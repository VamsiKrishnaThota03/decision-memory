import { sql } from '@forge/sql';
import { ensureSchema } from './schema.js';

/** Site-wide app settings (admin page) and internal state such as the Teamwork Graph connection. */
export const DEFAULT_SETTINGS = Object.freeze({
  autoComment: true, // post a comment when new work conflicts
  minSeverity: 'medium', // 'medium' | 'high' — lowest severity that triggers an automatic comment
  addLabel: true, // add the decision-conflict label
  captureFromComments: true, // capture "Decision: ..." comments
  checkComments: true, // check new comments for conflicts, not just issue text
  reviewReminders: true, // daily reminder on decisions past their review date
  quietAfterDismissals: 3, // after N dismissals (more than acknowledgements) only HIGH severity auto-comments
});

const SETTINGS_KEY = 'settings';

async function getRaw(key) {
  await ensureSchema();
  const r = await sql.prepare('SELECT setting_value FROM app_settings WHERE setting_key = ?').bindParams(key).execute();
  if (!r.rows[0]) return null;
  try {
    return JSON.parse(r.rows[0].setting_value);
  } catch {
    return null;
  }
}

async function setRaw(key, value, accountId = null) {
  await ensureSchema();
  await sql
    .prepare(
      `INSERT INTO app_settings (setting_key, setting_value, updated_by) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    )
    .bindParams(key, JSON.stringify(value), accountId)
    .execute();
}

async function deleteRaw(key) {
  await ensureSchema();
  await sql.prepare('DELETE FROM app_settings WHERE setting_key = ?').bindParams(key).execute();
}

/** Validate & coerce settings so stored values are always well-formed. */
export function sanitizeSettings(input = {}) {
  const out = { ...DEFAULT_SETTINGS };
  for (const k of ['autoComment', 'addLabel', 'captureFromComments', 'checkComments', 'reviewReminders']) {
    if (typeof input[k] === 'boolean') out[k] = input[k];
  }
  if (input.minSeverity === 'high' || input.minSeverity === 'medium') out.minSeverity = input.minSeverity;
  const q = Number.parseInt(input.quietAfterDismissals, 10);
  if (Number.isInteger(q) && q >= 1 && q <= 50) out.quietAfterDismissals = q;
  return out;
}

export async function getSettings() {
  return sanitizeSettings((await getRaw(SETTINGS_KEY)) ?? {});
}

export async function saveSettings(input, accountId) {
  const clean = sanitizeSettings(input);
  await setRaw(SETTINGS_KEY, clean, accountId);
  return clean;
}

// ---- Teamwork Graph connections (set by the graph:connector onConnectionChange hook)
const GRAPH_KEY = 'graph-connections';

export async function getGraphConnections() {
  const v = await getRaw(GRAPH_KEY);
  return Array.isArray(v) ? v : [];
}

export async function upsertGraphConnection(connectionId, name) {
  const list = (await getGraphConnections()).filter((c) => c.connectionId !== connectionId);
  list.push({ connectionId, name: String(name ?? '').slice(0, 100), connectedAt: new Date().toISOString() });
  await setRaw(GRAPH_KEY, list.slice(-5));
}

export async function removeGraphConnection(connectionId) {
  const list = (await getGraphConnections()).filter((c) => c.connectionId !== connectionId);
  if (list.length) await setRaw(GRAPH_KEY, list);
  else await deleteRaw(GRAPH_KEY);
}
