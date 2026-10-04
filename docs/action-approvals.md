# Action approvals

Select **Review actions** or **Full access** in the composer or under Session options
→ Permissions for the next turn. A choice applies to the next new/resumed turn and
is captured with queued instructions. Steering a running turn does not change its
permissions. The instance default applies when an older client or queue item has no
explicit choice. Review is the default; `POCKET_APPROVAL_MODE=full` retains unattended
behavior. `POCKET_ALLOW_FULL_ACCESS=0` rejects Full access at the API as well as hiding
it in the picker. This setting does not retroactively alter running turns.

When a native request arrives, the session moves to Needs approval and shows a Review
banner. Open it to inspect the command, file changes, or tool arguments, then choose
Allow once or Deny. Closing the sheet, sleeping the phone or losing the browser
connection does not approve anything. Refresh reloads the live pending requests.
Push notifications contain no command or argument details. A decision being sent is
not evidence of successful execution; check the conversation for the result.

## Provider behavior

- Claude uses `default` permission mode with ask rules for Bash, PowerShell, Edit,
  Write, NotebookEdit, Agent/Task, WebFetch/WebSearch and MCP tools. AskUserQuestion
  remains a separate native question. Deny rules and organization requirements still
  apply. Full access uses the previous bypassPermissions behavior.
- Codex uses a read-only sandbox with the `untrusted` approval policy and the user
  reviewer. It can perform safe reads and actions allowed by existing provider tool
  rules without prompting. Command and file-change approvals use the native `accept`
  or `decline` response, never a persistent rule amendment. File previews are taken
  from the matching native item; missing/oversized previews cannot be approved here.
- A Codex network request may release multiple pending requests to the displayed
  destination. An explicit additional-permissions request can grant the displayed
  subset for the rest of the turn, with that broader scope stated on the card. No
  session-wide permission grant is offered. Unsupported elicitation requests decline.
  Existing native user-input questions remain supported, including those the provider
  uses for its own connected-tool confirmations.

These are native execution controls, not semantic classification of email, payments,
or other business actions. An approved script, command, or delegation can perform
multiple operations. Existing tools and provider allow-rules are trusted. Account
isolation, service-account protection, employee roles, and mandatory per-resource
Google approvals belong in a separate connection service and restricted runtime.

Protocol references: [Claude permissions](https://code.claude.com/docs/en/permissions),
[Codex App Server](https://developers.openai.com/codex/app-server/). Wire schemas were
checked against the installed runtimes; no permissive fallback is used when a request
is malformed or unsupported.

## Recovery and audit

Each request belongs to one session, native request and live turn. Replies are
idempotent within that connection: repeated matching decisions do not send another
native response, conflicting decisions are rejected, and old-turn IDs cannot approve
new work. Decisions are recorded before being written to the provider. If the audit
cannot be written, nothing is approved. An uncertain pipe write cannot be retried;
stop the turn and inspect the result before starting again.

`approval-decisions.jsonl` in the instance data directory records request identifiers,
turn IDs, kinds, hashes, timestamps and decisions. It excludes commands, arguments,
file contents and credentials. Keep it with instance backups. Full request details
remain in the live inbox, private Claude turn logs and provider transcript, not
browser storage or notifications. Approval HTTP responses use `Cache-Control: no-store`.

Pending approvals do not survive a daemon restart as actionable requests. The
restarted daemon reattaches to the running Claude or Codex process and answers every
request that was sent before the restart with a deny (Codex: the fail-closed decline
for that request kind, skipping requests the log shows were already resolved), so the
turn carries on and the agent can ask again. A second answer to a request the old
daemon had already answered is ignored by the CLI (verified on Claude Code 2.1.281).
Only a process whose input pipe cannot be reopened is marked with an interrupted
approval (or question) connection. Stop an interrupted turn, review completed work, then
send a new instruction. Never reconnect an old approval to a new process. Deploy
while owned turns are idle, especially when questions or approvals are pending.

## Validation and rollback

Unit/API coverage checks session binding, malformed and oversized requests, audit
failure, duplicate and concurrent replies, uncertain transport, cancellation, denial,
browser reconnect and daemon restart. Browser fixtures check escaped action details,
keyboard controls, responsive cards, policy selection and disabled uncertain replies.
Real isolated Claude and Codex runs verified that file writes and shell writes stay
blocked before Allow, and file-write denials do not create the target.

Before rolling back below 1.4, stop owned turns, back up the current queue and convert
queued review-mode or unspecified-policy items to `uncertain` with an explanatory
error and incremented revision. Older code otherwise ignores the policy and runs with
full access. Back up and remove pending `.retry.json` auto-resume markers for review
turns before an older daemon starts. Preserve current transcripts, receipts, metadata
and audit records; do not overwrite them with an old state snapshot.

Run confirmation (build25): the always-visible status strip polls authenticated
server ownership/state every5seconds. Only a new server checkedAt confirms a run;
local age ticks, transcript activity and SSE keepalives cannot renew it. Failed
checks or15seconds without proof remove running lamps/counts and mark status
unconfirmed. Input requests and external/unconfirmed activity stay distinct.
The delivery receipt says Message delivered and clears on a confirmed outcome;
it does not claim work is still running. Phone/browser suspension may pause UI
polling; returning to the app fetches current state. Server turns continue
independently of that browser lifecycle.
