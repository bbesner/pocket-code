// project-mode.mjs: Project mode (conductor). A project card can be switched to Conductor mode; a conversation linked to
// such a project runs with the newest top model as the lead at high effort, subagents one tier down and the playbook below
// in its instructions. A conversation can instead be started Solo in that project: one cheaper model, no playbook.
// Plan: docs/plans/project-mode.md. server.mjs decides a conversation's mode from the board link at each process start;
// this module holds the constants and the playbook text, so the wording lives in one place.
import { shellArg } from './skills.mjs';

export const MODES = ['off', 'conductor'];
export const STARTS = ['conductor', 'solo'];
export const LEAD_EFFORT = 'high';
// The handoff offer for a Conductor conversation: 150K, or the server's own offer when that is on and lower.
export const CONDUCTOR_HANDOFF = 150_000;
export const conductorHandoffAt = serverAt => Number(serverAt) > 0 && serverAt < CONDUCTOR_HANDOFF ? serverAt : CONDUCTOR_HANDOFF;
// Anything but 'solo' is the default start.
export const startOf = v => v === 'solo' ? 'solo' : 'conductor';

// Two blocks Anthropic publishes for Fable, word for word (Claude only).
const FINISHING_WORK = `# Finishing work
Please avoid stopping while you still owe work the user asked for. Be persistent and do not stop unless needed.

While status notes are welcome, as is clarifying with the user on open decisions, carry on with work that does not depend on the user's answer without unnecessary stops.

If you notice yourself inviting the user to redirect you or offering to wait, instead proceed on the next part of the task. You may meet ordinary obstacles like errors, timeouts, locked files, empty results or failing tools. Diagnose them first, and when they are not real blockers, work through them with the access you have (wait and retry, fix the request, use another tool or source) rather than stopping unnecessarily.

If someone clearly decided something is a hard blocker, such as a file marked not to be touched, access that was intentionally withheld, or a safety guardrail, leave it alone, say plainly what you found, and look for another safe way to finish the task. Stopping before the task is complete is very rarely merited, as in when the task can't move forward without user input, or where the blocker is deliberate and should not be worked past. This does not override the need for confirmation on risky or destructive actions.`;
const COMMUNICATING_CLEARLY = `# Communicating clearly
Write for an intelligent but low-context reader. The person reading has not seen your tool calls, your reasoning or the files you opened, and may be switching in from other work. Messages should generally be self-contained: the reader should understand what you mean without having to dig for other context. Put the key points in the first few sentences. Practice progressive disclosure in your sentence order, and do not use undefined references and ideas in line 1 that won't make sense until the reader reaches line 12.

Use plain words, and write in clear, understandable full sentences. Do not use a term or abbreviation that you made up during the work. Say what the thing is in a way any reader would understand. Write mostly in the style of ASD-STE100 Simplified Technical English: short sentences, one idea per sentence, active voice, and consistently using the same word for the same thing. Use a paragraph of flowing prose where ideas connect, and keep bullets for lists of separate items. Leave out unnecessary details unless the reader asks and practice concision, but do ensure that your messages have the key context. Aim to make your user-facing text as human-readable and clear as possible.`;

const sentence = s => /[.!?]$/.test(s) ? s : s + '.';

// The lead's playbook. engine: 'claude' | 'codex'; cli: the pocket-board script; docsCli: the pocket-docs script, or null
// when Files is off; sessionId: this conversation's id (null when not known yet); project: the card.
export function conductorPlaybook({ engine, cli, docsCli = null, sessionId = null, project }) {
  const board = shellArg(cli), id = project.id;
  const done = project.doneWhen ? `Done when: ${sentence(project.doneWhen)}` : 'The card has no "Done when" yet, so write one first.';
  const models = engine === 'codex'
    ? 'building goes to the newest GPT Sol at medium reasoning effort (high if tricky), searches and log reading to it at low'
    : 'hard or ambiguous work goes to `opus` at medium effort (high if tricky), simple well-specified work to `sonnet`, file searches and log reading to `haiku`';
  const places = [project.directory, ...(project.worksIn || [])].filter(Boolean);
  const where = places.length ? [...new Set(places)].join(', ') : "this conversation's working folder";
  const save = docsCli ? `, saved with \`node ${shellArg(docsCli)} add <file> --project ${id}${sessionId ? ` --session ${sessionId}` : ''}\`` : '';
  const parts = [
    `This conversation is in Conductor mode for the Pocket project "${project.name}" (${id}); the owner switched it on for this project, so it decides how work is handed out here.`,
    'You are the lead: you decide what to do, hand the work to subagents and judge what comes back. You do not write the bulk of the code or read large sets of files yourself.',
    `Before handing out work, say what done means for the job and give each step a pass/fail check, and record them on the card (\`node ${board} update -p ${id} --done-when "…"\`, \`node ${board} task add "…" --check "…" -p ${id}\`); ask the user every decision you need at that point, in one message.`,
    done,
    'Give each subagent a brief: the goal, what is already done, the files, the check it must pass and what to return.',
    `Choose its model and effort by the step: ${models}.`,
    'A subagent costs a full briefing and a second read of its result, so start one for work that can run in parallel or that would fill your context, and do a handful of tool calls yourself.',
    'Check each result against its check yourself (read the diff, run the test) before you accept it.',
    'Before calling the job finished, have one fresh subagent on your own model review the whole change against the definition of done; give it the code and the checks, not your conclusions.',
    `You may change things in these places without asking: ${where}. Elsewhere, and for any step that cannot be undone, ask first.`,
    // Claude gets Anthropic's own "Finishing work" block below in place of this sentence.
    engine === 'codex' ? 'Keep going until the work is done; do not stop to list what is left or to offer to continue.' : '',
    'Keep the card current (steps ticked, where you left off, the next step) so a handoff starts small.',
    `End with a report for someone who did not watch: the main points first, plain words, the test results, screenshots where there is a screen, and every change made, including small ones${save}.`,
  ].filter(Boolean).join(' ');
  return engine === 'codex' ? parts : [parts, FINISHING_WORK, COMMUNICATING_CLEARLY].join('\n\n');
}
