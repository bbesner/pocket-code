"""The owner's memory in decisions and in the tidy pass, and the judge's own tool calls in the ledger, against a fake
memory. No MemStem, model or network.

    python3 tests/test_memory.py
"""
import datetime as dt
import json
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inbox_monitor import config as cfgmod  # noqa: E402
from inbox_monitor import engine as E  # noqa: E402
from inbox_monitor.judges import ClaudeJudge  # noqa: E402
from inbox_monitor.memory_search import MemstemSearch, dedupe_sessions  # noqa: E402

S1 = "3c9a1f52-7d0e-4b8a-9e61-2f4d5a6b7c80"


class FakeSearch:
    def __init__(self, hits):
        self.hits, self.queries, self.broken = hits, [], False

    def search(self, query, limit=10):
        self.queries.append(query)
        return list(self.hits)

    def body(self, mid):
        return {"s1": "User: fix the portal packing slip bug. " + "x " * 600 + "Assistant: fixed, released 1.4.2 to production."}.get(mid, "")

    def close(self):
        pass


def setup():
    d = Path(tempfile.mkdtemp())
    (d / "config.toml").write_text('[owner]\nname = "Alex"\nemail = "alex@example.com"\ntimezone = "UTC"\n\n[judge]\nkind = "claude"\nmodel = "sonnet"\n')
    E.configure(cfgmod.load(d / "config.toml"))
    return E.Store(d / "state" / "m.sqlite")


def hit(i, typ, updated, title="t", path=None):
    return {"id": i, "type": typ, "title": title, "path": path or f"{typ}s/{i}.md", "created": updated, "updated": updated, "snippet": f"snippet {i}"}


def test_items_marked_after_and_future_hidden():
    setup()
    E.MEMORY_SEARCH = FakeSearch([hit("s1", "session", "2026-10-21T15:00:00Z", "portal bug session"),
                                  hit("old", "daily", "2026-10-01T12:00:00Z", "packing slip printer notes"),
                                  hit("future", "memory", "2026-10-23T12:00:00Z")])
    E.MODE.sim = dt.datetime(2026, 10, 22, 12, 0, tzinfo=dt.timezone.utc)
    try:
        items = E.memory_items("portal packing slip", "2026-10-21T13:00:00+00:00", 3)
        assert [m["ref"] for m in items] == ["mem:s1", "mem:old"], "nothing written after now (a replay's now)"
        assert items[0]["after"] is True and items[1]["after"] is False
        assert items[0]["text"].startswith("… ") and "released 1.4.2" in items[0]["text"], "a session shows its end"
        assert len(items[0]["text"]) <= E.MEMORY_ITEM_CHARS + 1
        only = E.memory_items("portal packing slip", "2026-10-21T13:00:00+00:00", 3, since="2026-10-21T13:00:00+00:00")
        assert [m["ref"] for m in only] == ["mem:s1"]
    finally:
        E.MODE.sim = None
        E.MEMORY_SEARCH = None
    assert E.memory_items("anything", None, 3) == [], "off: nothing"


def test_unrelated_memory_left_out():
    setup()
    E.MEMORY_SEARCH = FakeSearch([hit("zoho", "session", "2026-10-21T15:00:00Z", "Audit the Zoho Books billing for the alarm accounts"),
                                  hit("own", "memory", "2026-10-21T15:00:00Z", "Alex asked Ari about Oct billing"),
                                  hit("inv", "daily", "2026-10-21T15:00:00Z", "2026-10-21"),
                                  hit("nikki", "distillation", "2026-10-21T15:00:00Z", "Nikki Sabatelli asked to change the billing card")])
    E.MEMORY_SEARCH.body = lambda mid: {"inv": "Sent Vanderbilt the corrected INV-17693 on Tuesday."}.get(mid, "")
    try:
        got = E.memory_items("Billing Information INV-17693 Nikki Sabatelli vanderbiltop", None, 3)
    finally:
        E.MEMORY_SEARCH = None
    assert [m["ref"] for m in got] == ["mem:inv", "mem:nikki"], "one shared word is not enough; the owner's and assistant's names and dates count for nothing; an identifier is"
    assert E.memory_relevant("Doorbell reset", "Reset the front doorbell camera", "")
    assert not E.memory_relevant("Invoice", "Invoice for the alarm audit", ""), "a one-word query needs an identifier"


def test_query_names_the_sender_not_a_system():
    setup()
    q = E.memory_query("RE: Order 7644799 missing camera", '"Dana Whitfield" <greg@harborviewhomes.com>', "about order 7644799")
    assert "Dana Whitfield" in q and "harborviewhomes" in q and "7644799" in q and "@" not in q, q
    q = E.memory_query("Your statement is ready", "Northwind Bank <no-reply@notify.northwindbank.com>")
    assert "Northwind Bank" not in q and "northwindbank" in q, q


def test_search_leaves_out_own_records_and_skills():
    s = MemstemSearch({"folder": "memories/inbox-watch", "search_exclude": ["memories/private"]}, lambda m: None)
    s.opened = True

    class C:
        def tool(self, name, args):
            fm = lambda **k: {"updated": "2026-10-21T10:00:00Z", **k}  # noqa: E731
            return [{"id": "a", "type": "memory", "path": "memories/inbox-watch/alex/x.md", "frontmatter": fm()},
                    {"id": "b", "type": "skill", "path": "skills/x/SKILL.md", "frontmatter": fm()},
                    {"id": "c", "type": "memory", "path": "memories/private/y.md", "frontmatter": fm()},
                    {"id": "d", "type": "memory", "path": "memories/z.md", "frontmatter": fm(source="inbox-monitor")},
                    {"id": "e", "type": "distillation", "path": f"distillations/claude-code/{S1}.md",
                     "frontmatter": fm(provenance={"source_updated": "2026-10-21T21:32:00Z"})},
                    {"id": "f", "type": "session", "path": f"sessions/{S1}.md", "frontmatter": fm(updated="2026-10-21T21:30:00Z")}]
    s.client = C()
    got = s.search("portal bug")
    assert [h["id"] for h in got] == ["e"], "own records, skills, excluded paths gone; the session folds into its distillation"
    assert got[0]["updated"] == "2026-10-21T21:32:00Z", "a distillation is dated by the session it summarises"


def test_session_kept_when_it_went_on_after_its_summary():
    hits = [{"id": "e", "type": "distillation", "path": f"distillations/claude-code/{S1}.md", "updated": "2026-10-21T21:00:00Z"},
            {"id": "f", "type": "session", "path": f"sessions/{S1}.md", "updated": "2026-10-22T09:00:00Z"}]
    assert [h["id"] for h in dedupe_sessions(hits)] == ["e", "f"]


def test_search_failure_turns_it_off_for_the_check():
    logs = []
    s = MemstemSearch({}, logs.append)
    s.opened = True

    class C:
        def tool(self, name, args):
            raise RuntimeError("down")

        def close(self):
            pass
    s.client = C()
    assert s.search("x") == [] and s.broken and "memory search off" in logs[0]
    assert s.search("y") == [] and len(logs) == 1, "no retry within the check"


def test_tidy_takes_a_memory_ref_as_proof():
    store = setup()

    class Pocket:
        kind = "pocket"
        acted = []

        def inbox_open(self):
            return [{"id": "e1", "kind": "alert", "title": "portal packing slip bug", "story": "", "at": "2026-10-21T13:00:00Z", "text": "Rob reports…"},
                    {"id": "e2", "kind": "alert", "title": "Vendor invoice", "story": "", "at": "2026-10-21T13:00:00Z", "text": "Due Friday"}]

        def act(self, eid, action, note):
            self.acted.append((eid, action, note))
    p = Pocket()
    E.DELIVERIES = [p]
    E.MEMORY_SEARCH = FakeSearch([hit("s1", "session", "2026-10-21T15:00:00Z", "portal bug session")])
    sent = {}

    def judge(msg, purpose="decide", threads=0, memory_items=0, lookahead=False):
        sent["msg"], sent["n"] = msg, memory_items
        return {"entries": [{"id": "e1", "verdict": "resolved", "reason": "Fixed and released in a session Tuesday 11 AM.", "evidence": ["mem:s1"]},
                            {"id": "e2", "verdict": "handled", "reason": "Paid.", "evidence": ["mem:made-up"]}]}
    saved = E.call_judge
    E.call_judge = judge
    try:
        E.tidy(store, E.Archive(Path(tempfile.mkdtemp()) / "mail.sqlite"))
    finally:
        E.call_judge = saved
        E.MEMORY_SEARCH = None
    assert '"ref":"mem:s1"' in sent["msg"] and '"date_iso"' not in sent["msg"] and sent["n"] == 1, "the portal session is not shown with the invoice"
    assert p.acted == [("e1", "resolve", "Resolved: Fixed and released in a session Tuesday 11 AM.")], "a ref it was not shown is no proof"


def test_stream_records_tool_calls():
    out = "\n".join(json.dumps(x) for x in [
        {"type": "system", "subtype": "init"},
        {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "mcp__memstem__memstem_search", "input": {"query": "Addison", "limit": 5}}]}},
        {"type": "user", "message": {"content": [{"type": "tool_result", "content": "…"}]}},
        {"type": "assistant", "message": {"content": [{"type": "text", "text": "{}"}]}},
        {"type": "result", "result": "{}", "num_turns": 2, "total_cost_usd": 0.05}])
    data, tools = ClaudeJudge.parse_stream(out)
    assert data["num_turns"] == 2 and tools == [{"name": "memstem_search", "input": {"query": "Addison", "limit": 5}}]
    data, tools = ClaudeJudge.parse_stream(json.dumps({"type": "result", "result": "{}", "num_turns": 1}))
    assert data["num_turns"] == 1 and tools == [], "a single result event: no tool calls"
    store = setup()

    class J:
        name, model, reasoning = "claude", "sonnet", "medium"
        last_usage = {"model": "sonnet", "turns": 2, "tools": tools + [{"name": "memstem_get", "input": {"id_or_path": "x"}}]}
    E.record_call(store.db, "decide", J(), 100, 3, True, 1, memory_items=4)
    r = store.db.execute("select turns, tool_calls, tools, memory_items from judge_calls").fetchone()
    assert (r["turns"], r["tool_calls"], r["memory_items"]) == (2, 1, 4) and "memstem_get" in r["tools"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
