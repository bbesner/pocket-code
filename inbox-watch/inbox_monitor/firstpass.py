"""First pass: a decision model (TypeSafe Jev, or OpenAI's decision model, through OpenRouter's decisions endpoint) reads
each changed thread that may be skipped and says whether it is routine. Routine mail above the confidence threshold does
not go to the judge in full; its one-line headline rides along in the next decision turn instead, so a payment
confirmation or a "back up" notice can still close a story the judge is following.

Which threads may be skipped at all is decided by code, never by the classifier (engine.firstpass_eligible): not a thread
the owner wrote in, not one already judged worth more than ignore, not one that closely matches a story touched in the
last week. Any error, timeout or refusal means "review": the first pass can only ever send mail to the judge, not lose it.

Backtest 2026-10-20 (996 past decisions, Sonnet's action as the label): Jev and OpenAI rank equally (AUC 0.863 / 0.862);
at 0.9 with the rules no alert was skipped; Jev $0.000042 an email, 0.14 s. Day replay at 5 minutes: −18% (0.9) to −22% (0.8).

  [firstpass]
  enabled = true
  provider = "jev"          # jev | openai | both (skip only when both agree)
  threshold = 0.8           # probability of "skip" at or above which a thread is skipped
  key_file = "~/.config/openrouter/keys/inbox-monitor.key"   # or key_env = "OPENROUTER_API_KEY"
"""
from __future__ import annotations

import concurrent.futures as cf
import json
import os
import time
import urllib.error
import urllib.request

ENDPOINT = "https://openrouter.ai/api/alpha/decisions"
MODELS = {"jev": "~typesafe/jev-latest", "openai": "openai/gpt-6-luna-decisions"}
PROVIDERS = [("jev", "Jev (TypeSafe)"), ("openai", "OpenAI decision model"), ("both", "Both must agree")]
THRESHOLDS = [0.95, 0.9, 0.8, 0.7]
INSTRUCTIONS = ("Should the assistant read this email carefully, or is it routine mail it can safely skip? Skip only mail that clearly "
                "carries nothing {owner} would need to know or act on. If {owner}'s rules ask to hear about this kind of mail, it is review, "
                "never skip. When in doubt, review.")
RULES_CHARS = 6000  # the owner's rules ride along with every email (about 1.5k tokens at most)
CRITERIA = {
    "skip": "Routine automated or bulk mail with nothing to know or do: receipts and successful payment confirmations, order, shipping and "
            "delivery notices, newsletters, marketing and promotions, social or app notifications, verification codes, routine daily or "
            "weekly reports that show nothing wrong.",
    "review": "Anything that could matter: a person writing, a customer, vendor or employee issue, money owed, failed, declined or unusual, "
              "a deadline, a renewal or cancellation, a security, fraud or outage alert, a problem in a report, legal, tax, "
              "banking, insurance or account notices, anything unusual.",
}


def defaults(cfg: dict) -> dict:
    """The settings shape for the first pass, from the [firstpass] table."""
    p = cfg.get("provider", "jev")
    try:
        t = float(cfg.get("threshold", 0.8))
    except (TypeError, ValueError):
        t = 0.8
    return {"enabled": bool(cfg.get("enabled", False)), "provider": p if p in MODELS or p == "both" else "jev",
            "threshold": t if 0.5 <= t <= 0.99 else 0.8}


class FirstPass:
    def __init__(self, cfg: dict, owner: str, context: str, log=print):
        self.cfg = cfg
        self.owner = owner
        self.context = context
        self.log = log
        self.timeout = float(cfg.get("timeout", 20))  # OpenRouter stalls of 8–23 s that then complete (MemStem ledger); a check is not in a hurry
        self.workers = int(cfg.get("workers", 6))
        self.models = {**MODELS, **(cfg.get("models") or {})}

    def key(self) -> str | None:
        if self.cfg.get("key_env") and os.environ.get(self.cfg["key_env"]):
            return os.environ[self.cfg["key_env"]]
        f = self.cfg.get("key_file")
        if f:
            try:
                return open(os.path.expanduser(f)).read().strip() or None
            except OSError:
                return None
        return os.environ.get("OPENROUTER_API_KEY")

    @property
    def available(self) -> bool:
        return bool(self.key())

    @staticmethod
    def email_text(b: dict) -> str:
        m = b["messages"][-1]
        return (f"From: {m['from']}\nTo: {(m.get('to') or '')[:300]}\nSubject: {b['subject']}\nMessages in thread: {b['message_count']}\n"
                f"Gmail labels: {', '.join(m.get('labels') or [])}\n\n{(m.get('body') or '')[:3000]}")

    def _ask(self, model: str, b: dict, key: str, rules: str = "") -> dict:
        context = self.context + (f"\n\n{self.owner}'s own rules for what they want to hear about (they override the descriptions below):\n"
                                  f"{rules[:RULES_CHARS]}" if rules.strip() else "")
        body = {"model": model, "state": {"context": context, "email": self.email_text(b)},
                "questions": {"triage": {"type": "choice", "instructions": INSTRUCTIONS.format(owner=self.owner), "criteria": CRITERIA}}}
        req = urllib.request.Request(ENDPOINT, data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"})
        t0 = time.time()
        for attempt in range(3):
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as r:
                    j = json.load(r)
                break
            except urllib.error.HTTPError as ex:
                if ex.code in (429, 500, 502, 503) and attempt < 2:
                    time.sleep(1.5 * (attempt + 1))
                    continue
                raise
            except (TimeoutError, urllib.error.URLError, OSError):
                # OpenRouter has a slow tail (2026-10-20 11:03 AM: three 8 s timeouts while a probe answered in 0.2 s); one retry
                if attempt < 1:
                    continue
                raise
        a = (j.get("answers") or {}).get("triage") or {}
        if a.get("type") == "refusal" or "probabilities" not in a:
            raise RuntimeError("no answer")
        u = j.get("usage") or {}
        return {"p_skip": float((a.get("probabilities") or {}).get("skip", 0)), "cost": u.get("cost"), "ms": int((time.time() - t0) * 1000)}

    def classify(self, b: dict, settings: dict, key: str, rules: str = "") -> dict:
        """{skip: bool, p_skip, provider, cost, ms, error}. Errors mean review."""
        provider, threshold = settings["provider"], settings["threshold"]
        names = ["jev", "openai"] if provider == "both" else [provider]
        out = {"skip": False, "p_skip": None, "provider": provider, "cost": 0.0, "ms": 0, "error": None}
        ps = []
        try:
            for n in names:
                r = self._ask(self.models[n], b, key, rules)
                ps.append(r["p_skip"])
                out["cost"] += r["cost"] or 0
                out["ms"] = max(out["ms"], r["ms"])
        except Exception as ex:  # noqa: BLE001 - fail open: the judge reads it
            out["error"] = str(ex)[:200]
            return out
        out["p_skip"] = min(ps)
        out["skip"] = out["p_skip"] >= threshold
        return out

    def run(self, bundles: list[dict], settings: dict, rules: str = "") -> dict[str, dict]:
        """thread_id -> result, for the eligible bundles given; empty when there is no key."""
        key = self.key()
        if not key or not bundles:
            return {}
        with cf.ThreadPoolExecutor(min(self.workers, len(bundles))) as pool:
            return dict(zip((b["thread_id"] for b in bundles), pool.map(lambda b: self.classify(b, settings, key, rules), bundles)))
