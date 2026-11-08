import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addedDependencyLines } from '../src/lib/diff.js';
import { assess } from '../src/lib/conflicts.js';
import { resolveGuardrails } from '../src/lib/guardrails.js';

const DIFF = `diff --git a/package.json b/package.json
index 1..2 100644
--- a/package.json
+++ b/package.json
@@ -10,6 +10,7 @@
   "dependencies": {
+    "mongodb": "^6.3.0",
     "express": "^4.18.0"
-    "pg": "^8.0.0"
diff --git a/src/db.js b/src/db.js
--- a/src/db.js
+++ b/src/db.js
@@ -1 +1 @@
+// TODO: remove mongodb later
diff --git a/Jenkinsfile b/Jenkinsfile
new file mode 100644
--- /dev/null
+++ b/Jenkinsfile
@@ -0,0 +1 @@
+pipeline { agent any }
`;

test('only added lines in dependency/infra files are kept', () => {
  const r = addedDependencyLines(DIFF);
  assert.deepEqual(r.files, ['package.json', 'Jenkinsfile']);
  assert.ok(r.addedLines.some((l) => l.includes('mongodb')));
  assert.ok(!r.addedLines.some((l) => l.includes('TODO')));
  assert.ok(r.addedLines.includes('add Jenkinsfile'));
});

test('a PR adding the mongodb driver conflicts with "Postgres instead of Mongo"', () => {
  const g = resolveGuardrails('Use PostgreSQL instead of MongoDB for all new services.');
  const d = { id: 1, key: 'DEC-1', title: 'Postgres', statement: 's', status: 'active', avoidTerms: g.avoid, preferTerms: g.prefer };
  const r = assess(addedDependencyLines(DIFF).addedLines.join('\n'), [d]);
  assert.equal(r.conflicts.length, 1);
});
