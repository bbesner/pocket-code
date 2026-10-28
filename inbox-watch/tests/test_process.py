"""The judge's decisions through the real process(): quiet hours hold an alert, Check now sends it, and a batch that fails
part-way leaves nothing behind (1.77.1); a judge reply that does not parse is asked for again (1.77.6); `notify --dry-run` keeps nothing (1.77.8); resolving an entry in Pocket closes its story (1.77.10). A fake archive, judge and Pocket; no Gmail, model or network.

    python3 tests/test_process.py
"""
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inbox_monitor import config as cfgmod  # noqa: E402
from inbox_monitor import engine as E  # noqa: E402

A, B = "18f0aa01b2c3d4e5", "18f0aa01b2c3d4e6"  # Gmail thread ids are hex
NOW = time.time()


class FakeArchive:
    def thread(self, tid, until):
        return [{"thread_id": tid, "message_id": f"m-{tid}", "subject": f"Subject {tid[-2:]}", "labels": "[]", "ts": NOW - 60,
                 "sender": "billing@example.com", "recipients": "alex@example.com", "from_owner": 0, "body": "A payment posted."}]

    def related(self, *a, **k):
        return []


class FakePocket:
    kind = "pocket"

    def __init__(self):
        self.sent = []

    def send_alert(self, a, pocket_url=None, held_note=False):
        self.sent.append(a["subject"])
        return "e"


def notify(tid):
    return E.validate_story_fields({"thread_id": tid, "action": "notify", "issue_key": f"story-{tid[-2:]}", "title": f"Story {tid[-2:]}",
                                    "status": "open", "priority": "normal", "confidence": 0.9, "new_fact": f"Payment {tid[-2:]} posted.",
                                    "user_message": f"Payment {tid[-2:]} posted.", "evidence": [{"message_id": f"m-{tid}"}]}, {f"m-{tid}"})


def setup():
    d = Path(tempfile.mkdtemp())
    (d / "config.toml").write_text('[owner]\nname = "Alex"\nemail = "alex@example.com"\ntimezone = "UTC"\n\n[judge]\nkind = "claude"\nmodel = "sonnet"\n')
    E.configure(cfgmod.load(d / "config.toml"))
    pocket = FakePocket()
    E.DELIVERIES = [pocket]
    store = E.Store(d / "state" / "m.sqlite")
    for tid in (A, B):
        store.db.execute("insert or ignore into backlog(thread_id,added_at) values(?,?)", (tid, E.iso()))
    store.commit()
    return store, pocket


def run(store, quiet, awake=False):
    """process() over threads A and B, one batch each, with the judge choosing notify for both. `quiet` answers
    in_quiet_hours() call by call (an exception is raised)."""
    saved = {k: getattr(E, k) for k in ("decide", "in_quiet_hours", "group_bundles")}
    answers = list(quiet)

    def in_quiet_hours(*a):
        x = answers.pop(0)
        if isinstance(x, Exception):
            raise x
        return x
    try:
        E.decide = lambda store, archive, gmail, batch, until, related=None: [notify(b["thread_id"]) for b in batch]
        E.in_quiet_hours = in_quiet_hours
        E.group_bundles = lambda bundles, related: [[b] for b in bundles]
        return E.process(store, FakeArchive(), None, 1, [A, B], int(NOW) + 60, False, fetch_live=False, awake=awake)
    finally:
        for k, v in saved.items():
            setattr(E, k, v)


def statuses(store):
    return dict(store.db.execute("select issue_key, status from alerts").fetchall())


def test_quiet_hours_hold_the_alert():
    # 2026-10-23: 1.75.3 named `awake` in this check without passing it in; every non-critical notify between 10 PM and
    # 6 AM ended the run with a NameError.
    store, pocket = setup()
    evaluated, notified, error = run(store, [True, True])
    assert (evaluated, notified, error) == (2, 0, None), (evaluated, notified, error)
    assert statuses(store) == {"story-e5": "held", "story-e6": "held"}, statuses(store)
    assert pocket.sent == []


def test_check_now_sends_in_quiet_hours():
    store, pocket = setup()
    evaluated, notified, error = run(store, [True, True], awake=True)
    assert (notified, error) == (2, None), (notified, error)
    assert statuses(store) == {"story-e5": "sent", "story-e6": "sent"}, statuses(store)
    assert sorted(pocket.sent) == ["Story e5", "Story e6"], pocket.sent


def test_a_failed_batch_leaves_nothing_behind():
    store, pocket = setup()
    try:
        run(store, [False, RuntimeError("boom")])
    except RuntimeError:
        pass
    else:
        raise AssertionError("the failure is not swallowed (systemd's OnFailure reports it)")
    db = store.db
    # batch 1 went through and its alert still went out at the end of the run
    assert pocket.sent == ["Story e5"], pocket.sent
    assert statuses(store) == {"story-e5": "sent"}, statuses(store)
    assert not db.execute("select 1 from backlog where thread_id=?", (A,)).fetchone()
    # batch 2: no decision, story, event or alert to read as "already alerted"; the thread waits for the next run
    assert not db.execute("select 1 from decisions where thread_id=?", (B,)).fetchone(), "the failed batch's decision was kept"
    assert not db.execute("select 1 from issues where issue_key='story-e6'").fetchone(), "the failed batch's story was kept"
    assert not db.execute("select 1 from issue_events where issue_key='story-e6'").fetchone(), "the failed batch's event was kept"
    assert db.execute("select 1 from backlog where thread_id=?", (B,)).fetchone(), "the failed thread left the backlog"
    # and the next run alerts on it
    evaluated, notified, error = run(store, [False, False])
    assert pocket.sent == ["Story e5", "Story e6"], pocket.sent


class FakeJudge:
    def __init__(self, replies):
        self.replies, self.asked = list(replies), 0

    def ask(self, message, tag="", day=""):
        self.asked += 1
        return self.replies.pop(0)


def ask_judge(replies):
    setup()
    judge, saved = FakeJudge(replies), (E.JUDGE, E.USAGE_DB)
    E.JUDGE, E.USAGE_DB = judge, None
    try:
        return E.call_judge("bundle"), judge.asked
    finally:
        E.JUDGE, E.USAGE_DB = saved


def test_a_reply_that_does_not_parse_is_asked_again():
    # 2026-10-23 11 PM: one Sonnet reply would not parse and the whole check failed; the same threads judged fine 30 min later.
    good = '{"decisions": []}'
    assert ask_judge([good]) == ({"decisions": []}, 1), "a good reply is asked for once"
    assert ask_judge(['{"decisions":[{"title":"Contoso "past due""}]}', good]) == ({"decisions": []}, 2)
    assert ask_judge(['{"decisions":[{"title":"cut off', good]) == ({"decisions": []}, 2)
    try:
        ask_judge(["no json here", '{"decisions": [}'])
    except RuntimeError as e:
        assert "returned no JSON" in str(e), e
    else:
        raise AssertionError("two replies that do not parse still fail the check")


def test_notify_dry_run_keeps_nothing():
    # 2026-10-24: `monitor.py notify --dry-run` left its alert row, and the real send with the same key was refused as a duplicate.
    import argparse
    _, pocket = setup()
    saved = E.in_quiet_hours
    E.in_quiet_hours = lambda *a: False

    def notify_cli(dry_run):
        return E.notify_cli(argparse.Namespace(subject="Backups missed", text="Five devices missed backups.", next_step=None, sender=None,
                                               thread_id=A, priority="high", key="backups|resend", dry_run=dry_run))
    try:
        assert notify_cli(True) == 0
        db = E.Store(E.DB_PATH).db
        assert not db.execute("select 1 from alerts where dedupe_key='ext|backups|resend'").fetchone(), "the dry run kept its alert"
        assert pocket.sent == []
        assert notify_cli(False) == 0
        assert pocket.sent == ["Backups missed"], pocket.sent
        assert notify_cli(True) == 0 and notify_cli(False) == 0, "a dry run after the send"
        assert pocket.sent == ["Backups missed"], "the same key still sends once"
    finally:
        E.in_quiet_hours = saved


def test_resolving_in_pocket_closes_the_story():
    # 2026-10-25: Pocket's feedback reports the entry's state ("resolved"), and apply_feedback only closed a story on "resolve",
    # so none of the owner's 58 resolves since 2026-10-19 closed one. The items below are the shape inbox.mjs feedback() returns.
    store, pocket = setup()
    for k in ("story-a", "story-b", "story-c"):
        store.upsert_story({"issue_key": k, "status": "open", "priority": "normal", "new_fact": f"{k} opened."}, None)
    store.commit()
    acked = []
    pocket.feedback = lambda: [
        {"id": "e1", "action": "resolved", "at": "2026-10-25T12:00:03Z", "note": "Sam made this purchase", "title": "Charge", "story": "story-a", "source": "inbox-monitor", "kind": "alert"},
        {"id": "e2", "action": "dismissed", "at": "2026-10-25T12:00:04Z", "note": "", "title": "Dismissed", "story": "story-b", "source": "inbox-monitor", "kind": "alert"},
        {"id": "e3", "action": "resolved", "at": "2026-10-25T12:00:05Z", "note": "", "title": "Later restored", "story": "story-c", "source": "inbox-monitor", "kind": "alert"},
    ]
    pocket.ack = acked.extend
    E.apply_feedback(store)
    status = lambda k: store.story(k)["status"]
    assert [status(k) for k in ("story-a", "story-b", "story-c")] == ["resolved", "open", "resolved"]
    assert any("marked this resolved" in r["fact"] for r in store.events("story-a")), "no feedback event on the story"
    assert acked == ["e1", "e2", "e3"], acked
    pocket.feedback = lambda: [{"id": "e3", "action": "restore", "at": "2026-10-25T12:01:00Z", "note": "", "title": "Later restored", "story": "story-c", "source": "inbox-monitor", "kind": "alert"}]
    E.apply_feedback(store)
    assert status("story-c") == "open", "restore reopens"


def test_two_labelled_copies_share_one_entry():
    # 2026-10-28: both copies of a reply labelled in Gmail, folded into one alert; the second follows the first's entry.
    store, pocket = setup()
    for tid in (A, B):
        E.mark_label(store, tid, "incoming")
    store.commit()
    saved = {k: getattr(E, k) for k in ("decide", "in_quiet_hours")}
    try:
        E.decide = lambda store, archive, gmail, batch, until, related=None: [{**notify(b["thread_id"]), "issue_key": "reply"} for b in batch]
        E.in_quiet_hours = lambda *a: False
        _, notified, err = E.process(store, FakeArchive(), None, 7, [A, B], int(NOW) + 60, False, fetch_live=False)
    finally:
        for k, v in saved.items():
            setattr(E, k, v)
    assert err is None and notified == 1, (notified, err)
    rows = store.db.execute("select id, thread_id, status, dedupe_key from alerts order by id").fetchall()
    assert [r["status"] for r in rows] == ["sent", "merged"] and rows[0]["dedupe_key"].endswith("|7"), [tuple(r) for r in rows]
    st = dict(store.db.execute("select thread_id, state from label_sync").fetchall())
    assert st == {rows[0]["thread_id"]: "judged", rows[1]["thread_id"]: f"with:{rows[0]['id']}"}, st


def test_tidy_leaves_a_restored_entry_alone():
    # Restore in Pocket undoes a tidy; the next tidy must not take the entry off again.
    store, _ = setup()

    class Inbox:
        inbox = True
        acted = []

        def inbox_open(self):
            old = "2026-10-01T12:00:00Z"
            return [{"id": "aaaaaaaaaaaa", "kind": "alert", "at": old, "title": "Restored", "story": None, "text": "x"},
                    {"id": "bbbbbbbbbbbb", "kind": "alert", "at": old, "title": "Fresh", "story": None, "text": "y"}]

        def act(self, eid, action, note):
            self.acted.append(eid)
    box = Inbox()
    store.db.execute("insert into tidy_log(at,entry_id,issue_key,title,verdict,reason,evidence,acted) values(?,?,?,?,?,?,?,?)",
                     (E.iso(), "aaaaaaaaaaaa", None, "Restored", "handled", "done", "[]", 1))
    store.commit()
    seen = []
    saved = {k: getattr(E, k) for k in ("pocket_inbox", "call_judge", "tidy_memory")}
    try:
        E.pocket_inbox = lambda: box
        E.tidy_memory = lambda e: []
        E.call_judge = lambda msg, **k: seen.append(msg) or {"entries": [{"id": "bbbbbbbbbbbb", "verdict": "resolved", "reason": "over"}]}
        out = E.tidy(store, FakeTidyArchive())
    finally:
        for k, v in saved.items():
            setattr(E, k, v)
    assert out["restored"] == 1 and box.acted == ["bbbbbbbbbbbb"], (out, box.acted)
    assert "aaaaaaaaaaaa" not in seen[0], "the restored entry was sent to the tidy judge"


class FakeTidyArchive:
    class db:
        @staticmethod
        def execute(*a):
            return []


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
