"""The Pocket start link in each delivery (1.81): before Pocket knows its public address `pocket-start` prints a Pocket
path (/#/start/<id>). The Inbox keeps it (it opens inside Pocket); Telegram and email, which need an address, leave the
button out. A fake pocket-start and fake channels; no Pocket, network or mailbox. Needs `node` on the path.

    python3 tests/test_delivery.py
"""
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inbox_monitor import delivery as D  # noqa: E402

ALERT = {"subject": "Invoice due", "text": "Pat sent invoice 42.", "priority": "normal", "thread_id": "18f0aa01b2c3d4e5"}
PATH_LINK, WEB_LINK = "/#/start/0123456789ab", "https://pocket.example.com/#/start/0123456789ab"


def fake_pocket(printed):
    root = Path(tempfile.mkdtemp())
    (root / "scripts").mkdir()
    (root / "scripts" / "pocket-start.mjs").write_text(f"console.log({printed!r});\n")
    return {"root": str(root)}


def test_start_link_keeps_a_pocket_path_and_a_web_address():
    assert D.start_link(fake_pocket(PATH_LINK), "brief", "Title", print) == PATH_LINK
    assert D.start_link(fake_pocket(WEB_LINK), "brief", "Title", print) == WEB_LINK
    assert D.start_link(fake_pocket("nonsense"), "brief", "Title", print) is None


def test_absolute_link_only_passes_web_addresses():
    assert D.absolute_link(WEB_LINK) == WEB_LINK
    assert D.absolute_link("http://127.0.0.1:3610/#/start/x") == "http://127.0.0.1:3610/#/start/x"
    assert D.absolute_link(PATH_LINK) is None and D.absolute_link(None) is None and D.absolute_link("") is None


def test_telegram_button_needs_an_address():
    t = D.Telegram({"chat_id": "1", "token": "x"}, print)
    seen = []
    t._send = lambda text, buttons: seen.append(buttons) or "1"
    t.send_alert(ALERT, pocket_url=PATH_LINK)
    assert [b["text"] for b in seen[-1]] == ["Open in Gmail"], seen[-1]
    t.send_alert(ALERT, pocket_url=WEB_LINK)
    assert [b["text"] for b in seen[-1]] == ["Open in Pocket Code", "Open in Gmail"], seen[-1]


def test_email_link_needs_an_address():
    e = D.Email({"smtp_url": "smtp://u:p@mail.example.com:587", "to": "alex@example.com"}, print)
    sent = []
    e._send = lambda subject, text, html: sent.append((text, html)) or subject
    e.send_alert(ALERT, pocket_url=PATH_LINK)
    assert "/#/start/" not in sent[-1][0] and "/#/start/" not in sent[-1][1], sent[-1]
    e.send_alert(ALERT, pocket_url=WEB_LINK)
    assert WEB_LINK in sent[-1][0] and "Open in Pocket Code" in sent[-1][1], sent[-1]


def test_inbox_entry_keeps_the_pocket_path():
    p = D.PocketPush({"root": tempfile.mkdtemp()}, print)
    p.inbox = True
    calls = []
    p._node = lambda script, args, stdin=None: calls.append(args) or type("R", (), {"returncode": 0, "stdout": '{"entry": {"id": "e1"}}', "stderr": ""})()
    p.send_alert(ALERT, pocket_url=PATH_LINK)
    assert calls[-1][calls[-1].index("--url") + 1] == PATH_LINK, calls[-1]


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    for n, f in tests:
        f()
        print(f"ok  {n}")
    print(f"{len(tests)} passed")
