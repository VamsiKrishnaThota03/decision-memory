import * as svc from '../services/decisionService.js';
import { clampInt, toBool } from '../lib/validate.js';
import { addedDependencyLines } from '../lib/diff.js';

/**
 * Rovo actions (also exposed as MCP tools via rovo:mcp).
 * Handlers return compact JSON the agent can reason over. Errors are
 * returned as `{ error }` so the agent can explain them instead of failing.
 * Authorisation always uses the platform-provided accountId, never inputs.
 */

function accountIdOf(payload, context) {
  // Platform-provided identity only; never from the payload.
  return context?.principal?.accountId ?? context?.accountId ?? null;
}

/** Issue key from explicit input, or from the Jira page the user is on. */
function issueKeyOf(payload) {
  const explicit = typeof payload?.issueKey === 'string' ? payload.issueKey.trim().toUpperCase() : '';
  if (explicit) return explicit;
  const fromCtx = payload?.context?.jira?.issueKey;
  if (typeof fromCtx === 'string' && fromCtx.includes('-')) return fromCtx;
  const url = payload?.context?.jira?.url;
  const m = typeof url === 'string' ? url.match(/\/browse\/([A-Z][A-Z0-9_]+-\d+)/) : null;
  return m ? m[1] : null;
}

function confluenceUrlOf(payload) {
  const url = payload?.context?.confluence?.url;
  return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

const wrap = (fn) => async (payload, context) => {
  try {
    return await fn(payload ?? {}, context ?? {});
  } catch (err) {
    if (err?.userFacing) return { error: err.message };
    console.error('Action failed', err);
    return { error: 'Decision Memory hit an unexpected error. Please try again.' };
  }
};

const findingOut = (c) => ({
  key: c.decision.key,
  title: c.decision.title,
  statement: c.decision.statement,
  reason: c.reason,
  confidence: c.confidence,
  evidence: c.evidence?.map((e) => e.snippet),
  ownerAccountId: c.decision.ownerAccountId || undefined,
});

export const searchDecisions = wrap(async (payload) => {
  const results = await svc.searchDecisions(payload.query, {
    includeInactive: toBool(payload.includeInactive),
    limit: clampInt(payload.limit, { min: 1, max: 20, fallback: 8 }),
  });
  return {
    count: results.length,
    decisions: results.map((r) => svc.summarize(r.decision, { relevance: r.score })),
    hint: results.length ? undefined : 'No recorded decision matches. Consider recording one with record-decision.',
  };
});

export const getDecision = wrap(async (payload, context) => {
  const { decision, supersededBy, ownerTeams } = await svc.decisionDetail(payload.key, { accountId: accountIdOf(payload, context) });
  return {
    decision: svc.summarize(decision, { statusReason: decision.statusReason || undefined }),
    supersededBy: supersededBy ? svc.summarize(supersededBy) : undefined,
    ownerTeams: ownerTeams.available ? ownerTeams.teams.map((t) => t.name) : undefined,
  };
});

export const checkConflicts = wrap(async (payload) => {
  const issueKey = issueKeyOf(payload);
  if (payload.diff) {
    const { files, addedLines } = addedDependencyLines(String(payload.diff).slice(0, 1_000_000));
    const r = await svc.checkText([payload.text ?? '', ...addedLines].join('\n') || 'empty');
    return {
      checked: `diff (${files.length} dependency/infra file${files.length === 1 ? '' : 's'}: ${files.slice(0, 10).join(', ') || 'none'})`,
      conflicts: r.conflicts.map(findingOut),
      implements: r.aligned.map((a) => ({ key: a.decision.key, title: a.decision.title, reason: a.reason })),
    };
  }
  if (!payload.text && issueKey) {
    const r = await svc.issueInsights(issueKey);
    return {
      checked: `Jira issue ${r.issue.key}: ${r.issue.summary}`,
      conflicts: r.conflicts.map(findingOut),
      implements: r.aligned.map((a) => ({ key: a.decision.key, title: a.decision.title, reason: a.reason })),
      related: r.related.map((x) => ({ key: x.decision.key, title: x.decision.title })),
    };
  }
  const r = await svc.checkText(payload.text);
  return {
    checked: 'provided text',
    conflicts: r.conflicts.map(findingOut),
    implements: r.aligned.map((a) => ({ key: a.decision.key, title: a.decision.title, reason: a.reason })),
    related: r.related.map((x) => ({ key: x.decision.key, title: x.decision.title })),
  };
});

export const recordDecision = wrap(async (payload, context) => {
  const result = await svc.recordDecision(
    {
      statement: payload.statement,
      title: payload.title,
      rationale: payload.rationale,
      tags: payload.tags,
      avoidTerms: payload.avoidTerms,
      preferTerms: payload.preferTerms,
      reviewBy: payload.reviewBy,
      sourceUrl: payload.sourceUrl || confluenceUrlOf(payload),
      scope: payload.scope,
    },
    {
      accountId: accountIdOf(payload, context),
      sourceType: payload?.context?.confluence ? 'confluence' : 'rovo',
      issueKey: issueKeyOf(payload),
    },
  );
  return {
    recorded: svc.summarize(result.decision),
    alreadyExisted: !result.created || undefined,
    warning: result.contradicts.length
      ? `This new decision contradicts ${result.contradicts.map((c) => c.key).join(', ')}. Ask the user whether to supersede the older decision(s).`
      : undefined,
    contradicts: result.contradicts.length ? result.contradicts : undefined,
    similar: result.similar.length ? result.similar : undefined,
  };
});

export const supersedeDecision = wrap(async (payload, context) => {
  const r = await svc.supersedeDecision(
    payload.key,
    { statement: payload.newStatement, rationale: payload.rationale, title: payload.title },
    { accountId: accountIdOf(payload, context), sourceType: 'rovo' },
  );
  return { newDecision: svc.summarize(r.decision), superseded: svc.summarize(r.superseded) };
});

export const listDueForReview = wrap(async () => {
  const due = await svc.dueForReview();
  return { count: due.length, decisions: due.map((d) => svc.summarize(d)) };
});
