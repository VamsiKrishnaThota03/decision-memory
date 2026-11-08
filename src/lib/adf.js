/**
 * Atlassian Document Format (ADF) helpers: read text, extract decisions,
 * and build the comments Decision Memory posts back to Jira.
 */

const BLOCK_TYPES = new Set([
  'paragraph', 'heading', 'listItem', 'bulletList', 'orderedList', 'blockquote',
  'codeBlock', 'panel', 'decisionItem', 'taskItem', 'tableCell', 'tableHeader', 'rule',
]);

/** Flatten ADF (or a plain string) into readable text. */
export function adfToText(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  const parts = [];
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'text' && typeof n.text === 'string') parts.push(n.text);
    else if (n.type === 'hardBreak') parts.push('\n');
    else if (n.type === 'mention') parts.push(n.attrs?.text ?? '');
    else if (n.type === 'inlineCard' || n.type === 'blockCard') parts.push(n.attrs?.url ?? '');
    else if (n.type === 'emoji') parts.push(n.attrs?.text ?? '');
    if (Array.isArray(n.content)) n.content.forEach(walk);
    if (BLOCK_TYPES.has(n.type)) parts.push('\n');
  };
  walk(node);
  return parts.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** "Decision: ...", "Decided - ...", "We decided: ...", "ADR: ..." */
const MARKER = /^\s*(?:\*\*)?(?:decision|decided|we\s+decided|final\s+decision|adr)(?:\*\*)?\s*[:\-–—]\s*(.+)$/i;

/**
 * Extract decisions from ADF content. Supports:
 *  1. Native Atlassian decision blocks (`/decision` in the editor) marked DECIDED.
 *  2. Lines that start with a "Decision:" style marker.
 * @returns {string[]} decision statements in document order
 */
export function extractDecisions(doc) {
  const found = [];
  const add = (s) => {
    const clean = String(s ?? '').replace(/\s+/g, ' ').trim();
    if (clean.length >= 8 && !found.includes(clean)) found.push(clean);
  };
  const walk = (n) => {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'decisionItem') {
      if ((n.attrs?.state ?? 'DECIDED') === 'DECIDED') add(adfToText(n));
      return;
    }
    if (n.type === 'paragraph' || n.type === 'heading') {
      for (const line of adfToText(n).split('\n')) {
        const m = line.match(MARKER);
        if (m) add(m[1]);
      }
      return;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  if (typeof doc === 'string') {
    for (const line of doc.split('\n')) {
      const m = line.match(MARKER);
      if (m) add(m[1]);
    }
  } else {
    walk(doc);
  }
  return found;
}

// ---------- ADF builders ----------

const text = (t, marks) => (marks ? { type: 'text', text: t, marks } : { type: 'text', text: t });
const strong = (t) => text(t, [{ type: 'strong' }]);
const link = (t, href) => text(t, [{ type: 'link', attrs: { href } }]);
const paragraph = (...content) => ({ type: 'paragraph', content: content.filter(Boolean) });
const mention = (accountId) => ({ type: 'mention', attrs: { id: accountId } });

/**
 * Comment posted when new work conflicts with recorded decisions.
 * @param {Array<{decision: object, reason: string, severity: string}>} conflicts
 * @param {(decision) => string} urlFor
 */
export function buildConflictComment(conflicts, urlFor) {
  const items = conflicts.map((c) => ({
    type: 'listItem',
    content: [
      paragraph(
        link(c.decision.key, urlFor(c.decision)),
        text(' — '),
        strong(c.decision.title),
        text(` (${c.severity} confidence)`),
      ),
      paragraph(text(c.reason)),
      c.evidence?.[0]?.snippet ? paragraph(text('Evidence: '), text(`“${c.evidence[0].snippet}”`, [{ type: 'em' }])) : null,
      c.decision.rationale ? paragraph(text('Why it was decided: '), text(c.decision.rationale.slice(0, 300))) : null,
      c.decision.ownerAccountId
        ? paragraph(text('Decision owner: '), mention(c.decision.ownerAccountId))
        : null,
    ].filter(Boolean),
  }));
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'panel',
        attrs: { panelType: 'warning' },
        content: [
          paragraph(strong('Decision Memory: this work may conflict with a team decision')),
          { type: 'bulletList', content: items },
          paragraph(
            text('If the decision still stands, align this work with it. If things have changed, supersede the decision so everyone knows. Open the '),
            strong('Decision Memory'),
            text(' panel on this issue to acknowledge or dismiss.'),
          ),
        ],
      },
    ],
  };
}

/** Short confirmation reply when decisions are captured from a comment. */
export function buildCapturedComment(decisions, urlFor) {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'panel',
        attrs: { panelType: 'success' },
        content: [
          paragraph(
            strong('Decision Memory'),
            text(` captured ${decisions.length === 1 ? 'a decision' : `${decisions.length} decisions`}: `),
            ...decisions.flatMap((d, i) => [
              i ? text(', ') : null,
              link(`${d.key} ${d.title}`, urlFor(d)),
            ]).filter(Boolean),
          ),
          paragraph(text('Future issues that contradict it will be flagged automatically.')),
        ],
      },
    ],
  };
}

/** Weekly reminder on the source issue when a decision passes its review date. */
export function buildReviewReminderComment(decision, url) {
  return {
    type: 'doc',
    version: 1,
    content: [
      {
        type: 'panel',
        attrs: { panelType: 'note' },
        content: [
          paragraph(
            strong('Decision Memory: time to revisit '),
            link(`${decision.key} ${decision.title}`, url),
          ),
          paragraph(text(`This decision was due for review on ${decision.reviewBy}. Does it still hold?`)),
          decision.ownerAccountId ? paragraph(text('Owner: '), mention(decision.ownerAccountId)) : null,
          paragraph(text('Keep it (set a new review date), supersede it, or revoke it from the Decision Log.')),
        ].filter(Boolean),
      },
    ],
  };
}
