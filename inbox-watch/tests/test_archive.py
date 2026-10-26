"""The mail archive's column that marks the owner's own mail (1.81): archives written before it was renamed `from_owner` keep
their rows and gain the new name when opened, once; a new archive is created with it. A temporary SQLite file; no mailbox.

    python3 tests/test_archive.py
"""
import sqlite3
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from inbox_monitor import engine as E  # noqa: E402

OLD_SCHEMA = """
create table mail(message_id text primary key, thread_id text, ts integer, date text, sender text, recipients text,
  subject text, labels text, from_brad integer, body text);
create index mail_thread on mail(thread_id, ts);
create virtual table mail_fts using fts5(subject, sender, body, content='mail', content_rowid='rowid', tokenize='unicode61 remove_diacritics 2');
create trigger mail_ai after insert on mail begin
  insert into mail_fts(rowid, subject, sender, body) values (new.rowid, new.subject, new.sender, new.body); end;
"""


def old_archive():
    path = Path(tempfile.mkdtemp()) / "state" / "mail.sqlite"
    path.parent.mkdir()
    db = sqlite3.connect(path)
    db.executescript(OLD_SCHEMA)
    db.executemany("insert into mail values(?,?,?,?,?,?,?,?,?,?)", [
        ("m1", "t1", 1000, "d", "pat@vendor.example", "alex@example.com", "Invoice 42", "[]", 0, "Attached is the invoice."),
        ("m2", "t1", 2000, "d", "alex@example.com", "pat@vendor.example", "Re: Invoice 42", '["SENT"]', 1, "Paid today.")])
    db.commit()
    db.close()
    return path


def columns(db):
    return [r[1] for r in db.execute("pragma table_info(mail)")]


def test_old_archive_is_renamed_and_keeps_its_rows():
    path = old_archive()
    a = E.Archive(path)
    cols = columns(a.db)
    assert "from_owner" in cols and "from_brad" not in cols, cols
    assert [(r["message_id"], r["from_owner"]) for r in a.db.execute("select * from mail order by ts")] == [("m1", 0), ("m2", 1)]
    assert [r["from_owner"] for r in a.thread("t1", 5000)] == [0, 1]
    # the full-text index and its triggers still work after the rename
    a.add([{"message_id": "m3", "thread_id": "t2", "ts": 3000, "date": "d", "sender": "pat@vendor.example", "recipients": "", "subject": "Quote 7",
            "labels": "[]", "from_owner": 0, "body": "A quote for the gate."}])
    assert [r["message_id"] for r in a.db.execute("select m.message_id from mail_fts f join mail m on m.rowid=f.rowid where mail_fts match 'quote'")] == ["m3"]
    assert [r["message_id"] for r in a.db.execute("select m.message_id from mail_fts f join mail m on m.rowid=f.rowid where mail_fts match 'invoice' order by m.ts")] == ["m1", "m2"]


def test_opening_again_changes_nothing():
    path = old_archive()
    E.Archive(path).db.close()
    a = E.Archive(path)
    assert columns(a.db).count("from_owner") == 1 and "from_brad" not in columns(a.db)
    assert a.db.execute("select count(*) n from mail").fetchone()["n"] == 2


def test_a_new_archive_is_created_with_the_neutral_name():
    a = E.Archive(Path(tempfile.mkdtemp()) / "state" / "mail.sqlite")
    cols = columns(a.db)
    assert "from_owner" in cols and "from_brad" not in cols, cols


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_"):
            fn()
            print("ok", name)
