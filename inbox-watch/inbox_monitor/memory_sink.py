"""Where surfaced items are remembered. Anything the monitor put in front of the owner (an alert, a digest line, a
look-ahead, a digest) is worth finding again from any session, so it is written to the owner's memory system too.

  kind = "memstem"   MemStem, through its own MCP server (`memstem mcp`, tool `memstem_upsert`): the same write path a
                     Claude Code session uses, so the vault file, the index and the embedding queue stay consistent.

Configure with a [memory] table in the TOML. Records have stable ids and paths, so writing one again updates it.
"""
from __future__ import annotations

import json
import select
import subprocess
import time


class MemstemSink:
    kind = "memstem"

    def __init__(self, cfg: dict, log):
        self.command = list(cfg.get("command") or ["memstem", "mcp"])
        self.folder = cfg.get("folder", "memories/inbox-watch").strip("/")
        self.tags = list(cfg.get("tags", []))
        self.timeout = float(cfg.get("timeout", 60))
        self.log = log

    def upsert(self, records: list[dict]) -> list[str]:
        """Write records ({id, path, title, body, tags, created, importance, ref}); returns the ids that landed."""
        if not records:
            return []
        p = subprocess.Popen(self.command, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True, bufsize=1)
        done: list[str] = []
        try:
            self._call(p, 1, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                            "clientInfo": {"name": "inbox-monitor", "version": "0.3"}})
            self._send(p, {"jsonrpc": "2.0", "method": "notifications/initialized"})
            for n, r in enumerate(records, start=2):
                fm = {"id": r["id"], "type": "memory", "title": r["title"][:200], "source": "inbox-monitor",
                      "created": r["created"], "updated": r.get("updated") or r["created"], "tags": self.tags + r.get("tags", []),
                      "importance": r.get("importance", 0.6), "provenance": {"source": "inbox-monitor", "ref": r["ref"]}}
                res = self._call(p, n, "tools/call", {"name": "memstem_upsert",
                                                      "arguments": {"frontmatter": fm, "body": r["body"], "path": f"{self.folder}/{r['path']}"}})
                if res.get("isError"):
                    self.log(f"memstem upsert {r['ref']} failed: {json.dumps(res.get('content'))[:300]}")
                    continue
                done.append(r["id"])
        finally:
            try:
                p.stdin.close()
                p.wait(timeout=10)
            except Exception:  # noqa: BLE001
                p.kill()
        return done

    def _send(self, p: subprocess.Popen, msg: dict) -> None:
        p.stdin.write(json.dumps(msg) + "\n")
        p.stdin.flush()

    def _call(self, p: subprocess.Popen, mid: int, method: str, params: dict) -> dict:
        self._send(p, {"jsonrpc": "2.0", "id": mid, "method": method, "params": params})
        deadline = time.time() + self.timeout
        while time.time() < deadline:
            ready, _, _ = select.select([p.stdout], [], [], max(0.1, deadline - time.time()))
            if not ready:
                break
            line = p.stdout.readline()
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


def make_memory(cfg: dict | None, log):
    if not cfg:
        return None
    kind = cfg.get("kind", "memstem")
    if kind == "memstem":
        return MemstemSink(cfg, log)
    raise ValueError(f"memory.kind must be memstem, not {kind!r}")
