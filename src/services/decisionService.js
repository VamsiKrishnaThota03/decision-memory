import * as repo from '../db/decisions.js';
import * as alerts from '../db/alerts.js';
import { assess, findContradictions, search } from '../lib/conflicts.js';
import { resolveGuardrails } from '../lib/guardrails.js';
import { ForbiddenError, NotFoundError, ValidationError, validateDecisionInput } from '../lib/validate.js';
import { getIssue, isIssueKey, userCanBrowse, userIsJiraAdmin } from './jira.js';
import { browsableProjectKeys, filterVisible } from './projects.js';
import { getOwnerTeams } from './teamworkGraph.js';
import { syncDecisions } from './graphSync.js';
import * as settingsRepo from '../db/settings.js';
import { createHash } from 'node:crypto';
import { parseAdrs } from '../lib/adr.js';

/**
 * Application service: the single place where business rules live.
 * Rovo actions, MCP tools, UI resolvers and triggers are thin adapters on top.
 */

const todayIso = () => new Date().toISOString().slice(0, 10);

/** Decisions the current user may see. */
async function visibleCorpus({ includeInactive = false } = {}) {
  const [all, projects] = await Promise.all([repo.listAllDecisions({ includeInactive }), browsableProjectKeys()]);
  return filterVisible(all, projects);
}

async function assertCanSee(decision) {
  if (!decision) throw new NotFoundError('Decision not found.');
  if (decision.projectKey) {
    const projects = await browsableProjectKeys();
    if (!projects.has(decision.projectKey)) throw new NotFoundError('Decision not found.');
  }
  return decision;
}

async function assertCanManage(decision, accountId) {
  if (decision.ownerAccountId === accountId || decision.createdBy === accountId) return;
  if (await userIsJiraAdmin()) return;
  throw new ForbiddenError('Only the decision owner or a Jira admin can change this decision.');
}

export async function loadDecision(idOrKey) {
  const id = repo.parseDecisionId(idOrKey);
  if (!id) throw new ValidationError('Use a decision key like DEC-12.');
  return assertCanSee(await repo.getDecision(id));
}

/** Summarise a decision for agents / MCP clients (compact, no internal fields). */
export function summarize(d, extra = {}) {
  return {
    key: d.key,
    title: d.title,
    statement: d.statement,
    rationale: d.rationale || undefined,
    status: d.status,
    ownerAccountId: d.ownerAccountId || undefined,
    source: d.sourceUrl ?? (d.issueKey ? `Jira issue ${d.issueKey}` : d.sourceType),
    scope: d.projectKey ? `project ${d.projectKey}` : 'site-wide',
    decidedOn: d.createdAt?.slice(0, 10),
    reviewBy: d.reviewBy || undefined,
    supersededBy: d.supersededBy ? repo.decisionKey(d.supersededBy) : undefined,
    guardrails: { avoid: d.avoidTerms, prefer: d.preferTerms },
    ...extra,
  };
}

/**
 * Record a decision on behalf of a user (UI, Rovo, MCP).
 * @param {object} input raw input
 * @param {{accountId: string, sourceType: string, issueKey?: string, sourceRef?: string}} ctx
 */
export async function recordDecision(input, ctx) {
  if (!ctx.accountId) throw new ForbiddenError('A signed-in user is required to record decisions.');
  const v = validateDecisionInput(input);

  let issue = null;
  if (ctx.issueKey) {
    if (!isIssueKey(ctx.issueKey)) throw new ValidationError('Invalid issue key.');
    issue = await getIssue(ctx.issueKey, { asUser: true }).catch(() => null);
    if (!issue) throw new ForbiddenError('You cannot access that issue.');
  }
  // Scope: explicit "project" → only that project's users see it; default site-wide.
  if (input.scope === 'project' && !issue) {
    throw new ValidationError('Project-only decisions must be recorded from (or linked to) a Jira issue.');
  }
  const projectScoped = input.scope === 'project';
  const guardrails = resolveGuardrails(v.statement, v);

  // Before saving, tell the caller about contradictions / overlap with existing decisions.
  const corpus = await visibleCorpus();
  const contradictions = findContradictions(guardrails, corpus);
  const overlap = assess(`${v.title}. ${v.statement}`, corpus, { relatedLimit: 3, minRelatedScore: 4 });
  const contradictIds = new Set(contradictions.map((c) => c.decision.id));
  for (const c of overlap.conflicts) if (!contradictIds.has(c.decision.id)) contradictions.push(c);

  const { decision, created } = await repo.insertDecision({
    ...v,
    avoidTerms: guardrails.avoid,
    preferTerms: guardrails.prefer,
    ownerAccountId: ctx.accountId, // never from input: owners get @mentioned and manage rights
    createdBy: ctx.accountId,
    sourceType: ctx.sourceType,
    sourceRef: ctx.sourceRef ?? null,
    issueKey: issue?.key ?? null,
    projectKey: projectScoped ? issue.projectKey : null,
  });
  if (created) await syncDecisions([decision]);

  return {
    decision,
    created,
    contradicts: contradictions.map((c) => ({ key: c.decision.key, title: c.decision.title, reason: c.reason })),
    similar: overlap.related.map((r) => ({ key: r.decision.key, title: r.decision.title })),
  };
}

export async function supersedeDecision(idOrKey, input, ctx) {
  const old = await loadDecision(idOrKey);
  if (old.status !== 'active') throw new ValidationError(`${old.key} is already ${old.status}.`);
  await assertCanManage(old, ctx.accountId);
  const v = validateDecisionInput(input);
  const guardrails = resolveGuardrails(v.statement, v);
  const { decision } = await repo.insertDecision({
    ...v,
    rationale: v.rationale || `Supersedes ${old.key}: ${old.title}`,
    tags: v.tags.length ? v.tags : old.tags,
    avoidTerms: guardrails.avoid,
    preferTerms: guardrails.prefer,
    ownerAccountId: ctx.accountId,
    createdBy: ctx.accountId,
    sourceType: ctx.sourceType,
    issueKey: old.issueKey,
    projectKey: old.projectKey,
  });
  const updatedOld = await repo.setStatus(old.id, 'superseded', {
    reason: `Superseded by ${decision.key}`,
    supersededBy: decision.id,
  });
  await syncDecisions([decision, updatedOld]);
  return { decision, superseded: updatedOld };
}

export async function revokeDecision(idOrKey, reason, ctx) {
  const d = await loadDecision(idOrKey);
  if (d.status !== 'active') throw new ValidationError(`${d.key} is already ${d.status}.`);
  await assertCanManage(d, ctx.accountId);
  const why = String(reason ?? '').trim().slice(0, 1000);
  if (why.length < 3) throw new ValidationError('Please give a short reason for revoking.');
  const revoked = await repo.setStatus(d.id, 'revoked', { reason: why });
  await syncDecisions([revoked]);
  return revoked;
}

export async function editGuardrails(idOrKey, input, ctx) {
  const d = await loadDecision(idOrKey);
  if (d.status !== 'active') throw new ValidationError(`${d.key} is ${d.status}; only active decisions can be edited.`);
  await assertCanManage(d, ctx.accountId);
  const v = validateDecisionInput({ ...d, ...input, statement: d.statement, title: d.title });
  const updated = await repo.updateGuardrails(d.id, {
    avoidTerms: v.avoidTerms,
    preferTerms: v.preferTerms,
    tags: v.tags,
    reviewBy: v.reviewBy,
  });
  await syncDecisions([updated]);
  return updated;
}

export async function searchDecisions(query, { includeInactive = false, limit = 8, status = null } = {}) {
  const q = String(query ?? '').trim().slice(0, 500);
  const visible = await visibleCorpus({ includeInactive: includeInactive || Boolean(status) });
  const corpus = status ? visible.filter((d) => d.status === status) : visible;
  if (!q) return corpus.slice(0, limit).map((decision) => ({ decision, score: 0, matched: [] }));
  return search(q, corpus, { limit, includeInactive: true });
}

/** Free-text conflict check (proposals, PR descriptions, chat). */
export async function checkText(text) {
  const t = String(text ?? '').trim().slice(0, 20000);
  if (t.length < 3) throw new ValidationError('Provide some text describing the planned work.');
  return assess(t, await visibleCorpus());
}

/**
 * Full insight for an issue, as the current user. Merges live analysis with
 * alert state (acknowledged / dismissed) and decisions captured on this issue.
 */
export async function issueInsights(issueKey) {
  if (!isIssueKey(issueKey)) throw new ValidationError('Invalid issue key.');
  const issue = await getIssue(issueKey, { asUser: true }).catch((e) => {
    if (e.status === 404 || e.status === 403) throw new NotFoundError('Issue not found.');
    throw e;
  });
  const [all, projects, alertRows, captured] = await Promise.all([
    repo.listAllDecisions(),
    browsableProjectKeys(),
    alerts.listAlertsForIssue(issue.key),
    repo.listDecisionsForIssue(issue.key),
  ]);
  // Decisions captured on this issue are its own rules, not conflicts (same as the trigger).
  const corpus = filterVisible(all, projects).filter((d) => d.issueKey !== issue.key);
  const result = assess(`${issue.summary}\n${issue.descriptionText}`, corpus);
  const alertState = new Map(alertRows.map((a) => [a.decisionId, a.status]));
  return {
    issue: { key: issue.key, summary: issue.summary, projectKey: issue.projectKey },
    conflicts: result.conflicts.map((c) => ({ ...c, alertStatus: alertState.get(c.decision.id) ?? 'open' })),
    aligned: result.aligned,
    related: result.related,
    captured: filterVisible(captured, projects),
    dueForReview: result.conflicts
      .concat(result.aligned)
      .map((x) => x.decision)
      .filter((d) => d.reviewBy && d.reviewBy <= todayIso()),
  };
}

export async function setIssueAlertStatus(issueKey, decisionIdOrKey, status, ctx) {
  if (!(await userCanBrowse(issueKey))) throw new NotFoundError('Issue not found.');
  const d = await loadDecision(decisionIdOrKey);
  await alerts.setAlertStatus(issueKey, d.id, status, ctx.accountId);
  return { issueKey, decisionKey: d.key, status };
}

export async function decisionDetail(idOrKey, ctx = {}) {
  const d = await loadDecision(idOrKey);
  const [lineage, graphTeams, outcomes, viewerCanManage] = await Promise.all([
    decisionLineage(d),
    getOwnerTeams(d.ownerAccountId),
    alerts.alertOutcomesByDecision(),
    canManage(d, ctx.accountId),
  ]);
  const o = outcomes.get(d.id) ?? { open: 0, acknowledged: 0, dismissed: 0 };
  return {
    decision: d,
    supersededBy: lineage.find((x) => x.id === d.supersededBy) ?? null,
    lineage,
    ownerTeams: graphTeams,
    alerts: o,
    // Learning loop: frequently dismissed alerts mean the guardrails are too broad.
    needsTuning: o.dismissed >= 2 && o.dismissed > o.acknowledged,
    viewerCanManage,
  };
}

/** Full supersede chain (oldest → newest), visible decisions only. */
async function decisionLineage(d) {
  const projects = await browsableProjectKeys();
  const older = [];
  let frontier = [d];
  for (let depth = 0; depth < 10 && frontier.length; depth += 1) {
    const prev = (await Promise.all(frontier.map((x) => repo.listSupersededBy(x.id)))).flat();
    older.unshift(...prev);
    frontier = prev;
  }
  const newer = [];
  let cursor = d;
  for (let depth = 0; depth < 10 && cursor.supersededBy; depth += 1) {
    cursor = await repo.getDecision(cursor.supersededBy);
    if (!cursor) break;
    newer.push(cursor);
  }
  return filterVisible([...older, d, ...newer], projects);
}

async function canManage(d, accountId) {
  if (!accountId) return false;
  try {
    await assertCanManage(d, accountId);
    return true;
  } catch {
    return false;
  }
}

export async function dueForReview() {
  const projects = await browsableProjectKeys();
  return filterVisible(await repo.listDueForReview(todayIso()), projects);
}

export async function dashboardStats() {
  const [all, projects, openByDecision] = await Promise.all([
    repo.listAllDecisions({ includeInactive: true }),
    browsableProjectKeys(),
    alerts.openAlertCountsByDecision(),
  ]);
  const visible = filterVisible(all, projects);
  const today = todayIso();
  const counts = { active: 0, superseded: 0, revoked: 0 };
  let openConflicts = 0;
  let due = 0;
  for (const d of visible) {
    counts[d.status] = (counts[d.status] ?? 0) + 1;
    if (d.status === 'active') {
      openConflicts += openByDecision.get(d.id) ?? 0;
      if (d.reviewBy && d.reviewBy <= today) due += 1;
    }
  }
  return { ...counts, openConflicts, dueForReview: due };
}

// ---------------------------------------------------------------- demo data

const DEMO = [
  {
    statement: 'Use PostgreSQL instead of MongoDB for all new services.',
    rationale: 'One database to operate, transactional guarantees, and the on-call team already runs Postgres.',
    tags: 'database, backend',
  },
  {
    statement: 'Do not deploy to production on Fridays.',
    rationale: 'Weekend incidents hurt on-call wellbeing; Friday changes had 3x the rollback rate last year.',
    tags: 'release, operations',
  },
  {
    statement: 'Deprecate the legacy Jenkins pipelines; use GitHub Actions for CI.',
    rationale: 'Jenkins hosts are unpatched and cost us two engineer-days a month.',
    tags: 'ci, platform',
  },
  {
    statement: 'No feature flags in the payments service.',
    rationale: 'PCI audit scope: every code path in payments must be reviewed and deterministic.',
    tags: 'payments, compliance',
  },
  {
    statement: 'All public APIs must use OAuth 2.0 instead of API keys.',
    rationale: 'API keys leaked twice in 2025; OAuth gives scoped, revocable access.',
    tags: 'security, api',
    reviewBy: '2027-03-31',
  },
];

/** Load sample decisions (idempotent) so judges and new teams can try the app in seconds. */
export async function seedDemo(ctx) {
  if (!ctx.accountId) throw new ForbiddenError();
  const existing = await repo.listAllDecisions({ includeInactive: true });
  if (existing.some((d) => !String(d.sourceRef ?? '').startsWith('demo:')) && !(await userIsJiraAdmin())) {
    throw new ValidationError('Sample decisions can only be loaded into an empty Decision Log (or by a Jira admin).');
  }
  const created = [];
  for (const [i, d] of DEMO.entries()) {
    const v = validateDecisionInput(d);
    const g = resolveGuardrails(v.statement, v);
    const r = await repo.insertDecision({
      ...v,
      avoidTerms: g.avoid,
      preferTerms: g.prefer,
      ownerAccountId: ctx.accountId,
      createdBy: ctx.accountId,
      sourceType: 'manual',
      sourceRef: `demo:${i + 1}`,
    });
    if (r.created) created.push(r.decision);
  }
  await syncDecisions(created);
  return { created: created.length, total: DEMO.length };
}

// ---------------------------------------------------------------- ADR import

/** Stable identity of a draft: hash of its normalised statement (independent of selection/order). */
function draftId(statement) {
  return createHash('sha1').update(String(statement).toLowerCase().replace(/\s+/g, ' ').trim()).digest('hex').slice(0, 16);
}

function parseDrafts(markdown) {
  const md = String(markdown ?? '');
  if (md.length > 200000) throw new ValidationError('That is too much text at once (max 200,000 characters).');
  return parseAdrs(md).map((d) => ({
    ...d,
    id: draftId(d.statement),
    guardrails: resolveGuardrails(d.statement),
    // Proposed ADRs aren't decisions yet: never pre-selected, never imported as active.
    selectable: d.status !== 'proposed',
  }));
}

/** Preview: parse ADR markdown / page text into drafts (no writes). */
export function previewImport(markdown) {
  return parseDrafts(markdown);
}

/**
 * Import the selected drafts. The source text is RE-PARSED here; the client only
 * sends which draft ids to import, so stored content always comes from the source.
 */
export async function importDecisions(markdown, ids, { accountId, sourceUrl = null, sourceType = 'manual', refPrefix }) {
  if (!accountId) throw new ForbiddenError();
  const wanted = new Set(Array.isArray(ids) ? ids.map(String) : []);
  if (!wanted.size) throw new ValidationError('Select at least one decision to import.');
  const drafts = parseDrafts(markdown).filter((d) => wanted.has(d.id));
  const out = [];
  for (const raw of drafts.slice(0, 50)) {
    if (!raw.selectable) {
      out.push({ ok: false, title: raw.title || raw.statement, error: 'Proposed ADRs are not imported until accepted.' });
      continue;
    }
    let v;
    try {
      v = validateDecisionInput({ ...raw, sourceUrl });
    } catch (e) {
      out.push({ ok: false, title: raw.title || raw.statement, error: e.message });
      continue;
    }
    const g = resolveGuardrails(v.statement, v);
    const { decision, created } = await repo.insertDecision({
      ...v,
      avoidTerms: g.avoid,
      preferTerms: g.prefer,
      ownerAccountId: accountId,
      createdBy: accountId,
      sourceType,
      sourceRef: `${refPrefix}:${raw.id}`.slice(0, 255),
    });
    let final = decision;
    if (created && (raw.status === 'superseded' || raw.status === 'revoked')) {
      final = await repo.setStatus(decision.id, raw.status, { reason: 'Imported as historical record' });
    }
    out.push({ ok: true, created, key: final.key, title: final.title, status: final.status });
  }
  const createdIds = out.filter((r) => r.ok && r.created).map((r) => repo.parseDecisionId(r.key));
  await syncDecisions(await repo.getDecisionsByIds(createdIds));
  return out;
}

// ---------------------------------------------------------------- insights

export async function insights() {
  const [all, projects, outcomes, monthly] = await Promise.all([
    repo.listAllDecisions({ includeInactive: true }),
    browsableProjectKeys(),
    alerts.alertOutcomesByDecision(),
    alerts.alertsByMonth(6),
  ]);
  const visible = filterVisible(all, projects);
  const ids = new Set(visible.map((d) => d.id));
  const byId = new Map(visible.map((d) => [d.id, d]));

  const totals = { caught: 0, acknowledged: 0, dismissed: 0, open: 0 };
  const perDecision = [];
  for (const [id, o] of outcomes) {
    if (!ids.has(id)) continue;
    const n = o.open + o.acknowledged + o.dismissed;
    totals.caught += n;
    totals.acknowledged += o.acknowledged;
    totals.dismissed += o.dismissed;
    if (byId.get(id).status === 'active') totals.open += o.open;
    perDecision.push({ decision: byId.get(id), ...o, total: n });
  }
  perDecision.sort((a, b) => b.total - a.total);

  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push(d.toISOString().slice(0, 7));
  }
  const perMonth = new Map(months.map((m) => [m, 0]));
  for (const row of monthly) if (ids.has(row.decisionId) && perMonth.has(row.month)) perMonth.set(row.month, perMonth.get(row.month) + row.n);

  const bySource = {};
  for (const d of visible) bySource[d.sourceType] = (bySource[d.sourceType] ?? 0) + 1;

  const today = todayIso();
  return {
    totals,
    precision: totals.acknowledged + totals.dismissed
      ? Math.round((100 * totals.acknowledged) / (totals.acknowledged + totals.dismissed))
      : null,
    conflictsByMonth: [...perMonth].map(([month, count]) => ({ month, count })),
    topDecisions: perDecision.slice(0, 5).map((p) => ({ key: p.decision.key, title: p.decision.title, total: p.total, dismissed: p.dismissed })),
    bySource: Object.entries(bySource).map(([source, count]) => ({ source, count })),
    hygiene: {
      withoutRationale: visible.filter((d) => d.status === 'active' && !d.rationale).length,
      withoutGuardrails: visible.filter((d) => d.status === 'active' && !d.avoidTerms.length && !d.preferTerms.length).length,
      overdueReview: visible.filter((d) => d.status === 'active' && d.reviewBy && d.reviewBy <= today).length,
      needsTuning: perDecision.filter((p) => p.dismissed >= 2 && p.dismissed > p.acknowledged).map((p) => p.decision.key),
    },
  };
}

// ---------------------------------------------------------------- settings

export async function getSettings() {
  return settingsRepo.getSettings();
}

export async function saveSettings(input, ctx) {
  if (!(await userIsJiraAdmin())) throw new ForbiddenError('Only Jira admins can change Decision Memory settings.');
  return settingsRepo.saveSettings(input, ctx.accountId);
}

export async function graphStatus() {
  const connections = await settingsRepo.getGraphConnections();
  return { connected: connections.length > 0, connections: connections.map((c) => ({ name: c.name, connectedAt: c.connectedAt })) };
}
