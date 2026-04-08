/**
 * In-memory agent work history — records state transitions per agent.
 * Max 20 entries per agent, oldest evicted first.
 */

const MAX_ENTRIES_PER_AGENT = 20;

/**
 * @typedef {{ state: string, task: string | null, timestamp: string }} AgentHistoryEntry
 */

export class AgentHistoryStore {
  /** @type {Map<string, AgentHistoryEntry[]>} */
  #history = new Map();

  /** @type {Map<string, string>} */
  #lastState = new Map();

  /**
   * Record a state change for an agent. Only stores if state actually changed.
   * @param {string} agentId
   * @param {string} state
   * @param {string | null} task
   */
  record(agentId, state, task = null) {
    const prevState = this.#lastState.get(agentId);
    if (prevState === state) return;

    this.#lastState.set(agentId, state);

    let entries = this.#history.get(agentId);
    if (!entries) {
      entries = [];
      this.#history.set(agentId, entries);
    }

    entries.push({
      state,
      task: task || null,
      timestamp: new Date().toISOString(),
    });

    if (entries.length > MAX_ENTRIES_PER_AGENT) {
      entries.splice(0, entries.length - MAX_ENTRIES_PER_AGENT);
    }
  }

  /**
   * Record state changes from a team-status snapshot (called on each poll).
   * @param {{ projects: Record<string, { members: Array<{ name: string, surface: string, status: string, lastOutput: string }> }> }} snapshot
   * @param {Map<string, { id: string }>} membersByName
   */
  recordFromSnapshot(snapshot, membersByName) {
    for (const project of Object.values(snapshot?.projects ?? {})) {
      for (const member of project?.members ?? []) {
        const meta = membersByName.get(member.name);
        const id = meta?.id ?? member.surface;
        if (!id) continue;
        this.record(id, member.status, deriveTaskFromLastOutput(member.lastOutput));
      }
    }
  }

  /**
   * @param {string} agentId
   * @returns {AgentHistoryEntry[]}
   */
  getHistory(agentId) {
    return [...(this.#history.get(agentId) ?? [])].reverse();
  }

  /**
   * @returns {Record<string, AgentHistoryEntry[]>}
   */
  getAllHistories() {
    const result = {};
    for (const [id, entries] of this.#history) {
      result[id] = [...entries].reverse();
    }
    return result;
  }
}

/**
 * Extract a short task description from the last output lines.
 * @param {string} lastOutput
 * @returns {string | null}
 */
function deriveTaskFromLastOutput(lastOutput) {
  if (!lastOutput) return null;
  const lines = lastOutput.split("\n").map((l) => l.trim()).filter(Boolean);
  // Look for task-like patterns
  for (const line of lines) {
    if (line.startsWith("Task:") || line.startsWith("Working on")) {
      return line.slice(0, 120);
    }
  }
  // Use the first meaningful non-error line
  const meaningful = lines.find((l) =>
    !l.startsWith("Error:") &&
    !l.startsWith("$") &&
    l.length > 5 &&
    l.length < 200
  );
  return meaningful?.slice(0, 120) ?? null;
}
