import { sql } from '@forge/sql';
import { ensureSchema } from './schema.js';

export const ALERT_STATUSES = ['open', 'acknowledged', 'dismissed'];

const toDomain = (row) => ({
  id: Number(row.id),
  issueKey: row.issue_key,
  decisionId: Number(row.decision_id),
  confidence: row.confidence != null ? Number(row.confidence) : null,
  reason: row.reason ?? '',
  status: row.status,
  resolvedBy: row.resolved_by ?? null,
  createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : (row.created_at ?? null),
});

export async function listAlertsForIssue(issueKey) {
  await ensureSchema();
  const r = await sql
    .prepare('SELECT * FROM decision_alerts WHERE issue_key = ?')
    .bindParams(issueKey)
    .execute();
  return r.rows.map(toDomain);
}

/**
 * Record conflicts for an issue. Returns only the conflicts that are NEW
 * (never alerted before) so we never spam the same issue twice. INSERT IGNORE
 * on the unique (issue, decision) key makes this safe under concurrent or
 * duplicate trigger deliveries: only the invocation that inserts the row wins.
 */
export async function recordAlerts(issueKey, conflicts) {
  if (!conflicts.length) return [];
  await ensureSchema();
  const fresh = [];
  for (const c of conflicts) {
    const r = await sql
      .prepare(
        `INSERT IGNORE INTO decision_alerts (issue_key, decision_id, confidence, reason, status)
         VALUES (?, ?, ?, ?, 'open')`,
      )
      .bindParams(issueKey, c.decision.id, c.confidence, c.reason)
      .execute();
    if (Number(r.rows?.affectedRows ?? 0) === 1) fresh.push(c);
  }
  return fresh;
}

export async function setAlertStatus(issueKey, decisionId, status, accountId) {
  if (!ALERT_STATUSES.includes(status)) throw new Error(`Invalid alert status ${status}`);
  await ensureSchema();
  await sql
    .prepare(
      `INSERT INTO decision_alerts (issue_key, decision_id, status, resolved_by)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE status = VALUES(status), resolved_by = VALUES(resolved_by)`,
    )
    .bindParams(issueKey, decisionId, status, accountId)
    .execute();
}

/** Map of decisionId -> number of open alerts. */
export async function openAlertCountsByDecision() {
  await ensureSchema();
  const r = await sql
    .prepare(`SELECT decision_id, COUNT(*) AS n FROM decision_alerts WHERE status = 'open' GROUP BY decision_id`)
    .execute();
  return new Map(r.rows.map((row) => [Number(row.decision_id), Number(row.n)]));
}

/** Per-decision alert outcome counts: { decisionId -> {open, acknowledged, dismissed} }. */
export async function alertOutcomesByDecision() {
  await ensureSchema();
  const r = await sql
    .prepare('SELECT decision_id, status, COUNT(*) AS n FROM decision_alerts GROUP BY decision_id, status')
    .execute();
  const out = new Map();
  for (const row of r.rows) {
    const id = Number(row.decision_id);
    const entry = out.get(id) ?? { open: 0, acknowledged: 0, dismissed: 0 };
    entry[row.status] = Number(row.n);
    out.set(id, entry);
  }
  return out;
}

/** Alerts per month for the last `months` months: [{ month: 'YYYY-MM', decisionId, n }]. */
export async function alertsByMonth(months = 6) {
  await ensureSchema();
  const r = await sql
    .prepare(
      `SELECT DATE_FORMAT(created_at, '%Y-%m') AS month, decision_id, COUNT(*) AS n
       FROM decision_alerts
       WHERE created_at >= DATE_SUB(NOW(), INTERVAL ${Number(months)} MONTH)
       GROUP BY month, decision_id`,
    )
    .execute();
  return r.rows.map((row) => ({ month: row.month, decisionId: Number(row.decision_id), n: Number(row.n) }));
}
