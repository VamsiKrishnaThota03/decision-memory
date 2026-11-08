import { test } from 'node:test';
import assert from 'node:assert/strict';
import { adfToText, buildConflictComment, extractDecisions } from '../src/lib/adf.js';

const doc = {
  type: 'doc',
  version: 1,
  content: [
    { type: 'paragraph', content: [{ type: 'text', text: 'Discussed DB options with the team.' }] },
    {
      type: 'decisionList',
      attrs: { localId: 'a' },
      content: [
        { type: 'decisionItem', attrs: { localId: 'b', state: 'DECIDED' }, content: [{ type: 'text', text: 'Use PostgreSQL instead of MongoDB.' }] },
        { type: 'decisionItem', attrs: { localId: 'c', state: 'UNDECIDED' }, content: [{ type: 'text', text: 'Maybe adopt Kafka later' }] },
      ],
    },
    { type: 'paragraph', content: [{ type: 'text', text: 'Decision: no Friday deploys to production.' }] },
  ],
};

test('adfToText flattens content', () => {
  const t = adfToText(doc);
  assert.match(t, /Discussed DB options/);
  assert.match(t, /PostgreSQL/);
});

test('extracts DECIDED decision items and marker lines only', () => {
  assert.deepEqual(extractDecisions(doc), [
    'Use PostgreSQL instead of MongoDB.',
    'no Friday deploys to production.',
  ]);
});

test('extracts from plain text', () => {
  assert.deepEqual(extractDecisions('hello\nDecided - Ship the v2 API behind auth\nbye'), ['Ship the v2 API behind auth']);
});

test('ignores comments without decisions', () => {
  assert.deepEqual(extractDecisions({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'LGTM' }] }] }), []);
});

test('conflict comment is valid-looking ADF', () => {
  const adf = buildConflictComment(
    [{ decision: { key: 'DEC-1', title: 'Use Postgres', ownerAccountId: 'abc' }, reason: 'Mentions "mongodb".', severity: 'high' }],
    (d) => `https://example.atlassian.net/${d.key}`,
  );
  assert.equal(adf.type, 'doc');
  assert.equal(adf.content[0].type, 'panel');
  const json = JSON.stringify(adf);
  assert.match(json, /DEC-1/);
  assert.match(json, /"mention"/);
});
