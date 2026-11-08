import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ValidationError, validateDecisionInput, validateUrl, validateDate } from '../src/lib/validate.js';
import { parseTeams } from '../src/services/teamworkGraph.js';

test('derives title and normalises whitespace', () => {
  const v = validateDecisionInput({ statement: '  Use   Postgres instead of Mongo.  Because ops.', tags: 'DB, db, Backend' });
  assert.equal(v.statement, 'Use Postgres instead of Mongo. Because ops.');
  assert.equal(v.title, 'Use Postgres instead of Mongo');
  assert.deepEqual(v.tags, ['db', 'backend']);
});

test('rejects too-short statements', () => {
  assert.throws(() => validateDecisionInput({ statement: 'no' }), ValidationError);
});

test('only https links are accepted', () => {
  assert.equal(validateUrl(''), null);
  assert.throws(() => validateUrl('javascript:alert(1)'), ValidationError);
  assert.throws(() => validateUrl('http://example.com'), ValidationError);
  assert.equal(validateUrl('https://example.atlassian.net/wiki/x'), 'https://example.atlassian.net/wiki/x');
});

test('dates must be YYYY-MM-DD', () => {
  assert.equal(validateDate('2027-01-31'), '2027-01-31');
  assert.throws(() => validateDate('31/01/2027'), ValidationError);
});

test('parseTeams reads cypherQuery list nodes and de-duplicates', () => {
  const body = {
    data: {
      cypherQuery: {
        edges: [
          {
            node: {
              columns: [
                {
                  key: 'teams',
                  value: {
                    __typename: 'CypherQueryResultListNode',
                    nodes: [
                      { data: { __typename: 'AtlassianTeam', id: 't1', displayName: 'Platform' } },
                      { data: { __typename: 'AtlassianTeam', id: 't1', displayName: 'Platform' } },
                      { data: { __typename: 'AtlassianTeam', id: 't2', displayName: 'Payments' } },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  };
  assert.deepEqual(parseTeams(body), [
    { id: 't1', name: 'Platform' },
    { id: 't2', name: 'Payments' },
  ]);
  assert.deepEqual(parseTeams({}), []);
});
