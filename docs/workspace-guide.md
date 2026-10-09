# Pocket Code workspace guide

This guide follows the current checkout, including the 1.7.1 UI refinements. Check
[CHANGELOG.md](../CHANGELOG.md) for which version has been released.

## Start or resume work

Open a session from the list or choose **New session**. Write the task, choose the
project directory and agent, then press **Start session**. **Choose a skill** inserts
an editable instruction from that agent's installed skills; choosing it does not
start a turn. A custom workspace path must be a directory on the server, not your phone.
With no default workspace and nothing remembered, the most recent workspace is
preselected and named above **Start session**. If something is missing, the reason
appears under the button.

**Saved prompts.** **Save as prompt** keeps the task with its workspace and agent (and, if you
keep them, model, effort, permissions and Codex mode). Saved prompts show as chips above the task
box; a tap fills the screen and you press Start. **Recent** lists your last five starts from any
device. **Manage** (or a long-press on a chip) reorders, renames, replaces and deletes them. They
are stored on the server, so every device sees the same list.

Pocket-specific defaults may preselect the workspace, model, effort and permissions.
Otherwise the app uses its remembered choices and the installed CLI's configuration.
Model and reasoning selectors affect subsequent turns. Codex also offers **Plan first**
and **Work normally**; Plan first is guidance, not a security sandbox.

Switching agents resets an incompatible model choice to Default. Opening an existing
session also repairs a saved choice from the other agent. Valid choices stay saved;
the model button shows an unrecognized model by its ID instead of labelling it as
the default. Older tabs that send a model for the wrong agent receive a message to
choose a model and send again; Pocket does not start or queue that request.

The session list distinguishes confirmed Pocket-owned runs from activity seen in an
external transcript. Search matches recent session titles and workspace paths.

A session's title is your rename, else the agent's own title, else a short title
Pocket generates from the opening request. Clearing a rename returns to that title.

**Settings → Generate short titles** turns generation on or off for the whole server
(on by default), and **Title model** picks who writes them:

| Choice | Uses | Cost per title |
|---|---|---|
| Automatic | Claude when its CLI is installed and signed in, otherwise Codex | as below |
| Claude · Haiku | `claude -p --model haiku`, no tools, no saved session | about 400 tokens |
| Codex · GPT-6-Luna | `codex exec --ephemeral`, read-only, low effort | about 25k tokens (Codex's built-in instructions) |

Calls run on that CLI's own sign-in: your Claude or ChatGPT subscription, or an API key
if the CLI uses one. Titles are kept in `session-meta.json`, never written to a
transcript, made one at a time, and only for sessions active in the last 14 days.
A provider that is not installed, not signed in, or (Codex) does not offer GPT-6-Luna is
shown as unavailable with the reason; with neither available no calls are made. Turning
titles off also hides the ones already made, so the list matches code-server when Sync
names with code-server is on. Claude's `haiku` alias follows the installed CLI: update
Claude Code to move titles to the newest Haiku.

**Search inside conversations.** Three or more characters in a session search box also
search inside conversations after a short pause. The **In conversations** section shows the
matching passage and who wrote it; tapping a result opens the conversation with Find on the
match. With [MemStem](https://github.com/Memstem/memstem) beside Pocket the search covers
every session by wording and meaning (sessions that only match by meaning say **Related**);
without it, Pocket searches the 200 most recent conversations for the exact phrase, for up to
six seconds, and says how many it covered.

Scheduled runs that open with `[cron:<id> Job name]` (or an OpenClaw runtime preamble)
are marked automated, show the job name, and sit in a collapsed **Automated** group at
the end of **All**. Search, the other filters, pins, running work and anything needing
attention show them as usual. Sessions in `/tmp/` workspaces are left out unless pinned
or running.
Find in conversation searches the open conversation, including older transcript matches.

**All**, **Active** and **Attention** stay visible on the home list and switcher.
**Filters** contains workspace, agent, New, Pinned and Hidden choices. Its expansion
is remembered on this browser; applied secondary filters remain in the summary.
The desktop rail has its own independent Filters disclosure.

Pinning and renaming are server-side. Hiding a session is local to this browser,
preserves history, and is reversed by new activity. Active or waiting work stays visible.

Pinned sessions keep an order of their own, saved on the server so every device agrees.
On desktop widths each pinned row has a grip: drag it onto another pinned row, or focus
it and press the up and down arrow keys. Session options offers **Move pin up** and
**Move pin down** on any device. A newly pinned session follows the ordered pins by
recency; unpinning forgets its place.

## Desktop workspace

![Two conversations in the desktop workspace](images/desktop-split.png)

The left rail finds sessions. Open-session tabs keep recent work within reach. A pinned
session's tab shows the pin and its title in the accent, and pinned tabs come first in
the pinned order, then the rest in the order opened; Alt [ / ] follow the same order.
Each tab also shows its session's status before the title, matching the rail row: the
breathing ember while a turn runs, an amber dot when it needs you, green for an unread
reply, red for a failed turn and a ring for activity elsewhere or a paused queue.
Quiet sessions show no mark. Hover a tab to read the status.
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
checklists. On wide screens prose stops at a readable line length (about 68 characters'
width at the chosen text size) while tables and code use the full width. Wide tables
scroll within their own region. Tool activity appears in
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
an uncertain retry.

**While you were away.** Opening a session that kept working while you were gone (or
returning to the app) opens the conversation at the end, with a **New since …** line
before the first message you have not seen. "Since" is the later of the reviewed marker
shared by your devices and the last time this browser had the conversation on screen.
An away card under the latest message repeats the time and offers **Read from there**,
which jumps to the line and keeps the view there until you scroll, tap or type. When the
new part is more than a short exchange, the card also summarizes it in two to four lines
and names the model that wrote it; when the latest reply ends in suggested replies, the
card sits above them. The summary uses the model chosen under **Settings → Model for
titles and summaries** and only the new messages; turn it off with **Summarize what you
missed** (the line and the card stay).

When the last turn failed, the end of the conversation says so, with the reason when
the agent gave one, and offers **Send again** (the last message, as a new turn) and
**Edit message** (puts it in the message box). Neither replaces a draft you are typing.
The notice comes from the server, so it is still there after a reload or on another device. See [delivery recovery](operations.md#delivery-and-queue-recovery).

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

**Attention** collects everything waiting on you: agent questions, action approvals, failed turns, and
replies marked Response ready that you have not opened yet. Opening a session clears its Response ready.
To clear one without opening it, long-press the session (or tap ⋯) and choose **Mark as reviewed**; a
failed turn clears the same way. In **Attention** and **New**, the bar above the list offers **Mark all
reviewed**, with **Undo** for 10 seconds. Questions and approvals stay until you answer them. Opening or marking a
session reviewed counts on all your devices: clear it at your desk and it is gone from your phone too.

**Reply suggestions.** Pocket asks Claude and Codex to end a closing question that offers specific next
steps with a short list of options. Pocket shows them as buttons under the latest reply once the turn has
finished; a tap sends that option as your next message, exactly as if you had typed it. When the agent has a
clear recommendation, that button is filled and tagged **Recommended**; the tag is a hint, not part of what a
tap sends, and an even choice has no tag. Typing in the
message box hides them, and the X dismisses them for that reply. They never appear mid-turn: questions
an agent asks while it works still use the question form. The instruction is added only to turns Pocket
runs (Claude via `--append-system-prompt`, Codex via thread developer instructions; a Codex config that
sets its own `developer_instructions` is left alone and gets no suggestions). Sessions run from a
terminal or editor show no buttons. Set `POCKET_CHOICES=0` to turn the instruction off.

Native questions and approval requests appear in separate banners. Answers require
an explicit submission. Approval cards show the action and offer Allow or Deny;
closing a dialog or losing the browser connection does not approve it.

**Review actions** is the default. **Full access** allows unattended execution if the
operator permits it. A mode choice applies to the next turn and is captured with a
queued instruction; it does not change an active turn. See [action approvals](action-approvals.md)
for provider-specific scope, restart handling and limitations.

The run-confirmation strip stays visible when the header collapses. On phones and
panes up to 600px wide it sits in the title bar beside the project name, in short words
(Idle, Running, Needs your answer); hover or long-press for the detail. The check time
moves in steps (just now, 10s ago, 1m ago) so a healthy check does not tick every second. Only a fresh
server status response confirms an owned run. Failed checks or stale proof remove
that confirmation; a locally ticking timer is not evidence that work is progressing.
An external transcript can show activity without proving a process is still running.
Browser suspension may pause status refresh; the server turn remains independent.

The context ring sits beside the composer's settings button (in the working row while a turn runs). It
fills as the session's context window fills, turning amber at 70% and red at 90%. Hover or focus it for
the model, tokens used, the window size and the percentage; click it for this session's usage: the context
window (window, used, free, as of) and the provider's plan limits. Estimates are labelled. It shows the
latest known context relative to the model window, not cumulative token billing for the whole turn.

Beside the ring, Claude sessions show how long the prompt cache stays warm (1.28): minutes left, amber in
the last stretch, `cold` once it has expired, when the ring turns ice blue (1.28.1). Claude caches the session's context after each request for a
lifetime (one hour on a normal plan, five minutes in some cases such as extra usage); a turn that starts
while it is warm reads the context cheaply, while a turn after it expires writes the whole context to cache
again. Usage → **Prompt cache** gives the status, expiry, cached tokens, lifetime and how the last turn
started; each reply's turn line adds "97% cached" or "cold start". Open-session tabs mark sessions with
at least 100k cached tokens with an hourglass when the cache is about to expire and a snowflake once it has.
All of this is an estimate from the transcript's last request, so it includes turns run in a terminal or
code-server; the provider can drop a cache sooner. Codex sessions show no cache figures.

## Projects

Projects (1.29) keep the work that comes out of sessions beside the sessions. The feature
is off until **Settings → Tools → Projects** turns it on for the whole install.

A project is one card: where you left off, the next step, what it is waiting for, a
directory and a link, a checklist of remaining steps, reminders, notes, history, and the
sessions that worked on it, each with its live status mark. States are Active, Waiting and
Done. Finishing a project stops its reminders; resuming it does not bring them back.
A reminder belongs to the project or to one step; finishing the step stops its reminder,
and a new reminder on the same project or step replaces the open one (that is what
*Remind later* does). An edit made from a stale card is refused and the current card is
shown.

Projects are tracked only when you ask: **Track a project** on the list, the **Project**
control under a conversation's header, or **Add to project** in a session's options, which tracks a new project around the session (its
workspace becomes the directory) or links the session to an existing one. Agents keep a
card current with the `pocket-board` command (see the README); they may track a project
only with `--requested`, so nothing enrolls work by inference. With Projects on, agents
started by Pocket are told how, and told to do it only when you ask, so "track this as a
project" works in any session.

**Scheduled** lists every open reminder across projects, due first. Only reminders Pocket
Code itself keeps appear there. When a reminder comes due it is sent once to your devices
by push, with a link to the card, and once to the server's reminder hook if the operator
set one; the card and the Scheduled list keep showing it as due until you dismiss it or
set a new time.

On the desktop the rail head switches between **Sessions** and **Projects**, with the
count of due reminders. Pick a project from the rail and it opens as a tab in the same
strip as sessions (pinning, closing and Alt [ / ] work the same; the tab's mark is the due
count), or beside the conversation if Settings → Tools says so. *Open beside* and *Split
view* also offer Projects, Scheduled and the active projects. On the phone, the session
home shows a **Projects** chip and views open full-screen.

## Settings, notifications and compact views

Settings opens without waiting for notification support. Accounts & instance, Plan
usage, keyboard help, completion chime, push and name sync precede the expandable
About & updates, What's new and Bugs & feature requests sections. The last opens the
GitHub issue forms with the app version and build filled in. Version lookup failures offer a retry instead
of claiming the app is current. Frontend and server build numbers can differ until
the daemon restarts during an upgrade.

Accounts & instance shows provider identity and plan metadata. Under Claude Code,
choose **Switch account** (or **Sign in**), then **Get sign-in link**. Open the link,
select the account you want in Claude’s browser page, and authorize Claude Code.
Return to Pocket, paste the code including any `#` suffix, and choose **Finish sign-in**.
Pocket shows the verified account when the CLI finishes. Paste codes only in this
form, not in a conversation.

This changes the shared Claude login on this server, including code-server when it
uses the same configuration. Finish Pocket’s current Claude turns first. Background
jobs keep running and may keep their earlier login. Idle Claude processes close and
new Claude turns wait until sign-in ends; conversations remain saved. After signing
in, use a new session with the new account, or wait for a retained session’s jobs to
finish before sending its next message. Pocket then reopens that session with the
current login. Other open Claude processes may need reopening. Codex is unchanged.

Closing the form leaves sign-in pending for up to ten minutes. Return to Accounts &
instance to resume it, or choose **Cancel sign-in**. A server restart ends a pending
sign-in. Pocket does not explicitly log out the current account first; after an
interrupted attempt, refresh Accounts to check which login is in place. API keys,
cloud-provider authentication, and Codex sign-in are managed through the server.

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

## Voice mode (beta)

Voice mode is in beta: expect its timing and wording to change as it improves. It appears when the server has the voice engine installed (`scripts/voice-setup.sh`).
The mic sits beside Send in every conversation, including split panes.

- **Tap to talk.** Tap the mic, speak, and pause. Pocket detects the end of speech, transcribes it
  on the server and sends it. Tap the mic again to send early, or Cancel to discard.
- **Hold to talk.** Hold the mic while you speak and release to send. Useful in noisy places.
- **While a turn runs**, a spoken message steers the running turn or waits for it, following the
  When to send choice, exactly like a typed message.
- **A typed draft is never sent for you.** If the message box already has text, what you say is
  added to it for you to review and send.
- **Quick commands** are answered on your device without involving the agent: *what's it doing*
  (latest step), *stop* (stops the running turn), *read it* (the latest reply at your spoken reply length),
  *read it all*, *what's waiting on me* (approvals, questions and sessions needing you),
  *be quiet* (stops speaking), *mute* and *unmute* (spoken output on this device). Longer or
  different sentences are sent to the session.
- **Spoken replies.** When a turn you started by voice finishes, the reply is read aloud at the
  length set in Settings → Voice → Spoken reply length: Brief (one sentence), Normal (about two, the
  default) or Detailed (the whole reply, stopping after about three minutes). Code, tables and links
  are left on screen. The setting changes how much is read, not what the agent writes. If the agent needs an approval or has a question,
  you hear that, and you answer it on screen.

**Mute voice.** When voice is available, the composer has a **Voice** chip beside Alerts (an icon
beside the bell while a turn runs). One tap mutes every spoken reply, announcement and approval or
question prompt on this device, stops anything being spoken and ends a hands-free conversation; your
Speak replies, Announce sessions and other voice settings are kept and apply again when you tap it
back. While muted, quick commands show their answer in the voice strip, the completion chime applies
as configured, and Settings → Voice → Play a sample still plays. Starting hands-free, or saying
"unmute", turns voice back on. Settings → Voice shows the same switch.

**Spoken alerts.** Settings → Voice (beta) → Announce sessions: Off (default), Session name only, or
Name and a one-line summary. While Pocket is open, it then says when any session finishes, stops with
an error, or needs your approval or answer, and replaces the completion chime. Alerts wait until you
finish speaking or a reply finishes; each event is said once even with several Pocket tabs open, and
split panes stay quiet (the main window speaks). Per-session mute silences a session's alerts. A
hidden tab keeps checking every few seconds. Browsers allow sound only after one tap or click on the
page; an alert that arrives before that waits for your first tap. Push notifications remain the way
to hear about work while Pocket is closed or the phone is locked.

The composer has two voice buttons. The mic sends one message: tap and speak (it sends when you
pause) or hold for push-to-talk; it never listens again by itself. The headset starts a hands-free
conversation for the open session: each reply is read aloud and the mic reopens for your answer,
waiting 2 minutes by default while you read the rest. Tap the headset again, tap Cancel or Stop,
leave the session or stay quiet past the wait to end it. The headset hides while you have a typed
draft, since speech then only adds to the draft. Announcements, approval prompts and replies outside a
hands-free conversation are spoken without reopening the mic.

In hands-free, Pocket reads each instruction back ("Ready to send: …") and waits. Say "send it" (or yes,
go ahead) or tap Send to send it; say "cancel" or tap Cancel to drop it; say "edit" or tap Edit to put it in
the message box. Saying something else replaces it and is read back again. Nothing reaches the agent
without that yes. Quick commands (what's it doing, stop, read it) are answered at once. The plain mic
sends as before.

Settings → Voice controls whether replies are spoken, review-before-sending, Hands-free: wait for my
reply (30 seconds to 5 minutes), the voice, and names and terms for the recognizer (project names,
product codes). The screen stays awake while voice is active.
Embedded views need microphone permission from the page that embeds Pocket; otherwise the mic
explains that it is blocked and you can open Pocket Code directly.

## Where preferences live

| This browser/device | Server/provider data |
|---|---|
| Open tabs, split arrangement, hidden sessions, filters | Conversation transcripts and native Codex store |
| Drafts, reading position, attachment references, retry state | Uploaded files and delivery receipts |
| Text size and collapse preferences, dismissed reply suggestions | Pins and their order, names, per-session mutes and name-sync setting |
| Per-session composer choices and chime preference | Follow-up queue, approval audit, usage snapshots, runner state |
| Voice preferences, voice mute and vocabulary | Voice engine install (`POCKET_VOICE_HOME`); no recordings are kept |

Keep browser storage to retain local preferences. Keep the server data inventory in
[operations](operations.md#state-and-backups) across upgrades and rollbacks.

## Subagents

A session with delegated work shows a Subagents button beneath the status controls,
including with the header collapsed. Its count shows agents whose running state
Pocket can confirm. Open it and expand a task to see the instructions, status and
latest activity or result. Model and tool usage appear when the provider supplies them.
Session options also includes Subagents, with an empty state before any are recorded.

The list refreshes every five seconds while the app is visible. Expanding a row and
reading its text does not send a message or take control of that agent. Completed
entries remain in the list. If Pocket loses confirmation, the status changes to
unconfirmed and the last details remain available with Retry. Terminal/editor
sessions can supply history without proving that their agents are still running.
The view shows up to 100 agents; it labels truncated history. Task and result text
are limited to 12,000 characters per field. Background shell jobs are excluded.
