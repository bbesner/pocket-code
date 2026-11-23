// Reply suggestions ("choice cards"): when a turn ends by asking the user to pick a next step, the agent
// lists the picks in a fenced `choices` block as the very last thing in its reply. Pocket strips that block
// from the text and shows the picks as buttons; tapping one sends it as the next message.
// Only a block at the very end of a reply counts, so an example of the format shown mid-reply stays text;
// the one exception is a sources list after the block (1.105.1), which stays in the text.
// An option ending in "(Recommended)" is the agent's pick: the marker is stripped from the reply text and
// shown as a tag on that button instead (1.17).

// The Complete card (1.111): the other way a reply can end. When the work the user asked for is finished and
// nothing is left, the agent ends its reply with a fenced `done` block holding one line that states the outcome.
// Pocket strips the block and shows a Complete card under the reply; a tap closes the conversation (marks it
// reviewed, releases its process, closes its tab). The card is a claim by the agent, so Pocket checks it: a
// reply that also offers choices, or whose closing paragraph asks something, gets no card (see textBlocks).
export const DONE_INSTRUCTIONS = [
  'Pocket can also show that a conversation is finished.',
  'When a reply completes work the user asked for and nothing is left (everything requested in this conversation is done and checked, nothing failed or was skipped, nothing is still running or waiting on anyone, and you have no next step to recommend and no question to ask), finish the reply with a fenced code block whose info string is `done`, holding one line under 100 characters that states the outcome (for example "Released 2.4.1 to production; all tests pass").',
  'Pocket shows it as a Complete card that the user taps to close the conversation, so they do not have to read the reply to learn where things stand.',
  'Never add it to a reply that has a `choices` block, asks or offers anything, reports a failure or a skipped step, or only answers a question; when unsure, leave it out.',
].join(' ');

export const CHOICE_INSTRUCTIONS = [
  'This session is shown in Pocket Code, which can display suggested replies as buttons.',
  'When you end a reply by asking the user to choose between specific next steps (for example whether to merge and deploy, or which of two fixes to make), finish the reply with a fenced code block whose info string is `choices`, listing 2 to 4 options, one per line.',
  'Write each option as the short reply the user would send, in their voice, under 60 characters (for example "Merge and deploy" or "Don\'t merge yet"). Ask the question in normal text above the block; the block must be the last thing in the reply, so put any sources list above the question.',
  'When you have a clear recommendation, list that option first and end it with "(Recommended)"; Pocket shows the marker as a tag on the button, not as part of the reply. Mark at most one option, and mark none when the choice is genuinely even.',
  'Do not add the block for open-ended questions, for questions that need a typed answer, or when nothing needs deciding.',
  DONE_INSTRUCTIONS,
].join(' ');

// Its body never spans another fence either (1.124.2): an example shown mid-reply in a reply that ends with a code
// block was read as one block running to that last fence, and every line after the example became a button.
const FENCE = /\n?[ \t]*```choices[ \t]*\n((?:(?!```)[\s\S])*?)\n[ \t]*```[ \t]*\s*$/;
const ANY_FENCE = /\n?[ \t]*```choices[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*(?=\n|$)/g;
// The done block may be empty (a card with no outcome line). Its body never spans another fence, so a done block
// written above a choices block is not read as one long block ending at the choices' closing fence.
const DONE_FENCE = /\n?[ \t]*```done[ \t]*\n(?:((?:(?!```)[\s\S])*?)\n)?[ \t]*```[ \t]*\s*$/;
const DONE_ANY = /\n?[ \t]*```done[ \t]*\n(?:([\s\S]*?)\n)?[ \t]*```[ \t]*(?=\n|$)/g;
const MAX_DONE = 140;
const RECOMMENDED = /\s*(?:[-–—:]\s*)?[(\[]\s*recommended\s*[)\]]\s*$/i;
const MAX_OPTIONS = 5, MAX_LEN = 120;

// A web-search tool tells the agent to end with a "Sources:" list, which pushes the block off the end (1.105.1).
// That tail, and only that, may follow the block: a Sources/References heading, then list items that each
// carry a link. It stays in the reply text, above the buttons.
const SOURCES_HEAD = /^\s*(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:sources?|references?)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i;
const SOURCE_ITEM = /^\s*(?:[-*•]|\d+[.)])\s+.*(?:\]\([^)\s]+\)|https?:\/\/\S+)/;
function sourcesTail(tail) {
  const lines = tail.split('\n').map(l => l.trimEnd()).filter(l => l.trim());
  return lines.length >= 2 && SOURCES_HEAD.test(lines[0]) && lines.slice(1).every(l => SOURCE_ITEM.test(l));
}

// The block the reply ends with: at the very end, or followed only by a sources list.
// -> { block, before, after } or null
function trailingBlock(s, end = FENCE, any = ANY_FENCE) {
  const m = s.match(end);
  if (m) return { block: m[1] || '', before: s.slice(0, m.index), after: '' };
  const last = [...s.matchAll(any)].pop();
  if (!last) return null;
  const after = s.slice(last.index + last[0].length);
  return sourcesTail(after) ? { block: last[1] || '', before: s.slice(0, last.index), after: after.trim() } : null;
}

// -> { text, options, recommended } ; options is null when the text has no trailing choices block;
// recommended is the index of the option the agent marked "(Recommended)", or null.
export function splitChoices(text) {
  const s = String(text ?? '');
  const t = trailingBlock(s);
  if (!t) return { text: s, options: null, recommended: null };
  const seen = new Set(), options = [];
  let recommended = null;
  for (const raw of t.block.split('\n')) {
    let o = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/^["“]|["”]$/g, '').trim();
    const rec = RECOMMENDED.test(o);
    if (rec) o = o.replace(RECOMMENDED, '').replace(/^["“]|["”]$/g, '').trim();
    o = o.slice(0, MAX_LEN);
    if (!o || seen.has(o.toLowerCase())) continue;
    seen.add(o.toLowerCase()); options.push(o);
    if (rec && recommended === null) recommended = options.length - 1;   // the first marked option wins
    if (options.length === MAX_OPTIONS) break;
  }
  const before = t.before.replace(/\s+$/, '');
  return { text: t.after ? (before ? `${before}\n\n${t.after}` : t.after) : before, options: options.length ? options : null, recommended };
}

// -> { text, done } ; done is the outcome line ('' when the block is empty), or null when the text has no trailing
// done block or the claim does not hold: a reply whose closing paragraph asks something is not finished.
// The block leaves the text either way, so a refused claim never shows as a code block.
export function splitDone(text) {
  const s = String(text ?? '');
  const t = trailingBlock(s, DONE_FENCE, DONE_ANY);
  if (!t) return { text: s, done: null };
  const before = t.before.replace(/\s+$/, '');
  const line = t.block.split('\n').map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/^["“]|["”]$/g, '').trim()).find(Boolean) || '';
  const asks = before.split(/\n\s*\n/).at(-1).includes('?');
  return { text: t.after ? (before ? `${before}\n\n${t.after}` : t.after) : before, done: asks ? null : line.slice(0, MAX_DONE) };
}

// A transcript text block -> display blocks: the text (if any), then a choices block or a done block (never both).
// The choices block carries `rec` (an option index) only when the agent marked a recommendation.
// Choices win over done: a reply that asks the user to pick is not finished, whichever block came last.
export function textBlocks(text) {
  const d = splitDone(text);
  const { text: left, options, recommended } = splitChoices(d.text);
  const rest = options ? splitDone(left).text : left;       // a done block written above the choices goes too
  const tail = options ? { t: 'choices', options, ...(recommended === null ? {} : { rec: recommended }) }
    : d.done !== null ? { t: 'done', text: d.done } : null;
  return [...(rest.trim() ? [{ t: 'text', text: rest }] : []), ...(tail ? [tail] : [])];
}
