import { migrationRunner, sql } from '@forge/sql';

/**
 * Forge SQL schema. Every statement is idempotent and migrations are append-only:
 * never edit an existing entry — add a new one.
 */
const MIGRATIONS = [
  [
    'v001_create_decisions',
    `CREATE TABLE IF NOT EXISTS decisions (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      statement TEXT NOT NULL,
      rationale TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'active',
      owner_account_id VARCHAR(128),
      created_by VARCHAR(128) NOT NULL,
      source_type VARCHAR(32) NOT NULL,
      source_url VARCHAR(1024),
      source_ref VARCHAR(255),
      issue_key VARCHAR(64),
      project_key VARCHAR(64),
      tags TEXT,
      avoid_terms TEXT,
      prefer_terms TEXT,
      superseded_by BIGINT,
      status_reason TEXT,
      review_by DATE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_decisions_source_ref (source_ref),
      KEY idx_decisions_status (status),
      KEY idx_decisions_issue (issue_key),
      KEY idx_decisions_project (project_key)
    )`,
  ],
  [
    'v002_create_decision_alerts',
    `CREATE TABLE IF NOT EXISTS decision_alerts (
      id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
      issue_key VARCHAR(64) NOT NULL,
      decision_id BIGINT NOT NULL,
      confidence DOUBLE,
      reason TEXT,
      status VARCHAR(16) NOT NULL DEFAULT 'open',
      resolved_by VARCHAR(128),
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_alerts_issue_decision (issue_key, decision_id),
      KEY idx_alerts_status (status),
      KEY idx_alerts_decision (decision_id)
    )`,
  ],
  [
    'v003_create_settings',
    `CREATE TABLE IF NOT EXISTS app_settings (
      setting_key VARCHAR(64) NOT NULL PRIMARY KEY,
      setting_value TEXT NOT NULL,
      updated_by VARCHAR(128),
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`,
  ],
  ['v004_decisions_last_reminded', 'ALTER TABLE decisions ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMP NULL'],
  ['v005_alerts_created_index', 'CREATE INDEX IF NOT EXISTS idx_alerts_created ON decision_alerts (created_at)'],
  // Human-facing sequential number (DEC-1, DEC-2…). TiDB AUTO_INCREMENT ids are not consecutive.
  ['v006_decisions_num', 'ALTER TABLE decisions ADD COLUMN IF NOT EXISTS num BIGINT NULL'],
  ['v007_decisions_num_unique', 'CREATE UNIQUE INDEX IF NOT EXISTS uq_decisions_num ON decisions (num)'],
];

let ready = null;

async function runMigrations() {
  let runner = migrationRunner;
  for (const [name, ddl] of MIGRATIONS) runner = runner.enqueue(name, ddl);
  await runner.run();
  await backfillNumbers();
}

/** Give every decision without a number the next sequential one (oldest first). Idempotent. */
async function backfillNumbers() {
  const r = await sql.prepare('SELECT id FROM decisions WHERE num IS NULL ORDER BY id ASC LIMIT 5000').execute();
  for (const row of r.rows) await assignNumber(Number(row.id));
}

/**
 * Assign MAX(num)+1 to a decision. The unique index makes concurrent assignment safe:
 * a collision fails and is retried with a fresh MAX.
 */
export async function assignNumber(id) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      await sql
        .prepare(
          `UPDATE decisions SET num = (SELECT next_num FROM (SELECT COALESCE(MAX(num), 0) + 1 AS next_num FROM decisions) AS t)
           WHERE id = ? AND num IS NULL`,
        )
        .bindParams(id)
        .execute();
      return;
    } catch (err) {
      if (attempt === 5) throw err;
    }
  }
}

/**
 * Ensure the schema exists. Called from the install/upgrade lifecycle trigger,
 * and lazily (once per warm runtime) before any data access, so the app works
 * immediately after install without waiting for a scheduled job.
 */
export function ensureSchema() {
  if (!ready) {
    ready = runMigrations().catch((err) => {
      ready = null; // allow retry on the next invocation
      throw err;
    });
  }
  return ready;
}
