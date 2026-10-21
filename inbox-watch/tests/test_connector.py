"""The connector mail source against a fake `claude` that answers the way Claude Code's stream-json does.

    python3 -m pytest tests/test_connector.py      (or: python3 tests/test_connector.py)

No mailbox, model or network: the fake reads the requested calls from the prompt and answers from a JSON mailbox file.
"""
import json
import os
import stat
import subprocess
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inbox_monitor import mail_connector as C  # noqa: E402

FAKE = r'''#!/usr/bin/env python3
import json, os, re, sys
args = sys.argv[1:]
box = json.load(open(os.environ["FAKE_BOX"]))
log = open(os.environ["FAKE_LOG"], "a"); log.write(json.dumps(args) + "\n"); log.close()
prompt = sys.stdin.read()
calls = json.loads(prompt[prompt.index("["):])
def emit(e): print(json.dumps(e))
tools = [] if box.get("no_connector") else ["mcp__claude_ai_Gmail__" + t for t in ("search_threads", "get_thread", "get_message", "send_message", "list_labels", "create_label", "label_thread", "unlabel_thread")]
emit({"type": "system", "subtype": "init", "tools": tools})
skip = box.get("skip_first", 0) if len(open(os.environ["FAKE_LOG"]).readlines()) == 1 else 0  # only the first run skips
for i, c in enumerate(calls):
    if i < skip:
        continue
    tid = f"tu{i}"
    emit({"type": "assistant", "message": {"content": [{"type": "tool_use", "id": tid, "name": c["tool"], "input": c["input"]}]}})
    name = c["tool"].rsplit("__", 1)[-1]
    if name in ("label_thread", "unlabel_thread", "create_label") and box.get("read_only_grant"):
        emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "is_error": True, "content": "Insufficient scope: required https://mail.google.com/"}]}})
        continue
    elif name == "list_labels":
        res = {"labels": [{"id": "INBOX", "name": "INBOX"}] + [{"id": i, "name": n} for n, i in box.get("labels", {}).items()]}
    elif name == "create_label":
        box.setdefault("labels", {})[c["input"]["displayName"]] = "Label_9"; json.dump(box, open(os.environ["FAKE_BOX"], "w"))
        res = {"id": "Label_9", "name": c["input"]["displayName"]}
    elif name in ("label_thread", "unlabel_thread"):
        res = {"id": c["input"]["threadId"], "labelIds": c["input"]["labelIds"]}
    elif name == "search_threads":
        q = c["input"]["query"]
        threads = [t for t in box["threads"] if (m := re.search(r"after:(\d+)", q)) is None or max(int(x["internalDate"]) for x in t["messages"]) / 1000 > int(m.group(1))]
        if "in:sent" in q:
            threads = [t for t in box["threads"] if any("SENT" in x["labelIds"] for x in t["messages"])]
        res = {"threads": [{"id": t["id"], "messageCount": len(t["messages"]), "messages": [{k: v for k, v in t["messages"][-1].items() if k != "plaintextBody"}]} for t in threads]}
    else:
        t = next((t for t in box["threads"] if t["id"] == c["input"].get("threadId")), None)
        if t is None:
            emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "is_error": True, "content": "Thread not found"}]}})
            continue
        res = {"id": t["id"], "messageCount": len(t["messages"]), "messages": t["messages"]}
    emit({"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": tid, "content": [{"type": "text", "text": json.dumps(res)}]}]},
          "tool_use_result": {"structuredContent": res}})
emit({"type": "assistant", "message": {"content": [{"type": "text", "text": "DONE"}]}})
emit({"type": "result", "subtype": "success", "result": "DONE", "total_cost_usd": 0.002, "duration_ms": 900, "usage": {"input_tokens": 1200, "output_tokens": 20}})
'''


def msg(mid, tid, ts, sender="Pat Doe <pat@vendor.example>", labels=("INBOX",), body="The invoice is attached."):
    return {"id": mid, "threadId": tid, "internalDate": str(ts * 1000), "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(ts)),
            "labelIds": list(labels), "sender": sender, "toRecipients": ["Alex <alex@example.com>"], "subject": "Invoice 42",
            "snippet": body[:40], "plaintextBody": body}


def test_codex_labels_in_a_home_of_their_own():
    b = codex_box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 120), msg("m2", "t1", now - 60)]}, {"id": "t2", "messages": [msg("m3", "t2", now - 30)]}]
    b.save()
    m = C.ConnectorMail({"agent": "codex", "bin": str(b.codex), "codex_home": str(b.dir / "codex-src")}, "alex@example.com", "", "", b.dir)
    assert m.label_access() is None and m.label_id("Pocket Inbox") == "Pocket Inbox"
    assert m.labelled_threads("Pocket Inbox", 50) == {"t1", "t2"}
    assert "label:pocket-inbox" in b.argv()[-1]["argv"][-1], "searched by the label's Gmail name"
    m.db.execute("create table if not exists mail(message_id text primary key, thread_id text, ts integer)")
    m.db.executemany("insert or replace into mail values(?,?,?)", [("m1", "t1", now - 120), ("m2", "t1", now - 60), ("m3", "t2", now - 30)])
    m.db.commit()
    ok = m.label_threads([("t1", ["Pocket Inbox"], []), ("t2", [], ["Pocket Inbox"]), ("t9", ["Pocket Inbox"], [])])
    assert ok == {"t1", "t2"}, "a thread with no known message is skipped"
    run = b.argv()[-1]
    sent = json.loads(run["argv"][-1].split("in order: ", 1)[1].split("]. Make no", 1)[0] + "]")
    assert sent[0]["message_ids"] == ["m2"] and sent[0]["create_missing_labels"] is True, "added on the newest message"
    assert sorted(sent[1]["message_ids"]) == ["m3"] and sent[1]["remove_label_names"] == ["Pocket Inbox"]
    home = Path(run["home"])
    cfg = (home / "config.toml").read_text()
    assert home.name == "codex-home-label" and ".tools.apply_labels_to_emails]\nenabled = true" in cfg
    assert not any(f".tools.{t}]" in cfg for t in C.CODEX_READS) and "send_email" not in cfg and "destructive_enabled = false" in cfg
    b.data["codex_label_tamper"] = True
    b.save()
    assert m.label_threads([("t1", ["Pocket Inbox"], [])]) == set(), "a call with other arguments than asked does not count"
    claude = Box().mail()
    assert claude.label_access() is None, "1.75.1: Claude's connector changes labels too"


def test_claude_labels_locked_down():
    b = Box()
    m = b.mail()
    assert m.label_id("Pocket Inbox") == "Label_9", "made when missing"
    n = len(b.argv())
    assert m.label_id("Pocket Inbox") == "Label_9" and len(b.argv()) == n, "remembered: no second lookup"
    assert m.label_threads([("t1", ["Label_9"], []), ("t2", [], ["Label_9"])]) == {"t1", "t2"}
    args = b.argv()[-1]
    allowed = args[args.index("--allowedTools") + 1].split(",")
    assert sorted(allowed) == sorted(C.LABEL_TOOLS) and "send_message" not in allowed
    blocked = args[args.index("--disallowedTools") + 1].split(",")
    assert C.PREFIX + "send_message" in blocked and C.PREFIX + "get_thread" in blocked and C.PREFIX + "label_thread" not in blocked
    w = m.fetch
    guard = lambda tool, inp: subprocess.run(["python3", "-I", str(w.label_guard)], input=json.dumps({"tool_name": C.PREFIX + tool, "tool_input": inp}),
                                             capture_output=True, text=True).stdout
    assert guard("label_thread", {"threadId": "t1", "labelIds": ["Label_9"]}) == "", "the asked-for change passes"
    assert "deny" in guard("label_thread", {"threadId": "t7", "labelIds": ["Label_9"]}), "another thread is refused"
    assert "deny" in guard("label_thread", {"threadId": "t1", "labelIds": ["TRASH"]}), "another label is refused"
    assert "deny" in guard("send_message", {"to": "x@example.com"}), "anything else is refused"
    assert "deny" in guard("create_label", {"displayName": "Other"})
    b.data["read_only_grant"] = True
    b.save()
    try:
        m.label_threads([("t1", ["Label_9"], [])])
        raise AssertionError("a read-only grant must raise")
    except C.MailError as e:
        assert e.resp.status == 403 and "reconnect Gmail" in str(e), "a read-only grant says what to do"


def test_claude_read_only_falls_back_to_codex_for_labels():
    b = codex_box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 60)]}]
    b.data["read_only_grant"] = True
    b.save()
    m = C.ConnectorMail({"agent": "claude", "bin": str(b.bin), "fallback_agent": "codex", "fallback": {"bin": str(b.codex), "codex_home": str(b.dir / "codex-src")}},
                        "alex@example.com", "", "", b.dir)
    m.db.execute("create table if not exists mail(message_id text primary key, thread_id text, ts integer)")
    m.db.execute("insert or replace into mail values('m1','t1',?)", (now - 60,))
    m.db.commit()
    lid = m.label_id("Pocket Inbox")
    assert lid == "Pocket Inbox", "Claude may not even make the label (Damon's grant, 2026-10-21): Codex does, by name"
    assert m.label_threads([("t1", [lid], [])]) == {"t1"}, "the change went through Codex instead"
    sent = b.argv()[-1]
    assert Path(sent["home"]).name == "codex-home-label" and '"add_label_names": ["Pocket Inbox"]' in sent["argv"][-1], "by name, in Codex's label home"


class Box:
    def __init__(self):
        self.dir = Path(tempfile.mkdtemp(prefix="conn-test-"))
        self.bin = self.dir / "claude"
        self.bin.write_text(FAKE)
        self.bin.chmod(self.bin.stat().st_mode | stat.S_IEXEC)
        self.file, self.log = self.dir / "box.json", self.dir / "calls.log"
        os.environ["FAKE_BOX"], os.environ["FAKE_LOG"] = str(self.file), str(self.log)
        self.data = {"threads": []}
        self.save()

    def save(self):
        self.file.write_text(json.dumps(self.data))

    def mail(self, **kw):
        return C.ConnectorMail({"provider": "connector", "bin": str(self.bin), **kw}, "alex@example.com", "newer_than:2d", "", self.dir)

    def argv(self):
        return [json.loads(x) for x in self.log.read_text().splitlines()]


def test_changed_threads_sees_new_messages_once():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 60)]}]
    b.save()
    m = b.mail()
    changed, cur, rebase = m.changed_threads(f"t:{now - 300}")
    assert changed == {"t1"} and cur.startswith("t:") and rebase is False
    changed, _, _ = m.changed_threads(cur)
    assert changed == set(), "a thread with nothing new is not changed again"
    b.data["threads"][0]["messages"].append(msg("m2", "t1", now))
    b.save()
    changed, _, _ = m.changed_threads(cur)
    assert changed == {"t1"}


def test_spam_and_promotions_alone_do_not_count():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t9", "messages": [msg("m9", "t9", now - 10, labels=("CATEGORY_PROMOTIONS",))]}]
    b.save()
    assert b.mail().changed_threads(f"t:{now - 300}")[0] == set()


def test_thread_raw_reads_like_the_gmail_api():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 60, body="Please confirm the install date.")]}]
    b.save()
    raw = b.mail().thread_raw("t1")
    assert raw[0]["id"] == "m1" and raw[0]["threadId"] == "t1" and raw[0]["internalDate"] == str((now - 60) * 1000)
    from inbox_monitor import engine as E
    E.MAILBOX = "alex@example.com"
    row = E.parse_message(raw[0])
    assert row["subject"] == "Invoice 42" and row["sender"].startswith("Pat Doe") and "install date" in row["body"]
    assert row["ts"] == now - 60 and row["from_brad"] == 0


def test_missing_thread_is_a_404():
    b = Box()
    try:
        b.mail().thread_raw("nope")
    except C.MailError as e:
        assert e.resp.status == 404
    else:
        raise AssertionError("expected a 404")


def test_prefetch_batches_threads_into_few_calls():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": f"t{i}", "messages": [msg(f"m{i}", f"t{i}", now - i)]} for i in range(10)]
    b.save()
    m = b.mail()
    m.prefetch_threads([f"t{i}" for i in range(10)])
    assert len(b.argv()) == 2, "10 threads at 8 per call is two calls"
    m.thread_raw("t3")
    assert len(b.argv()) == 2, "a prefetched thread costs no further call"


def test_skipped_calls_are_retried():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now)]}, {"id": "t2", "messages": [msg("m2", "t2", now)]}]
    b.data["skip_first"] = 1
    b.save()
    m = b.mail()
    m.prefetch_threads(["t1", "t2"])
    assert len(b.argv()) == 2 and "t1" in m._cache and "t2" in m._cache


def test_the_call_is_locked_to_read_tools():
    b = Box()
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", int(time.time()))]}]
    b.save()
    m = b.mail()
    m.thread_raw("t1")
    argv = b.argv()[0]
    assert argv[argv.index("--tools") + 1] == ""
    assert argv[argv.index("--permission-mode") + 1] == "dontAsk"
    denied = argv[argv.index("--disallowedTools") + 1].split(",")
    assert "mcp__claude_ai_Gmail__send_message" in denied and "mcp__claude_ai_Gmail__trash_thread" in denied and "mcp__claude_ai_Google_Drive" in denied
    assert set(argv[argv.index("--allowedTools") + 1].split(",")) == set(C.READ_TOOLS)
    settings = json.loads(argv[argv.index("--settings") + 1])
    hook = settings["hooks"]["PreToolUse"][0]
    assert hook["matcher"] == "*"
    guard = m.fetch.guard
    import subprocess
    for tool, allowed in (("mcp__claude_ai_Gmail__get_thread", True), ("mcp__claude_ai_Gmail__send_message", False), ("Bash", False)):
        r = subprocess.run([sys.executable, "-I", str(guard)], input=json.dumps({"tool_name": tool}), capture_output=True, text=True)
        decided = json.loads(r.stdout)["hookSpecificOutput"]["permissionDecision"] if r.stdout.strip() else "allow"
        assert (decided == "allow") == allowed, (tool, decided)


def test_no_connector_says_how_to_fix_it():
    b = Box()
    b.data["no_connector"] = True
    b.save()
    try:
        b.mail().changed_threads(f"t:{int(time.time())}")
    except C.MailError as e:
        assert e.resp.status == 401 and "Connectors" in str(e)
    else:
        raise AssertionError("expected a 401")


def test_whoami_is_the_sender_of_sent_mail():
    b = Box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now, sender="Alex Rivera <Alex@Example.com>", labels=("SENT",))]}]
    b.save()
    assert b.mail().whoami() == {"email": "alex@example.com", "name": "Alex Rivera"}


def test_cursors_do_not_cross_sources():
    assert C.ConnectorMail.cursor_ok("t:1790000000") and not C.ConnectorMail.cursor_ok("123456")


FAKE_CODEX = r"""#!/usr/bin/env python3
import json, os, re, sys
args = sys.argv[1:]
box = json.load(open(os.environ["FAKE_BOX"]))
log = open(os.environ["FAKE_LOG"], "a"); log.write(json.dumps({"argv": args, "home": os.environ.get("CODEX_HOME")}) + "\n"); log.close()
prompt = args[-1]
def emit(e): print(json.dumps(e))
if box.get("codex_bot_check"):
    emit({"type": "turn.failed", "error": {"message": "unexpected status 403 Forbidden: cloudflare challenge"}}); sys.exit(1)
lab = re.search(r"Call gmail_apply_labels_to_emails once for each of these argument objects, exactly as given, in order: (\[.*\])\.", prompt)
if lab:  # 1.75: label changes, one call per item; box["codex_label_tamper"] makes the model swap a label name
    for i, a in enumerate(json.loads(lab.group(1))):
        if box.get("codex_label_tamper") and i == 0:
            a = {**a, "add_label_names": ["SPAM"]}
        emit({"type": "item.completed", "item": {"type": "mcp_tool_call", "server": "codex_apps", "tool": "gmail.apply_labels_to_emails", "arguments": a,
              "status": "completed", "result": {"structured_content": {"success": True, "added_label_ids": a["add_label_names"], "removed_label_ids": a["remove_label_names"]}}}})
    emit({"type": "turn.completed", "usage": {"input_tokens": 900, "output_tokens": 10}})
    sys.exit(0)
m = re.search(r"Call gmail_(\w+) exactly once(?: with these arguments: (\{.*\}))?\.", prompt)
tool, a = m.group(1), json.loads(m.group(2) or "{}")
if tool == "get_profile":
    res = {"email": "Alex@Example.com", "name": "Alex Rivera"}
elif tool == "search_emails":
    res = {"emails": [{"id": x["id"], "thread_id": t["id"], "from_": x["sender"], "labels": x["labelIds"]} for t in box["threads"] for x in t["messages"][-1:]]}
else:
    res = {"responses": [{"id": t["id"], "messages": [{"id": x["id"], "thread_id": t["id"], "label_ids": x["labelIds"], "internal_date": x["internalDate"],
            "snippet": x["snippet"], "payload": {"mime_type": "multipart/alternative", "headers": [{"name": "From", "value": x["sender"]}, {"name": "Subject", "value": x["subject"]}],
            "body": {"content": None}, "parts": [{"mime_type": "text/plain", "body": {"content": x["plaintextBody"]}, "parts": []}]}} for x in t["messages"]]}
            for t in box["threads"] if t["id"] in a.get("thread_ids", [])]}
emit({"type": "item.completed", "item": {"type": "mcp_tool_call", "server": "codex_apps", "tool": "gmail." + tool, "arguments": a, "status": "completed",
      "result": {"content": [{"type": "text", "text": "ok"}], "structured_content": res}}})
emit({"type": "item.completed", "item": {"type": "agent_message", "text": "DONE"}})
emit({"type": "turn.completed", "usage": {"input_tokens": 3000, "cached_input_tokens": 1000, "output_tokens": 20}})
"""


def codex_box():
    b = Box()
    b.codex = b.dir / "codex"
    b.codex.write_text(FAKE_CODEX)
    b.codex.chmod(b.codex.stat().st_mode | stat.S_IEXEC)
    (b.dir / "codex-src").mkdir()
    (b.dir / "codex-src" / "auth.json").write_text("{}")
    return b


def test_codex_reads_and_locks_down():
    b = codex_box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 60, body="Codex body text.")]}]
    b.save()
    m = C.ConnectorMail({"agent": "codex", "bin": str(b.codex), "codex_home": str(b.dir / "codex-src")}, "alex@example.com", "", "", b.dir)
    assert m.whoami() == {"email": "alex@example.com", "name": "Alex Rivera"}
    changed, cur, _ = m.changed_threads(f"t:{now - 300}")
    assert changed == {"t1"} and m.changed_threads(cur)[0] == set()
    from inbox_monitor import engine as E
    E.MAILBOX = "alex@example.com"
    row = E.parse_message(m.thread_raw("t1")[0])
    assert row["subject"] == "Invoice 42" and "Codex body text" in row["body"] and row["ts"] == now - 60
    home = Path(b.argv()[0]["home"])
    cfg = (home / "config.toml").read_text()
    assert (home / "auth.json").is_symlink() and os.readlink(home / "auth.json") == str(b.dir / "codex-src" / "auth.json")
    assert "[apps._default]\nenabled = false" in cfg and "default_tools_enabled = false" in cfg and "destructive_enabled = false" in cfg
    assert "shell_tool = false" in cfg and 'sandbox_mode = "read-only"' in cfg
    assert all(f".tools.{t}]\nenabled = true" in cfg for t in C.CODEX_READS) and "send_email" not in cfg


def test_codex_bot_check_is_a_503_and_claude_takes_over():
    b = codex_box()
    now = int(time.time())
    b.data["threads"] = [{"id": "t1", "messages": [msg("m1", "t1", now - 60)]}]
    b.data["codex_bot_check"] = True
    b.save()
    alone = C.ConnectorMail({"agent": "codex", "bin": str(b.codex), "codex_home": str(b.dir / "codex-src")}, "", "", "", b.dir)
    try:
        alone.changed_threads(f"t:{now - 300}")
    except C.MailError as e:
        assert e.resp.status == 503
    else:
        raise AssertionError("expected a 503")
    logs = []
    both = C.ConnectorMail({"agent": "codex", "bin": str(b.codex), "codex_home": str(b.dir / "codex-src"), "fallback_agent": "claude",
                            "fallback": {"bin": str(b.bin)}}, "", "", "", b.dir, log=logs.append)
    assert both.changed_threads(f"t:{now - 300}")[0] == {"t1"}
    assert any("using ClaudeConnector" in x for x in logs)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
