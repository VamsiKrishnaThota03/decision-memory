import { tokenize } from './text.js';

/**
 * Okapi BM25 ranking over an in-memory corpus. The corpus for a single site is
 * small (hundreds to low thousands of decisions), so ranking in the function
 * is fast and costs nothing beyond normal Forge compute — no vector DB or paid
 * embedding API required.
 */
export class Bm25Index {
  /**
   * @param {Array<{id: any, fields: Record<string,string>}>} docs
   * @param {Record<string, number>} fieldWeights repeat-weighting per field
   */
  constructor(docs, fieldWeights = {}, { k1 = 1.2, b = 0.75 } = {}) {
    this.k1 = k1;
    this.b = b;
    this.docs = docs.map((doc) => {
      const tf = new Map();
      let length = 0;
      for (const [field, text] of Object.entries(doc.fields)) {
        const weight = fieldWeights[field] ?? 1;
        for (const token of tokenize(text)) {
          tf.set(token, (tf.get(token) ?? 0) + weight);
          length += weight;
        }
      }
      return { id: doc.id, tf, length };
    });
    this.avgLength = this.docs.reduce((s, d) => s + d.length, 0) / (this.docs.length || 1);
    this.df = new Map();
    for (const d of this.docs) {
      for (const token of d.tf.keys()) this.df.set(token, (this.df.get(token) ?? 0) + 1);
    }
  }

  idf(token) {
    const n = this.docs.length;
    const df = this.df.get(token) ?? 0;
    return Math.log(1 + (n - df + 0.5) / (df + 0.5));
  }

  /**
   * @returns {Array<{id:any, score:number, matched:string[]}>} sorted desc
   */
  search(query, { limit = 10, minScore = 0 } = {}) {
    const qTokens = [...new Set(tokenize(query))];
    if (!qTokens.length || !this.docs.length) return [];
    const results = [];
    for (const d of this.docs) {
      let score = 0;
      const matched = [];
      for (const token of qTokens) {
        const f = d.tf.get(token);
        if (!f) continue;
        matched.push(token);
        const norm = f + this.k1 * (1 - this.b + (this.b * d.length) / (this.avgLength || 1));
        score += this.idf(token) * ((f * (this.k1 + 1)) / norm);
      }
      if (score > minScore) results.push({ id: d.id, score, matched });
    }
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }
}
