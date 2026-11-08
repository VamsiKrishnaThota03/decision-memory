import { graph } from '@forge/teamwork-graph';
import { getGraphConnections } from '../db/settings.js';
import { decisionUrl, getSiteBaseUrl } from './jira.js';

/**
 * Publishes decisions INTO the Teamwork Graph (graph:connector) so they become
 * first-class, searchable objects linked to the Jira work they came from —
 * discoverable by Rovo search, other agents and every Teamwork Graph consumer.
 *
 * Only site-wide decisions are published (they're visible to everyone on the
 * site anyway). Project-scoped decisions stay inside the app, so we never
 * widen access. All calls are best-effort: graph problems never break the app.
 */

const BATCH = 100;

/** Pure: map a decision to an atlassian:document object. Exported for tests. */
export function toGraphObject(d, baseUrl, now = new Date()) {
  const createdAt = d.createdAt ?? now.toISOString();
  const lastUpdatedAt = d.updatedAt ?? createdAt;
  const status = d.status === 'active' ? '' : ` [${d.status.toUpperCase()}]`;
  const body = [
    `${d.key}: ${d.title}${status}`,
    `Decision: ${d.statement}`,
    d.rationale ? `Why: ${d.rationale}` : '',
    d.avoidTerms?.length ? `Avoid: ${d.avoidTerms.join(', ')}` : '',
    d.preferTerms?.length ? `Prefer: ${d.preferTerms.join(', ')}` : '',
    d.statusReason ? `Status: ${d.statusReason}` : '',
  ]
    .filter(Boolean)
    .join('\n');
  const user = d.ownerAccountId ? { accountId: d.ownerAccountId, externalId: d.ownerAccountId } : null;
  return {
    schemaVersion: '1.0',
    id: `decision-${d.id}`,
    // Millisecond clock: two updates within the same second must still be ordered.
    updateSequenceNumber: now.getTime(),
    displayName: `${d.key}: ${d.title}${status}`.slice(0, 255),
    description: d.statement.slice(0, 1000),
    url: decisionUrl(baseUrl, d),
    createdAt,
    lastUpdatedAt,
    ...(user ? { createdBy: user, owners: [user] } : {}),
    permissions: { accessControls: [{ principals: [{ type: 'ATLASSIAN_WORKSPACE' }] }] },
    ...(d.issueKey
      ? { associations: { lastUpdatedAt, set: [{ associationType: 'issueIdOrKeys', values: [d.issueKey] }] } }
      : {}),
    'atlassian:document': {
      type: { category: 'DOCUMENT', mimeType: 'text/plain' },
      content: { mimeType: 'text/plain', text: body },
      labels: ['decision', `decision-${d.status}`, ...(d.tags ?? [])].slice(0, 20),
    },
  };
}

/** Upsert decisions into every configured connection. Never throws. */
export async function syncDecisions(decisions, { backfill = false } = {}) {
  try {
    const publishable = (decisions ?? []).filter((d) => d && !d.projectKey);
    if (!publishable.length) return { synced: 0 };
    const connections = await getGraphConnections();
    if (!connections.length) return { synced: 0, connected: false };
    const baseUrl = await getSiteBaseUrl();
    const objects = publishable.map((d) => toGraphObject(d, baseUrl));
    let synced = 0;
    for (const { connectionId } of connections) {
      for (let i = 0; i < objects.length; i += BATCH) {
        const res = await graph.setObjects({
          objects: objects.slice(i, i + BATCH),
          connectionId,
          operationType: backfill ? 'BACKFILL' : 'NORMAL',
        });
        if (!res?.success) console.warn('Teamwork Graph setObjects failed', res?.error);
        else synced += res.results?.accepted?.length ?? 0;
        if (res?.results?.rejected?.length) console.warn('Teamwork Graph rejected objects', JSON.stringify(res.results.rejected).slice(0, 500));
      }
    }
    return { synced, connected: true };
  } catch (err) {
    console.warn('Teamwork Graph sync skipped', err?.message);
    return { synced: 0, error: true };
  }
}
