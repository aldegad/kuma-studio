/**
 * Statistics store -- in-memory statistics with optional SQLite persistence.
 * Falls back to pure in-memory if better-sqlite3 is not available.
 */

let Database = null;
try {
  const mod = await import("better-sqlite3");
  Database = mod.default;
} catch {
  // better-sqlite3 not installed -- running in in-memory-only mode
}

export class StatsStore {
  #db = null;
  #inMemoryJobEvents = [];
  #inMemoryTokenUsage = [];
  #inMemoryAgentSessions = [];

  /**
   * @param {string} [dbPath] path to SQLite database file. If omitted, runs in-memory only.
   */
  constructor(dbPath) {
    if (Database && dbPath) {
      try {
        this.#db = new Database(dbPath);
        this.#db.pragma("journal_mode = WAL");
        this.#createTables();
      } catch (err) {
        process.stderr.write(`[stats-store] SQLite init failed, falling back to in-memory: ${err.message}\n`);
        this.#db = null;
      }
    }
  }

  #createTables() {
    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS job_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        job_id TEXT NOT NULL,
        session_id TEXT,
        agent_id TEXT,
        status TEXT NOT NULL,
        message TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        tokens_used INTEGER DEFAULT 0,
        model TEXT
      );

      CREATE TABLE IF NOT EXISTS token_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        agent_id TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens INTEGER NOT NULL,
        recorded_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS agent_sessions (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        started_at TEXT DEFAULT (datetime('now')),
        ended_at TEXT,
        total_jobs INTEGER DEFAULT 0,
        completed_jobs INTEGER DEFAULT 0,
        total_tokens INTEGER DEFAULT 0
      );
    `);
  }

  /**
   * Record a job event.
   */
  recordJobEvent({ jobId, sessionId, agentId, status, message, tokensUsed = 0, model = null }) {
    const entry = { jobId, sessionId, agentId, status, message, tokensUsed, model, createdAt: new Date().toISOString() };

    if (this.#db) {
      this.#db
        .prepare(
          `INSERT INTO job_events (job_id, session_id, agent_id, status, message, tokens_used, model)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(jobId, sessionId, agentId, status, message, tokensUsed, model);
    } else {
      this.#inMemoryJobEvents.push(entry);
    }
  }

  /**
   * Record token usage.
   */
  recordTokenUsage({ agentId, model, tokens }) {
    if (this.#db) {
      this.#db
        .prepare(`INSERT INTO token_usage (agent_id, model, tokens) VALUES (?, ?, ?)`)
        .run(agentId, model, tokens);
    } else {
      this.#inMemoryTokenUsage.push({ agentId, model, tokens, recordedAt: new Date().toISOString() });
    }
  }

  /**
   * Get dashboard statistics snapshot.
   * @returns {object}
   */
  getStats() {
    if (this.#db) {
      const jobStats = this.#db
        .prepare(
          `SELECT
             COUNT(*) as totalJobs,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completedJobs,
             SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) as inProgressJobs,
             SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) as errorJobs,
             SUM(tokens_used) as totalTokens
           FROM job_events`,
        )
        .get();

      return {
        totalJobs: jobStats.totalJobs ?? 0,
        completedJobs: jobStats.completedJobs ?? 0,
        inProgressJobs: jobStats.inProgressJobs ?? 0,
        errorJobs: jobStats.errorJobs ?? 0,
        totalTokens: jobStats.totalTokens ?? 0,
        tokensByModel: {},
        tokensByAgent: {},
        aceAgent: null,
      };
    }

    // In-memory fallback
    const events = this.#inMemoryJobEvents;
    return {
      totalJobs: events.length,
      completedJobs: events.filter((e) => e.status === "completed").length,
      inProgressJobs: events.filter((e) => e.status === "in_progress").length,
      errorJobs: events.filter((e) => e.status === "error").length,
      totalTokens: events.reduce((s, e) => s + (e.tokensUsed ?? 0), 0),
      tokensByModel: {},
      tokensByAgent: {},
      aceAgent: null,
    };
  }

  /**
   * Close the database connection.
   */
  close() {
    if (this.#db) {
      this.#db.close();
      this.#db = null;
    }
  }
}
