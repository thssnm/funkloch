#!/usr/bin/env node
/**
 * Static dev server for the project.
 *
 *   node tools/serve.js [--port=8000] [--host=127.0.0.1]
 *
 * Exists for one reason: it sends `Cache-Control: no-store`. A plain
 * `python3 -m http.server` sends only `Last-Modified`, so browsers cache the ES
 * modules heuristically. Reload after an edit and you can end up with a fresh
 * index.html linked against a stale module — the import graph fails to
 * resolve, the script never runs, and the page renders nothing at all with no
 * visible error. That is a dev-loop trap, not something the player should ever
 * meet, so the dev server simply refuses to let anything be cached.
 *
 * A real deployment would do the opposite: cache hard and bust by filename.
 */

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.css': 'text/css; charset=utf-8',
};

const args = Object.fromEntries(process.argv.slice(2).map((arg) => arg.replace(/^--/, '').split('=')));
const port = Number.parseInt(args.port ?? '8000', 10);
const host = args.host ?? '127.0.0.1';

createServer(async (request, response) => {
  const requested = decodeURIComponent(request.url.split('?')[0]);
  const path = requested === '/' ? '/index.html' : requested;
  // Keep the server inside the project directory.
  const file = join(ROOT, normalize(path).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    response.writeHead(403).end('forbidden');
    return;
  }

  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': MIME[extname(file)] ?? 'application/octet-stream',
      'cache-control': 'no-store, must-revalidate',
    });
    response.end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end(`not found: ${path}`);
  }
}).listen(port, host, () => {
  console.log(`serving ${ROOT} on http://${host}:${port}/  (no-store)`);
});
