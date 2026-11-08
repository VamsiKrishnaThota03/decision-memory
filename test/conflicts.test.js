import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assess, search } from '../src/lib/conflicts.js';
import { resolveGuardrails } from '../src/lib/guardrails.js';

function decision(id, statement, extra = {}) {
  const g = resolveGuardrails(statement, extra);
  return {
    id,
    key: `DEC-${id}`,
    title: statement.slice(0, 60),
    statement,
    rationale: extra.rationale ?? '',
    tags: extra.tags ?? [],
    status: extra.status ?? 'active',
    avoidTerms: g.avoid,
    preferTerms: g.prefer,
  };
}

const decisions = [
  decision(1, 'We will use PostgreSQL instead of MongoDB for all new services.', {
    rationale: 'Operational cost and transactional guarantees.',
    tags: ['database'],
  }),
  decision(2, 'Do not use feature flags in the payments service.', { tags: ['payments'] }),
  decision(3, 'Deprecate the legacy Jenkins pipelines; use GitHub Actions.', { tags: ['ci'] }),
  decision(4, 'No Redis caching in the auth service.', { status: 'superseded' }),
  decision(5, 'Do not deploy to production on Fridays.'),
];

test('scoped guardrails need their scope: plain production work is fine', () => {
  const r = assess('Deploy the billing hotfix to production', decisions);
  assert.ok(!r.conflicts.some((c) => c.decision.id === 5), JSON.stringify(r.conflicts));
});

test('scoped guardrails fire when scope matches', () => {
  const r = assess('Schedule production release on Friday evening', decisions);
  assert.ok(r.conflicts.some((c) => c.decision.id === 5), JSON.stringify(r.conflicts));
});

test('feature flags outside payments are fine', () => {
  const r = assess('Add feature flags to the onboarding wizard', decisions);
  assert.ok(!r.conflicts.some((c) => c.decision.id === 2));
});

test('flags work that adopts a rejected technology', () => {
  const r = assess('Add MongoDB cluster for the new recommendations service', decisions);
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].decision.id, 1);
  assert.match(r.conflicts[0].reason, /mongodb/);
  assert.ok(r.conflicts[0].evidence[0].snippet.includes('mongodb'));
});

test('work that moves AWAY from the rejected thing is aligned, not a conflict', () => {
  const r = assess('Migrate off MongoDB to PostgreSQL in the orders service', decisions);
  assert.equal(r.conflicts.length, 0);
  assert.equal(r.aligned[0].decision.id, 1);
});

test('using the preferred option is aligned', () => {
  const r = assess('Set up GitHub Actions workflow for the web app', decisions);
  assert.equal(r.conflicts.length, 0);
  assert.ok(r.aligned.some((a) => a.decision.id === 3));
});

test('superseded decisions never raise conflicts', () => {
  const r = assess('Introduce Redis caching in auth service login path', decisions);
  assert.ok(!r.conflicts.some((c) => c.decision.id === 4));
});

test('multi-word guardrails match with small gaps', () => {
  const r = assess('Wrap the payments service checkout in feature flags so we can roll out gradually', decisions);
  assert.ok(r.conflicts.some((c) => c.decision.id === 2), JSON.stringify(r.conflicts));
});

test('unrelated work produces nothing', () => {
  const r = assess('Fix typo on the marketing landing page', decisions);
  assert.deepEqual([r.conflicts.length, r.aligned.length, r.related.length], [0, 0, 0]);
});

test('search ranks by relevance and supports DEC keys', () => {
  const results = search('which database do we use', decisions);
  assert.equal(results[0].decision.id, 1);
  const byKey = search('tell me about DEC-3', decisions);
  assert.equal(byKey[0].decision.id, 3);
});

test('migrating TO a rejected technology is a conflict, not alignment', () => {
  for (const text of [
    'Migrate from Postgres to MongoDB',
    'Move from PostgreSQL to MongoDB',
    'Replace PostgreSQL with MongoDB',
    'Not sure yet, but MongoDB looks good for recommendations',
  ]) {
    const r = assess(text, decisions);
    assert.ok(r.conflicts.some((c) => c.decision.id === 1), `${text}: ${JSON.stringify(r)}`);
  }
});

test('negation close to the term means moving away', () => {
  const r = assess('We should not add MongoDB here; use PostgreSQL', decisions);
  assert.ok(!r.conflicts.some((c) => c.decision.id === 1));
});

test('hyphenated compounds and short tech names match', () => {
  const extra = [...decisions, decision(6, "Don't use Go for new services.")];
  assert.ok(assess('Build a MongoDB-backed cache', extra).conflicts.some((c) => c.decision.id === 1));
  assert.ok(assess('Rewrite the importer in Go', extra).conflicts.some((c) => c.decision.id === 6));
});

test('MongoDB is flagged even when the work is not called a "service"', () => {
  const r = assess('Add a MongoDB cluster for the recommendations engine', decisions);
  assert.ok(r.conflicts.some((c) => c.decision.id === 1));
});

test('contradicting decisions are detected both ways', async () => {
  const { findContradictions } = await import('../src/lib/conflicts.js');
  const existing = [decision(10, 'Use MongoDB for analytics.')];
  const found = findContradictions(resolveGuardrails('Do not use MongoDB.'), existing);
  assert.equal(found.length, 1);
  assert.match(found[0].reason, /mongodb/i);
});

test('explicit adoption is high confidence', () => {
  const r = assess('Add MongoDB cluster for recommendations service', decisions);
  assert.equal(r.conflicts[0].severity, 'high');
});
