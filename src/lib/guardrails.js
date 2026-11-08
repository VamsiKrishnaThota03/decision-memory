import { parseList, rawTokens, termTokens } from './text.js';

/**
 * Guardrails are the machine-checkable part of a decision:
 *   - avoid:  things the team decided NOT to do / use ("MongoDB", "production (on fridays)")
 *   - prefer: things the team decided TO do / use instead ("Postgres")
 *
 * A term may carry a scope qualifier in parentheses — "feature flags (in payments service)" —
 * which new work must also mention for the guardrail to apply. Terms are extracted
 * heuristically and are editable, so the system stays explainable and costs nothing to run.
 */

const STOPPERS = String.raw`instead|over|rather|versus|vs\.?|for|in|on|at|because|since|until|unless|when|while|so|as|to|from|by|within|across|anymore|any\s+more|anywhere|ever|again|whatsoever|altogether|going\s+forward|from\s+now|after|before|during|due|given|if|and\s+(?:we|instead)|but|without|unless`;
/** A stopper at the very start of the clause, or after whitespace. */
const PHRASE_STOP = new RegExp(String.raw`(?:^|\s+)(${STOPPERS})\b(.*)$`, 'i');

const QUALIFIER_PREPS = new Set(['in', 'within', 'for', 'across', 'on']);
const TIME_WORDS = /\b(?:mon|tues|wednes|thurs|fri|satur|sun)days?\b|\bweekends?\b|\bholidays?\b|\bfreeze\b/i;
/** Scopes too generic to narrow a rule ("for all new services" ≈ everywhere). */
export const GENERIC_SCOPE = new Set([
  'service', 'project', 'everything', 'team', 'code', 'app', 'system', 'product', 'repo', 'repository',
  'work', 'use', 'case', 'now', 'future', 'feature', 'component', 'new', 'all', 'any', 'every', 'our',
  'the', 'of', 'existing', 'thing', 'purpose',
]);
/** Terms made only of these words carry no meaning on their own. */
const GENERIC_TERM = new Set([
  'be', 'us', 'use', 'used', 'it', 'this', 'that', 'them', 'thing', 'anything', 'everything', 'something',
  'anywhere', 'anymore', 'stuff', 'way', 'one', 'scale', 'change', 'work', 'do', 'done', 'make', 'have',
  'allow', 'allowed', 'support', 'add', 'more', 'less', 'other', 'it\'s', 'there', 'here', 'so', 'such',
  'get', 'need', 'longer',
]).add('the').add('a').add('an');

const LEADING_FILLER = /^(?:the|any|a|an|our|new|more|further|all|using|use|of)\s+/i;

const NEGATIVE = String.raw`(?:do\s+not|don't|dont|never|won't|will\s+not|must\s+not|mustn't|should\s+not|shouldn't|shall\s+not|cannot|can't|no\s+longer|are\s+not\s+(?:going\s+to|allowed\s+to)|stop|avoid|ban|banned|prohibit|forbid|deprecate|deprecating|deprecated|sunset|sunsetting|retire|retiring|drop|dropping|reject|rejected|decommission|phase\s+out|phasing\s+out|freeze)`;

const ACTION = String.raw`(?:use|using|adopt|adopting|add|adding|introduce|introducing|build(?:ing)?\s+on|deploy(?:ing)?(?:\s+to)?|support(?:ing)?|rely(?:ing)?\s+on|call(?:ing)?|ship(?:ping)?|run(?:ning)?|store|storing|depend(?:ing)?\s+on|integrat(?:e|ing)\s+with|merge|merging|create|creating|allow(?:ing)?|accept(?:ing)?)`;

const POSITIVE = String.raw`(?:use|adopt|choose|chose|chosen|select|selected|standardi[sz]e\s+on|go\s+with|prefer|move\s+to|migrate\s+to|switch\s+to|keep|stick\s+with|build\s+on|consolidate\s+on|require)`;

const RE_INSTEAD = new RegExp(
  String.raw`\b(?:we\s+(?:will|shall|should|must)\s+)?${POSITIVE}\s+(.+?)\s+(?:instead\s+of|over|rather\s+than|in\s+place\s+of|not)\s+((?:[^.;:\n]|\.(?=\S))+)`,
  'gi',
);
// "(?!be\b)" leaves passive phrasing ("must not be used") to RE_PASSIVE.
const RE_NEGATIVE = new RegExp(String.raw`\b${NEGATIVE}\s+(?!be\b)(?:(${ACTION})\s+)?((?:[^.;:\n]|\.(?=\S))+)`, 'gi');
const RE_PASSIVE = /(?:^|[;:\n]\s*|\.\s+)([a-z0-9](?:[^.;:\n]|\.(?=\S)){0,60}?)\s+(?:must|should|shall|will|can|may|is|are)(?:\s+not|n't)\s+(?:be\s+)?(?:used|allowed|introduced|added|deployed|adopted|permitted|merged|shipped)\b((?:[^.;:\n]|\.(?=\S))*)/gi;
const RE_NO = /\bno\s+(?!longer\b|one\b|more\b|need\b|change\b|decision\b)([a-z0-9](?:[^.;:\n]|\.(?=\S)){1,60})/gi;
const RE_IMPERATIVE = new RegExp(String.raw`(?:^|[.;:\n]\s*|\band\s+)${POSITIVE}\s+((?:[^.;:\n]|\.(?=\S))+)`, 'gi');
const RE_POSITIVE = new RegExp(String.raw`\b(?:we\s+(?:will|shall|should|must)\s+|all\s+\w+\s+(?:must|should)\s+)${POSITIVE}\s+((?:[^.;:\n]|\.(?=\S))+)`, 'gi');
/** Reasons are rationale, not rules: "…because MongoDB cannot scale" must not create a guardrail. */
const REASON_CLAUSE = /\b(?:because|since|as|given\s+that|due\s+to|so\s+that)\b(?:[^.;\n]|\.(?=\S))*/gi;

function stripFiller(text) {
  let out = text.trim();
  for (let i = 0; i < 3; i += 1) out = out.replace(LEADING_FILLER, '');
  return out;
}

const isMeaningful = (phrase) => termTokens(phrase).some((t) => !GENERIC_TERM.has(t));

/**
 * Shrink a captured clause to its key noun phrase (max 4 words), keeping a short,
 * specific scope qualifier when present:
 *   "production on Fridays"                 -> "production (on fridays)"
 *   "feature flags in the payments service" -> "feature flags (in payments service)"
 *   "MongoDB for all new services"          -> "mongodb"   (generic scope dropped)
 */
export function cleanPhrase(raw, { qualify = true } = {}) {
  let s = String(raw ?? '')
    .replace(/[“”"'`()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  let qualifier = '';
  const stop = s.match(PHRASE_STOP);
  if (stop) {
    const prep = stop[1].toLowerCase();
    const rest = ` ${stop[2] ?? ''}`.replace(PHRASE_STOP, '').replace(/,.*$/, '');
    if (qualify && QUALIFIER_PREPS.has(prep) && (prep !== 'on' || TIME_WORDS.test(rest))) {
      const q = rawTokens(stripFiller(rest)).slice(0, 3).join(' ');
      if (termTokens(q).some((t) => !GENERIC_SCOPE.has(t))) qualifier = `${prep} ${q}`;
    }
    s = s.slice(0, stop.index);
  }
  s = stripFiller(s).replace(/,.*$/, '').trim();
  const phrase = rawTokens(s).slice(0, 4).join(' ');
  if (!phrase || !isMeaningful(phrase)) return '';
  return qualifier ? `${phrase} (${qualifier})` : phrase;
}

/** Split "main (in scope)" into its parts. */
export function splitTerm(term) {
  const m = String(term ?? '').match(/^(.*?)\s*\((?:in|within|for|across|on)\s+([^)]+)\)\s*$/i);
  return m ? { main: m[1], context: m[2] } : { main: String(term ?? ''), context: '' };
}

/** Identity of a term for de-duplication and cross-decision comparison. */
export const termKey = (term) => termTokens(splitTerm(term).main).join(' ');

function addUnique(list, phrase, options) {
  const p = cleanPhrase(phrase, options);
  if (p && !list.some((x) => termKey(x) === termKey(p))) list.push(p);
}

/**
 * @param {string} statement decision text
 * @returns {{avoid: string[], prefer: string[]}}
 */
export function extractGuardrails(statement) {
  const text = String(statement ?? '').replace(REASON_CLAUSE, '');
  const avoid = [];
  const prefer = [];

  for (const m of text.matchAll(RE_INSTEAD)) {
    addUnique(prefer, m[1], { qualify: false });
    addUnique(avoid, m[2]);
  }
  for (const m of text.matchAll(RE_PASSIVE)) addUnique(avoid, `${m[1]}${m[2] ?? ''}`);
  for (const m of text.matchAll(RE_NEGATIVE)) {
    const verb = (m[1] ?? '').replace(/\s+(?:to|on|with)$/i, '');
    // "Do not deploy on Fridays": the object is only a scope, so the verb becomes the guardrail.
    if (cleanPhrase(m[2])) addUnique(avoid, m[2]);
    else if (verb) addUnique(avoid, `${verb} ${m[2]}`);
  }
  for (const m of text.matchAll(RE_NO)) addUnique(avoid, m[1]);
  const avoidKeys = () => new Set(avoid.map(termKey));
  for (const m of [...text.matchAll(RE_POSITIVE), ...text.matchAll(RE_IMPERATIVE)]) {
    const p = cleanPhrase(m[1], { qualify: false });
    if (p && !avoidKeys().has(termKey(p))) addUnique(prefer, p, { qualify: false });
  }
  // A term can't be both preferred and avoided — avoid wins (safer).
  const keys = avoidKeys();
  return {
    avoid: avoid.slice(0, 10),
    prefer: prefer.filter((p) => !keys.has(termKey(p))).slice(0, 10),
  };
}

/** Merge human-supplied guardrails with extracted ones (human input first, never filtered). */
export function resolveGuardrails(statement, { avoidTerms, preferTerms } = {}) {
  const auto = extractGuardrails(statement);
  const merge = (a, b) => {
    const out = [];
    for (const t of [...a, ...b]) {
      if (termKey(t) && !out.some((x) => termKey(x) === termKey(t))) out.push(t);
    }
    return out.slice(0, 15);
  };
  return {
    avoid: merge(parseList(avoidTerms), auto.avoid),
    prefer: merge(parseList(preferTerms), auto.prefer),
  };
}
