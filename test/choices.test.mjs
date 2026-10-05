import test from 'node:test';
import assert from 'node:assert/strict';
import { splitChoices, textBlocks, CHOICE_INSTRUCTIONS } from '../choices.mjs';

test('a trailing choices block becomes reply options and leaves the question as text', () => {
  const r = splitChoices('Tests pass. Should I merge and deploy?\n\n```choices\nMerge and deploy\n- Don\'t merge yet\n1. "Run the tests again"\n```\n');
  assert.equal(r.text, 'Tests pass. Should I merge and deploy?');
  assert.deepEqual(r.options, ['Merge and deploy', "Don't merge yet", 'Run the tests again']);
});

test('only the very end of a reply counts; examples shown mid-reply stay text', () => {
  const t = 'The format looks like this:\n```choices\nYes\nNo\n```\nThat is all.';
  assert.deepEqual(splitChoices(t), { text: t, options: null });
  assert.deepEqual(splitChoices('No block here?'), { text: 'No block here?', options: null });
});

test('options are trimmed, de-duplicated and capped', () => {
  const r = splitChoices('Pick one\n```choices\nA\na\n\n B \nC\nD\nE\nF\n```');
  assert.deepEqual(r.options, ['A', 'B', 'C', 'D', 'E']);
  assert.ok(splitChoices('x\n```choices\n' + 'y'.repeat(500) + '\n```').options[0].length <= 120);
});

test('display blocks: text then choices; an empty block is dropped', () => {
  assert.deepEqual(textBlocks('Go?\n```choices\nGo\nStop\n```'), [{ t: 'text', text: 'Go?' }, { t: 'choices', options: ['Go', 'Stop'] }]);
  assert.deepEqual(textBlocks('Done?\n```choices\n\n```'), [{ t: 'text', text: 'Done?' }]);
  assert.match(CHOICE_INSTRUCTIONS, /```|`choices`/);
});
