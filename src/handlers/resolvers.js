import Resolver from '@forge/resolver';
import * as svc from '../services/decisionService.js';
import { extractGuardrails } from '../lib/guardrails.js';
import { NeedsAuthenticationError } from '@forge/api';
import { clampInt, ForbiddenError, toBool, ValidationError } from '../lib/validate.js';
import { STATUSES } from '../db/decisions.js';
import { getPageAsUser } from '../services/confluence.js';

/**
 * UI Kit resolvers. Every resolver returns `{ ok: true, data }` or
 * `{ ok: false, error }` so the frontend can render friendly errors.
 */
const resolver = new Resolver();

const define = (name, fn) =>
  resolver.define(name, async (req) => {
    try {
      const data = await fn(req.payload ?? {}, { accountId: req.context?.accountId, context: req.context });
      return { ok: true, data };
    } catch (err) {
      // Let Forge show its "Allow access" consent screen instead of a generic error.
      if (err instanceof NeedsAuthenticationError || err?.name === 'NeedsAuthenticationError') throw err;
      if (err?.userFacing) return { ok: false, error: err.message };
      console.error(`Resolver ${name} failed`, err);
      return { ok: false, error: 'Something went wrong. Please try again.' };
    }
  });

/** The issue key always comes from the platform context when available, not the client. */
const issueKeyFrom = (payload, context) => context?.extension?.issue?.key ?? payload.issueKey;

define('getIssueInsights', async (payload, { context }) => svc.issueInsights(issueKeyFrom(payload, context)));

define('setAlertStatus', async (payload, { accountId, context }) => {
  if (!['acknowledged', 'dismissed', 'open'].includes(payload.status)) throw new ValidationError('Invalid status.');
  return svc.setIssueAlertStatus(issueKeyFrom(payload, context), payload.decisionKey, payload.status, { accountId });
});

define('recordDecision', async (payload, { accountId, context }) => {
  const issueKey = context?.extension?.issue?.key ?? null;
  const r = await svc.recordDecision(payload, { accountId, sourceType: issueKey ? 'jira-issue' : 'manual', issueKey });
  return { decision: r.decision, contradicts: r.contradicts, similar: r.similar };
});

define('previewGuardrails', async (payload) => extractGuardrails(String(payload.statement ?? '').slice(0, 4000)));

define('listDecisions', async (payload) => {
  const status = STATUSES.includes(payload.status) ? payload.status : null;
  const results = await svc.searchDecisions(payload.query, {
    status,
    includeInactive: !status || toBool(payload.includeInactive),
    limit: clampInt(payload.limit, { min: 1, max: 200, fallback: 100 }),
  });
  return results.map((r) => r.decision);
});

define('getDecision', async (payload, { accountId }) => svc.decisionDetail(payload.key, { accountId }));

define('supersedeDecision', async (payload, { accountId }) =>
  svc.supersedeDecision(payload.key, payload, { accountId, sourceType: 'manual' }));

define('revokeDecision', async (payload, { accountId }) => svc.revokeDecision(payload.key, payload.reason, { accountId }));

define('editGuardrails', async (payload, { accountId }) => svc.editGuardrails(payload.key, payload, { accountId }));

define('getStats', async () => svc.dashboardStats());

define('checkText', async (payload) => svc.checkText(payload.text));

define('seedDemo', async (_payload, { accountId }) => svc.seedDemo({ accountId }));

define('previewImport', async (payload) => svc.previewImport(payload.markdown));

define('importDecisions', async (payload, { accountId }) =>
  svc.importDecisions(payload.markdown, payload.ids, { accountId, refPrefix: 'adr' }));

define('getInsights', async () => svc.insights());

define('getSettings', async () => ({ settings: await svc.getSettings(), graph: await svc.graphStatus() }));

define('saveSettings', async (payload, { accountId }) => svc.saveSettings(payload.settings ?? {}, { accountId }));

// ---- Confluence (cross-app): the page id always comes from the platform context.
const pageIdFrom = (context) => context?.extension?.content?.id ?? null;

define('getPageDecisions', async (_payload, { context }) => {
  const pageId = pageIdFrom(context);
  if (!pageId) throw new ValidationError('Open this from a Confluence page.');
  const page = await getPageAsUser(pageId);
  return { page: { id: page.id, title: page.title, url: page.url }, drafts: svc.previewImport(page.markdownish) };
});

define('importFromPage', async (payload, { accountId, context }) => {
  const pageId = pageIdFrom(context);
  if (!pageId) throw new ValidationError('Open this from a Confluence page.');
  const page = await getPageAsUser(pageId); // re-read as the user: authorises access AND is the only content source
  return svc.importDecisions(page.markdownish, payload.ids, {
    accountId,
    sourceUrl: page.url,
    sourceType: 'confluence',
    refPrefix: `confluence:${page.id}`,
  });
});

define('getMacroDecisions', async (_payload, { accountId }) => {
  // Anonymous viewers (public spaces) must not see team decisions.
  if (!accountId) throw new ForbiddenError('Sign in to see team decisions.');
  const results = await svc.searchDecisions('', { limit: 10 });
  return results.map((r) => r.decision);
});

export const handler = resolver.getDefinitions();
