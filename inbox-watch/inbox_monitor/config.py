"""Configuration for an inbox-monitor instance: one TOML file per mailbox.

Everything owner- or machine-specific lives here, so the engine is the same for every person it runs for.
See examples/config.example.toml for every key and its default.
"""
from __future__ import annotations

import os
import tomllib
from dataclasses import dataclass, field
from pathlib import Path

DEFAULT_PROMPTS = Path(__file__).resolve().parent / "prompts"


@dataclass
class Config:
    path: Path
    owner_name: str
    owner_email: str
    assistant_name: str
    timezone: str
    quiet_hours: tuple[int, int]          # hold ordinary alerts from the first hour to the second (local)
    digest_hour: int
    lookahead: dict[str, tuple[int, int]]  # slot -> [start hour, end hour)
    state_dir: Path
    preferences_file: Path
    prompts_dir: Path
    mail: dict
    judge: dict
    deliveries: list[dict]
    pocket: dict                           # root, session_dir, provider: start links for alerts (empty = none)
    briefing_footer: str
    own_domains: list[str] = field(default_factory=list)
    noise_words: list[str] = field(default_factory=list)  # [owner] noise_words: words in every subject that say nothing (company name, group prefix)
    memory_search: bool = False            # the judge may call memstem_search / memstem_get (OpenClaw, Claude with MCP)
    judge_language: str = ""              # extra standing instruction for the judge, e.g. a house style
    memory: dict = field(default_factory=dict)  # [memory]: where surfaced items are remembered (empty = nowhere)
    schedule: dict = field(default_factory=dict)
    firstpass: dict = field(default_factory=dict)
    tidy: dict = field(default_factory=dict)  # [tidy]: take resolved or handled entries off the owner's Inbox  # [firstpass]: skip routine mail before the judge (firstpass.py)  # [schedule] as written: every, paused, [[schedule.period]] (see schedule.py)

    def quiet(self, hour: int) -> bool:
        a, b = self.quiet_hours
        return hour >= a or hour < b if a > b else a <= hour < b


def _path(base: Path, v: str | None, default: Path) -> Path:
    if not v:
        return default
    p = Path(os.path.expanduser(v))
    return p if p.is_absolute() else (base / p).resolve()


def load(path: str | os.PathLike) -> Config:
    p = Path(path).resolve()
    with p.open("rb") as f:
        raw = tomllib.load(f)
    base = p.parent
    owner = raw.get("owner", {})
    sched = raw.get("schedule", {})
    la = sched.get("lookahead", {"morning": [8, 12], "evening": [17, 22]})
    state_dir = _path(base, raw.get("state_dir"), base / "state")
    mail = dict(raw.get("mail", {}))
    if "service_account_file" in mail:
        mail["service_account_file"] = str(_path(base, mail["service_account_file"], base))
    for k in ("oauth_client_file", "oauth_token_file"):
        if k in mail:
            mail[k] = str(_path(base, mail[k], base))
    email = owner.get("email", "")
    if not email:
        raise ValueError(f"{p}: [owner] email is required")
    domain = email.split("@")[-1].lower()
    return Config(
        path=p,
        owner_name=owner.get("name") or email.split("@")[0],
        owner_email=email,
        assistant_name=raw.get("assistant", {}).get("name", "your assistant"),
        timezone=owner.get("timezone", "UTC"),
        quiet_hours=tuple(sched.get("quiet_hours", [22, 8])),
        digest_hour=int(sched.get("digest_hour", 8)),
        lookahead={k: (int(v[0]), int(v[1])) for k, v in la.items()},
        state_dir=state_dir,
        preferences_file=_path(base, raw.get("preferences_file"), base / "preferences.md"),
        prompts_dir=_path(base, raw.get("prompts_dir"), DEFAULT_PROMPTS),
        mail=mail,
        judge=dict(raw.get("judge", {})),
        deliveries=list(raw.get("delivery", [])),
        pocket=dict(raw.get("pocket", {})),
        briefing_footer=raw.get("briefing", {}).get("footer", ""),
        own_domains=[domain] + list(owner.get("own_domains", [])),
        noise_words=[str(w) for w in owner.get("noise_words", [])],
        memory_search=bool(raw.get("judge", {}).get("memory_search", False)),
        judge_language=raw.get("judge", {}).get("standing_instruction", ""),
        memory=dict(raw.get("memory", {})),
        schedule=dict(sched),
        firstpass=dict(raw.get("firstpass", {})),
        tidy=dict(raw.get("tidy", {})),
    )
