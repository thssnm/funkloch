import { test } from 'node:test';
import assert from 'node:assert/strict';

import { versionResponse } from '../api/version.js';

const SHA = '4e9a9b8c0d1e2f30415263748596a7b8c9d0e1f2';

test('the version endpoint', async (t) => {
  await t.test('names the commit Vercel deployed', async () => {
    const response = versionResponse({ VERCEL_GIT_COMMIT_SHA: SHA });
    assert.deepEqual(await response.json(), { commit: SHA });
    assert.equal(response.headers.get('cache-control'), 'no-store');
  });

  await t.test('says null without one, as on a deployment not made from Git', async () => {
    assert.deepEqual(await versionResponse({}).json(), { commit: null });
    assert.deepEqual(await versionResponse({ VERCEL_GIT_COMMIT_SHA: '' }).json(), { commit: null });
  });

  await t.test('passes on nothing that is not a commit hash', async () => {
    assert.deepEqual(await versionResponse({ VERCEL_GIT_COMMIT_SHA: '<b>main</b>' }).json(), { commit: null });
  });
});
