import api, { route } from '@forge/api';

/**
 * Visibility model
 * ----------------
 * A decision with `projectKey = null` is site-wide knowledge (explicitly shared).
 * A decision with a `projectKey` is only visible to users who can browse that project.
 * Decisions auto-captured from issue comments are always project-scoped, so content
 * from restricted projects never leaks through search, Rovo or MCP.
 */

const MAX_PAGES = 20;

/** Project keys the current user can browse (asUser → Jira enforces permissions). */
export async function browsableProjectKeys() {
  const keys = new Set();
  let startAt = 0;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const res = await api
      .asUser()
      .requestJira(route`/rest/api/3/project/search?action=browse&maxResults=100&startAt=${startAt}`, {
        headers: { Accept: 'application/json' },
      });
    if (!res.ok) break;
    const body = await res.json();
    for (const p of body.values ?? []) keys.add(p.key);
    if (body.isLast || !(body.values ?? []).length) break;
    startAt += body.values.length;
  }
  return keys;
}

export function filterVisible(decisions, projectKeys) {
  return decisions.filter((d) => !d.projectKey || projectKeys.has(d.projectKey));
}

/** For app-authored output on an issue: only site-wide or same-project decisions. */
export function filterForIssue(decisions, issueProjectKey) {
  return decisions.filter((d) => !d.projectKey || d.projectKey === issueProjectKey);
}
