/**
 * Which commit the running deployment was made from, for the line under the
 * hint — so a bug report can say which build it was seen on.
 *
 * A Vercel Function rather than a file written at deploy time, because there
 * is no build step to write one. Vercel sets VERCEL_GIT_COMMIT_SHA at runtime
 * as well as at build time ("System environment variables", vercel.com/docs),
 * so the function reads it on every request and nothing has to be stamped
 * into the page. A deployment that did not come from a Git push — `vercel
 * deploy` from a working copy — has no commit, and says so with `null`.
 *
 * `tools/serve.js` answers the same path with this same handler, so the page
 * and the smoke test see one implementation.
 */

/**
 * @param {Record<string, string | undefined>} env
 * @returns {Response}
 */
export function versionResponse(env) {
  const sha = env.VERCEL_GIT_COMMIT_SHA;
  return Response.json(
    { commit: typeof sha === 'string' && /^[0-9a-f]{40}$/.test(sha) ? sha : null },
    // Not cached anywhere: the answer is tiny, and a cached one from the
    // deployment before is exactly the wrong answer this exists to avoid.
    { headers: { 'cache-control': 'no-store' } },
  );
}

export default {
  fetch() {
    return versionResponse(process.env);
  },
};
