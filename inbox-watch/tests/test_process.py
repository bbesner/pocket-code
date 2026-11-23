"""The judge's decisions through the real process(): quiet hours hold an alert, Check now sends it, and a batch that fails
part-way leaves nothing behind (1.77.1); a judge reply that does not parse is asked for again (1.77.6); `notify --dry-run` keeps nothing (1.77.8); resolving an entry in Pocket closes its story (1.77.10).
A run killed outright (SIGKILL) or left with a closed output pipe still gets its alerts out exactly once (1.124.1): those
runs go through the real run() in a forked child. A fake archive, judge and Pocket; no Gmail, model or network.

    python3 tests/test_process.py
"""
import json
import os
import signal
import sys
import tempfile
import time
import traceback
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


def test_a_decision_turn_carries_the_newest_alerts_and_the_related_ones():
    alerts = [{"issue_key": f"story-{i}", "title": f"Topic {i}"} for i in range(12)]
    alerts.append({"issue_key": "harbor-hoa-gate-outage", "title": "Harbor HOA gate cameras down"})
    alerts.append({"issue_key": None, "title": "Daily report"})
    batch = set(E.tokens("Re: Harbor gate still offline")) | {"jordan"}
    kept = E.relevant_alerts(alerts, batch, common=set())
    assert [a["issue_key"] for a in kept] == [f"story-{i}" for i in range(E.RECENT_ALERTS_ALWAYS)] + ["harbor-hoa-gate-outage"], kept
    # a word every story shares does not make an alert related
    assert E.relevant_alerts(alerts, batch, common={"harbor", "gate"})[-1]["issue_key"] == f"story-{E.RECENT_ALERTS_ALWAYS - 1}"


# ---------------------------------------------------------------- runs that end badly (1.124.1)
GATE, INVOICE, GATE2 = "18f0aa01b2c3d4f1", "18f0aa01b2c3d4f2", "18f0aa01b2c3d4f3"
MAIL = {GATE: ("Gate down", "The gate is down."), INVOICE: ("Invoice 7", "Invoice 7 attached."),
        GATE2: ("Gate still down", "Gate still down, residents locked out.")}


def die():
    """The process ends here with no finally and no commit: the runner's 30-minute SIGKILL, or the machine going down."""
    os.kill(os.getpid(), signal.SIGKILL)


class LedgerPocket:
    """Pocket as it looks from more than one process: entries kept in a file, and an alert whose dedupe key Pocket already
    has comes back as a duplicate and adds nothing (POST /api/inbox, inbox.mjs add). `die_after_send` ends the process
    once the entry is in, before the watcher can record that it went."""
    kind = "pocket"

    def __init__(self, path, die_after_send=False):
        self.path, self.die_after_send = Path(path), die_after_send

    def entries(self):
        return [json.loads(x) for x in self.path.read_text().splitlines()] if self.path.exists() else []

    def send_alert(self, a, pocket_url=None, held_note=False):
        if any(e["dedupe"] == a["dedupe_key"] for e in self.entries()):
            return "duplicate"
        with self.path.open("a") as f:
            f.write(json.dumps({"title": a["subject"], "dedupe": a["dedupe_key"]}) + "\n")
        if self.die_after_send:
            die()
        return "e"


class LedgerArchive(FakeArchive):
    def thread(self, tid, until):
        subject, body = MAIL[tid]
        return [{"thread_id": tid, "message_id": f"m-{tid}", "subject": subject, "labels": "[]", "ts": NOW - 60,
                 "sender": "site@example.com", "recipients": "alex@example.com", "from_owner": 0, "body": body}]


def gate_decision(tid):
    key, fact = ("inv-7", "Invoice 7 is due.") if tid == INVOICE else ("gate", "Residents are locked out." if tid == GATE2 else "The gate is down.")
    return E.validate_story_fields({"thread_id": tid, "action": "notify", "issue_key": key, "title": MAIL[tid][0], "status": "open",
                                    "priority": "high", "confidence": 0.9, "new_fact": fact, "user_message": fact,
                                    "evidence": [{"message_id": f"m-{tid}"}]}, {f"m-{tid}"})


def run_setup(die_after_send=False):
    """A state directory and the fakes run() needs: a mail source that reports what `MAILED` holds, the judge above, a
    Pocket in a file, and nothing that would call a model or Pocket's own commands."""
    store, _ = setup()
    store.db.execute("delete from backlog")
    store.commit()
    store.db.close()
    pocket = LedgerPocket(E.STATE / "pocket.jsonl", die_after_send)
    E.DELIVERIES = [pocket]
    mailed = []

    class Mail:
        def cursor_ok(self, c):
            return True

        def profile_history_id(self):
            return "t:2"

        def changed_threads(self, cursor):
            got = set(mailed)
            mailed.clear()
            return got, "t:2", False

    real_process = E.process

    def process(store, archive, gmail, run_id, todo, until, dry_run, fetch_live, cursor_note="", awake=False):
        return real_process(store, LedgerArchive(), gmail, run_id, todo, until, dry_run, False, cursor_note, awake)
    E.gmail_client, E.process = Mail, process
    E.decide = lambda store, archive, gmail, batch, until, related=None: [gate_decision(b["thread_id"]) for b in batch]
    E.group_bundles = lambda bundles, related: [[b] for b in bundles]
    E.in_quiet_hours = lambda *a: False
    E.learn_safely = lambda *a, **k: None
    E.sync_memory = lambda *a, **k: 0
    E.heartbeat = lambda *a, **k: None
    E.tidy_due = lambda *a, **k: False
    E.scheduled = lambda *a, **k: None
    s = E.Store(E.DB_PATH)
    s.set("history_cursor", "t:1")
    s.commit()
    s.db.close()
    return pocket, mailed


RUN_FAKES = ("process", "gmail_client", "decide", "group_bundles", "in_quiet_hours", "learn_safely", "sync_memory", "heartbeat", "tidy_due", "scheduled")


def with_run_fakes(fn):
    saved = {k: getattr(E, k) for k in RUN_FAKES}
    try:
        return fn()
    finally:
        for k, v in saved.items():
            setattr(E, k, v)


def in_child(fn):
    """fn() in a forked child, the way Pocket's runner starts the watcher: how it ended ("exit <code>" or "killed <signal>"),
    and the traceback if it raised (written to a file, since its output may be the thing that is gone)."""
    err = E.STATE / "child-error.txt"
    sys.stdout.flush()  # or the child prints what the parent had not written yet
    sys.stderr.flush()
    pid = os.fork()
    if pid == 0:
        code = 70
        try:
            code = fn() or 0
        except BaseException:  # noqa: BLE001
            err.write_text(traceback.format_exc())
        os._exit(code)
    _, status = os.waitpid(pid, 0)
    how = f"killed {os.WTERMSIG(status)}" if os.WIFSIGNALED(status) else f"exit {os.WEXITSTATUS(status)}"
    return how, err.read_text() if err.exists() else ""


def alerts_now():
    s = E.Store(E.DB_PATH)
    try:
        return {r["dedupe_key"].split("|")[0] + ("" if r["status"] != "merged" else "+"): r["status"] for r in s.db.execute("select dedupe_key, status from alerts")}
    finally:
        s.db.close()


def test_an_alert_left_queued_by_a_killed_run_goes_out_at_the_next_run():
    # Review 2026-11-23 (inbox-01): batch 1's alert is committed 'queued' and goes out only at the end of the run. A run killed
    # in between (here while batch 2 is judged) left it queued for good, and every later alert on the story folded into it.
    def check():
        pocket, mailed = run_setup()
        s = E.Store(E.DB_PATH)  # two threads an earlier check found, the gate first
        s.db.executemany("insert into backlog(thread_id,added_at) values(?,?)", [(GATE, "2026-11-23T10:00:00Z"), (INVOICE, "2026-11-23T10:00:01Z")])
        s.commit()
        s.db.close()
        judge = E.decide

        def decide(store, archive, gmail, batch, until, related=None):
            if batch[0]["thread_id"] == INVOICE:
                die()
            return judge(store, archive, gmail, batch, until, related)
        E.decide = decide
        how, err = in_child(lambda: E.run(False, False))
        mailed.clear()  # the child reported it; a fork does not share the list back
        assert how == "killed 9", (how, err)
        assert alerts_now() == {"gate": "queued"} and pocket.entries() == [], (alerts_now(), pocket.entries())
        E.decide = judge
        assert E.run(False, False) == 0  # the next check, with no new mail of its own
        assert [e["title"] for e in pocket.entries()] == ["Gate down", "Invoice 7"], pocket.entries()
        assert alerts_now() == {"gate": "sent", "inv-7": "sent"}, alerts_now()
        mailed.append(GATE2)  # later mail on the story is a new alert, not folded into one that never left
        assert E.run(False, False) == 0
        assert [e["title"] for e in pocket.entries()] == ["Gate down", "Invoice 7", "Gate still down"], pocket.entries()
    with_run_fakes(check)


def test_an_alert_sent_just_before_the_run_was_killed_is_not_sent_again():
    # The kill lands after Pocket took the entry and before the watcher recorded it: the next run sends it again with the
    # same dedupe key, and Pocket answers that it already has it.
    def check():
        pocket, mailed = run_setup(die_after_send=True)
        mailed.append(GATE)
        how, err = in_child(lambda: E.run(False, False))
        mailed.clear()  # the child reported it; a fork does not share the list back
        assert how == "killed 9", (how, err)
        assert alerts_now() == {"gate": "queued"} and len(pocket.entries()) == 1, (alerts_now(), pocket.entries())
        pocket.die_after_send = False
        assert E.run(False, False) == 0
        assert alerts_now() == {"gate": "sent"}, alerts_now()
        assert [e["title"] for e in pocket.entries()] == ["Gate down"], pocket.entries()
    with_run_fakes(check)


def test_a_new_fact_folded_into_an_alert_that_never_left_takes_it_out():
    # process() on its own (no start-of-run recovery): the stuck alert goes out with the new fact instead of absorbing it.
    store, pocket = setup()
    store.queue_alert("gate|old", issue_key="gate", thread_id=GATE, kind="notify", priority="high", text="The gate is down.", subject="Gate down",
                      sender="site@example.com", status="queued")
    store.commit()
    saved = {k: getattr(E, k) for k in ("decide", "in_quiet_hours", "group_bundles")}
    try:
        E.decide = lambda store, archive, gmail, batch, until, related=None: [gate_decision(b["thread_id"]) for b in batch]
        E.in_quiet_hours = lambda *a: False
        _, notified, err = E.process(store, LedgerArchive(), None, 2, [GATE2], int(NOW) + 60, False, fetch_live=False)
    finally:
        for k, v in saved.items():
            setattr(E, k, v)
    assert (notified, err) == (1, None) and pocket.sent == ["Gate still down"], (notified, err, pocket.sent)
    assert sorted(r["status"] for r in store.db.execute("select status from alerts")) == ["merged", "sent"]


def test_a_late_alert_waits_out_quiet_hours_and_one_on_a_resolved_story_is_dropped():
    store, pocket = setup()
    for key, prio in (("gate", "high"), ("fire", "critical"), ("inv-7", "normal")):
        store.queue_alert(f"{key}|f1", issue_key=key, thread_id=A, kind="notify", priority=prio, text=f"{key}.", subject=key, sender="x@example.com", status="queued")
    store.upsert_story({"issue_key": "inv-7", "status": "resolved", "priority": "normal", "new_fact": "Paid."}, None)
    store.db.execute("update issues set updated_at=? where issue_key='inv-7'", (E.iso(E.now_utc() + E.dt.timedelta(seconds=5)),))
    store.commit()
    saved = E.in_quiet_hours
    E.in_quiet_hours = lambda *a: True
    try:
        assert E.deliver_left_queued(store, False) == 1
    finally:
        E.in_quiet_hours = saved
    assert statuses(store) == {"gate": "held", "fire": "sent", "inv-7": "superseded"}, statuses(store)
    assert pocket.sent == ["fire"], pocket.sent


def test_a_closed_output_pipe_does_not_end_the_run():
    # Review 2026-11-23 (inbox-03): a Pocket restart during a check leaves the watcher running with nobody reading its
    # stdout and stderr. Its next log line raised BrokenPipeError and the run stopped wherever it was.
    def check():
        pocket, mailed = run_setup()
        mailed.append(GATE)

        def orphaned():
            r, w = os.pipe()
            os.close(r)  # the daemon that read the pipe is gone
            os.dup2(w, 1)
            os.dup2(w, 2)
            return E.run(False, False)
        how, err = in_child(orphaned)
        assert how == "exit 0", (how, err)
        assert alerts_now() == {"gate": "sent"} and [e["title"] for e in pocket.entries()] == ["Gate down"], (alerts_now(), pocket.entries())
        logged = E.LOG_PATH.read_text()
        assert "changed threads: 1" in logged and "run 1 done" in logged, logged
    with_run_fakes(check)


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
