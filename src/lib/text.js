/**
 * Text normalisation utilities shared by search, guardrail extraction and
 * conflict detection. Pure functions: no Forge APIs, fully unit-testable.
 */

const STOPWORDS = new Set(
  `a an and are as at be been being but by can could did do does doing for from
   had has have having he her here hers him his how i if in into is it its itself
   just me more most my no nor not of off on once only or other our ours out over
   own same she should so some such than that the their theirs them then there
   these they this those through to too under until up very was we were what when
   where which while who whom why will with would you your yours also all any
   each few both again further about above after against before below between
   during let lets let's us via per etc eg ie new need needs want wants please
   will shall may might must going go get got make made team teams`
    .split(/\s+/)
    .filter(Boolean),
);

/** Words that must survive tokenisation because they carry intent. */
const INTENT_WORDS = new Set(['no', 'not', 'never', 'stop', 'avoid']);

/**
 * Common technology aliases, mapped to one canonical token so "Postgres", "pg"
 * and "PostgreSQL" are the same thing to search and conflict detection.
 */
const ALIASES = new Map(Object.entries({
  postgres: 'postgresql', pg: 'postgresql', psql: 'postgresql', pgsql: 'postgresql',
  mongo: 'mongodb', dynamo: 'dynamodb', ddb: 'dynamodb',
  k8s: 'kubernetes', kube: 'kubernetes',
  js: 'javascript', ts: 'typescript', golang: 'go', py: 'python',
  es: 'elasticsearch', elastic: 'elasticsearch',
  mssql: 'sqlserver', gql: 'graphql', tf: 'terraform',
  gha: 'github-action', jenkin: 'jenkins',
  prod: 'production', stg: 'staging', fri: 'friday', fridays: 'friday',
  apis: 'api', svc: 'service', svcs: 'service', microservice: 'service', microservices: 'service',
  ff: 'feature-flag',
}));

/** Canonical token: alias resolution, then conservative stemming. */
export function canonical(token) {
  return ALIASES.get(token) ?? ALIASES.get(stem(token)) ?? stem(token);
}

/**
 * Very small, conservative suffix stripper. We deliberately avoid aggressive
 * stemming so that product names (e.g. "redis", "kafka") are not mangled.
 */
export function stem(token) {
  if (token.length <= 4 || /[\d.+#]/.test(token)) return token; // node.js, c++, c# stay intact
  if (token.endsWith('ies') && token.length > 5) return `${token.slice(0, -3)}y`;
  if (token.endsWith('ing') && token.length > 6) return token.slice(0, -3);
  if (token.endsWith('ed') && token.length > 5) return token.slice(0, -2);
  if (token.endsWith('es') && /(sses|xes|ches|shes)$/.test(token)) return token.slice(0, -2);
  if (token.endsWith('s') && !token.endsWith('ss') && !token.endsWith('us')) return token.slice(0, -1);
  return token;
}

/** Split raw text into lower-case word tokens (keeps tech names like c++, c#, node.js). */
export function rawTokens(text) {
  if (!text) return [];
  return String(text)
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .match(/[a-z0-9][a-z0-9+#]*(?:[.'-][a-z0-9+#]+)*/g) ?? [];
}

/** Tokens used for relevance scoring: stopwords removed, stemmed. */
export function tokenize(text, { keepIntent = false } = {}) {
  return rawTokens(text)
    .filter((t) => (keepIntent && INTENT_WORDS.has(t)) || (!STOPWORDS.has(t) && t.length > 1))
    .flatMap((t) => canonical(t).split('-'));
}

const ARTICLES = new Set(['the', 'a', 'an', 'any', 'our', 'all']);

/**
 * Tokens used for guardrail matching. Unlike `tokenize`, nothing meaningful is
 * dropped: short tech names ("Go", "C", "R") survive, and hyphenated compounds
 * are split so "MongoDB-backed" matches "mongodb".
 */
export function matchTokens(text) {
  return rawTokens(text)
    .flatMap((t) => t.split('-'))
    .filter(Boolean)
    .flatMap((t) => canonical(t).split('-'));
}

/** Canonical key of a guardrail phrase (articles removed). */
export function termTokens(phrase) {
  return matchTokens(phrase).filter((t) => !ARTICLES.has(t));
}

/** Normalise a free-text term/phrase into its canonical token sequence. */
export function normalizePhrase(phrase) {
  return tokenize(phrase).join(' ');
}

/** Parse "a, b ,c" or ["a","b"] into a de-duplicated array of trimmed strings. */
export function parseList(value, { max = 20, maxLen = 60 } = {}) {
  const items = Array.isArray(value) ? value : String(value ?? '').split(/[,;\n]/);
  const out = [];
  const seen = new Set();
  for (const item of items) {
    const v = String(item ?? '').trim().slice(0, maxLen);
    const k = v.toLowerCase();
    if (v && !seen.has(k)) {
      seen.add(k);
      out.push(v);
    }
    if (out.length >= max) break;
  }
  return out;
}

/** First sentence (or truncated text) suitable as a title. */
export function deriveTitle(statement, maxLen = 120) {
  const clean = String(statement ?? '').replace(/\s+/g, ' ').trim();
  const firstSentence = clean.split(/(?<=[.!?])\s/)[0] ?? clean;
  const base = firstSentence.replace(/[.!?]+$/, '');
  return base.length > maxLen ? `${base.slice(0, maxLen - 1).trimEnd()}…` : base;
}

export function truncate(text, maxLen) {
  const s = String(text ?? '');
  return s.length > maxLen ? `${s.slice(0, maxLen - 1)}…` : s;
}
