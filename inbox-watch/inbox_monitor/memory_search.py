"""What the owner's memory already says about a thread or an Inbox entry: past sessions with their assistants, saved notes,
summaries. Searched by the worker, not left to the judge, so every decision and every tidy pass sees it, and so it can be
logged and replayed.

  kind = "memstem"   MemStem, through its own MCP server (`memstem mcp`, tools `memstem_search` and `memstem_get`): one
                     server process per check, opened on the first search and closed when the check ends.

Configure in the [memory] table: `search = true` turns it on (off by default); `search_exclude` lists path prefixes left out
(the watcher's own records under `folder` always are, so it never reads its own alerts back as background);
`search_types` the record types kept (skills are not memory); `search_exclude_titles` regular expressions for titles of
standing background files that match every search (a business profile, a decisions log). A failing search never fails a check: it logs once and the
check goes on without memory.
"""
from __future__ import annotations

import json
import re
import select
import subprocess
import time

TYPES = ("session", "distillation", "memory", "daily", "project")
UUID_RX = re.compile(r"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}")


class McpStdio:
    """A minimal MCP client over a server's stdin/stdout: initialize, then tools/call."""

    def __init__(self, command: list[str], timeout: float, name: str = "inbox-monitor"):
        self.command, self.timeout, self.name = command, timeout, name
        self.p: subprocess.Popen | None = None
        self.n = 0

    def open(self) -> None:
        self.p = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        self.call("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": self.name, "version": "0.3"}})
        self.send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def close(self) -> None:
        if not self.p:
            return
        try:
            self.p.stdin.close()
            self.p.wait(timeout=10)
        except Exception:  # noqa: BLE001
            self.p.kill()
        self.p = None

    def send(self, msg: dict) -> None:
        self.p.stdin.write(json.dumps(msg) + "\n")
        self.p.stdin.flush()

    def call(self, method: str, params: dict) -> dict:
        self.n += 1
        mid = self.n
        self.send({"jsonrpc": "2.0", "id": mid, "method": method, "params": params})
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            ready, _, _ = select.select([self.p.stdout], [], [], max(0.1, deadline - time.time()))
            if not ready:
                break
            line = self.p.stdout.readline()
            if not line:
                raise RuntimeError(f"memstem mcp exited during {method}")
            try:
                msg = json.loads(line)
            except json.JSONDecodeError:
                continue
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"memstem {method}: {msg['error']}")
                return msg.get("result") or {}
        raise RuntimeError(f"memstem {method}: no answer in {self.timeout:.0f}s")

    def tool(self, name: str, arguments: dict):
        res = self.call("tools/call", {"name": name, "arguments": arguments})
        if res.get("isError"):
            raise RuntimeError(f"memstem {name}: {json.dumps(res.get('content'))[:300]}")
        sc = res.get("structuredContent")
        if sc is None:
            try:
                sc = json.loads((res.get("content") or [{}])[0].get("text") or "null")
            except (ValueError, IndexError, AttributeError):
                sc = None
        return sc.get("result", sc) if isinstance(sc, dict) and set(sc) == {"result"} else sc


class MemstemSearch:
    kind = "memstem"

    def __init__(self, cfg: dict, log):
        self.client = McpStdio(list(cfg.get("command") or ["memstem", "mcp"]), float(cfg.get("search_timeout", 60)))
        folder = cfg.get("folder", "memories/inbox-watch").strip("/")
        self.exclude = tuple([folder + "/"] + [str(p).strip("/") + "/" for p in cfg.get("search_exclude", [])])
        self.types = tuple(cfg.get("search_types") or TYPES)
        self.skip_titles = [re.compile(x) for x in cfg.get("search_exclude_titles", [])]  # standing background files, not events
        self.log = log
        self.opened = False
        self.broken = False
        self.searches = 0

    def close(self) -> None:
        self.client.close()
        self.opened = False

    def _ready(self) -> bool:
        if self.broken:
            return False
        if not self.opened:
            self.client.open()
            self.opened = True
        return True

    def search(self, query: str, limit: int = 10) -> list[dict]:
        """Hits as {id, type, title, path, created, updated, snippet}, the watcher's own records and skills left out. [] on failure."""
        query = " ".join(query.split())[:300]
        if not query:
            return []
        try:
            if not self._ready():
                return []
            raw = self.client.tool("memstem_search", {"query": query, "limit": limit})
            self.searches += 1
        except Exception as ex:  # noqa: BLE001 - memory is a help, never a reason to fail a check
            self.broken = True
            self.log(f"memory search off for this check: {ex}")
            self.close()
            return []
        out = []
        for h in raw if isinstance(raw, list) else []:
            fm = h.get("frontmatter") or {}
            path = h.get("path") or ""
            title = h.get("title") or fm.get("title") or ""
            if h.get("type") not in self.types or path.startswith(self.exclude) or fm.get("source") == "inbox-monitor":
                continue
            if any(x.search(title) for x in self.skip_titles):
                continue
            prov = fm.get("provenance") or {}
            out.append({"id": h.get("id") or fm.get("id"), "type": h.get("type"), "title": h.get("title") or fm.get("title") or "",
                        "path": path, "created": fm.get("created"), "updated": prov.get("source_updated") or fm.get("updated") or fm.get("created"),
                        "snippet": h.get("snippet") or ""})
        return dedupe_sessions(out)

    def body(self, mid: str) -> str:
        try:
            if not self._ready():
                return ""
            r = self.client.tool("memstem_get", {"id_or_path": mid})
        except Exception as ex:  # noqa: BLE001
            self.log(f"memory get {mid}: {ex}")
            return ""
        return (r or {}).get("body") or "" if isinstance(r, dict) else ""


def dedupe_sessions(hits: list[dict]) -> list[dict]:
    """A session and its distillation are one item: keep the distillation (a summary) unless the session went on after it."""
    distilled = {}
    for h in hits:
        if h["type"] == "distillation":
            m = UUID_RX.search(h["path"])
            if m:
                distilled[m.group(0)] = h
    out = []
    for h in hits:
        m = UUID_RX.search(h["path"]) if h["type"] == "session" else None
        d = distilled.get(m.group(0)) if m else None
        if d and (h.get("updated") or "") <= (d.get("updated") or ""):
            continue
        out.append(h)
    return out


def make_search(cfg: dict | None, log):
    if not cfg or not cfg.get("search"):
        return None
    kind = cfg.get("kind", "memstem")
    if kind == "memstem":
        return MemstemSearch(cfg, log)
    raise ValueError(f"memory.kind must be memstem, not {kind!r}")
