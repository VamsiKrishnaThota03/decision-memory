import api, { route } from '@forge/api';
import { adfToText } from '../lib/adf.js';

const ISSUE_KEY = /^[A-Z][A-Z0-9_]{0,63}-\d{1,12}$/;

export function isIssueKey(value) {
  return typeof value === 'string' && ISSUE_KEY.test(value);
}

class JiraError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function ok(res, what) {
  if (res.ok) return res.status === 204 ? null : res.json();
  const body = await res.text().catch(() => '');
  throw new JiraError(`${what} failed: ${res.status} ${body.slice(0, 300)}`, res.status);
}

const requester = (asUser) => (asUser ? api.asUser() : api.asApp());

/**
 * Fetch an issue. With `asUser: true` Jira enforces the caller's permissions,
 * which is how we authorise every user-facing read of issue content.
 */
export async function getIssue(issueIdOrKey, { asUser = false } = {}) {
  const res = await requester(asUser).requestJira(
    route`/rest/api/3/issue/${issueIdOrKey}?fields=summary,description,project,labels,status,issuetype,reporter,security`,
    { headers: { Accept: 'application/json' } },
  );
  const issue = await ok(res, 'Get issue');
  return {
    id: issue.id,
    key: issue.key,
    summary: issue.fields?.summary ?? '',
    descriptionText: adfToText(issue.fields?.description),
    projectKey: issue.fields?.project?.key ?? null,
    labels: issue.fields?.labels ?? [],
    status: issue.fields?.status?.name ?? null,
    issueType: issue.fields?.issuetype?.name ?? null,
    reporterAccountId: issue.fields?.reporter?.accountId ?? null,
    hasSecurityLevel: Boolean(issue.fields?.security),
  };
}

/** True if the current user can see the issue (404/403 → false). */
export async function userCanBrowse(issueKey) {
  if (!isIssueKey(issueKey)) return false;
  const res = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}?fields=summary`, {
    headers: { Accept: 'application/json' },
  });
  return res.ok;
}

export async function getComment(issueIdOrKey, commentId) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/comment/${commentId}`, {
    headers: { Accept: 'application/json' },
  });
  return ok(res, 'Get comment');
}

export async function addComment(issueIdOrKey, adfBody) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueIdOrKey}/comment`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ body: adfBody }),
  });
  return ok(res, 'Add comment');
}

export async function addLabel(issueIdOrKey, label) {
  const res = await api.asApp().requestJira(route`/rest/api/3/issue/${issueIdOrKey}?notifyUsers=false`, {
    method: 'PUT',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ update: { labels: [{ add: label }] } }),
  });
  return ok(res, 'Add label');
}

/** Jira global ADMINISTER permission for the current user. */
export async function userIsJiraAdmin() {
  const res = await api.asUser().requestJira(route`/rest/api/3/mypermissions?permissions=ADMINISTER`, {
    headers: { Accept: 'application/json' },
  });
  if (!res.ok) return false;
  const body = await res.json();
  return Boolean(body?.permissions?.ADMINISTER?.havePermission);
}

let baseUrlCache = null;
export async function getSiteBaseUrl() {
  if (baseUrlCache) return baseUrlCache;
  const res = await api.asApp().requestJira(route`/rest/api/3/serverInfo`, { headers: { Accept: 'application/json' } });
  const info = await ok(res, 'Server info');
  baseUrlCache = String(info.baseUrl ?? '').replace(/\/$/, '');
  return baseUrlCache;
}

/** Best link for a decision: its source, else the Jira issue it came from. */
export function decisionUrl(baseUrl, decision) {
  if (decision.sourceUrl && /^https:\/\//i.test(decision.sourceUrl)) return decision.sourceUrl;
  if (decision.issueKey) return `${baseUrl}/browse/${decision.issueKey}`;
  return baseUrl;
}
