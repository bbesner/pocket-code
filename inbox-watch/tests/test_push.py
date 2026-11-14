"""The push split (1.105): every alert goes on the list; the owner's push settings decide which also push to their devices.
A fake Pocket; no Gmail, model or network.

    python3 tests/test_push.py
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inbox_monitor import config as cfgmod  # noqa: E402
from inbox_monitor import engine as E  # noqa: E402
from inbox_monitor import schedule as S  # noqa: E402


class FakePocket:
    kind = "pocket"

    def __init__(self):
        self.sent = []

    def send_alert(self, a, pocket_url=None, held_note=False, push=True, why=None):
        self.sent.append((a["subject"], push, why))
        return "e"

    def send_lookahead(self, a, pocket_url=None, items=None, push=True, why=None):
        self.sent.append((a["subject"], push, why))
        return "e"


class OldPocket:
    """A channel written before 1.105: no push or why."""
    kind = "pocket"

    def __init__(self):
        self.sent = []

    def send_alert(self, a, pocket_url=None, held_note=False):
        self.sent.append(a["subject"])
        return "e"


def setup(push=None, toml_push=""):
    d = Path(tempfile.mkdtemp())
    (d / "config.toml").write_text('[owner]\nname = "Alex"\nemail = "alex@example.com"\ntimezone = "UTC"\n\n[judge]\nkind = "claude"\nmodel = "sonnet"\n'
                                   + toml_push)
    E.configure(cfgmod.load(d / "config.toml"))
    if push is not None:
        E.SETTINGS = {**E.SETTINGS, "push": S.normalize({"push": push}, E.DEFAULTS)["push"]}
    pocket = FakePocket()
    E.DELIVERIES = [pocket]
    return E.Store(d / "state" / "m.sqlite"), pocket


def alert(store, subject, *, story=None, priority="normal", kind="notify", push_kind=None, why_now=None):
    aid = store.queue_alert(f"{subject}|{priority}|{push_kind}", issue_key=story or subject.lower().replace(" ", "-"), thread_id="", kind=kind,
                            priority=priority, text=f"{subject}.", subject=subject, sender="x@example.com", status="queued",
                            push_kind=push_kind, why_now=why_now)
    E.deliver(store, aid, None, False)
    store.commit()
    return aid


def test_defaults_keep_every_push():
    store, pocket = setup()
    assert E.SETTINGS["push"] == S.PUSH_DEFAULT, E.SETTINGS["push"]
    alert(store, "Bug report")
    assert pocket.sent == [("Bug report", True, None)], pocket.sent


def test_toml_push_table():
    store, _ = setup(toml_push='\n[push]\nmode = "urgent"\nkinds = ["money", "nonsense"]\nper_day = 5\nrepeat = "worse"\n')
    assert E.SETTINGS["push"] == {"mode": "urgent", "kinds": ["money"], "perDay": 5, "repeat": "worse"}, E.SETTINGS["push"]


def test_normalize_keeps_good_parts():
    setup()
    got = S.normalize({"push": {"mode": "loud", "kinds": ["outage", "money", "x"], "perDay": 7, "repeat": "worse"}}, E.DEFAULTS)["push"]
    assert got == {"mode": "all", "kinds": ["outage", "money"], "perDay": 0, "repeat": "worse"}, got


def test_urgent_pushes_only_chosen_kinds():
    store, pocket = setup({"mode": "urgent", "kinds": ["emergency", "money"], "perDay": 0, "repeat": "every"})
    alert(store, "Bug report from a tenant")
    alert(store, "Dispatch request", push_kind="emergency", why_now="The gate is stuck open tonight.")
    alert(store, "Credit hold", push_kind="deadline", why_now="Due tomorrow.")
    alert(store, "Card declined", priority="critical")
    assert pocket.sent == [("Bug report from a tenant", False, None), ("Dispatch request", True, "The gate is stuck open tonight."),
                           ("Credit hold", False, None), ("Card declined", True, "Critical")], pocket.sent
    pushed = [r["pushed"] for r in store.db.execute("select pushed from alerts order by id")]
    assert pushed == [0, 1, 0, 1], pushed


def test_repeat_on_a_story_waits_until_it_gets_worse():
    store, pocket = setup({"mode": "urgent", "kinds": list(S.PUSH_KINDS), "perDay": 0, "repeat": "worse"})
    alert(store, "Site down", story="oaks-down", priority="normal", push_kind="outage")
    alert(store, "Site still down", story="oaks-down", priority="normal", push_kind="outage")
    alert(store, "Site down, 40 cameras", story="oaks-down", priority="high", push_kind="outage")
    assert [p for _, p, _ in pocket.sent] == [True, False, True], pocket.sent
    assert pocket.sent[1][2].startswith("Not pushed: this story"), pocket.sent[1]


def test_daily_limit_spares_critical():
    store, pocket = setup({"mode": "urgent", "kinds": list(S.PUSH_KINDS), "perDay": 3, "repeat": "every"})
    for i in range(4):
        alert(store, f"Waiting {i}", push_kind="waiting")
    alert(store, "Breach", priority="critical")
    assert [p for _, p, _ in pocket.sent] == [True, True, True, False, True], pocket.sent
    assert "3 pushes today" in pocket.sent[3][2], pocket.sent[3]


def test_lookahead_counts_as_deadline():
    store, pocket = setup({"mode": "urgent", "kinds": ["deadline"], "perDay": 0, "repeat": "every"})
    alert(store, "Look-ahead", kind="checkin", priority="high")
    setup_none = setup({"mode": "urgent", "kinds": ["money"], "perDay": 0, "repeat": "every"})
    alert(setup_none[0], "Look-ahead 2", kind="checkin", priority="high")
    assert pocket.sent[0][1] is True and setup_none[1].sent[0][1] is False, (pocket.sent, setup_none[1].sent)


def test_none_pushes_nothing_and_old_channels_still_deliver():
    store, pocket = setup({"mode": "none"})
    alert(store, "Breach", priority="critical")
    assert pocket.sent == [("Breach", False, None)], pocket.sent
    old = OldPocket()
    E.DELIVERIES = [old]
    alert(store, "Another")
    assert old.sent == ["Another"], old.sent


def test_judge_urgency_is_validated():
    setup()
    d = E.validate_story_fields({"interrupt": "panic", "why_now": "x"}, set())
    assert d["interrupt"] is None and d["why_now"] is None, d
    d = E.validate_story_fields({"interrupt": "money", "why_now": "Late fee on the 20th." * 30}, set())
    assert d["interrupt"] == "money" and len(d["why_now"]) == 200, d


def test_merge_keeps_the_newer_urgency():
    store, _ = setup({"mode": "urgent", "kinds": list(S.PUSH_KINDS), "perDay": 0, "repeat": "every"})
    aid = store.queue_alert("k1", issue_key="acme", thread_id="", kind="notify", priority="normal", text="a", subject="Acme", sender="x", status="held")
    waiting = store.db.execute("select * from alerts where id=?", (aid,)).fetchone()
    store.merge_alert(waiting, "k2", {"issue_key": "acme", "thread_id": "", "priority": "high", "user_message": "b", "interrupt": "waiting",
                                      "why_now": "The board meets at 6."}, "Acme", "x")
    row = store.db.execute("select push_kind, why_now from alerts where id=?", (aid,)).fetchone()
    assert (row["push_kind"], row["why_now"]) == ("waiting", "The board meets at 6."), dict(row)


def test_options_offer_the_choices():
    o = S.options("claude", ["sonnet"])
    assert o["push"]["kinds"] == S.PUSH_KINDS and 0 in o["push"]["perDay"], o["push"]


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
