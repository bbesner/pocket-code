# Pocket Code product improvement plan

> Historical design and verification record. For current behavior, use the
> [workspace guide](docs/workspace-guide.md). Do not use this record as an upgrade runbook.

This plan turns the October 2026 mobile/desktop design review into four stages.
The first priority is keeping track of running sessions. Pocket Code remains a
standalone, mobile-first PWA; the Mission Control entry point is deployed, and employee packaging follows daily-use validation.

## 1. Session visibility and delivery reliability — implemented in 1.1.0

- Group and filter recent sessions by confirmed running work, recent external
  activity, and recorded failures. Do not turn transcript recency into a claim
  that an agent is running, waiting for input, or successful.
- Show useful state labels, elapsed time for owned runs, queued follow-ups, and
  last update. Preserve the existing session stores and fast list query.
- Provide the same session controls in the desktop rail and a mobile switcher.
- Make session actions visible and accessible; preserve drafts when navigating.
- Preserve text and attachments through failed sends. Persist a client message
  identifier and server receipt so retrying an acknowledged-but-lost response
  does not launch a duplicate action. Surface ambiguous restart cases explicitly.
- Show connection trouble and stale session data; do not silently keep a green state.

Acceptance: seeded multi-session browser checks at 360/390/768/1440px; reliable
filter/count behavior; long names and no horizontal page overflow; keyboard
dialogs; failed sends preserve content; double clicks and response-loss retries
execute once; restart receipt recovery; both providers retain their existing APIs.

Verification completed: eight unit/API tests and fixture-browser checks at all four
widths, including response-loss recovery for existing and new sessions. These use a
fake Claude CLI and synthetic Claude/Codex session rows. Real Claude and Codex smoke tests also passed new turns, resumed turns and
duplicate-request recovery. Physical-device and assistive-technology checks remain
operator validation; rollout is controlled separately from the public release.

## 2. Conversation quality and interactive controls — delivered through 1.3.0

- Safe Markdown tables, quotes, nested lists and heading structure; contained
  scrolling for wide content and readable result links.
- Full dialog focus/keyboard behavior, readable secondary text and comfortable
  touch targets throughout, including settings, model/effort and copy controls.
- Delivered: explicit steer/queue choices, a persistent editable queue, and runtime
  acknowledgments for Codex starts/steering.
- Delivered in 1.3: native Claude questions and Codex Plan-mode questions,
  per-request replies, explicit needs-answer state and interrupted-question recovery.
- Candidate 1.4: native action-approval cards, Review actions / Full access policy,
  request-bound decisions and interrupted-connection recovery. Plan mode and approval
  UI are not employee identity/resource isolation. See docs/action-approvals.md.
- Session result index linking to existing document destinations.

Acceptance: representative inventory/product reports; sanitized hostile Markdown;
keyboard-only navigation; structured questions tested against each provider;
real phone software-keyboard and screen-reader checks before release claims.

## 3. Mobile and desktop composition — core daily workspace delivered in 1.3.0

- Task-first New Session, friendly workspace labels, advanced options collapsed.
- Delivered: desktop open-session tabs, workspace/provider/pinned filters,
  local hide/restore, keyboard controls, optional Results/Queue/Git panel,
  read-only Git inspection and Accounts & instance metadata.
- Mobile full-screen conversation/results, preserved draft and reading position.
- Consistent type, spacing, interaction states and motion; optional light/system theme.
- Skill discovery with friendly task starters, rather than a separate hard-coded
  form for every skill. Expert controls remain available.

Acceptance: one complete task on phone and desktop, cold load, phone sleep/resume,
long conversations, empty/error states, responsive and rendered design review.

## 4. Mission Control integration delivered; employee instances deferred

- Delivered: Mission Control embeds the same app origin while preserving direct PWA entry.
- One maintained release with per-instance modules, defaults and authorized skills.
- Separate persistent session storage, credentials, workspaces and MemStem access.
- Versioned container packaging, health checks, backup/restore and rollback.
- Pilot a warehouse workflow with one employee before expanding.

## Working and release agreement

Implementation uses an isolated feature checkout and pull request. The live app
and other installations remain unchanged during development. Every release gets
targeted regression tests, rendered desktop/mobile inspection, a bounded design
scan and a reviewable change summary. Production deployment follows explicit
release approval. Project tracking remains an explicit operator choice.

The current visual direction is warm charcoal with clay accents, native readable
type, restrained motion, and clear state hierarchy. Refinement preserves that
identity. Later stages may be reordered based on daily-use evidence.

## Version policy

- 1.1.0 / asset build 20: the first usable session-workspace increment.
- Later compatible feature stages receive minor versions; fixes receive patch versions.
- Update the package version, lockfile, changelog and in-app notes in the feature PR.
- Mark the changelog entry Unreleased until merge/release. Tag the reviewed commit
  and publish matching GitHub release notes; deployment is a separate step.
- Keep implementation, tests, documentation and synthetic screenshots in this public
  repository. Keep credentials, real transcripts and private deployment notes out.

## Current stopping point

1.3.1 is live with compact desktop controls and adjustable chat text. Candidate 1.4
adds native action approvals for both providers and is pending release approval.
Queue edits pause dispatch, and real staged/working Git views supplement the older
transcript-based Session edits view. Both providers passed real native question,
answer and continuation checks; read-only account summaries show CLI identities.
The Mission Control app and standalone Pocket Code remain separate installs.

Next: desktop/phone daily-use feedback; choose an employee pilot and its allowed
workspaces, credentials, skills and approval policy before provisioning. Employee
hosting/container decisions and other people's deployments remain deferred by the
operator. Native action approvals are implemented in candidate 1.4; employee identity, restricted
Google connections and mandatory per-resource policies remain separate work. Optional themes, full editor/terminal functions
and new business workflows are not required for this release.
