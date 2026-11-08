import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAdrs } from '../src/lib/adr.js';
import { extractGuardrails } from '../src/lib/guardrails.js';
import { assess } from '../src/lib/conflicts.js';
import { resolveGuardrails } from '../src/lib/guardrails.js';

const MD = `# ADR-001: Use PostgreSQL for new services

## Status
Accepted

## Context
We run three databases and the on-call load is high.

## Decision
We will use **PostgreSQL** instead of MongoDB for all new services.

## Consequences
Teams need Postgres training.

# ADR-002: Old idea
## Status
Superseded by ADR-001
## Decision
Use MongoDB for everything.
`;

test('parses multiple Nygard-style ADRs', () => {
  const adrs = parseAdrs(MD);
  assert.equal(adrs.length, 2);
  assert.equal(adrs[0].title, 'Use PostgreSQL for new services');
  assert.equal(adrs[0].statement, 'We will use PostgreSQL instead of MongoDB for all new services.');
  assert.match(adrs[0].rationale, /on-call load/);
  assert.equal(adrs[0].status, 'active');
  assert.equal(adrs[1].status, 'superseded');
});

test('falls back to Decision: lines', () => {
  assert.deepEqual(parseAdrs('notes\nDecision: Ship the v2 API behind OAuth.\n').map((a) => a.statement), [
    'Ship the v2 API behind OAuth.',
  ]);
});

test('empty input', () => {
  assert.deepEqual(parseAdrs(''), []);
});

test('aliases: pg / postgres / mongo map to the same technology', () => {
  const d = { id: 1, key: 'DEC-1', title: 't', statement: 's', status: 'active', ...(() => {
    const g = resolveGuardrails('Use Postgres instead of Mongo.');
    return { avoidTerms: g.avoid, preferTerms: g.prefer };
  })() };
  assert.ok(assess('Add a MongoDB replica set', [d]).conflicts.length === 1);
  assert.ok(assess('Move the service to PostgreSQL', [d]).aligned.length === 1);
});

test('verb guardrails: "do not deploy on Fridays"', () => {
  const g = extractGuardrails('We will not deploy on Fridays.');
  assert.deepEqual(g.avoid, ['deploy (on fridays)']);
  const d = { id: 2, key: 'DEC-2', title: 'No Friday deploys', statement: 'x', status: 'active', avoidTerms: g.avoid, preferTerms: [] };
  assert.equal(assess('Deploy the billing hotfix on Friday evening', [d]).conflicts.length, 1);
  assert.equal(assess('Deploy the billing hotfix on Tuesday', [d]).conflicts.length, 0);
});

test('Confluence pages with several decision blocks yield several drafts', async () => {
  const { adfToMarkdownish } = await import('../src/services/confluence.js');
  const doc = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Architecture sync' }] },
      { type: 'decisionList', content: [
        { type: 'decisionItem', attrs: { state: 'DECIDED' }, content: [{ type: 'text', text: 'Use Kafka for event streaming.' }] },
        { type: 'decisionItem', attrs: { state: 'DECIDED' }, content: [{ type: 'text', text: 'Do not use RabbitMQ for new services.' }] },
      ] },
    ],
  };
  const md = adfToMarkdownish(doc, 'Meeting notes 2026-11-01');
  const drafts = parseAdrs(md);
  assert.deepEqual(drafts.map((d) => d.statement), ['Use Kafka for event streaming.', 'Do not use RabbitMQ for new services.']);
  assert.match(drafts[0].rationale, /Architecture sync/);
});

test('a Confluence page holding several ADRs yields one draft per ADR', async () => {
  const { adfToMarkdownish } = await import('../src/services/confluence.js');
  const h = (level, t) => ({ type: 'heading', attrs: { level }, content: [{ type: 'text', text: t }] });
  const p = (t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] });
  const doc = { type: 'doc', content: [
    h(1, 'ADR-1: Database'), h(2, 'Decision'), p('Use PostgreSQL instead of MongoDB.'),
    h(1, 'ADR-2: CI'), h(2, 'Status'), p('Proposed'), h(2, 'Decision'), p('Use GitHub Actions instead of Jenkins.'),
  ] };
  const drafts = parseAdrs(adfToMarkdownish(doc, 'Architecture decisions'));
  assert.deepEqual(drafts.map((d) => [d.title, d.status]), [['Database', 'active'], ['CI', 'proposed']]);
});

test('dots inside tech names are not sentence boundaries', async () => {
  const { assess } = await import('../src/lib/conflicts.js');
  const g = extractGuardrails('Do not use Node.js for CPU-heavy services.');
  assert.ok(g.avoid.some((a) => a.startsWith('node.js')), JSON.stringify(g));
  const d = { id: 9, key: 'DEC-9', title: 'x', statement: 'x', status: 'active', avoidTerms: g.avoid, preferTerms: [] };
  assert.equal(assess('Add a node to the Kubernetes node pool', [d]).conflicts.length, 0);
  assert.equal(assess('Rewrite the CPU-heavy image resizer in Node.js', [d]).conflicts.length, 1);
});
