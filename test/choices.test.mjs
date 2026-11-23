import test from 'node:test';
import assert from 'node:assert/strict';
import { splitChoices, splitDone, textBlocks, CHOICE_INSTRUCTIONS, DONE_INSTRUCTIONS } from '../choices.mjs';

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

test('an example mid-reply stays text when the reply ends with another fenced block (1.124.2)', () => {
  // the reply's last fence used to close the example, so everything after it became buttons
  const code = 'Like this:\n```choices\nMerge and deploy\n```\n\nThen I changed the parser:\n```js\nexport function f(){}\n```';
  assert.deepEqual(splitChoices(code), { text: code, options: null, recommended: null });
  assert.deepEqual(textBlocks(code), [{ t: 'text', text: code }]);
  // a real block at the end still counts, and the example above it stays in the text
  const real = 'Like this:\n```choices\nA\n```\n\nWhich one?\n```choices\nYes\nNo\n```';
  assert.deepEqual(splitChoices(real), { text: 'Like this:\n```choices\nA\n```\n\nWhich one?', options: ['Yes', 'No'], recommended: null });
  const both = 'Like this:\n```choices\nA\n```\nCode:\n```js\nf()\n```\nWhich one?\n```choices\nYes\nNo\n```';
  assert.deepEqual(splitChoices(both).options, ['Yes', 'No']);
  assert.equal(splitChoices(both).text, 'Like this:\n```choices\nA\n```\nCode:\n```js\nf()\n```\nWhich one?');
});

test('a sources list after the block still gives buttons and stays in the text above them', () => {
  // the shape of a real reply that showed the block as code: a web search asked for Sources at the end
  const t = 'What would you like to do?\n\n```choices\nWait for Northwind (Recommended)\nAdd a custom SSH port\n```\n\nSources:\n- [Northwind Hosting Status](https://status.northwind-hosting.example/)\n- [StatusGator – Northwind Hosting](https://statusgator.com/services/northwind-hosting)\n';
  assert.deepEqual(splitChoices(t), {
    text: 'What would you like to do?\n\nSources:\n- [Northwind Hosting Status](https://status.northwind-hosting.example/)\n- [StatusGator – Northwind Hosting](https://statusgator.com/services/northwind-hosting)',
    options: ['Wait for Northwind', 'Add a custom SSH port'], recommended: 0,
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

// 1.111: the Complete card
test('a trailing done block becomes a done block with the outcome line', () => {
  assert.deepEqual(textBlocks('Shipped it.\n\n```done\nReleased 2.4.1; tests pass\n```\n'), [{ t: 'text', text: 'Shipped it.' }, { t: 'done', text: 'Released 2.4.1; tests pass' }]);
  assert.deepEqual(textBlocks('Shipped it.\n\n```done\n```'), [{ t: 'text', text: 'Shipped it.' }, { t: 'done', text: '' }], 'an empty block is a card with no line');
  assert.deepEqual(textBlocks('```done\n- "Fixed the import"\nsecond line\n```'), [{ t: 'done', text: 'Fixed the import' }], 'the first line, without list or quote marks');
  assert.ok(textBlocks('x\n```done\n' + 'y'.repeat(500) + '\n```').at(-1).text.length <= 140);
  // a sources list may follow it, as with choices
  assert.deepEqual(textBlocks('Done.\n\n```done\nFixed\n```\n\nSources:\n- [a](https://example.com)'), [{ t: 'text', text: 'Done.\n\nSources:\n- [a](https://example.com)' }, { t: 'done', text: 'Fixed' }]);
});

test('only the very end counts, and an example mid-reply stays text', () => {
  const t = 'The format looks like this:\n```done\nReleased\n```\nThat is all.';
  assert.deepEqual(textBlocks(t), [{ t: 'text', text: t }]);
  assert.deepEqual(splitDone('No block here.'), { text: 'No block here.', done: null });
});

test('a reply that asks something is not complete: the claim is dropped and the block never shows', () => {
  assert.deepEqual(textBlocks('Shipped. Want me to tag it too?\n\n```done\nReleased\n```'), [{ t: 'text', text: 'Shipped. Want me to tag it too?' }]);
  assert.deepEqual(splitDone('All set.\n\nShould I also close the PR?\n```done\nx\n```'), { text: 'All set.\n\nShould I also close the PR?', done: null });
  // a question earlier in the reply does not count, only the closing paragraph
  assert.equal(splitDone('Why did it fail? The port was taken.\n\nFixed and verified.\n```done\nFixed the port clash\n```').done, 'Fixed the port clash');
});

test('reply buttons win over a done block, whichever came last', () => {
  const choices = { t: 'choices', options: ['A', 'B'] };
  assert.deepEqual(textBlocks('Pick one.\n\n```done\nx\n```\n\n```choices\nA\nB\n```'), [{ t: 'text', text: 'Pick one.' }, choices]);
  assert.deepEqual(textBlocks('Pick one.\n\n```choices\nA\nB\n```\n\n```done\nx\n```'), [{ t: 'text', text: 'Pick one.' }, choices]);
  // and a reply with choices alone is unchanged
  assert.deepEqual(textBlocks('Merge?\n```choices\nMerge (Recommended)\nWait\n```'), [{ t: 'text', text: 'Merge?' }, { t: 'choices', options: ['Merge', 'Wait'], rec: 0 }]);
});

test('the instructions tell the agent when the done block is allowed', () => {
  assert.match(DONE_INSTRUCTIONS, /`done`/);
  assert.match(DONE_INSTRUCTIONS, /nothing failed or was skipped/);
  assert.match(DONE_INSTRUCTIONS, /Never add it to a reply that has a `choices` block/);
  assert.ok(CHOICE_INSTRUCTIONS.endsWith(DONE_INSTRUCTIONS), 'they travel with the suggested-reply instructions, to every engine');
});
