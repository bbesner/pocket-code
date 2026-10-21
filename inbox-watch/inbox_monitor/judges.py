"""The judge: whoever reads the bundle and answers with the JSON decisions. Four ways to run one.

  kind = "openclaw"   an OpenClaw agent (`openclaw agent --agent … --model …`), the owner's own assistant with its
                      memory and tools; sessions rotate every few calls so context never reaches compaction.
  kind = "claude"     Claude Code headless (`claude -p --output-format json`), one fresh process per call, isolated:
                      no built-in tools, no user settings or hooks, no CLAUDE.md, no saved transcript. Give it memory
                      with `mcp_config` (a JSON file of MCP servers) and `allowed_tools` (the tool names it may call).
  kind = "codex"      Codex CLI headless (`codex exec --json --ephemeral`), one fresh process per call.
  kind = "anthropic"  the Claude API directly through the official SDK (model claude-opus-5-5 by default, adaptive
                      thinking, explicit effort, server-side refusal fallback). Needs ANTHROPIC_API_KEY or an
                      `ant auth login` profile in the environment the timer runs with.

Every judge takes the complete message (instruction + bundle) and returns the model's text; the engine parses the
JSON. Memory lives in the engine's archive and story ledger, so a judge never needs to remember an earlier call.
After each call `last_usage` holds what it cost, as far as the judge can tell: tokens in (of which written to and read
from the prompt cache), tokens out, reasoning tokens, dollars at list price (Claude Code reports it; None elsewhere) and
milliseconds. The engine keeps one row per call in `judge_calls`.
"""
from __future__ import annotations

import json
import os
import subprocess
import tempfile
from pathlib import Path


def find_key(obj, key: str):
    if isinstance(obj, dict):
        if key in obj and obj[key]:
            return obj[key]
        for v in obj.values():
            r = find_key(v, key)
            if r:
                return r
    elif isinstance(obj, list):
        for v in obj:
            r = find_key(v, key)
            if r:
                return r
    return None


def effort(cfg: dict, key: str = "reasoning", fallback: str = "thinking") -> str | None:
    """The configured reasoning level, or None for "default" (leave the model's own)."""
    v = cfg.get(key) or cfg.get(fallback)
    return None if not v or v == "default" else str(v)


def blank_usage(model: str | None) -> dict:
    return {"model": model or "", "input": None, "cache_write": None, "cache_read": None, "output": None, "thinking": None, "cost_usd": None, "ms": None}


class Judge:
    name = "judge"
    model: str | None = None
    reasoning: str | None = None
    last_usage: dict | None = None

    def ask(self, message: str, *, tag: str = "") -> str:  # pragma: no cover - interface
        raise NotImplementedError

    def describe(self) -> str:
        return self.name


class OpenClawJudge(Judge):
    """`openclaw agent` in the owner's workspace. `tag` names the run (live or a replay) for the session key."""
    name = "openclaw"

    def __init__(self, cfg: dict, state_dir: Path, session_prefix: str = "email-monitor"):
        self.bin = cfg.get("bin", "openclaw")
        self.config = cfg.get("config")
        self.agent = cfg.get("agent", "main")
        self.model = cfg.get("model")
        self.thinking = effort(cfg) or "medium"  # OpenClaw calls it thinking and needs a level
        self.reasoning = self.thinking
        self.timeout = int(cfg.get("timeout", 300))
        self.cwd = cfg.get("cwd") or (str(Path(self.config).parent) if self.config else None)
        self.calls_per_session = int(cfg.get("calls_per_session", 6))
        self.prefix = session_prefix
        self.counter = state_dir / "judge-session-counter"
        self._day, self._n = None, 0
        self.last_session = ""

    def _session_key(self, day: str, tag: str) -> str:
        if not tag and self._day is None and self.counter.exists():
            d, _, n = self.counter.read_text().partition(" ")
            self._day, self._n = d, int(n or 0)
        if self._day != day:
            self._day, self._n = day, 0
        k = self._n // self.calls_per_session
        self._n += 1
        if not tag:
            self.counter.write_text(f"{day} {self._n}")
        suffix = f"-{tag}" if tag else ""
        return f"agent:{self.agent}:{self.prefix}{suffix}-{day}-{k}"

    def ask(self, message: str, *, tag: str = "", day: str = "") -> str:
        import datetime as dt
        day = day or dt.datetime.now().strftime("%Y%m%d")
        self.last_session = self._session_key(day, tag)
        with tempfile.NamedTemporaryFile("w", suffix=".md", delete=False) as f:
            f.write(message)
            path = f.name
        try:
            env = dict(os.environ)
            if self.config:
                env["OPENCLAW_CONFIG_PATH"] = self.config
            cmd = [self.bin, "agent", "--agent", self.agent, "--session-key", self.last_session, "--thinking", self.thinking,
                   "--timeout", str(self.timeout), "--json", "--message-file", path]
            if self.model:
                cmd += ["--model", self.model]
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=self.timeout + 60, env=env, cwd=self.cwd)
        finally:
            os.unlink(path)
        self.last_usage = blank_usage(self.model)
        if r.returncode != 0:
            raise RuntimeError(f"openclaw agent exited {r.returncode}: {r.stderr[-800:]}")
        out = r.stdout
        try:
            parsed = json.loads(out[out.index("{"):])
            return find_key(parsed, "finalAssistantVisibleText") or find_key(parsed, "finalAssistantRawText") or ""
        except (ValueError, json.JSONDecodeError):
            return out

    def describe(self) -> str:
        return f"openclaw agent {self.agent}" + (f" model {self.model}" if self.model else "")


class ClaudeJudge(Judge):
    """Claude Code headless, isolated from the machine's own Claude Code setup by default.

    The judge reads untrusted email, so it gets no built-in tools (no Bash, no file or web access), only the MCP tools
    named in `allowed_tools` from the servers in `mcp_config`, and anything else is denied rather than prompted. The
    user's settings are not loaded (their permission mode and hooks would otherwise apply: 2026-10-19, a user-level
    `bypassPermissions` gave the judge Bash), nor any CLAUDE.md / AGENTS.md, and no transcript is saved (a memory
    indexer watching ~/.claude/projects would otherwise ingest every bundle). `isolate = false` restores the old
    behaviour.

    The prompt cache is off by default (`prompt_cache = false`): every bundle is new, so Claude Code's one-hour cache
    write (about twice the input price) was paid on each call and never read back (2026-10-20: 45% of the cost)."""
    name = "claude"
    ISOLATION = ["--no-session-persistence", "--setting-sources", "project", "--permission-mode", "dontAsk", "--tools", "",
                 "--strict-mcp-config", "--settings",
                 json.dumps({"claudeMdExcludes": ["/**/CLAUDE.md", "/**/CLAUDE.local.md", "/**/AGENTS.md", "/**/.claude/**"]})]

    def __init__(self, cfg: dict, state_dir: Path):
        self.bin = cfg.get("bin", "claude")
        self.model = cfg.get("model", "opus")
        self.timeout = int(cfg.get("timeout", 300))
        self.cwd = cfg.get("cwd") or str(state_dir)
        self.reasoning = effort(cfg)  # low | medium | high | xhigh | max, as `claude --effort`; None = the model's default
        self.prompt_cache = bool(cfg.get("prompt_cache", False))
        self.isolate = bool(cfg.get("isolate", True))
        self.mcp_config = cfg.get("mcp_config")  # e.g. a JSON file with only the memstem server
        self.allowed_tools = list(cfg.get("allowed_tools", []))  # e.g. ["mcp__memstem__memstem_search", "mcp__memstem__memstem_get"]
        self.args = list(cfg.get("args", []))  # anything else, passed through last

    def ask(self, message: str, *, tag: str = "", day: str = "") -> str:
        env = {k: v for k, v in os.environ.items() if k not in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT")}
        if not self.prompt_cache:
            env["DISABLE_PROMPT_CACHING"] = "1"
        cmd = [self.bin, "-p", "--output-format", "json", "--model", self.model]
        if self.isolate:
            cmd += self.ISOLATION
        if self.mcp_config:
            cmd += ["--mcp-config", str(self.mcp_config)]
        if self.allowed_tools:
            cmd += ["--allowedTools", ",".join(self.allowed_tools)]
        cmd += self.args
        if self.reasoning:
            cmd += ["--effort", self.reasoning]
        self.last_usage = blank_usage(self.model)
        r = subprocess.run(cmd, input=message, capture_output=True, text=True, timeout=self.timeout, env=env, cwd=self.cwd)
        if r.returncode != 0:
            raise RuntimeError(f"claude exited {r.returncode}: {r.stderr[-800:] or r.stdout[-800:]}")
        try:
            data = json.loads(r.stdout)
        except json.JSONDecodeError:
            return r.stdout
        self.last_usage = self.usage(data)
        if data.get("is_error"):
            raise RuntimeError(f"claude: {str(data.get('result'))[:400]}")
        return str(data.get("result") or "")

    def usage(self, data: dict) -> dict:
        """Tokens across every model the call used (Claude Code also runs a small Haiku pass), the reported list-price cost."""
        u = blank_usage(self.model)
        mu = data.get("modelUsage") if isinstance(data.get("modelUsage"), dict) else {}
        if mu:
            def tot(k):
                return sum(int(v.get(k) or 0) for v in mu.values() if isinstance(v, dict))
            u.update(input=tot("inputTokens") + tot("cacheCreationInputTokens") + tot("cacheReadInputTokens"), cache_write=tot("cacheCreationInputTokens"),
                     cache_read=tot("cacheReadInputTokens"), output=tot("outputTokens"), thinking=tot("thinkingTokens"))
            main = max(mu.items(), key=lambda kv: float((kv[1] or {}).get("costUSD") or 0))[0]
            u["model"] = main
        elif isinstance(data.get("usage"), dict):
            x = data["usage"]
            cw, cr = int(x.get("cache_creation_input_tokens") or 0), int(x.get("cache_read_input_tokens") or 0)
            u.update(input=int(x.get("input_tokens") or 0) + cw + cr, cache_write=cw, cache_read=cr, output=int(x.get("output_tokens") or 0))
        if data.get("total_cost_usd") is not None:
            u["cost_usd"] = float(data["total_cost_usd"])
        u["ms"] = data.get("duration_ms")
        return u

    def describe(self) -> str:
        return (f"claude -p model {self.model}" + (f" effort {self.reasoning}" if self.reasoning else "")
                + (" (isolated" + (f", tools {','.join(self.allowed_tools)})" if self.allowed_tools else ", no tools)") if self.isolate else " (NOT isolated)")
                + ("" if self.prompt_cache else ", no prompt cache"))


class CodexJudge(Judge):
    """Codex CLI headless, no session files, no sandboxed commands needed (the judge only reads and writes JSON).

    Isolated by default (2026-10-21): without an explicit `codex_home` it runs in its own CODEX_HOME beside the state,
    holding only a link to the owner's sign-in (`auth.json`) and a config with every ChatGPT app off (the owner's Gmail
    app may allow sending, and the judge reads untrusted email), no shell, plugins or memories. An explicit
    `codex_home` is used as is; `isolate = false` uses the owner's own."""
    name = "codex"
    LOCKED = ('# Written by Inbox Watch for the judge: no apps, no shell. Rewritten on every start.\n'
              'approval_policy = "never"\nsandbox_mode = "read-only"\nweb_search = "disabled"\n\n'
              '[features]\nshell_tool = false\nunified_exec = false\nplugins = false\nmemories = false\napps = false\n\n'
              '[apps._default]\nenabled = false\n')

    def __init__(self, cfg: dict, state_dir: Path):
        self.bin = cfg.get("bin", "codex")
        self.model = cfg.get("model")
        self.timeout = int(cfg.get("timeout", 300))
        self.cwd = cfg.get("cwd") or str(state_dir)
        self.codex_home = cfg.get("codex_home")
        if not self.codex_home and cfg.get("isolate", True):
            self.codex_home = str(self.locked_home(state_dir))
        self.reasoning = effort(cfg)  # minimal | low | medium | high | xhigh, as model_reasoning_effort; None = the default
        self.args = list(cfg.get("args", []))

    @classmethod
    def locked_home(cls, state_dir: Path) -> Path:
        home = state_dir / "judge-codex-home"
        home.mkdir(parents=True, exist_ok=True)
        src = Path(os.path.expanduser(os.environ.get("CODEX_HOME") or "~/.codex")) / "auth.json"
        link = home / "auth.json"
        if link.is_symlink() and os.readlink(link) != str(src):
            link.unlink()
        if not link.is_symlink():
            link.symlink_to(src)
        (home / "config.toml").write_text(cls.LOCKED)
        return home

    def ask(self, message: str, *, tag: str = "", day: str = "") -> str:
        env = dict(os.environ)
        if self.codex_home:
            env["CODEX_HOME"] = self.codex_home
        with tempfile.NamedTemporaryFile("w", suffix=".txt", delete=False) as f:
            last = f.name
        try:
            cmd = [self.bin, "exec", "--json", "--ephemeral", "--skip-git-repo-check", "-C", self.cwd, "-s", "read-only",
                   "-o", last, *self.args]
            if self.model:
                cmd += ["-m", self.model]
            if self.reasoning:
                cmd += ["-c", f'model_reasoning_effort="{self.reasoning}"']
            self.last_usage = blank_usage(self.model)
            r = subprocess.run(cmd, input=message, capture_output=True, text=True, timeout=self.timeout, env=env, cwd=self.cwd)
            text = Path(last).read_text() if Path(last).exists() else ""
            self.last_usage = self.usage(r.stdout)
        finally:
            Path(last).unlink(missing_ok=True)
        if r.returncode != 0 and not text.strip():
            raise RuntimeError(f"codex exec exited {r.returncode}: {r.stderr[-800:]}")
        if text.strip():
            return text
        # fall back to the JSONL events: the last agent message
        for line in reversed(r.stdout.splitlines()):
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            item = ev.get("item") if isinstance(ev, dict) else None
            if isinstance(item, dict) and item.get("type") == "agent_message" and item.get("text"):
                return item["text"]
        return r.stdout

    def usage(self, jsonl: str) -> dict:
        """Codex reports tokens on turn.completed; no price."""
        u = blank_usage(self.model)
        for line in jsonl.splitlines():
            try:
                ev = json.loads(line)
            except json.JSONDecodeError:
                continue
            x = ev.get("usage") if isinstance(ev, dict) else None
            if isinstance(x, dict):
                cr = int(x.get("cached_input_tokens") or 0)
                u.update(input=int(x.get("input_tokens") or 0), cache_read=cr, cache_write=0, output=int(x.get("output_tokens") or 0),
                         thinking=int(x.get("reasoning_output_tokens") or 0) or None)
        return u

    def describe(self) -> str:
        return "codex exec" + (f" model {self.model}" if self.model else "")


class AnthropicJudge(Judge):
    """The Claude API through the official SDK. One request per call; no conversation state."""
    name = "anthropic"

    def __init__(self, cfg: dict, state_dir: Path):
        import anthropic
        self.model = cfg.get("model", "claude-opus-5-5")
        self.effort = effort(cfg, "reasoning", "effort")  # low | medium | high | xhigh | max; None = the model's default
        self.reasoning = self.effort
        self.max_tokens = int(cfg.get("max_tokens", 16000))
        self.timeout = float(cfg.get("timeout", 300))
        self.fallbacks = bool(cfg.get("fallbacks", True))
        key_env = cfg.get("api_key_env")
        self.client = anthropic.Anthropic(api_key=os.environ.get(key_env) if key_env else None, timeout=self.timeout, max_retries=2)

    def ask(self, message: str, *, tag: str = "", day: str = "") -> str:
        kwargs = dict(model=self.model, max_tokens=self.max_tokens, messages=[{"role": "user", "content": message}])
        if self.effort:
            kwargs["output_config"] = {"effort": self.effort}
        self.last_usage = blank_usage(self.model)
        if self.fallbacks:
            resp = self.client.beta.messages.create(betas=["server-side-fallback-2026-07-01"], fallbacks="default", **kwargs)
        else:
            resp = self.client.messages.create(**kwargs)
        x = getattr(resp, "usage", None)
        if x is not None:
            cw, cr = int(getattr(x, "cache_creation_input_tokens", 0) or 0), int(getattr(x, "cache_read_input_tokens", 0) or 0)
            self.last_usage.update(input=int(getattr(x, "input_tokens", 0) or 0) + cw + cr, cache_write=cw, cache_read=cr, output=int(getattr(x, "output_tokens", 0) or 0))
        if resp.stop_reason == "refusal":
            raise RuntimeError(f"anthropic: the request was declined ({getattr(resp, 'stop_details', None)})")
        return "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")

    def describe(self) -> str:
        return f"anthropic {self.model} effort {self.effort or 'default'}"


def make_judge(cfg: dict, state_dir: Path, session_prefix: str = "email-monitor") -> Judge:
    kind = cfg.get("kind", "openclaw")
    if kind == "openclaw":
        return OpenClawJudge(cfg, state_dir, session_prefix)
    if kind == "claude":
        return ClaudeJudge(cfg, state_dir)
    if kind == "codex":
        return CodexJudge(cfg, state_dir)
    if kind == "anthropic":
        return AnthropicJudge(cfg, state_dir)
    raise ValueError(f"judge.kind must be openclaw, claude, codex or anthropic, not {kind!r}")
