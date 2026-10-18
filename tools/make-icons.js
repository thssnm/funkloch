#!/usr/bin/env node
/**
 * Rasterises favicon.svg into the PNGs the platforms insist on, and composes
 * the link preview from it.
 *
 *   node tools/make-icons.js
 *
 * iOS ignores `rel="icon"` with an SVG and wants an `apple-touch-icon` PNG;
 * Android reads the manifest and wants 192 and 512. So the vector stays the
 * single source and these three are derived from it — never edited by hand, or
 * the icon quietly forks into four slightly different drawings.
 *
 * The rounded corners are dropped for the raster sizes: every platform that
 * uses them masks the tile itself, and a corner rounded twice leaves a dark
 * sliver outside the mask.
 *
 * og-image.png, 1200×630, is what chats and feeds show next to a shared link.
 * It is composed here from the same two drawings the page already has — the
 * mark from favicon.svg as a background motif and the wordmark lifted out of
 * index.html, with the palette resolved from index.html's :root — so that it
 * follows both instead of being a third drawing of either. Opaque background
 * in the game's own colour: some services fill transparency with black or
 * white. The wordmark is set in whatever system font the machine running this
 * has, like the end card; it is baked in here, so re-run it where the font is
 * one you want to ship.
 *
 * Needs the playwright devDependency; see the note in tools/ui-smoke.js if
 * Chromium will not start for want of system libraries.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** The vector, with the tile corners squared off. */
const source = readFileSync(join(ROOT, 'favicon.svg'), 'utf8').replace('rx="14"', 'rx="0"');

const targets = [
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
];

/** The link preview's size, the one every service agrees on. */
const PREVIEW = { file: 'og-image.png', width: 1200, height: 630 };

/**
 * The preview as one SVG document: background, the mark, the wordmark.
 * Everything in it is taken from the page or the icon, nothing is drawn anew.
 * @param {string} icon favicon.svg
 * @param {string} html index.html
 * @returns {string}
 */
function composePreview(icon, html) {
  const take = (text, pattern, what) => {
    const found = text.match(pattern)?.[0];
    if (!found) throw new Error(`${what} not found — the preview follows the page, and the page moved`);
    return found;
  };
  const colour = (name) => take(html, new RegExp(`--${name}:\\s*#[0-9a-fA-F]{6}`), `--${name}`).split(/:\s*/)[1];
  const background = colour('bg');

  // The mark, without its tile, dimmed and set to the upper left: a fragment of
  // a board behind the name, not a second subject.
  const markSize = 176;
  const mark = icon
    .replace(/<rect[^>]*\/>\s*/, '')
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    .replace('width="64" height="64"', `x="72" y="56" width="${markSize}" height="${markSize}" opacity="0.55"`);

  // The wordmark as the end card draws it, four times its size and centred.
  // Its stylesheet rules come along, with the custom properties resolved.
  const scale = 4;
  const width = 184 * scale;
  const height = 48 * scale;
  const rules = [
    take(html, /\.wordmark text \{[^}]*\}/, '.wordmark text'),
    take(html, /\.wordmark \.mark-hole \{[^}]*\}/, '.wordmark .mark-hole'),
  ].join('\n').replace(/var\(--([a-z-]+)\)/g, (unused, name) => colour(name));
  const wordmark = take(html, /<svg class="wordmark"[\s\S]*?<\/svg>/, 'the wordmark')
    .replace(' id="wordmark"', '')
    .replace(/<title>[\s\S]*?<\/title>\s*/, '')
    // The glyphs sit between about 11 and 40 of the 48 in the viewBox; the
    // vertical offset puts that band, not the box, on the picture's centre.
    .replace('viewBox="0 0 184 48"', `viewBox="0 0 184 48" x="${(PREVIEW.width - width) / 2}" y="${PREVIEW.height / 2 - 25.5 * scale}" width="${width}" height="${height}" overflow="visible"`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW.width}" height="${PREVIEW.height}" viewBox="0 0 ${PREVIEW.width} ${PREVIEW.height}">`
    + `<style>${rules}</style>`
    + `<rect width="${PREVIEW.width}" height="${PREVIEW.height}" fill="${background}"/>`
    + mark + wordmark + '</svg>';
}

const browser = await chromium.launch();
try {
  const preview = composePreview(readFileSync(join(ROOT, 'favicon.svg'), 'utf8'), readFileSync(join(ROOT, 'index.html'), 'utf8'));
  const page = await browser.newPage({ viewport: { width: PREVIEW.width, height: PREVIEW.height } });
  await page.setContent(
    `<!doctype html><meta charset="utf-8"><style>html,body{margin:0}svg{display:block}</style>${preview}`,
    { waitUntil: 'load' },
  );
  await page.evaluate(() => document.fonts.ready);
  // Centred on what was actually drawn, not on the viewBox: the two halves of
  // the name hang off the ring, so where the word ends depends on the font.
  await page.evaluate((width) => {
    const wordmark = document.querySelector('svg.wordmark');
    const box = wordmark.getBBox();
    const scale = wordmark.width.baseVal.value / wordmark.viewBox.baseVal.width;
    wordmark.setAttribute('x', String(width / 2 - (box.x + box.width / 2) * scale));
  }, PREVIEW.width);
  writeFileSync(join(ROOT, PREVIEW.file), await page.screenshot({ omitBackground: false }));
  console.log(`${PREVIEW.file}  ${PREVIEW.width}×${PREVIEW.height}`);
  await page.close();

  for (const { file, size } of targets) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    // The SVG carries its own width/height; a page-level rule scales it to the
    // viewport so one vector serves every size.
    await page.setContent(
      `<!doctype html><meta charset="utf-8">`
      + `<style>html,body{margin:0;background:#10131a}svg{display:block;width:${size}px;height:${size}px}</style>`
      + source,
      { waitUntil: 'load' },
    );
    writeFileSync(join(ROOT, file), await page.screenshot({ omitBackground: false }));
    console.log(`${file}  ${size}×${size}`);
    await page.close();
  }
} finally {
  await browser.close();
}
