import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GAME_URL } from '../src/share.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(join(ROOT, 'index.html'), 'utf8');

/** The content of a meta tag by property or name, or null. */
function meta(key) {
  const pattern = new RegExp(`<meta (?:property|name)="${key}" content="([^"]*)"`);
  return html.match(pattern)?.[1] ?? null;
}

test('the link preview', async (t) => {
  await t.test('names the game, says what it is, and points home', () => {
    assert.equal(meta('og:type'), 'website');
    assert.equal(meta('og:title'), 'Funkloch');
    const description = meta('og:description');
    assert.ok(description && description.length >= 40 && description.length <= 160,
      `one sentence, ${description?.length} characters`);
    assert.equal(meta('twitter:card'), 'summary_large_image');
  });

  await t.test('uses absolute URLs on the same domain as the shared result', () => {
    // Preview services run no script, so index.html cannot import GAME_URL;
    // this is what keeps the two from drifting apart.
    assert.equal(meta('og:url'), `${GAME_URL}/`);
    assert.equal(meta('og:image'), `${GAME_URL}/og-image.png`);
    assert.equal(meta('twitter:image'), `${GAME_URL}/og-image.png`);
    for (const key of ['og:url', 'og:image', 'twitter:image']) {
      assert.match(meta(key), /^https:\/\//, `${key} is absolute`);
    }
    assert.equal(meta('og:image:width'), '1200');
    assert.equal(meta('og:image:height'), '630');
  });

  await t.test('the image is a 1200×630 PNG', () => {
    const png = readFileSync(join(ROOT, 'og-image.png'));
    assert.equal(png.subarray(1, 4).toString('ascii'), 'PNG');
    assert.equal(png.readUInt32BE(16), 1200);
    assert.equal(png.readUInt32BE(20), 630);
    // Colour type 2 or 6 is RGB or RGBA; either way the tool paints the
    // background, and a service that fills transparency gets nothing to fill.
    assert.ok([2, 6].includes(png[25]), `colour type ${png[25]}`);
  });
});

test('every icon the page or the manifest names ships', async (t) => {
  const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.webmanifest'), 'utf8'));
  const named = new Set([
    ...[...html.matchAll(/<link rel="(?:icon|apple-touch-icon|manifest)" href="\.\/([^"]+)"/g)].map((m) => m[1]),
    ...manifest.icons.map((icon) => icon.src),
    meta('og:image').slice(GAME_URL.length + 1),
  ]);
  assert.ok(named.size >= 5, `${[...named].join(', ')}`);

  await t.test('each file exists', () => {
    for (const file of named) assert.ok(existsSync(join(ROOT, file)), `${file} exists`);
  });

  await t.test('none of them is ignored by git, which is what Vercel deploys from', () => {
    for (const file of named) {
      const result = spawnSync('git', ['check-ignore', '-q', file], { cwd: ROOT, encoding: 'utf8' });
      // 0 is ignored, 1 is not; anything else is git failing to answer, and
      // that fails the test too — but saying so, rather than reading as a
      // .gitignore problem. Git refuses a repository whose directory belongs
      // to someone else ("dubious ownership"), and in some sandboxes the
      // directory reads as root's for a second or two after a file is
      // written into it.
      assert.notEqual(result.status, 0, `${file} is ignored by git`);
      assert.equal(result.status, 1,
        `git check-ignore gave no answer for ${file} (status ${result.status}): ${result.stderr.trim()}`);
    }
  });

  await t.test('vercel.json serves the repository root as it is, with nothing held back', () => {
    const vercel = JSON.parse(readFileSync(join(ROOT, 'vercel.json'), 'utf8'));
    assert.equal(vercel.outputDirectory, '.');
    assert.equal(vercel.buildCommand, '');
    assert.ok(!existsSync(join(ROOT, '.vercelignore')), 'no .vercelignore to hold a file back');
  });
});

test('the privacy page', async (t) => {
  const file = join(ROOT, 'datenschutz.html');

  await t.test('exists, ships, and is linked from the game', () => {
    assert.ok(existsSync(file));
    assert.equal(spawnSync('git', ['check-ignore', '-q', 'datenschutz.html'], { cwd: ROOT }).status, 1);
    const links = html.match(/href="datenschutz\.html"/g) ?? [];
    assert.ok(links.length >= 2, 'under the hint and where the result is entered');
  });

  await t.test('says what the leaderboard keeps, who sees it, and for how long', () => {
    const text = readFileSync(file, 'utf8').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    for (const needed of [
      'Name', 'Level', 'Punkte', 'Datum', 'Geräte-ID', 'öffentlich', 'IP-Adresse',
      'Klick', 'Einwilligung', 'zwei Tagen', 'E-Mail', 'Alwyzon', 'Österreich', 'Vercel',
    ]) assert.ok(text.includes(needed), needed);
  });
});
