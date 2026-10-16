import test from 'node:test';
import assert from 'node:assert/strict';
import {LineBuffer} from '../codex.mjs';

// The app-server's stdout is framed line by line; chunk boundaries fall anywhere.
test('LineBuffer frames lines across any chunk boundary and keeps a partial tail', () => {
  const text = 'alpha\n\n{"id":1,"result":{"x":"a\\nb"}}\nlast-without-newline';
  const expected = ['alpha', '', '{"id":1,"result":{"x":"a\\nb"}}'];
  for (const size of [1, 2, 3, 5, 7, 11, 64 * 1024]) {
    const b = new LineBuffer(), got = [];
    for (let i = 0; i < text.length; i += size) got.push(...b.push(text.slice(i, i + size)));
    assert.deepEqual(got, expected, `chunk size ${size}`);
    assert.deepEqual(b.push('\n'), ['last-without-newline'], `tail completes at ${size}`);
    assert.deepEqual(b.push('x\ny'), ['x']);
    assert.deepEqual(b.push(''), []);
    assert.deepEqual(b.push('\n'), ['y']);
  }
});

// One 17 MB reply in 64 KB chunks took 3.9 s with the old rejoin-and-split reader (2026-10-16).
test('LineBuffer handles a multi-megabyte single line in small chunks in linear time', () => {
  const line = JSON.stringify({ id: 7, result: { data: Array.from({ length: 20000 }, (_, i) => ({ id: 'item-' + i, text: 'x'.repeat(400) })) } });
  assert.ok(line.length > 8_000_000, 'payload is over 8 MB');
  const payload = line + '\n{"id":8,"result":null}\n';
  const b = new LineBuffer(); let lines = [];
  const t0 = performance.now();
  for (let i = 0; i < payload.length; i += 4096) lines.push(...b.push(payload.slice(i, i + 4096)));
  const ms = performance.now() - t0;
  assert.equal(lines.length, 2);
  assert.equal(lines[0], line);
  assert.equal(JSON.parse(lines[1]).id, 8);
  assert.ok(ms < 1500, `framing took ${ms.toFixed(0)} ms`);
});
