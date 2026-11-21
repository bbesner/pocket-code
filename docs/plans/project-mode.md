# Project mode (conductor): plan

**Prepared:** November 15, 2026 · **Status:** draft for the owner's review, no code yet · **Built against:** Pocket Code 1.105.1

## What it is

A switch on a project card. While it is on, a conversation started in that project runs with the newest
top model as the **lead** (Fable on Claude, Astra on Codex) at high effort. The lead plans, splits the
work, hands each piece to a cheaper model, checks what comes back, and stops only for a decision from
you. The setting lives on the card, so it follows the project through every new conversation and every
handoff without anyone repeating instructions.

A project in this mode also offers a **Solo** start for small tasks: one cheaper model (Opus) doing the
work itself, with no lead.

## Where the ideas come from

The owner's proposal (November 15), plus the AI LABS video "Fable 5.2 Is Insane... Only If You Use It
Anthropic's Way" (16 min), which summarizes a Claude Code team talk, an Anthropic model guide and
Anthropic's Fable guide. The video is a second-hand summary. Its numbers and the text blocks it mentions
are **not yet checked against Anthropic's own pages**; step 0 of the build does that.

What the video changed in the first design:

| Topic | First design | After the video |
|---|---|---|
| When to use a lead | Every conversation in the project | Big jobs only. The video reports a small feature cost about 1.7 times more with a lead than with Opus alone, because the lead re-reads everything to check it. Hence the Solo start. |
| Lead effort | High, extra-high for kickoff | High, always. Reported: extra-high adds little and costs a lot; low and medium stop early more often on long unattended jobs. |
| Worker models | Opus builds, Sonnet searches | Opus for hard pieces, Sonnet for simple well-specified pieces, Haiku for file searches and log reading. Builders at medium effort unless the piece is tricky. |
| Final review | A fresh Opus worker | A fresh Fable reviewer that has not seen how the work was built. Reported as the strongest combination: Opus builds, Fable reviews. |
| Definition of done | Acceptance check in each brief | A written "done when" for the project and a pass/fail check for every step, set before any work is handed out. |
| Subagent cost | "Do small things yourself" | Also tell the lead what a subagent costs and to start one only for work that can run in parallel. Reported to halve the number started. |
| Unattended runs | Not covered | List where the lead may work; steps that can be undone go ahead, steps that cannot wait for you; decisions are asked up front. |
| Final report | Not covered | Written for someone who did not watch: main points first, plain words, test results and screenshots, every small change listed. |
| Switching models | Noted the restart | Also loses the saved conversation copy and the lead's reasoning, so a model change belongs at a handoff, not mid-conversation. |

The video also confirms the first design's choice to use subagents, not separate worker conversations:
the team it describes talks to one lead instead of eight sessions.

## What Pocket has today

- **Project cards** (`projects.mjs`): name, summary, next step, steps, directory, linked conversations.
  No model, effort or mode. **Start conversation** opens a briefing with the agent that last worked on
  the project (`public/projects.js:206`).
- **One place for agent instructions** (`pocketInstructions`, `server.mjs:455`): the same text reaches
  Claude (`--append-system-prompt`), Codex (developer instructions) and OpenRouter.
- **Subagent tier-down** (`context-policy.mjs`, 1.92): server-wide only. Fable leads get Opus workers,
  Opus gets Sonnet, Astra gets Sol. The spec already proposes per-project overrides as phase 2.
- **Per-subagent choice:** Claude Code and Codex both let the lead name a model and an effort for each
  subagent it starts.
- **Model catalog** (`claude-catalog.mjs`, Codex's own list): Pocket already knows the newest model of
  each family, so "newest top model" needs no hardcoded name.
- **Handoffs** (`starts.mjs`): carry the source conversation and its permission level. No project, model
  or effort.
- **Files** (`pocket-docs`): where a finished report can land, linked to the project.

## The design

### 1. The card

Three new fields on a project:

- **Mode:** Off (today's behavior) or **Conductor**.
- **Done when:** what finished looks like for the project, as something that can be checked. Each step
  can carry its own pass/fail check.
- **Works in:** the folders, repos and test sites the lead may change without asking. The project's
  directory is always included.

`pocket-board` gets matching flags (`update --mode`, `--done-when`, `--works-in`), so an agent can set
them when you ask.

### 2. Starting a conversation

**Start conversation** on a Conductor project offers two starts:

- **Conductor** (preselected): newest top model, effort high, worker default one tier down for this
  conversation whatever the server-wide setting says.
- **Solo:** Opus at high effort, no lead instructions. For a fix or a single contained change.

A chip above the message box shows which one is on. The model and effort chips still work; changing the
model mid-conversation shows a one-line note recommending a handoff instead.

### 3. The lead's instructions

When a conversation is linked to a Conductor project, Pocket adds a playbook to its instructions at
process start. The wording is plain ("ask before", not "never"). Draft content:

1. You are the lead. Decide what to do, hand out the work, judge what comes back. Do not write the bulk
   of the code or read large sets of files yourself.
2. Before any work starts, write what done means for the job and a pass/fail check for each step, and
   record both on the project card. Ask every decision you need from the user at this point, together.
3. Hand each step to a subagent with a brief: the goal, what is already done, the files, the check it
   must pass, what to return. Pick the model by the step: hard or ambiguous → Opus (medium effort, high
   if tricky); simple and well specified → Sonnet; file searches and log reading → Haiku. On Codex:
   Sol, with the effort set per step.
4. A subagent costs a full briefing plus a second read of its result. Start one for work that can run
   in parallel or that would fill your context; do a handful of tool calls yourself.
5. Check every result against its pass/fail check yourself: read the diff, run the test. Do not rely on
   the subagent's report.
6. Before the job is called finished, have a fresh reviewer on the top model, given the code and the
   definition of done but not your conclusions, review the whole change.
7. Work freely inside the places listed on the card. A step that can be undone, take. A step that
   cannot, ask first.
8. Keep going until the work is done. Do not stop to list what is left or to offer to continue.
9. Keep the card current (steps ticked, where you left off, next step) so a handoff starts small.
10. Finish with a report for someone who did not watch: main points first, plain words, the test
    results, screenshots where there is a screen, and every change made, including small ones. Save it
    to Files, linked to the project.

Where Anthropic publishes its own text for points 4, 8 and 10, the build uses that text.

### 4. Handoffs and other ways in

- A handoff written by a conversation linked to a Conductor project links the new conversation to the
  same project and starts it the same way (Conductor or Solo).
- A conversation linked later with the **Add project** chip takes the mode at its next process start.
- A conversation that is merely started in the project's directory, without a link, is not changed.

### 5. What stays out of the first version

- Separate worker conversations with their own tabs and worktrees.
- **Works in** changing what Pocket approves automatically. In the first version it only informs the
  lead; approvals keep following the conversation's permission setting.
- Assistant mode seats.
- OpenRouter conversations (no worker policy there yet).

## Risks

- **Fable's usage cap.** The lead spends Fable on every turn and re-reads worker results. The mode
  should lower the handoff offer for its conversations (suggested 150K tokens) to keep the lead small.
- **Cost on small work.** Addressed by Solo, but only if it gets used. The measurement below checks.
- **Detail lost in delegation.** A brief and a summary each drop detail. Point 5 of the playbook and the
  fresh review are the guard.
- **Instructions the user's own files contradict.** A `CLAUDE.md` with a fixed subagent rule could pull
  against the playbook. The playbook says the project's mode governs worker choice in this conversation.
- **Setting names change.** The per-subagent model and effort controls are re-tested before release, as
  the context-policy spec already requires.

## How we'll know it works

Run one real multi-session build in Conductor mode for two weeks and compare, from the transcripts, with
the four-week baseline in the context-policy spec:

- share of tokens spent on the top model (target: well under the baseline for comparable work);
- share spent on subagents and which models they ran on (target: under 10% on the lead's own model);
- steps finished per conversation, and how many passed their check at the first review;
- how often a run stopped early with work left.

## Build order

0. **Check the sources.** Read Anthropic's Fable guide and launch post; take the published text blocks;
   re-test per-subagent model and effort on the installed Claude Code and Codex.
1. Card fields, store validation, `pocket-board` flags, manual page.
2. Launch: lead model and effort from the catalog, per-conversation worker policy, lower handoff offer.
3. Playbook injection through `pocketInstructions`, Claude and Codex.
4. UI: the card's switch and fields, the Conductor / Solo choice on Start conversation, the chip.
5. Handoff inheritance.
6. Final report to Files.
7. The two-week measurement, then decide on worker conversations and on **Works in** approvals.

Tests alongside each step: store and flag validation, mode resolution per engine, instruction injection
only for linked conversations, handoff inheritance, and the browser check for the Start sheet.

## Open questions for the owner

1. **Default for a new project:** off until you switch it on (the plan), or on for every new project?
2. **Start conversation:** Conductor preselected with Solo one tap away (the plan), or ask each time?
3. **Fresh top-model review:** once, before the job is called finished (the plan), or after every step?
4. **Works in:** information for the lead only at first (the plan), or wire it into automatic approvals
   in the first version?

**Answered 2026-11-15 (the owner: "Build it with those defaults"):** the plan's default on all four.

## As built (1.106.0)

Built as planned, with these points settled during the build and its review:

- **Which conversations are in the mode.** A conversation started in a Conductor project, handed off
  within it, or linked to it through the board while the mode is on. The project is recorded in the
  conversation's session meta. Switching the mode on does **not** pull in conversations that were already
  linked: an old conversation would otherwise restart under the top model and re-read its whole history
  uncached. Unlink and link such a conversation again to bring it in.
- **Leaving the mode.** Switching the mode off, finishing the project or unlinking the conversation ends
  the mode at the conversation's next reply (after a running background job).
- **Saved picks on New.** A model or effort saved from an earlier start is set aside while the Start
  control applies; a pick made on that screen still wins.
- **No top model offered.** Neither start applies; conversations start as before the feature.
- **A link that cannot be made** (the project is gone, or it already links 50 sessions): the conversation
  starts unlinked with no mode and a notice says so.
- **Card text** (Done when, Passes when, Works in) is stored on one line, because it reaches the lead's
  instructions.
- **Not in this version:** Works in does not change automatic approvals; OpenRouter conversations and
  Assistant mode do not run the mode; nothing measures cost per project yet (see "How we'll know it works").

