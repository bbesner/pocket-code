"""The judge's decisions through the real process(): quiet hours hold an alert, Check now sends it, and a batch that fails
part-way leaves nothing behind (1.77.1). A fake archive, judge and Pocket; no Gmail, model or network.

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
                 "sender": "billing@example.com", "recipients": "alex@example.com", "from_brad": 0, "body": "A payment posted."}]

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


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
