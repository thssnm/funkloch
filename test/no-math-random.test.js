import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * CLAUDE.md: everything random goes through `mulberry32(seed)`, and
 * `Math.random` does not occur in the source. That holds for the page as much
 * as for the logic and the tools — a free run seeded by `Math.random` was the
 * one place it did not, and a run without a known seed cannot be replayed.
 *
 * A call is what is looked for, not the word: comments that explain why it is
 * absent may name it.
 */
const ROOT = new URL('..', import.meta.url).pathname;
const CALL = /Math\s*\.\s*random\s*\(/;

const sources = [
  'index.html',
  ...['src', 'tools', 'test'].flatMap((dir) => readdirSync(join(ROOT, dir))
    .filter((name) => name.endsWith('.js'))
    .map((name) => `${dir}/${name}`)),
];

test('no Math.random in the source', async (t) => {
  await t.test('covers the page as well as the logic and the tools', () => {
    assert.ok(sources.includes('index.html'));
    assert.ok(sources.includes('src/run.js'));
    assert.ok(sources.includes('tools/ui-smoke.js'));
  });

  for (const file of sources) {
    await t.test(file, () => {
      const lines = readFileSync(join(ROOT, file), 'utf8').split('\n');
      const hits = lines.flatMap((line, i) => (CALL.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : []));
      assert.deepEqual(hits, []);
    });
  }
});
