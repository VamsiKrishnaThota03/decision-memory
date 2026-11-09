import { sql } from '@forge/sql';
import { assignNumber, ensureSchema } from './schema.js';

export const STATUSES = ['active', 'superseded', 'revoked'];
export const SOURCE_TYPES = ['jira-comment', 'jira-issue', 'confluence', 'rovo', 'manual', 'mcp'];

const COLUMNS = `id, num, (SELECT s.num FROM decisions s WHERE s.id = decisions.superseded_by) AS superseded_by_num, title, statement, rationale, status, owner_account_id, created_by, source_type,
  source_url, source_ref, issue_key, project_key, tags, avoid_terms, prefer_terms, superseded_by,
  status_reason, review_by, created_at, updated_at`;

/** Upper bound on decisions loaded for in-memory ranking. Plenty for a site; keeps compute tiny. */
const MAX_CORPUS = 3000;

const parseJsonArray = (v) => {
  if (!v) return [];
  try {
    const parsed = JSON.parse(v);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
};

const toIsoDate = (v) => {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? String(v).slice(0, 10) : d.toISOString().slice(0, 10);
};

const toIso = (v) => {
  if (!v) return null;
  if (v instanceof Date) return v.toISOString();
  // Forge SQL returns 'YYYY-MM-DD HH:MM:SS' (UTC) strings for TIMESTAMP columns.
  const d = new Date(/Z|[+-]\d\d:?\d\d$/.test(String(v)) ? String(v) : `${String(v).replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
};

export const decisionKey = (id) => `DEC-${id}`;

/** Accepts "DEC-12", "dec-12", "12" or 12. Returns the decision NUMBER (not the internal id) or null. */
export function parseDecisionNumber(value) {
  const m = String(value ?? '').trim().match(/^(?:DEC-)?(\d{1,15})$/i);
  return m ? Number(m[1]) : null;
}

export function toDomain(row) {
  if (!row) return null;
  const id = Number(row.id);
  const number = row.num != null ? Number(row.num) : null;
  return {
    id,
    number,
    key: decisionKey(number ?? id),
    title: row.title,
    statement: row.statement,
    rationale: row.rationale ?? '',
    status: row.status,
    ownerAccountId: row.owner_account_id ?? null,
    createdBy: row.created_by,
    sourceType: row.source_type,
    sourceUrl: row.source_url ?? null,
    sourceRef: row.source_ref ?? null,
    issueKey: row.issue_key ?? null,
    projectKey: row.project_key ?? null,
    tags: parseJsonArray(row.tags),
    avoidTerms: parseJsonArray(row.avoid_terms),
    preferTerms: parseJsonArray(row.prefer_terms),
    supersededBy: row.superseded_by != null ? Number(row.superseded_by) : null,
    supersededByKey: row.superseded_by_num != null ? decisionKey(Number(row.superseded_by_num)) : null,
    statusReason: row.status_reason ?? null,
    reviewBy: toIsoDate(row.review_by),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

/**
 * Insert a decision. If `sourceRef` already exists (e.g. the same Jira comment
 * processed twice) the existing decision is returned instead — idempotent.
 */
export async function insertDecision(d) {
  await ensureSchema();
  if (d.sourceRef) {
    const existing = await getBySourceRef(d.sourceRef);
    if (existing) return { decision: existing, created: false };
  }
  const result = await sql
    .prepare(
      `INSERT INTO decisions (title, statement, rationale, status, owner_account_id, created_by, source_type,
        source_url, source_ref, issue_key, project_key, tags, avoid_terms, prefer_terms, review_by)
       VALUES (?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bindParams(
      d.title,
      d.statement,
      d.rationale || null,
      d.ownerAccountId || null,
      d.createdBy,
      d.sourceType,
      d.sourceUrl || null,
      d.sourceRef || null,
      d.issueKey || null,
      d.projectKey || null,
      JSON.stringify(d.tags ?? []),
      JSON.stringify(d.avoidTerms ?? []),
      JSON.stringify(d.preferTerms ?? []),
      d.reviewBy || null,
    )
    .execute();
  const id = Number(result.rows.insertId);
  await assignNumber(id);
  return { decision: await getDecision(id), created: true };
}

export async function getDecision(id) {
  await ensureSchema();
  const r = await sql.prepare(`SELECT ${COLUMNS} FROM decisions WHERE id = ?`).bindParams(id).execute();
  return toDomain(r.rows[0]);
}

export async function getDecisionByNumber(num) {
  await ensureSchema();
  const r = await sql.prepare(`SELECT ${COLUMNS} FROM decisions WHERE num = ?`).bindParams(num).execute();
  return toDomain(r.rows[0]);
}

export async function getBySourceRef(sourceRef) {
  await ensureSchema();
  const r = await sql.prepare(`SELECT ${COLUMNS} FROM decisions WHERE source_ref = ?`).bindParams(sourceRef).execute();
  return toDomain(r.rows[0]);
}

export async function getDecisionsByIds(ids) {
  const unique = [...new Set(ids.filter((x) => Number.isInteger(x)))];
  if (!unique.length) return [];
  await ensureSchema();
  const placeholders = unique.map(() => '?').join(', ');
  const r = await sql
    .prepare(`SELECT ${COLUMNS} FROM decisions WHERE id IN (${placeholders})`)
    .bindParams(...unique)
    .execute();
  return r.rows.map(toDomain);
}

/** Corpus for ranking / conflict detection. */
export async function listAllDecisions({ includeInactive = false } = {}) {
  await ensureSchema();
  const where = includeInactive ? '' : `WHERE status = 'active'`;
  const r = await sql
    .prepare(`SELECT ${COLUMNS} FROM decisions ${where} ORDER BY id DESC LIMIT ${MAX_CORPUS}`)
    .execute();
  return r.rows.map(toDomain);
}

export async function listDecisionsForIssue(issueKey) {
  await ensureSchema();
  const r = await sql
    .prepare(`SELECT ${COLUMNS} FROM decisions WHERE issue_key = ? ORDER BY id DESC LIMIT 50`)
    .bindParams(issueKey)
    .execute();
  return r.rows.map(toDomain);
}

export async function listDueForReview(todayIso, limit = 25) {
  await ensureSchema();
  const r = await sql
    .prepare(`SELECT ${COLUMNS} FROM decisions WHERE status = 'active' AND review_by IS NOT NULL AND review_by <= ? ORDER BY review_by ASC LIMIT ${Number(limit)}`)
    .bindParams(todayIso)
    .execute();
  return r.rows.map(toDomain);
}

/** Decisions that this one replaced (i.e. whose superseded_by points here). */
export async function listSupersededBy(id) {
  await ensureSchema();
  const r = await sql
    .prepare(`SELECT ${COLUMNS} FROM decisions WHERE superseded_by = ? ORDER BY id DESC LIMIT 10`)
    .bindParams(id)
    .execute();
  return r.rows.map(toDomain);
}

/** Active decisions past their review date that weren't reminded in the last `days` days. */
export async function listNeedingReminder(todayIso, days = 7, limit = 20) {
  await ensureSchema();
  const r = await sql
    .prepare(
      `SELECT ${COLUMNS} FROM decisions
       WHERE status = 'active' AND review_by IS NOT NULL AND review_by <= ?
         AND (last_reminded_at IS NULL OR last_reminded_at < DATE_SUB(NOW(), INTERVAL ${Number(days)} DAY))
       ORDER BY review_by ASC LIMIT ${Number(limit)}`,
    )
    .bindParams(todayIso)
    .execute();
  return r.rows.map(toDomain);
}

export async function markReminded(id) {
  await ensureSchema();
  await sql.prepare('UPDATE decisions SET last_reminded_at = NOW() WHERE id = ?').bindParams(id).execute();
}

export async function setStatus(id, status, { reason = null, supersededBy = null } = {}) {
  if (!STATUSES.includes(status)) throw new Error(`Invalid status ${status}`);
  await ensureSchema();
  await sql
    .prepare('UPDATE decisions SET status = ?, status_reason = ?, superseded_by = ? WHERE id = ?')
    .bindParams(status, reason, supersededBy, id)
    .execute();
  return getDecision(id);
}

export async function updateGuardrails(id, { avoidTerms, preferTerms, tags, reviewBy }) {
  await ensureSchema();
  await sql
    .prepare('UPDATE decisions SET avoid_terms = ?, prefer_terms = ?, tags = ?, review_by = ? WHERE id = ?')
    .bindParams(JSON.stringify(avoidTerms), JSON.stringify(preferTerms), JSON.stringify(tags), reviewBy || null, id)
    .execute();
  return getDecision(id);
}
