# Pocket Code workspace guide

This guide follows the current checkout, including the 1.7.1 UI refinements. Check
[CHANGELOG.md](../CHANGELOG.md) for which version has been released.

## Start or resume work

Open a session from the list or choose **New session**. Write the task, choose the
project directory and agent, then press **Start session**. **Choose a skill** inserts
an editable instruction from that agent's installed skills; choosing it does not
start a turn. A custom workspace path must be a directory on the server, not your phone.

Pocket-specific defaults may preselect the workspace, model, effort and permissions.
Otherwise the app uses its remembered choices and the installed CLI's configuration.
Model and reasoning selectors affect subsequent turns. Codex also offers **Plan first**
and **Work normally**; Plan first is guidance, not a security sandbox.

The session list distinguishes confirmed Pocket-owned runs from activity seen in an
external transcript. Search matches recent session titles and workspace paths.
Find in conversation searches the open conversation, including older transcript matches.

**All**, **Active** and **Attention** stay visible on the home list and switcher.
**Filters** contains workspace, agent, New, Pinned and Hidden choices. Its expansion
is remembered on this browser; applied secondary filters remain in the summary.
The desktop rail has its own independent Filters disclosure.

Pinning and renaming are server-side. Hiding a session is local to this browser,
preserves history, and is reversed by new activity. Active or waiting work stays visible.

## Desktop workspace

![Two conversations in the desktop workspace](images/desktop-split.png)

The left rail finds sessions. Open-session tabs keep recent work within reach.
The panel icon beside the conversation title hides the rail; drag its divider or
use its arrow keys to resize it.

Use **Split view** in the conversation header to open an existing session or a
**New session** beside it. A session row's menu also offers **Open beside** when a
main conversation is open. There can be up to four conversations, including the main
one, if the window has room. One unstarted New-session pane is allowed at a time.

Each pane has its own conversation, composer, stream, draft and request dialogs.
The pane's swap button exchanges it with the main conversation. Drag a divider or
focus it and use Left/Right to resize; double-click restores equal sharing.

Each conversation needs at least 380px, in addition to rail, dock and divider space.
When the window narrows or the rail expands, panes that do not fit hide in place.
They return when room is available. Below 900px, split panes are hidden. Hiding does
not reload the frame, discard the draft, release a process or stop work.

**Results**, **Queue** and **Git** open in a workspace panel on wide screens (1280px+)
and in a sheet at narrower widths. The panel's width is included when deciding how
many conversation panes fit. A panel that becomes a sheet retains its fields.

## Closing views and processes

| Control | Effect |
|---|---|
| X on an open-session tab | Removes that local tab. The session and any work continue. |
| X on an existing-session side pane | Closes that view. The server session continues. |
| X on an unstarted New-session pane | Removes that pane's unsent draft, attachments, choices and retry state. |
| Session options → Close session process | Releases the process if idle. Active work prompts for Keep running or Stop. |
| Keep it running in the background | Closes the main view while the server work continues. |
| Stop the turn | Interrupts the work before closing the main view. |
| Stop in the composer | Interrupts the current turn and pauses automatic follow-up drain. |

Closing the main session promotes the first side pane, or opens New session if none
is available. Promoting a New-session pane brings its draft and saved start state.
No close control deletes the saved conversation. Releasing a Codex session also frees
its writer lock so another surface can continue the thread.

## Conversation, results and files

Assistant output reads as a document: headings, lists, tables, quotes, code and task
checklists. Wide tables scroll within their own region. Tool activity appears in
compact ledger rows; copy controls copy message text or code. The newest plan is
expanded and older plans are collapsible.

**Results** collects links and report paths referenced by assistant messages. Search
or refresh that panel to find a result. A reference does not prove that a file was
successfully created. Existing external links retain their own access rules.

Supported local report downloads require login, a reference in that conversation,
and a path inside the operator's home directory outside hidden folders. The server
limits results to recent references; older ones may still be in the transcript.

**Changed files** shows edits recorded in this session's transcript. **Git** shows
the entire working tree, including changes by other sessions. Git inspection is read-only:
working and staged diffs are separate; sensitive paths and symlink escapes cannot be
previewed. Untracked files are listed without a content preview. The limits are
250 changed files and 256 KB per diff.

Attach files with the paperclip, paste an image into the message field, or choose
**Paste screenshot**. Clipboard support depends on the browser and embedding permissions.
Wait for uploads to finish before sending. An upload remains attached to the session
where it began, even if you switch conversations before it completes.

Drafts and attachment references survive a reload on the same browser. When delivery
is uncertain, **Retry same message** checks the original request identifier; it does
not intentionally create another turn. Review the conversation before discarding
an uncertain retry. See [delivery recovery](operations.md#delivery-and-queue-recovery).

## Steering and follow-up queues

While a turn runs, **Steer now** delivers a correction into the active turn. It does
not start an independent turn or change the running turn's model or permissions.
**After this turn** saves a separate instruction for later execution.

Open **Queue** to edit, remove or run pending instructions. Editing reserves the row
so it cannot dispatch until saved or canceled. Closing the editor leaves it paused;
Continue editing recovers this browser's unsaved draft. Other devices see the paused
server row but not that local draft. Stale edits are rejected by revision checks.

Stopping or failing a turn pauses automatic drain. A later successful turn can resume
the backlog. After a daemon restart, a queue without an owned run waits for a new
turn or **Run next instruction**. An uncertain dispatch blocks later entries until
its outcome is reviewed and the uncertain row is removed.

## Questions, permissions and status

Native questions and approval requests appear in separate banners. Answers require
an explicit submission. Approval cards show the action and offer Allow or Deny;
closing a dialog or losing the browser connection does not approve it.

**Review actions** is the default. **Full access** allows unattended execution if the
operator permits it. A mode choice applies to the next turn and is captured with a
queued instruction; it does not change an active turn. See [action approvals](action-approvals.md)
for provider-specific scope, restart handling and limitations.

The run-confirmation strip stays visible when the header collapses. Only a fresh
server status response confirms an owned run. Failed checks or stale proof remove
that confirmation; a locally ticking timer is not evidence that work is progressing.
An external transcript can show activity without proving a process is still running.
Browser suspension may pause status refresh; the server turn remains independent.

The context meter shows the latest known context relative to the model window, with
estimates labelled `est.`. Phones show the percentage. It is not cumulative token
billing for the whole turn. Plan usage, available in Session options and Settings,
shows observed provider windows, reset times in Eastern, extra-usage status where
reported, and the observation time. It updates when provider events arrive, not as a
live account-billing meter. A reset that passed since observation is marked explicitly.

## Settings, notifications and compact views

Settings opens without waiting for notification support. Accounts & instance, Plan
usage, keyboard help, completion chime, push and name sync precede the expandable
About & updates and What's new sections. Version lookup failures offer a retry instead
of claiming the app is current. Frontend and server build numbers can differ until
the daemon restarts during an upgrade.

Accounts & instance shows provider identity and plan metadata; it does not change
credentials. Sign in or change accounts through the server's provider CLI.

Chat text size applies across this browser's conversations, from 14 to 24px (17px by
default). Prose, headings and tables scale; tool logs and application controls keep
their own sizes. The header chevron and composer gear independently recover reading
space, while status, attachment access, draft, Send and active-turn controls remain.
Toolbar arrows reveal settings that do not fit. See [collapse behavior](session-focus.md).

Push needs server VAPID keys, HTTPS and browser permission. A failed service-worker
registration leaves other settings usable and presents a retry message for notifications.
The completion chime and per-session mute are separate preferences. Installed-phone
background delivery and audio behavior need a real-device check.

## Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Ctrl/Cmd K | Find a session |
| Ctrl/Cmd Shift L | New session |
| Alt [ / Alt ] | Previous / next open-session tab |
| Ctrl/Cmd F in a conversation | Find in conversation |
| Enter in a desktop composer | Send |
| Shift+Enter in a desktop composer | New line |
| Escape | Close a sheet or search; from the conversation, return to sessions |
| Arrows, Home, End in agent/workspace choices | Select within the radio group |
| Left / Right on a divider | Resize the rail or pane |

Phone composers retain their native multiline input behavior. Dialogs trap focus and
return it to their opener; skip links target the current task or message field.

## Where preferences live

| This browser/device | Server/provider data |
|---|---|
| Open tabs, split arrangement, hidden sessions, filters | Conversation transcripts and native Codex store |
| Drafts, reading position, attachment references, retry state | Uploaded files and delivery receipts |
| Text size and collapse preferences | Pins, names, per-session mutes and name-sync setting |
| Per-session composer choices and chime preference | Follow-up queue, approval audit, usage snapshots, runner state |

Keep browser storage to retain local preferences. Keep the server data inventory in
[operations](operations.md#state-and-backups) across upgrades and rollbacks.
