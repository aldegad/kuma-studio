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

  recordTokenUsage({ agentId, model, tokens }) {
    if (this.#db) {
      this.#db
        .prepare(`INSERT INTO token_usage (agent_id, model, tokens) VALUES (?, ?, ?)`)
        .run(agentId, model, tokens);
    } else {
      this.#inMemoryTokenUsage.push({ agentId, model, tokens, recordedAt: new Date().toISOString() });
    }
  }

  getStats() {
    const aggregate = buildAggregateSnapshot(this.#readJobEvents(), this.#readTokenUsage());
    return {
      totalJobs: aggregate.totalJobs,
      completedJobs: aggregate.completedJobs,
      inProgressJobs: aggregate.inProgressJobs,
      errorJobs: aggregate.errorJobs,
      totalTokens: aggregate.totalTokens,
      tokensByModel: aggregate.tokensByModel,
      tokensByAgent: aggregate.tokensByAgent,
      aceAgent: aggregate.aceAgent,
    };
  }

  getDailyReport() {
    const today = startOfToday();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const aggregate = buildAggregateSnapshot(
      this.#readJobEvents().filter((event) => isWithinDay(event.createdAt, today, tomorrow)),
      this.#readTokenUsage().filter((entry) => isWithinDay(entry.recordedAt, today, tomorrow)),
    );

    const completionRate = aggregate.totalJobs > 0
      ? (aggregate.completedJobs / aggregate.totalJobs) * 100
      : 0;

    return {
      date: formatLocalDate(today),
      totalTasks: aggregate.totalJobs,
      completedTasks: aggregate.completedJobs,
      completionRate,
      tokenConsumption: aggregate.totalTokens,
      mvpAgent: aggregate.mvpAgent
        ? {
            id: aggregate.mvpAgent.id,
            completedTasks: aggregate.aceAgentCompletedJobs,
            totalTokens: aggregate.tokensByAgent[aggregate.mvpAgent.id] ?? 0,
          }
        : null,
    };
  }

  close() {
    if (this.#db) {
      this.#db.close();
      this.#db = null;
    }
  }

  #readJobEvents() {
    if (!this.#db) {
      return this.#inMemoryJobEvents;
    }

    return this.#db
      .prepare(
        `SELECT
          job_id AS jobId,
          session_id AS sessionId,
          agent_id AS agentId,
          status,
          message,
          created_at AS createdAt,
          tokens_used AS tokensUsed,
          model
        FROM job_events
        ORDER BY created_at ASC, id ASC`,
      )
      .all()
      .map((entry) => ({
        ...entry,
        createdAt: normalizeDbTimestamp(entry.createdAt),
        tokensUsed: Number(entry.tokensUsed ?? 0),
      }));
  }

  #readTokenUsage() {
    if (!this.#db) {
      return this.#inMemoryTokenUsage;
    }

    return this.#db
      .prepare(
        `SELECT
          agent_id AS agentId,
          model,
          tokens,
          recorded_at AS recordedAt
        FROM token_usage
        ORDER BY recorded_at ASC, id ASC`,
      )
      .all()
      .map((entry) => ({
        ...entry,
        recordedAt: normalizeDbTimestamp(entry.recordedAt),
        tokens: Number(entry.tokens ?? 0),
      }));
  }
}

function buildAggregateSnapshot(jobEvents, tokenEntries) {
  const latestJobs = new Map();
  const completedJobsByAgent = {};
  const tokensByAgent = {};
  const tokensByModel = {};

  for (const event of jobEvents) {
    if (!event?.jobId) {
      continue;
    }

    latestJobs.set(event.jobId, event);
  }

  for (const entry of tokenEntries) {
    if (typeof entry?.agentId === "string" && entry.agentId) {
      tokensByAgent[entry.agentId] = (tokensByAgent[entry.agentId] ?? 0) + Number(entry.tokens ?? 0);
    }

    if (typeof entry?.model === "string" && entry.model) {
      tokensByModel[entry.model] = (tokensByModel[entry.model] ?? 0) + Number(entry.tokens ?? 0);
    }
  }

  let completedJobs = 0;
  let inProgressJobs = 0;
  let errorJobs = 0;

  for (const event of latestJobs.values()) {
    if (event.status === "completed") {
      completedJobs += 1;
      if (typeof event.agentId === "string" && event.agentId) {
        completedJobsByAgent[event.agentId] = (completedJobsByAgent[event.agentId] ?? 0) + 1;
      }
    } else if (event.status === "in_progress") {
      inProgressJobs += 1;
    } else if (event.status === "error") {
      errorJobs += 1;
    }
  }

  const aceAgentId = Object.keys(completedJobsByAgent).sort((left, right) => {
    const completedDiff = (completedJobsByAgent[right] ?? 0) - (completedJobsByAgent[left] ?? 0);
    if (completedDiff !== 0) {
      return completedDiff;
    }

    return (tokensByAgent[right] ?? 0) - (tokensByAgent[left] ?? 0);
  })[0] ?? null;

  const aceAgentScore = aceAgentId
    ? (completedJobsByAgent[aceAgentId] ?? 0) * 10 + (tokensByAgent[aceAgentId] ?? 0) / 1000
    : null;

  return {
    totalJobs: latestJobs.size,
    completedJobs,
    inProgressJobs,
    errorJobs,
    totalTokens: Object.values(tokensByModel).reduce((sum, value) => sum + value, 0),
    tokensByModel,
    tokensByAgent,
    aceAgentCompletedJobs: aceAgentId ? completedJobsByAgent[aceAgentId] ?? 0 : 0,
    aceAgent: aceAgentId
      ? {
          id: aceAgentId,
          name: aceAgentId,
          score: aceAgentScore ?? 0,
        }
      : null,
  };
}

function normalizeDbTimestamp(value) {
  if (typeof value !== "string" || !value) {
    return new Date().toISOString();
  }

  return value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
}

function startOfToday() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

function isWithinDay(value, start, end) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date >= start && date < end;
}

function formatLocalDate(date) {
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
