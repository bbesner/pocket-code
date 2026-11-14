import test from 'node:test';
import assert from 'node:assert/strict';
import { splitChoices, textBlocks, CHOICE_INSTRUCTIONS } from '../choices.mjs';

test('a trailing choices block becomes reply options and leaves the question as text', () => {
  const r = splitChoices('Tests pass. Should I merge and deploy?\n\n```choices\nMerge and deploy\n- Don\'t merge yet\n1. "Run the tests again"\n```\n');
  assert.equal(r.text, 'Tests pass. Should I merge and deploy?');
  assert.deepEqual(r.options, ['Merge and deploy', "Don't merge yet", 'Run the tests again']);
  assert.equal(r.recommended, null);
});

test('only the very end of a reply counts; examples shown mid-reply stay text', () => {
  const t = 'The format looks like this:\n```choices\nYes\nNo\n```\nThat is all.';
  assert.deepEqual(splitChoices(t), { text: t, options: null, recommended: null });
  assert.deepEqual(splitChoices('No block here?'), { text: 'No block here?', options: null, recommended: null });
});

test('a sources list after the block still gives buttons and stays in the text above them', () => {
  // the shape of a real reply that showed the block as code: a web search asked for Sources at the end
  const t = 'What would you like to do?\n\n```choices\nWait for InMotion (Recommended)\nAdd a custom SSH port\n```\n\nSources:\n- [InMotion Hosting Status](https://status.inmotionhosting.com/)\n- [StatusGator – InMotion Hosting](https://statusgator.com/services/inmotion-hosting)\n';
  assert.deepEqual(splitChoices(t), {
    text: 'What would you like to do?\n\nSources:\n- [InMotion Hosting Status](https://status.inmotionhosting.com/)\n- [StatusGator – InMotion Hosting](https://statusgator.com/services/inmotion-hosting)',
    options: ['Wait for InMotion', 'Add a custom SSH port'], recommended: 0,
  });
  // heading styles, numbered items, bare URLs
  for (const head of ['**Sources:**', '## Sources', 'References', 'Source:']) {
    const r = splitChoices(`Go?\n\`\`\`choices\nGo\nStop\n\`\`\`\n${head}\n1. https://example.com/a\n* [b](https://example.com/b)`);
    assert.deepEqual(r.options, ['Go', 'Stop'], head);
    assert.match(r.text, /^Go\?\n\n/);
  }
});

test('anything else after the block still keeps it as text', () => {
  for (const tail of [
    'That is all.',                                                  // ordinary prose
    'Sources:',                                                      // a heading with no list
    'Sources:\n- the status page',                                   // an item without a link
    'Sources:\n- [a](https://example.com)\nLet me know.',            // prose after the list
    'Notes:\n- [a](https://example.com)',                            // a different heading
  ]) {
    const t = `Go?\n\`\`\`choices\nGo\nStop\n\`\`\`\n${tail}`;
    assert.deepEqual(splitChoices(t), { text: t, options: null, recommended: null }, tail);
  }
  // only the last block can count: an earlier example followed by a sourced block uses the last one
  const two = 'Like this:\n```choices\nYes\nNo\n```\nNow pick:\n```choices\nA\nB\n```\nSources:\n- https://example.com';
  assert.deepEqual(splitChoices(two).options, ['A', 'B']);
  assert.match(splitChoices(two).text, /Like this:\n```choices\nYes\nNo\n```\nNow pick:\n\nSources:/);
});

test('options are trimmed, de-duplicated and capped', () => {
  const r = splitChoices('Pick one\n```choices\nA\na\n\n B \nC\nD\nE\nF\n```');
  assert.deepEqual(r.options, ['A', 'B', 'C', 'D', 'E']);
  assert.ok(splitChoices('x\n```choices\n' + 'y'.repeat(500) + '\n```').options[0].length <= 120);
});

test('a "(Recommended)" marker is stripped from the option and recorded as its index', () => {
  const r = splitChoices('Merge?\n```choices\nMerge and deploy (Recommended)\nDon\'t merge yet\n```');
  assert.deepEqual(r.options, ['Merge and deploy', "Don't merge yet"]);
  assert.equal(r.recommended, 0);
  // any position, loose spelling, a dash or colon before it, square brackets, a quoted option
  assert.deepEqual(splitChoices('x\n```choices\nA\n- "B" [recommended]\nC\n```'), { text: 'x', options: ['A', 'B', 'C'], recommended: 1 });
  assert.equal(splitChoices('x\n```choices\nA\nB — Recommended)\nC - (RECOMMENDED)\n```').recommended, 2);
  assert.deepEqual(splitChoices('x\n```choices\nA\nB — Recommended)\nC - (RECOMMENDED)\n```').options, ['A', 'B — Recommended)', 'C']);
});

test('only the first marked option is recommended; duplicates and the marker alone do not count', () => {
  const r = splitChoices('x\n```choices\nA (Recommended)\nB (Recommended)\na (recommended)\n(Recommended)\n```');
  assert.deepEqual(r.options, ['A', 'B']);
  assert.equal(r.recommended, 0);
  assert.equal(splitChoices('x\n```choices\nA\nA (Recommended)\nB\n```').recommended, null, 'a duplicate of an earlier option is dropped, marker and all');
});

test('display blocks: text then choices; rec only when marked; an empty block is dropped', () => {
  assert.deepEqual(textBlocks('Go?\n```choices\nGo\nStop\n```'), [{ t: 'text', text: 'Go?' }, { t: 'choices', options: ['Go', 'Stop'] }]);
  assert.deepEqual(textBlocks('Go?\n```choices\nGo\nStop (Recommended)\n```'), [{ t: 'text', text: 'Go?' }, { t: 'choices', options: ['Go', 'Stop'], rec: 1 }]);
  assert.deepEqual(textBlocks('Done?\n```choices\n\n```'), [{ t: 'text', text: 'Done?' }]);
  assert.match(CHOICE_INSTRUCTIONS, /```|`choices`/);
  assert.match(CHOICE_INSTRUCTIONS, /\(Recommended\)/);
  assert.match(CHOICE_INSTRUCTIONS, /sources list above the question/);
});
