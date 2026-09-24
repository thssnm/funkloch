#!/usr/bin/env node
/**
 * Rasterises favicon.svg into the PNGs the platforms insist on.
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

const browser = await chromium.launch();
try {
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
