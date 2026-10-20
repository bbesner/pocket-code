"""Gmail access for one mailbox: history sync, thread and message reads, searches. Read-only.

Two ways in:
  auth = "service_account": a Google Workspace service account with domain-wide delegation impersonates the owner
      (service_account_file, scope gmail.readonly). Works for every mailbox in a domain the admin controls.
  auth = "oauth": the owner's own consent. `inbox-monitor gmail-auth` runs the browser flow once with
      oauth_client_file (an OAuth client of type "Desktop app") and keeps the refresh token in oauth_token_file.
"""
from __future__ import annotations

import time
from pathlib import Path

from googleapiclient.discovery import build
from googleapiclient.errors import HttpError  # noqa: F401  (re-exported for the engine)

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]


def credentials(mail: dict, owner_email: str):
    auth = mail.get("auth", "service_account")
    if auth == "service_account":
        from google.oauth2 import service_account
        return service_account.Credentials.from_service_account_file(mail["service_account_file"], scopes=GMAIL_SCOPES).with_subject(owner_email)
    if auth == "oauth":
        from google.oauth2.credentials import Credentials
        token = Path(mail["oauth_token_file"])
        if not token.exists():
            raise RuntimeError(f"no Gmail token at {token}; run `inbox-monitor gmail-auth` once")
        creds = Credentials.from_authorized_user_file(str(token), GMAIL_SCOPES)
        if not creds.valid:
            from google.auth.transport.requests import Request
            creds.refresh(Request())
            token.write_text(creds.to_json())
        return creds
    raise ValueError(f"mail.auth must be service_account or oauth, not {auth!r}")


def oauth_consent(mail: dict) -> Path:
    """One-time browser consent for auth = "oauth"; writes the token file."""
    from google_auth_oauthlib.flow import InstalledAppFlow
    flow = InstalledAppFlow.from_client_secrets_file(mail["oauth_client_file"], GMAIL_SCOPES)
    creds = flow.run_local_server(port=0, open_browser=False)
    token = Path(mail["oauth_token_file"])
    token.parent.mkdir(parents=True, exist_ok=True)
    token.write_text(creds.to_json())
    token.chmod(0o600)
    return token


SKIP_LABELS = {"SPAM", "TRASH", "DRAFT", "CHAT", "CATEGORY_PROMOTIONS"}


class Gmail:
    def __init__(self, mail: dict, owner_email: str, baseline_query: str, archive_query: str):
        self.svc = build("gmail", "v1", credentials=credentials(mail, owner_email), cache_discovery=False)
        self.u = self.svc.users()
        self.baseline_query = baseline_query
        self.archive_query = archive_query

    def profile_history_id(self) -> str:
        return str(self.u.getProfile(userId="me").execute()["historyId"])

    def changed_threads(self, cursor: str) -> tuple[set[str], str, bool]:
        """Thread ids with messages added since cursor, the new cursor, and whether a rebaseline is needed."""
        threads: set[str] = set()
        page = None
        try:
            while True:
                resp = self.u.history().list(userId="me", startHistoryId=cursor, historyTypes=["messageAdded"], maxResults=500, pageToken=page).execute()
                for h in resp.get("history", []):
                    for item in h.get("messagesAdded", []):
                        m = item.get("message", {})
                        if SKIP_LABELS & set(m.get("labelIds", [])):
                            continue
                        if m.get("threadId"):
                            threads.add(m["threadId"])
                page = resp.get("nextPageToken")
                new_cursor = str(resp.get("historyId", cursor))
                if not page:
                    return threads, new_cursor, False
        except HttpError as e:
            if e.resp.status == 404:
                return set(), cursor, True  # cursor expired: rebaseline
            raise

    def search_ids(self, query: str, cap: int) -> list[str]:
        ids: list[str] = []
        page = None
        while len(ids) < cap:
            resp = self.u.messages().list(userId="me", q=query, maxResults=min(500, cap - len(ids)), pageToken=page).execute()
            ids += [m["id"] for m in resp.get("messages", [])]
            page = resp.get("nextPageToken")
            if not page:
                break
        return ids[:cap]

    def baseline_threads(self, query: str | None = None, cap: int = 60) -> set[str]:
        threads: set[str] = set()
        page = None
        while len(threads) < cap:
            resp = self.u.messages().list(userId="me", q=query or self.baseline_query, maxResults=100, pageToken=page).execute()
            for m in resp.get("messages", []):
                threads.add(m["threadId"])
            page = resp.get("nextPageToken")
            if not page:
                break
        return threads

    def fetch_messages(self, ids: list[str]) -> list[dict]:
        """messages.get(format=full) in batches of 40, retrying rate-limit and server errors."""
        out: list[dict] = []
        ids = list(ids)
        for i in range(0, len(ids), 40):
            pending, tries = ids[i:i + 40], 0
            while pending and tries < 6:
                retry: list[str] = []

                def cb(rid, resp, exc, retry=retry):
                    if exc is None:
                        out.append(resp)
                    elif isinstance(exc, HttpError) and exc.resp.status in (429, 500, 502, 503):
                        retry.append(rid)

                batch = self.svc.new_batch_http_request()
                for mid in pending:
                    batch.add(self.u.messages().get(userId="me", id=mid, format="full"), request_id=mid, callback=cb)
                batch.execute()
                pending = retry
                if pending:
                    time.sleep(2 ** tries)
                    tries += 1
            time.sleep(0.4)
        return out

    def thread_raw(self, thread_id: str) -> list[dict]:
        return self.u.threads().get(userId="me", id=thread_id, format="full").execute().get("messages", [])
