import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractGuardrails, resolveGuardrails } from '../src/lib/guardrails.js';

test('instead-of pattern yields prefer + avoid', () => {
  const g = extractGuardrails('We will use PostgreSQL instead of MongoDB for all new services.');
  assert.deepEqual(g.prefer, ['postgresql']);
  assert.deepEqual(g.avoid, ['mongodb']);
});

test('negative statements yield avoid terms', () => {
  const g = extractGuardrails('Do not deploy to production on Fridays. We will no longer support the v1 REST API.');
  assert.ok(g.avoid.includes('production (on fridays)'), JSON.stringify(g));
  assert.ok(g.avoid.some((a) => a.includes('v1 rest api')), JSON.stringify(g));
});

test('"no X" pattern', () => {
  const g = extractGuardrails('No feature flags in the payments service.');
  assert.ok(g.avoid.includes('feature flags (in payments service)'), JSON.stringify(g));
});

test('deprecate pattern', () => {
  const g = extractGuardrails('Deprecate the legacy Jenkins pipelines by Q3.');
  assert.ok(g.avoid.some((a) => a.includes('legacy jenkins')), JSON.stringify(g));
});

test('standardise on pattern yields prefer', () => {
  const g = extractGuardrails('All teams must standardize on GitHub Actions.');
  assert.ok(g.prefer.includes('github actions'), JSON.stringify(g));
});

test('manual terms are merged first and deduplicated', () => {
  const g = resolveGuardrails('Use Postgres over DynamoDB.', { avoidTerms: 'Dynamo, DynamoDB', preferTerms: [] });
  assert.equal(g.avoid[0], 'Dynamo');
  assert.deepEqual(g.avoid, ['Dynamo']); // Dynamo and DynamoDB are aliases
  assert.deepEqual(g.prefer, ['postgres']);
});

test('empty input is safe', () => {
  assert.deepEqual(extractGuardrails(''), { avoid: [], prefer: [] });
  assert.deepEqual(extractGuardrails(undefined), { avoid: [], prefer: [] });
});

test('splitTerm parses scoped terms', async () => {
  const { splitTerm } = await import('../src/lib/guardrails.js');
  assert.deepEqual(splitTerm('feature flags (in payments service)'), { main: 'feature flags', context: 'payments service' });
  assert.deepEqual(splitTerm('mongodb'), { main: 'mongodb', context: '' });
});

test('API keys decision', () => {
  const g = extractGuardrails('All public APIs must use OAuth 2.0 instead of API keys.');
  assert.ok(g.prefer.includes('oauth 2.0'), JSON.stringify(g));
  assert.ok(g.avoid.includes('api keys'), JSON.stringify(g));
});

test('no junk guardrails from prepositions, reasons or passives', () => {
  assert.deepEqual(extractGuardrails('We will not deploy on Fridays.').avoid, ['deploy (on fridays)']);
  assert.deepEqual(extractGuardrails('Code freeze before release.').avoid, []);
  const reason = extractGuardrails('Use Postgres because MongoDB cannot scale');
  assert.ok(!reason.avoid.includes('scale'), JSON.stringify(reason));
  const passive = extractGuardrails('Feature flags must not be used in the payments service.');
  assert.deepEqual(passive.avoid, ['feature flags (in payments service)']);
  assert.deepEqual(extractGuardrails('Do not use MongoDB anywhere.').avoid, ['mongodb']);
});

test('manual short terms like "Go" are kept', () => {
  assert.deepEqual(resolveGuardrails('Keep services simple.', { avoidTerms: 'Go' }).avoid, ['Go']);
});
