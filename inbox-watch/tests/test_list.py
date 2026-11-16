"""The list as the owner's work queue (1.109): Not useful keeps a story off the list in code until the owner restores it or
labels the mail by hand; an entry the owner started a conversation from is a signal shown with later mail on that story or from
that sender; a `digest` line with the digest off is an `update`, and the judge is told there is no digest; a message says whether
the owner was in To or only in Cc. A temporary ledger, a fake judge and a fake Pocket; no mailbox, no model.

    python3 tests/test_list.py
"""
import json
import sqlite3
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inbox_monitor import config as cfgmod  # noqa: E402
from inbox_monitor import engine as E  # noqa: E402

A, B = "18f0aa01b2c3d4e5", "18f0aa01b2c3d4e6"
NOW = time.time()
SENDER = "Backup Monitor <alerts@backups.example>"


class FakeArchive:
    def thread(self, tid, until):
        return [{"thread_id": tid, "message_id": f"m-{tid}", "subject": "Backup failed on nas-1", "labels": "[]", "ts": NOW - 60,
                 "sender": SENDER, "recipients": "alex@example.com", "from_owner": 0, "body": "The nightly backup failed.",
                 "addressed": "to"}]

    def related(self, *a, **k):
        return []


class FakePocket:
    kind = "pocket"

    def __init__(self):
        self.sent, self.items, self.acked, self.worked, self.asked = [], [], [], [], 0

    def send_alert(self, a, pocket_url=None, held_note=False):
        self.sent.append(a["subject"])
        return "e"

    def feedback(self):
        return self.items

    def ack(self, ids):
        self.acked += ids
        self.items = []

    def inbox_worked(self, since):
        self.asked += 1
        return self.worked


def setup():
    d = Path(tempfile.mkdtemp())
    (d / "config.toml").write_text('[owner]\nname = "Alex"\nemail = "alex@example.com"\ntimezone = "UTC"\n\n[judge]\nkind = "claude"\nmodel = "sonnet"\n')
    E.configure(cfgmod.load(d / "config.toml"))
    pocket = FakePocket()
    E.DELIVERIES = [pocket]
    return E.Store(d / "state" / "m.sqlite"), pocket


def decision(tid, action="notify", key="nas-1-backup-failing", priority="normal"):
    return E.validate_story_fields({"thread_id": tid, "action": action, "issue_key": key, "title": "NAS-1 backup failing", "status": "open",
                                    "priority": priority, "confidence": 0.9, "new_fact": f"The backup failed again ({tid[-2:]}, {priority}).",
                                    "user_message": "The backup failed again.", "evidence": [{"message_id": f"m-{tid}"}]}, {f"m-{tid}"})


def process(store, tids, run_id, **fields):
    for tid in tids:
        store.db.execute("insert or ignore into backlog(thread_id,added_at) values(?,?)", (tid, E.iso()))
    store.commit()
    saved = {k: getattr(E, k) for k in ("decide", "in_quiet_hours", "group_bundles")}
    try:
        E.decide = lambda store, archive, gmail, batch, until, related=None: [decision(b["thread_id"], **fields) for b in batch]
        E.in_quiet_hours = lambda *a: False
        E.group_bundles = lambda bundles, related: [[b] for b in bundles]
        return E.process(store, FakeArchive(), None, run_id, tids, int(NOW) + 60, False, fetch_live=False)
    finally:
        for k, v in saved.items():
            setattr(E, k, v)


def not_useful(store, pocket, entry="e1"):
    pocket.items = [{"id": entry, "action": "not_useful", "at": "2026-11-16T12:00:00Z", "note": "", "title": "NAS-1 backup failing",
                     "story": "nas-1-backup-failing", "source": "inbox-monitor", "kind": "alert"}]
    E.apply_feedback(store)


def test_not_useful_keeps_the_story_off_the_list():
    # Before 1.109 Not useful lowered the story to low and became one learned line the judge could still outweigh, and one that
    # could later be merged away; an owner who marks a story Not useful means it should not come back.
    store, pocket = setup()
    assert process(store, [A], 1)[:2] == (1, 1) and pocket.sent == ["NAS-1 backup failing"]
    not_useful(store, pocket)
    assert store.story("nas-1-backup-failing")["not_useful_at"] and pocket.acked == ["e1"]
    assert store.story_dict(store.story("nas-1-backup-failing"), False)["not_useful"], "the judge is shown it"
    evaluated, notified, err = process(store, [B], 2)
    assert (evaluated, notified, err) == (1, 0, None), (evaluated, notified, err)
    assert len(pocket.sent) == 1, "the story went back on the list"
    raw = json.loads(store.db.execute("select raw from decisions where thread_id=? order by id desc", (B,)).fetchone()["raw"])
    assert raw["action"] == "update" and raw["blocked"] == "not_useful: was notify", raw
    # a critical change still gets through
    assert process(store, [B], 3, priority="critical")[1] == 1 and len(pocket.sent) == 2


def test_restore_and_a_hand_label_lift_not_useful():
    store, pocket = setup()
    process(store, [A], 1)
    not_useful(store, pocket)
    pocket.items = [{"id": "e1", "action": "restore", "at": "2026-11-16T13:00:00Z", "note": "", "title": "NAS-1 backup failing",
                     "story": "nas-1-backup-failing", "source": "inbox-monitor", "kind": "alert"}]
    E.apply_feedback(store)
    assert store.story("nas-1-backup-failing")["not_useful_at"] is None, "Restore lifts it"
    assert process(store, [B], 2)[1] == 1, "a restored story can be listed again"
    # marked again, then the owner labels the next mail in Gmail: their own hand wins and lifts it
    not_useful(store, pocket, "e2")
    assert store.story("nas-1-backup-failing")["not_useful_at"]
    C = "18f0aa01b2c3d4e7"
    E.mark_label(store, C, "incoming")
    store.commit()
    assert process(store, [C], 3)[1] == 1, "a thread the owner labelled is always listed"
    assert store.story("nas-1-backup-failing")["not_useful_at"] is None


def test_started_conversations_become_signals_not_lessons():
    store, pocket = setup()
    process(store, [A], 1)
    pocket.worked = [{"id": "e1", "kind": "alert", "story": "nas-1-backup-failing", "title": "NAS-1 backup failing",
                      "gmail": f"https://mail.google.com/mail/u/0/#all/{A}", "sessions": [{"id": "s1", "at": "2026-11-16T12:30:00Z"}]},
                     {"id": "e9", "kind": "alert", "story": "", "gmail": "", "title": "No story", "sessions": [{"id": "s2", "at": "2026-11-16T12:31:00Z"}]}]
    assert E.sync_worked(store) == 1
    row = store.db.execute("select * from lessons where kind='worked'").fetchone()
    assert (row["ref"], row["issue_key"], row["thread_id"], row["learned_at"]) == ("worked:e1", "nas-1-backup-failing", A, "signal"), tuple(row)
    assert row["sender"] == SENDER, "the sender comes from the alert, so later mail from it matches"
    assert E.sync_worked(store) == 0 and pocket.asked == 1, "asked at most every WORKED_EVERY_MIN minutes"
    store.set("worked_synced_at", "2026-01-01T00:00:00+00:00")
    assert E.sync_worked(store) == 0 and pocket.asked == 2, "the same entry is recorded once"
    # learn() never sees them: the watcher already listed that mail, there is no rule to write
    called = []
    saved = E.call_judge
    try:
        E.call_judge = lambda *a, **k: called.append(1) or {"rules": []}
        assert E.learn(store) == 0 and not called
    finally:
        E.call_judge = saved


def bundle(tid, sender=SENDER, subject="Backup failed on nas-1"):
    return {"thread_id": tid, "subject": subject, "message_count": 1,
            "messages": [{"message_id": f"m-{tid}", "from": sender, "to": "alex@example.com", "from_owner": False, "body": "x"}]}


def test_owner_history_matches_story_and_kind():
    store, pocket = setup()
    process(store, [A], 1)  # thread A is linked to the story
    E.add_lesson(store, "not_useful:e7", "not_useful", None, "other-story", "Weekly report", "Reports <reports@vendor.example>", "Weekly report", "", "alerted")
    for i in range(3):
        store.db.execute("insert into lessons(ref,at,kind,thread_id,issue_key,title,sender,subject,learned_at) values(?,?,?,?,?,?,?,?,?)",
                         (f"worked:w{i}", E.iso(), "worked", None, "nas-1-backup-failing", "NAS-1 backup failing", SENDER, "Backup failed on nas-1", "signal"))
    store.db.execute("insert into lessons(ref,at,kind,thread_id,issue_key,title,sender,subject) values(?,?,?,?,?,?,?,?)",
                     ("added:old", "2025-01-01T00:00:00+00:00", "added", None, "nas-1-backup-failing", "Too old", SENDER, "Too old"))
    store.commit()
    h = E.owner_history(store, [bundle(A), bundle(B, subject="Backup failed on nas-2"),
                                bundle("18f0aa01b2c3d4e8", "Reports <REPORTS@vendor.example>", "Re: Weekly report 2026-11-16"),
                                bundle("18f0aa01b2c3d4e9", "Someone Else <x@elsewhere.example>", "Backup failed"),
                                bundle("18f0aa01b2c3d4ea", SENDER, "Your invoice is ready")])
    assert [(g["did"], g["match"], g["times"]) for g in h[A]] == [("worked", "same story", 3)], h[A]
    # a new thread: the same sender and a similar subject is the same kind of mail
    assert [(g["did"], g["match"], g["times"], g["examples"]) for g in h[B]] == [("worked", "same kind", 3, ["NAS-1 backup failing"])], h[B]
    assert [(g["did"], g["match"]) for g in h["18f0aa01b2c3d4e8"]] == [("not_useful", "same kind")]
    # the sender alone is not a match (one address can send every kind of mail), nor is the subject alone
    assert set(h) == {A, B, "18f0aa01b2c3d4e8"}, set(h)
    assert E.same_kind(E.kind_words("[server-1] scheduled job failed — sync.service"), E.kind_words("Re: [server-1] scheduled job failed — harvest.service"))
    assert not E.same_kind(E.kind_words("PROCESSED, no action needed [REF-100003]"), E.kind_words("[server-1] scheduled job failed — harvest.service"))
    # and the decision turn carries it
    seen = []
    saved = E.call_judge
    try:
        E.call_judge = lambda message, **k: seen.append(message) or {"decisions": []}
        E.decide(store, FakeArchiveDb(), None, [bundle(B, subject="Backup failed on nas-2")], int(NOW), related={})
    finally:
        E.call_judge = saved
    assert '"owner_history":{"%s":[{"did":"worked","match":"same kind","times":3' % B in seen[0], seen[0][-1500:]


class FakeArchiveDb:
    """decide() looks up the newest message's time and repeated identifiers; an empty archive answers both."""
    def __init__(self):
        self.db = sqlite3.connect(":memory:")
        self.db.row_factory = sqlite3.Row
        self.db.execute("create table mail(message_id text, ts integer)")

    def recurring(self, *a, **k):
        return []


def test_with_the_digest_off_there_is_no_digest():
    # Before 1.109 a `digest` decision with the digest off was queued and then thrown away (skip_digest), every time.
    store, pocket = setup()
    saved = (E.call_judge, E.DIGEST_HOUR)
    reply = {"decisions": [{"thread_id": B, "action": "digest", "issue_key": "ups-alarms", "title": "UPS alarms", "status": "open", "priority": "low",
                            "confidence": 0.8, "new_fact": "The UPS alarmed again.", "user_message": "The UPS alarmed again.",
                            "evidence": [{"message_id": f"m-{B}"}]}]}
    try:
        E.call_judge = lambda message, **k: json.loads(json.dumps(reply))
        E.DIGEST_HOUR = None
        assert [d["action"] for d in E.decide(store, FakeArchiveDb(), None, [bundle(B)], int(NOW), related={})] == ["update"]
        assert "no `digest` in this turn" in E.fill(E.PROMPT_FILE.read_text())
        E.DIGEST_HOUR = 8
        assert [d["action"] for d in E.decide(store, FakeArchiveDb(), None, [bundle(B)], int(NOW), related={})] == ["digest"]
        text = E.fill(E.PROMPT_FILE.read_text())
        assert "no `digest` in this turn" not in text and "{digest_note}" not in text and "worth one line in the morning summary" in text
    finally:
        E.call_judge, E.DIGEST_HOUR = saved


def test_a_story_says_whether_it_was_ever_on_the_list():
    # Before 1.109 a digest line and a list entry looked the same under `alerts_sent_to_owner`, so a story that had only had digest
    # lines read as already alerted and a problem running for weeks was never listed.
    store, pocket = setup()
    process(store, [A], 1, action="update")
    key = "nas-1-backup-failing"
    store.queue_alert("d1", issue_key=key, thread_id=A, kind="digest", priority="low", text="The backup failed again.", status="digested")
    store.queue_alert("d2", issue_key=key, thread_id=A, kind="notify", priority="low", text="Held overnight, sent in the digest.", status="digested")
    store.commit()
    d = store.story_dict(store.story(key), True)
    assert d["on_list"] == "never" and [a["as"] for a in d["alerts_sent_to_owner"]] == ["digest line", "digest line"], d
    assert "on_list" not in store.story_dict(store.story(key), False), "only the full story carries it"
    process(store, [B], 2)  # now it is listed
    d = store.story_dict(store.story(key), True)
    assert "on_list" not in d and [a["as"] for a in d["alerts_sent_to_owner"]] == ["digest line", "digest line", "list entry"], d
    text = E.fill(E.PROMPT_FILE.read_text())
    assert "`on_list: never`" in text and "`digest line`" in text and "`list entry`" in text


def test_a_message_says_where_the_owner_was():
    store, pocket = setup()
    raw = lambda to, cc: {"id": "m1", "threadId": "t1", "internalDate": "1000000", "labelIds": [], "payload": {"headers": [
        {"name": "From", "value": "Pat <pat@vendor.example>"}, {"name": "To", "value": to}, {"name": "Cc", "value": cc}, {"name": "Subject", "value": "Quote"}]}}
    assert E.parse_message(raw("Alex <ALEX@example.com>", ""))["addressed"] == "to"
    assert E.parse_message(raw("sam@example.com", "alex@example.com"))["addressed"] == "cc"
    assert E.parse_message(raw("info@example.com", ""))["addressed"] == "none"
    rows = [{"thread_id": "t1", "message_id": "m0", "subject": "Quote", "labels": "[]", "ts": 900, "sender": "pat@vendor.example", "recipients": "x", "from_owner": 0, "body": "old"},
            {"thread_id": "t1", "message_id": "m1", "subject": "Quote", "labels": "[]", "ts": 1000, "sender": "pat@vendor.example", "recipients": "x", "from_owner": 0, "body": "b", "addressed": "cc"},
            {"thread_id": "t1", "message_id": "m2", "subject": "Quote", "labels": '["SENT"]', "ts": 1100, "sender": "alex@example.com", "recipients": "x", "from_owner": 1, "body": "b", "addressed": "none"}]
    msgs = E.thread_bundle(rows)["messages"]
    assert [m.get("owner_in") for m in msgs] == [None, "cc", None], msgs  # unknown on older mail; never on the owner's own
    # an archive written before 1.109 gains the column and keeps its rows; new mail is stored with it
    path = Path(tempfile.mkdtemp()) / "mail.sqlite"
    db = sqlite3.connect(path)
    db.execute("create table mail(message_id text primary key, thread_id text, ts integer, date text, sender text, recipients text, subject text, labels text, from_owner integer, body text)")
    db.execute("insert into mail values('m0','t1',900,'d','pat@vendor.example','alex@example.com','Quote','[]',0,'old')")
    db.commit()
    db.close()
    a = E.Archive(path)
    a.add([E.parse_message(raw("alex@example.com", ""))])
    a.add([{"message_id": "m9", "thread_id": "t1", "ts": 1200, "date": "d", "sender": "pat@vendor.example", "recipients": "", "subject": "Quote",
            "labels": "[]", "from_owner": 0, "body": "a row built without it"}])
    assert [(r["message_id"], r["addressed"]) for r in a.thread("t1", 2000)] == [("m0", None), ("m1", "to"), ("m9", None)]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
