import { Bm25Index } from './bm25.js';
import { GENERIC_SCOPE, splitTerm, termKey } from './guardrails.js';
import { canonical, rawTokens, termTokens } from './text.js';

/**
 * Conflict engine: given a piece of new work (issue summary + description,
 * PR text, a proposal...) and the team's decisions, explain which decisions
 * it CONFLICTS with, which it IMPLEMENTS, and which are merely RELATED.
 *
 * Deterministic and explainable: every finding carries the exact evidence
 * (term + snippet) that triggered it. Rovo is used on top for nuanced
 * reasoning in chat, but automatic alerts never depend on a paid LLM call.
 */

/** Clause boundaries: intent never carries across them ("Not sure yet, but MongoDB looks good"). */
const CLAUSE_SPLIT = /[;:!?,\n()[\]]+|\.(?=\s|$)|\s[-–—]\s|\bbut\b|\bhowever\b|\bwhereas\b/i;

/** Words skipped when looking for the verb that governs a term ("remove the legacy MongoDB"). */
const FILLER = new Set([
  'the', 'a', 'an', 'our', 'all', 'any', 'legacy', 'old', 'existing', 'current', 'remaining', 'deprecated',
  'entire', 'whole', 'this', 'that', 'these', 'those', 'its', 'their', 'my', 'your', 'outdated', 'unused',
]);
const AWAY_WORDS = new Set(['off', 'from', 'away', 'without', 'no', 'not', 'never', "don't", 'dont', 'avoid', 'avoiding', 'stop', 'stopping']);
const AWAY_VERB = /^(?:remov|drop|deprecat|replac|delet|decommission|sunset|retir|eliminat|disabl|kill|unwind|purg|uninstall|strip|ditch|abandon)/;
const AWAY_PAIRS = new Set(['rid of', 'instead of', 'rather than', 'phase out', 'phasing out', 'rip out', 'ripping out', 'clean up', 'cleaning up', 'turn off', 'turning off', 'out of']);
/** "from X to TERM", "replace X with TERM", "migrate onto TERM": the work goes TOWARDS the term. */
const TOWARDS_WORDS = new Set(['to', 'with', 'onto', 'into']);
const NEGATIONS = new Set(['not', 'never', "don't", 'dont', 'no', 'without', "won't", 'cannot', "can't", "shouldn't", "mustn't", 'avoid', 'stop']);
const NEGATION_WINDOW = 3;
const SNIPPET_WINDOW = 6;

/** @returns {Array<{raw: string[], stemmed: string[]}>} */
function toClauses(text) {
  return String(text ?? '')
    .split(CLAUSE_SPLIT)
    .map((c) => {
      // Keep raw and canonical tokens aligned 1:1 so intent words can be inspected around each hit.
      const raw = [];
      const stemmed = [];
      for (const t of rawTokens(c).flatMap((x) => x.split('-')).filter(Boolean)) {
        for (const part of canonical(t).split('-')) {
          raw.push(t);
          stemmed.push(part);
        }
      }
      return { raw, stemmed };
    })
    .filter((c) => c.raw.length);
}

/** Verbs that clearly mean "we are adopting / building with this". */
const ADOPT_VERB = /^(?:add|use|using|introduc|adopt|deploy|build|set|spin|provision|migrat|mov|switch|integrat|implement|creat|install|enabl|run|ship|launch|configur|wrap|rewrit|port)/;

/** Is the governing verb an explicit adoption ("Add MongoDB", "migrate to MongoDB")? */
function adopts(raw, start) {
  let i = start - 1;
  while (i >= 0 && (FILLER.has(raw[i]) || TOWARDS_WORDS.has(raw[i]) || raw[i] === 'up' || raw[i] === 'new')) i -= 1;
  return i >= 0 && ADOPT_VERB.test(raw[i]);
}

/** Is the work moving AWAY from the term at `start` (removing, replacing, not using it)? */
function movesAway(raw, start) {
  let i = start - 1;
  while (i >= 0 && FILLER.has(raw[i])) i -= 1;
  if (i < 0) return false;
  const w = raw[i];
  if (TOWARDS_WORDS.has(w)) return false;
  if (i > 0 && AWAY_PAIRS.has(`${raw[i - 1]} ${w}`)) return true;
  if (AWAY_WORDS.has(w) || AWAY_VERB.test(w)) return true;
  for (let j = Math.max(0, start - NEGATION_WINDOW); j < start; j += 1) if (NEGATIONS.has(raw[j])) return true;
  return false;
}

function findTermHits(term, clauses, allStemmed) {
  const { main, context } = splitTerm(term);
  const wanted = termTokens(main);
  if (!wanted.length) return [];
  // Scoped guardrails ("feature flags (in payments)") only apply when the scope is mentioned too.
  // Generic scope words ("services", "projects") don't narrow anything, so they aren't required.
  const scope = termTokens(context).filter((t) => !CONTEXT_NOISE.has(t) && !GENERIC_SCOPE.has(t));
  if (scope.length && !scope.every((t) => allStemmed.has(t))) return [];
  const hits = [];
  for (const { raw, stemmed } of clauses) {
    for (let i = 0; i < stemmed.length; i += 1) {
      if (stemmed[i] !== wanted[0]) continue;
      // Remaining tokens must appear in order within a small window ("redis cluster" ~ "redis ha cluster").
      let j = i + 1;
      let k = 1;
      const limit = Math.min(stemmed.length, i + wanted.length + 3);
      while (k < wanted.length && j < limit) {
        if (stemmed[j] === wanted[k]) k += 1;
        j += 1;
      }
      if (k !== wanted.length) continue;
      const end = Math.max(i + 1, j);
      const snippet = [
        i > SNIPPET_WINDOW ? '…' : '',
        raw.slice(Math.max(0, i - SNIPPET_WINDOW), Math.min(raw.length, end + SNIPPET_WINDOW)).join(' '),
        end + SNIPPET_WINDOW < raw.length ? '…' : '',
      ].join('');
      hits.push({ away: movesAway(raw, i), adopt: adopts(raw, i), snippet: snippet.trim() });
    }
  }
  return hits;
}

const CONTEXT_NOISE = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'all', 'any', 'new', 'our']);

function buildIndex(decisions) {
  return new Bm25Index(
    decisions.map((d) => ({
      id: d.id,
      fields: {
        title: d.title,
        statement: d.statement,
        rationale: d.rationale ?? '',
        tags: (d.tags ?? []).join(' '),
        guardrails: [...(d.avoidTerms ?? []), ...(d.preferTerms ?? [])].join(' '),
      },
    })),
    { title: 3, statement: 2, rationale: 1, tags: 2, guardrails: 2 },
  );
}

/**
 * @param {string} text
 * @param {Array<object>} decisions domain decisions (see db/decisions.js toDomain)
 * @param {{relatedLimit?: number, minRelatedScore?: number}} options
 */
export function assess(text, decisions, { relatedLimit = 5, minRelatedScore = 2.5 } = {}) {
  const active = decisions.filter((d) => d.status === 'active');
  const clauses = toClauses(text);
  const allStemmed = new Set(clauses.flatMap((c) => c.stemmed));
  const empty = { conflicts: [], aligned: [], related: [] };
  if (!clauses.length || !active.length) return empty;

  const index = buildIndex(active);
  const ranking = index.search(text, { limit: active.length });
  const relevance = new Map(ranking.map((r) => [r.id, r]));

  const conflicts = [];
  const aligned = [];

  for (const decision of active) {
    const towards = [];
    const away = [];
    for (const term of decision.avoidTerms ?? []) {
      for (const hit of findTermHits(term, clauses, allStemmed)) {
        (hit.away ? away : towards).push({ term, snippet: hit.snippet, adopt: hit.adopt });
      }
    }
    const preferHits = [];
    for (const term of decision.preferTerms ?? []) {
      for (const hit of findTermHits(term, clauses, allStemmed)) {
        if (!hit.away) preferHits.push({ term, snippet: hit.snippet });
      }
    }
    const rel = relevance.get(decision.id);
    const relScore = rel?.score ?? 0;

    if (towards.length) {
      const distinctTerms = new Set(towards.map((t) => t.term)).size;
      const base = towards.some((t) => t.adopt) ? 0.8 : 0.6; // explicit "add/use/migrate to X" is a strong signal
      const confidence = Math.min(0.99, base + 0.1 * (distinctTerms - 1) + Math.min(0.15, relScore / 20));
      conflicts.push({
        decision,
        confidence: Number(confidence.toFixed(2)),
        severity: confidence >= 0.75 ? 'high' : 'medium',
        evidence: dedupeEvidence(towards),
        reason: `Mentions ${quoteList(towards.map((t) => t.term))}, which ${decision.key} rules out.`,
      });
    } else if (away.length || preferHits.length) {
      aligned.push({
        decision,
        evidence: dedupeEvidence([...away, ...preferHits]),
        reason: away.length
          ? `Moves away from ${quoteList(away.map((t) => t.term))}, as ${decision.key} requires.`
          : `Uses ${quoteList(preferHits.map((t) => t.term))}, as ${decision.key} prescribes.`,
      });
    }
  }

  const flagged = new Set([...conflicts, ...aligned].map((c) => c.decision.id));
  const byId = new Map(active.map((d) => [d.id, d]));
  const related = ranking
    .filter((r) => !flagged.has(r.id) && r.score >= minRelatedScore && r.matched.length >= 2)
    .slice(0, relatedLimit)
    .map((r) => ({ decision: byId.get(r.id), score: Number(r.score.toFixed(2)), matched: r.matched }));

  conflicts.sort((a, b) => b.confidence - a.confidence);
  return { conflicts, aligned, related };
}

/** Rank decisions for a free-text question (used by search action & UI). */
export function search(query, decisions, { limit = 8, includeInactive = false } = {}) {
  const pool = includeInactive ? decisions : decisions.filter((d) => d.status === 'active');
  if (!pool.length) return [];
  const byId = new Map(pool.map((d) => [d.id, d]));
  const keyMatch = String(query ?? '').match(/\bDEC-(\d+)\b/i);
  const results = buildIndex(pool)
    .search(query, { limit })
    .map((r) => ({ decision: byId.get(r.id), score: Number(r.score.toFixed(2)), matched: r.matched }));
  if (keyMatch) {
    const exact = pool.find((d) => d.key.toUpperCase() === `DEC-${keyMatch[1]}`);
    if (exact && !results.some((r) => r.decision.id === exact.id)) {
      results.unshift({ decision: exact, score: 99, matched: [`dec-${exact.id}`] });
    }
  }
  return results.slice(0, limit);
}

function dedupeEvidence(items) {
  const seen = new Set();
  return items.filter((e) => {
    const k = `${e.term}|${e.snippet}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  }).slice(0, 5);
}

function quoteList(terms) {
  const unique = [...new Set(terms)];
  const quoted = unique.map((t) => `"${t}"`);
  if (quoted.length <= 1) return quoted.join('');
  return `${quoted.slice(0, -1).join(', ')} and ${quoted.at(-1)}`;
}

/**
 * Does a NEW decision contradict existing ones? Compares guardrails both ways:
 * the new decision avoids what an existing one prefers, or prefers what it avoids.
 * @param {{avoid: string[], prefer: string[]}} guardrails of the new decision
 */
export function findContradictions(guardrails, decisions) {
  const newAvoid = new Map(guardrails.avoid.map((t) => [termKey(t), t]));
  const newPrefer = new Map(guardrails.prefer.map((t) => [termKey(t), t]));
  const out = [];
  for (const d of decisions) {
    if (d.status !== 'active') continue;
    const clashes = [];
    for (const t of d.preferTerms ?? []) if (newAvoid.has(termKey(t))) clashes.push(`rules out "${newAvoid.get(termKey(t))}", which ${d.key} prescribes`);
    for (const t of d.avoidTerms ?? []) if (newPrefer.has(termKey(t))) clashes.push(`prescribes "${newPrefer.get(termKey(t))}", which ${d.key} rules out`);
    if (clashes.length) out.push({ decision: d, reason: `The new decision ${clashes.join('; ')}.` });
  }
  return out;
}
