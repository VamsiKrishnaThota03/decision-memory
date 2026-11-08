import { extractDecisions } from './adf.js';

/**
 * Parse Architecture Decision Records (ADRs) written in Markdown — the common
 * Nygard / MADR formats — into decision drafts.
 *
 *   # ADR-007: Use PostgreSQL for new services
 *   ## Status
 *   Accepted
 *   ## Context
 *   ...
 *   ## Decision
 *   We will use PostgreSQL instead of MongoDB.
 *
 * Multiple ADRs can be pasted at once; each top-level heading starts a new one.
 * Plain "Decision: ..." lines are also picked up.
 */

const SECTION_ALIASES = {
  decision: 'decision',
  'decision outcome': 'decision',
  outcome: 'decision',
  resolution: 'decision',
  context: 'context',
  'context and problem statement': 'context',
  problem: 'context',
  consequences: 'consequences',
  rationale: 'rationale',
  'decision drivers': 'rationale',
  status: 'status',
};

const clean = (s) => s.replace(/\r/g, '').replace(/[ \t]+/g, ' ').trim();
const stripMd = (s) =>
  s
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/\*\*|__|`/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/\n{2,}/g, '\n')
    .trim();

function firstParagraph(text, max = 1000) {
  const para = stripMd(text).split('\n').filter(Boolean).join(' ');
  return para.length > max ? `${para.slice(0, max - 1)}…` : para;
}

function mapStatus(text) {
  const t = text.toLowerCase();
  if (/supersed/.test(t)) return 'superseded';
  if (/deprecat|rejected|revoked/.test(t)) return 'revoked';
  if (/propos|draft/.test(t)) return 'proposed';
  return 'active';
}

/**
 * @param {string} markdown
 * @returns {Array<{title: string, statement: string, rationale: string, status: string}>}
 */
export function parseAdrs(markdown) {
  const text = String(markdown ?? '').replace(/\r\n/g, '\n');
  if (!text.trim()) return [];

  // Split into records on top-level ("# ") headings, or treat the whole input as one record.
  const chunks = text.split(/\n(?=#\s)/).filter((c) => c.trim());
  const drafts = [];

  for (const chunk of chunks) {
    const titleMatch = chunk.match(/^#\s+(.+)$/m);
    const rawTitle = titleMatch ? clean(titleMatch[1]) : '';
    const title = rawTitle.replace(/^(?:ADR|RFC)[\s-]*\d+\s*[:.\-–—]\s*/i, '').replace(/^\d+\.\s*/, '');

    const sections = {};
    for (const part of chunk.split(/\n(?=#{2,3}\s)/)) {
      const h = part.match(/^#{2,3}\s+(.+)$/m);
      if (!h) continue;
      const key = SECTION_ALIASES[clean(h[1]).toLowerCase().replace(/[:.]$/, '')];
      if (key) sections[key] = part.slice(part.indexOf('\n') + 1);
    }
    // MADR also uses "Status: accepted" front-matter style lines.
    const statusLine = chunk.match(/^\s*(?:\*\*)?status(?:\*\*)?\s*:\s*(.+)$/im);

    if (!sections.decision) {
      // Meeting notes / pages with native decision blocks: every "Decision:" line is its own decision.
      const loose = extractDecisions(chunk);
      if (loose.length) {
        const context = sections.context ? `Context: ${firstParagraph(sections.context, 1200)}` : title ? `From: ${title}` : '';
        for (const statement of loose) drafts.push({ title: '', statement, rationale: context, status: 'active' });
        continue;
      }
    }
    let statement = sections.decision ? firstParagraph(sections.decision, 1500) : '';
    if (!statement && title && Object.keys(sections).length) statement = title;
    if (!statement || statement.length < 8) continue;

    const rationale = [sections.context && `Context: ${firstParagraph(sections.context, 1200)}`,
      sections.rationale && `Drivers: ${firstParagraph(sections.rationale, 800)}`,
      sections.consequences && `Consequences: ${firstParagraph(sections.consequences, 800)}`]
      .filter(Boolean)
      .join('\n')
      .slice(0, 3900);

    drafts.push({
      title: (title || statement).slice(0, 250),
      statement,
      rationale,
      status: mapStatus(sections.status ? firstParagraph(sections.status, 100) : statusLine?.[1] ?? 'accepted'),
    });
  }

  // Fallback: a page of loose "Decision: ..." lines with no ADR structure.
  if (!drafts.length) {
    for (const statement of extractDecisions(text)) drafts.push({ title: '', statement, rationale: '', status: 'active' });
  }
  return drafts.slice(0, 50);
}
