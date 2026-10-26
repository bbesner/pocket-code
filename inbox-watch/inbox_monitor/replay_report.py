#!/usr/bin/env python3
"""Print what a replay would have sent to the owner, in order, as Markdown (Telegram HTML converted)."""
import datetime as dt
import html
import re
import sqlite3
import sys
from zoneinfo import ZoneInfo

TZ = ZoneInfo("America/New_York")
db = sqlite3.connect(sys.argv[1] if len(sys.argv) > 1 else "state/replay.sqlite")
db.row_factory = sqlite3.Row


def md(h: str) -> str:
    h = re.sub(r'<a href="([^"]+)">(.*?)</a>', r"[\2](\1)", h)
    h = re.sub(r"</?b>", "**", h)
    h = re.sub(r"</?i>", "_", h)
    return html.unescape(h)


kinds = {"notify": "Alert", "checkin": "Look-ahead", "digest": "Morning digest"}
day = None
for r in db.execute("select * from outbox order by id"):
    t = dt.datetime.fromisoformat(r["at"]).astimezone(TZ)
    if t.date() != day:
        day = t.date()
        print(f"\n## {t.strftime('%A %B %-d')}\n")
    print(f"### {t.strftime('%-I:%M %p')} · {kinds.get(r['kind'], r['kind'])}\n")
    body = md(r["html"]).replace("\n_Reply here and I'll handle it._", "").strip()
    print("> " + body.replace("\n", "\n> ") + "\n")
