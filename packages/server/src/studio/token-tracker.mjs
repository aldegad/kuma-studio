/**
 * Token usage tracker -- records token consumption per agent/model
 * and provides aggregated statistics.
 */

export class TokenTracker {
  /** @type {Array<{agentId: string, model: string, tokens: number, recordedAt: string}>} */
  #records = [];

  /** @type {((entry: object) => void)[]} */
  #listeners = [];

  /**
   * Record token usage.
   * @param {string} agentId
   * @param {string} model
   * @param {number} tokens
   */
  record(agentId, model, tokens) {
    const entry = {
      agentId,
      model,
      tokens,
      recordedAt: new Date().toISOString(),
    };
    this.#records.push(entry);
    this.#notifyListeners(entry);
  }

  /**
   * Get total tokens consumed.
   * @returns {number}
   */
  getTotal() {
    return this.#records.reduce((sum, r) => sum + r.tokens, 0);
  }

  /**
   * Get tokens grouped by model.
   * @returns {Record<string, number>}
   */
  getByModel() {
    const result = {};
    for (const r of this.#records) {
      result[r.model] = (result[r.model] ?? 0) + r.tokens;
    }
    return result;
  }

  /**
   * Get tokens grouped by agent.
   * @returns {Record<string, number>}
   */
  getByAgent() {
    const result = {};
    for (const r of this.#records) {
      result[r.agentId] = (result[r.agentId] ?? 0) + r.tokens;
    }
    return result;
  }

  /**
   * Get all records (for charts).
   * @returns {Array<object>}
   */
  getHistory() {
    return [...this.#records];
  }

  /**
   * Register a listener for new token records.
   * @param {(entry: object) => void} listener
   * @returns {() => void} unsubscribe
   */
  onRecord(listener) {
    this.#listeners.push(listener);
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  #notifyListeners(entry) {
    for (const listener of this.#listeners) {
      try {
        listener(entry);
      } catch (err) {
        process.stderr.write(`[token-tracker] Listener error: ${err}\n`);
      }
    }
  }
}
