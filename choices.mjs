// Reply suggestions ("choice cards"): when a turn ends by asking the user to pick a next step, the agent
// lists the picks in a fenced `choices` block as the very last thing in its reply. Pocket strips that block
// from the text and shows the picks as buttons; tapping one sends it as the next message.
// Only a block at the very end of a reply counts, so an example of the format shown mid-reply stays text.

export const CHOICE_INSTRUCTIONS = [
  'This session is shown in Pocket Code, which can display suggested replies as buttons.',
  'When you end a reply by asking the user to choose between specific next steps (for example whether to merge and deploy, or which of two fixes to make), finish the reply with a fenced code block whose info string is `choices`, listing 2 to 4 options, one per line.',
  'Write each option as the short reply the user would send, in their voice, under 60 characters (for example "Merge and deploy" or "Don\'t merge yet"). Ask the question in normal text above the block; the block must be the last thing in the reply.',
  'Do not add the block for open-ended questions, for questions that need a typed answer, or when nothing needs deciding.',
].join(' ');

const FENCE = /\n?[ \t]*```choices[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*\s*$/;
const MAX_OPTIONS = 5, MAX_LEN = 120;

// -> { text, options } ; options is null when the text has no trailing choices block.
export function splitChoices(text) {
  const s = String(text ?? '');
  const m = s.match(FENCE);
  if (!m) return { text: s, options: null };
  const seen = new Set(), options = [];
  for (const raw of m[1].split('\n')) {
    const o = raw.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').replace(/^["“]|["”]$/g, '').trim().slice(0, MAX_LEN);
    if (!o || seen.has(o.toLowerCase())) continue;
    seen.add(o.toLowerCase()); options.push(o);
    if (options.length === MAX_OPTIONS) break;
  }
  return { text: s.slice(0, m.index).replace(/\s+$/, ''), options: options.length ? options : null };
}

// A transcript text block -> display blocks: the text (if any) and a choices block (if any).
export function textBlocks(text) {
  const { text: rest, options } = splitChoices(text);
  return [...(rest.trim() ? [{ t: 'text', text: rest }] : []), ...(options ? [{ t: 'choices', options }] : [])];
}
