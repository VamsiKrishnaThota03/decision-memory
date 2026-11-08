import * as repo from '../db/decisions.js';
import * as alerts from '../db/alerts.js';
import { ensureSchema } from '../db/schema.js';
import { getSettings, removeGraphConnection, upsertGraphConnection } from '../db/settings.js';
import { adfToText, buildCapturedComment, buildConflictComment, buildReviewReminderComment, extractDecisions } from '../lib/adf.js';
import { assess } from '../lib/conflicts.js';
import { resolveGuardrails } from '../lib/guardrails.js';
import { validateDecisionInput } from '../lib/validate.js';
import { syncDecisions } from '../services/graphSync.js';
import { addComment, addLabel, decisionUrl, getComment, getIssue, getSiteBaseUrl } from '../services/jira.js';
import { filterForIssue } from '../services/projects.js';

export const CONFLICT_LABEL = 'decision-conflict';
const WATCHED_FIELDS = new Set(['summary', 'description']);

/**
 * Apply admin settings and the dismissal-learning loop: a decision whose alerts
 * keep getting dismissed only auto-comments on HIGH severity until its
 * guardrails are refined.
 */
async function alertable(conflicts, settings) {
  if (!conflicts.length) return [];
  const outcomes = await alerts.alertOutcomesByDecision();
  return conflicts.filter((c) => {
    const o = outcomes.get(c.decision.id);
    const noisy = o && o.dismissed >= settings.quietAfterDismissals && o.dismissed > o.acknowledged;
    const minSeverity = noisy ? 'high' : settings.minSeverity;
    return minSeverity === 'medium' || c.severity === 'high';
  });
}

/** Shared path: check text on an issue, record NEW alerts, comment + label once. */
async function checkAndAlert(issue, text, settings) {
  const corpus = filterForIssue(await repo.listAllDecisions(), issue.projectKey);
  const candidates = corpus.filter((d) => d.issueKey !== issue.key); // an issue's own decisions aren't conflicts
  const { conflicts } = assess(text, candidates);
  const eligible = await alertable(conflicts, settings);
  if (!eligible.length) return [];

  const fresh = await alerts.recordAlerts(issue.key, eligible);
  if (!fresh.length) return [];

  if (settings.autoComment) {
    const baseUrl = await getSiteBaseUrl();
    await addComment(issue.id, buildConflictComment(fresh, (d) => decisionUrl(baseUrl, d)));
  }
  if (settings.addLabel && !issue.labels.includes(CONFLICT_LABEL)) await addLabel(issue.id, CONFLICT_LABEL);
  console.log(`Flagged ${issue.key}: ${fresh.map((c) => c.decision.key).join(', ')}`);
  return fresh;
}

/**
 * avi:jira:created:issue / avi:jira:updated:issue
 * Proactively checks new or re-scoped work against recorded decisions.
 */
export async function onIssueEvent(event) {
  try {
    const issueId = event?.issue?.id ?? event?.issue?.key;
    if (!issueId) return;
    if (event?.changelog?.items && !event.changelog.items.some((i) => WATCHED_FIELDS.has(i.field))) return;

    const [issue, settings] = await Promise.all([getIssue(issueId), getSettings()]);
    await checkAndAlert(issue, `${issue.summary}\n${issue.descriptionText}`, settings);
  } catch (err) {
    console.error('onIssueEvent failed', err);
  }
}

/**
 * avi:jira:commented:issue
 * 1. Captures decisions written in comments (native /decision blocks or "Decision: ...").
 * 2. Otherwise, checks the comment for drift ("let's just use Mongo here").
 */
export async function onCommentEvent(event) {
  try {
    const issueId = event?.issue?.id;
    const commentId = event?.comment?.id;
    if (!issueId || !commentId) return;

    const comment = await getComment(issueId, commentId);
    if (comment?.author?.accountType === 'app') return; // never react to bots (incl. ourselves)
    // Restricted comments (role/group visibility) must not become project-wide knowledge.
    if (comment?.visibility) return;

    const [issue, settings] = await Promise.all([getIssue(issueId), getSettings()]);
    // Issues behind a security level are visible to fewer people than the project.
    if (issue.hasSecurityLevel) return;

    const statements = settings.captureFromComments ? extractDecisions(comment.body) : [];
    if (!statements.length) {
      if (settings.checkComments) await checkAndAlert(issue, adfToText(comment.body), settings);
      return;
    }

    const baseUrl = await getSiteBaseUrl();
    const captured = [];
    for (const [i, statement] of statements.slice(0, 10).entries()) {
      let v;
      try {
        v = validateDecisionInput({ statement });
      } catch {
        continue; // skip lines that are too short / too long
      }
      const g = resolveGuardrails(v.statement);
      const { decision, created } = await repo.insertDecision({
        ...v,
        avoidTerms: g.avoid,
        preferTerms: g.prefer,
        rationale: `Captured from a comment on ${issue.key}: ${issue.summary}`.slice(0, 4000),
        ownerAccountId: comment.author?.accountId ?? null,
        createdBy: comment.author?.accountId ?? 'app',
        sourceType: 'jira-comment',
        sourceRef: `jira-comment:${commentId}:${i}`,
        sourceUrl: `${baseUrl}/browse/${issue.key}?focusedCommentId=${commentId}`,
        issueKey: issue.key,
        projectKey: issue.projectKey, // comment-captured decisions are project-scoped (see services/projects.js)
      });
      if (created) captured.push(decision);
    }
    if (captured.length) {
      await addComment(issue.id, buildCapturedComment(captured, (d) => decisionUrl(baseUrl, d)));
    }
  } catch (err) {
    console.error('onCommentEvent failed', err);
  }
}

/**
 * Daily scheduled trigger: remind owners about decisions past their review date,
 * on the issue the decision came from (at most once a week per decision).
 */
export async function onDailyReview() {
  try {
    const settings = await getSettings();
    if (!settings.reviewReminders) return;
    const due = await repo.listNeedingReminder(new Date().toISOString().slice(0, 10));
    if (!due.length) return;
    const baseUrl = await getSiteBaseUrl();
    for (const d of due) {
      if (d.issueKey) {
        try {
          await addComment(d.issueKey, buildReviewReminderComment(d, decisionUrl(baseUrl, d)));
        } catch (err) {
          console.warn(`Reminder for ${d.key} could not be posted`, err?.message);
        }
      }
      await repo.markReminded(d.id); // also marks decisions without an issue (shown in the Decision Log)
    }
    console.log(`Review reminders: ${due.map((d) => d.key).join(', ')}`);
  } catch (err) {
    console.error('onDailyReview failed', err);
  }
}

/** avi:forge:installed:app / avi:forge:upgraded:app */
export async function onLifecycle() {
  try {
    await ensureSchema();
    console.log('Decision Memory schema ready');
  } catch (err) {
    console.error('Schema migration failed (will retry lazily)', err);
  }
}

// ---------------------------------------------------------------- Teamwork Graph connector

/** graph:connector validateConnection — nothing external to validate; the app is its own source. */
export async function validateGraphConnection() {
  return { success: true, message: 'Decision Memory will publish site-wide decisions to the Teamwork Graph.' };
}

/** graph:connector onConnectionChange — remember the connection, then backfill all decisions. */
export async function onGraphConnectionChange(request) {
  try {
    const { action, connectionId } = request ?? {};
    const name = request?.configProperties?.label || request?.name || '';
    if (!connectionId) return { success: false, message: 'Missing connection id.' };
    if (action === 'DELETED') {
      await removeGraphConnection(connectionId);
      return { success: true, message: 'Disconnected.' };
    }
    await upsertGraphConnection(connectionId, name);
    const all = await repo.listAllDecisions({ includeInactive: true });
    const result = await syncDecisions(all, { backfill: true });
    return { success: true, message: `Published ${result.synced ?? 0} decisions.` };
  } catch (err) {
    console.error('onGraphConnectionChange failed', err);
    return { success: false, message: 'Connection change failed.' };
  }
}
