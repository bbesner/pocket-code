"""The Pocket Inbox label kept in step with the Inbox, both ways, and Check now (1.75), against a fake mailbox and a fake
Pocket. No Gmail, model or network.

    python3 tests/test_label.py
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inbox_monitor import config as cfgmod  # noqa: E402
from inbox_monitor import engine as E  # noqa: E402

A, B, Z = "18f0aa01b2c3d4e5", "18f0aa01b2c3d4e6", "18f0aa01b2c3d4e7"  # Gmail thread ids are hex


class FakeGmail:
    def __init__(self, writable=True):
        self.labels: dict[str, set[str]] = {}  # thread -> label ids
        self.made = []
        self.writable = writable

    def label_access(self):
        return None if self.writable else "the Gmail sign-in is read-only"

    def label_id(self, name, create=True):
        if "L1" in self.made:
            return "L1"
        if not create:
            return None
        self.made.append("L1")
        return "L1"

    def labelled_threads(self, label_id, cap):
        return {t for t, ls in self.labels.items() if label_id in ls}

    def label_thread(self, tid, add=(), remove=()):
        ls = self.labels.setdefault(tid, set())
        ls |= set(add)
        ls -= set(remove)

    def label_threads(self, changes):
        for tid, add, remove in changes:
            self.label_thread(tid, add, remove)
        return {c[0] for c in changes}


class FakePocket:
    inbox = True

    def __init__(self):
        self.entries = []  # open entries: {id, gmail}
        self.acted = []

    def inbox_open(self):
        return list(self.entries)

    def act(self, eid, action, note):
        self.acted.append((eid, action))
        self.entries = [e for e in self.entries if e["id"] != eid]

    def entry(self, eid, tid):
        self.entries.append({"id": eid, "gmail": f"https://mail.google.com/mail/u/0/#all/{tid}"})


def setup():
    d = Path(tempfile.mkdtemp())
    (d / "config.toml").write_text('[owner]\nname = "Alex"\nemail = "alex@example.com"\ntimezone = "UTC"\n\n[judge]\nkind = "claude"\nmodel = "sonnet"\n')
    E.configure(cfgmod.load(d / "config.toml"))
    pocket = FakePocket()
    E.DELIVERIES = [pocket]
    return E.Store(d / "state" / "m.sqlite"), FakeGmail(), pocket


def states(store):
    return dict(store.db.execute("select thread_id, state from label_sync").fetchall())


def test_both_ways():
    store, g, p = setup()
    assert E.DEFAULTS["gmailLabel"] == {"enabled": True}, "on by default"
    p.entry("e1", A)
    g.labels[Z] = {"L1"}  # labelled before the sync began
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == set(), "the first sync brings nothing in"
    assert g.labels[A] == {"L1"} and states(store) == {A: "synced", Z: "judged"}, states(store)
    # the owner labels B in Gmail (with Move to: it left the inbox): it comes in, back in INBOX too
    g.labels[B] = {"L1"}
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == {B}
    assert g.labels[B] == {"L1", "INBOX"} and states(store)[B] == "incoming"
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == set(), "taken up once"
    bundle = {"thread_id": B, "subject": "Quote request", "messages": [{"message_id": "m1", "from": "Pat <pat@vendor.example>", "body": "", "from_owner": False}]}
    E.mark_added(store, [bundle])
    assert bundle.get("added_in_gmail") and not E.firstpass_eligible(store, bundle, [], set())
    dec = E.validate_story_fields({"thread_id": B, "action": "ignore", "issue_key": "b", "confidence": 0.1, "priority": "low", "status": "resolved"}, set())
    E.added_decision(dec, bundle)
    assert dec["action"] == "notify" and dec["priority"] == "normal" and dec["status"] == "open" and dec["evidence"][0]["message_id"] == "m1"
    assert "Quote request" in dec["user_message"]
    # its alert reaches Pocket: in step
    p.entry("e2", B)
    E.label_sync(store, g, bring_in=False, dry_run=False)
    assert states(store)[B] == "synced"
    # resolved in Pocket: the label comes off in Gmail
    p.entries = [e for e in p.entries if e["id"] != "e1"]
    E.label_sync(store, g, bring_in=True, dry_run=False)
    assert "L1" not in g.labels[A] and A not in states(store)
    # the owner takes the label off B in Gmail: the entry leaves the list (dismissed)
    g.labels[B].discard("L1")
    E.label_sync(store, g, bring_in=True, dry_run=False)
    assert p.acted == [("e2", "dismiss")] and B not in states(store)
    # restored in Pocket: labelled again
    p.entry("e2", B)
    E.label_sync(store, g, bring_in=True, dry_run=False)
    assert "L1" in g.labels[B]
    assert Z in states(store) and "L1" in g.labels[Z], "the label the owner had before is never touched"


def test_new_alert_gets_label_and_dry_run():
    store, g, p = setup()
    E.label_sync(store, g, bring_in=True, dry_run=False)
    p.entry("e9", A)
    E.label_sync(store, g, bring_in=False, dry_run=True)
    assert A not in g.labels, "dry run changes nothing"
    E.label_sync(store, g, bring_in=False, dry_run=False)
    assert g.labels[A] == {"L1"}


def test_off_unavailable_and_no_inbox():
    store, g, p = setup()
    p.entry("e1", A)
    E.label_sync(store, g, bring_in=True, dry_run=False)
    E.SETTINGS = {**E.SETTINGS, "gmailLabel": {"enabled": False}}
    g.labels[B] = {"L1"}
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == set() and states(store) == {} and not store.get("label_baseline"), "off clears the ledger"
    E.SETTINGS = {**E.SETTINGS, "gmailLabel": {"enabled": True}}
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == set(), "on again: a fresh first sync, nothing flooded in"
    store2, g2, p2 = setup()
    g2.writable = False
    p2.entry("e1", A)
    assert E.label_sync(store2, g2, bring_in=True, dry_run=False) == set() and A not in g2.labels
    assert E.label_status(store2)["available"] is False and "read-only" in E.label_status(store2)["reason"]
    store3, _g, p3 = setup()
    st = E.label_status(store3, object())
    assert st["available"] is False and "connector" in st["reason"], "a mail source without label writes"
    store4, g4, p4 = setup()
    p4.inbox = False
    g4.labels[A] = {"L1"}
    store4.db.execute("insert into label_sync values(?, 'synced', '')", (A,))
    store4.set("label_baseline", "x")
    E.label_sync(store4, g4, bring_in=True, dry_run=False)
    assert g4.labels[A] == {"L1"}, "Pocket's Inbox off: an empty list is not 'everything finished'"


def test_connector_syncs_are_spaced():
    store, g, p = setup()
    g.label_sync_min_s = 600
    searches = []
    real = g.labelled_threads
    g.labelled_threads = lambda lid, cap: searches.append(1) or real(lid, cap)
    E.label_sync(store, g, bring_in=True, dry_run=False)
    g.labels[B] = {"L1"}
    assert E.label_sync(store, g, bring_in=True, dry_run=False) == set() and len(searches) == 1, "too soon: no search"
    assert E.label_sync(store, g, bring_in=False, dry_run=False) == set() and len(searches) == 1, "the end-of-run pass needs a first pass"
    assert E.label_sync(store, g, bring_in=True, dry_run=False, force=True) == {B} and len(searches) == 2, "Check now forces one"


def test_check_now_runs_once():
    setup()
    calls = []
    E.load_settings = lambda fetch=True: None
    E.run = lambda dry_run, baseline_only, why="", request=None: calls.append((why, request)) or 0
    E.SETTINGS = {**E.SETTINGS, "paused": True}
    E.CHECK_REQUEST = "2026-10-21T18:00:00Z"
    E.tick(False)
    assert calls == [("Check now in Pocket", "2026-10-21T18:00:00Z")], "runs even when paused or not due"
    store = E.Store(E.DB_PATH)
    store.set("check_request_done", "2026-10-21T18:00:00Z")
    store.commit()
    E.tick(False)
    assert len(calls) == 1, "done: not again"


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
