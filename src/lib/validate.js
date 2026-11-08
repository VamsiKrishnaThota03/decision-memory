import { deriveTitle, parseList } from './text.js';

export class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'ValidationError';
    this.userFacing = true;
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'You do not have permission to do that.') {
    super(message);
    this.name = 'ForbiddenError';
    this.userFacing = true;
  }
}

export class NotFoundError extends Error {
  constructor(message = 'Not found.') {
    super(message);
    this.name = 'NotFoundError';
    this.userFacing = true;
  }
}

const str = (v) => (v == null ? '' : String(v)).trim();

function requireLength(name, value, { min = 0, max }) {
  if (value.length < min) throw new ValidationError(`${name} must be at least ${min} characters.`);
  if (value.length > max) throw new ValidationError(`${name} must be at most ${max} characters.`);
  return value;
}

export function validateDate(value) {
  const v = str(value);
  if (!v) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(new Date(`${v}T00:00:00Z`).getTime())) {
    throw new ValidationError('Review date must be in YYYY-MM-DD format.');
  }
  return v;
}

export function validateUrl(value) {
  const v = str(value);
  if (!v) return null;
  let url;
  try {
    url = new URL(v);
  } catch {
    throw new ValidationError('Source link must be a valid URL.');
  }
  if (url.protocol !== 'https:') throw new ValidationError('Source link must use https.');
  return requireLength('Source link', url.toString(), { max: 1024 });
}

/** Normalise + validate user/agent input for a new decision. */
export function validateDecisionInput(input = {}) {
  const statement = requireLength('Decision', str(input.statement).replace(/\s+/g, ' '), { min: 8, max: 4000 });
  const title = requireLength('Title', str(input.title) || deriveTitle(statement), { min: 3, max: 255 });
  const rationale = requireLength('Rationale', str(input.rationale), { max: 4000 });
  return {
    statement,
    title,
    rationale,
    tags: parseList(input.tags, { max: 10, maxLen: 40 }).map((t) => t.toLowerCase()),
    avoidTerms: parseList(input.avoidTerms, { max: 15, maxLen: 60 }),
    preferTerms: parseList(input.preferTerms, { max: 15, maxLen: 60 }),
    reviewBy: validateDate(input.reviewBy),
    sourceUrl: validateUrl(input.sourceUrl),
  };
}

export function clampInt(value, { min, max, fallback }) {
  const n = Number.parseInt(value, 10);
  if (Number.isNaN(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function toBool(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}
