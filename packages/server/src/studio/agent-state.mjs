/**
 * Agent state management -- tracks current state of each agent
 * and broadcasts state changes via WebSocket.
 */

/** Valid agent states */
const VALID_STATES = ["idle", "working", "thinking", "completed", "error"];

/** Allowed state transitions */
const STATE_TRANSITIONS = {
  idle:      ["working", "thinking"],
  working:   ["thinking", "completed", "error", "idle"],
  thinking:  ["working", "completed", "error", "idle"],
  completed: ["idle", "working"],
  error:     ["idle", "working"],
};

/**
 * Map a Job Card status to an agent state.
 * @param {string} jobStatus
 * @returns {string}
 */
export function mapJobStatusToAgentState(jobStatus) {
  switch (jobStatus) {
    case "in_progress": return "working";
    case "completed":   return "completed";
    case "error":       return "error";
    default:            return "idle";
  }
}

export class AgentStateManager {
  /** @type {Map<string, string>} agentId -> current state */
  #states = new Map();

  /** @type {((agentId: string, state: string) => void)[]} */
  #listeners = [];

  /**
   * Get the current state of an agent.
   * @param {string} agentId
   * @returns {string}
   */
  getState(agentId) {
    return this.#states.get(agentId) ?? "idle";
  }

  /**
   * Get all agent states.
   * @returns {Record<string, string>}
   */
  getAllStates() {
    return Object.fromEntries(this.#states);
  }

  /**
   * Set the state of an agent, validating the transition.
   * @param {string} agentId
   * @param {string} newState
   * @returns {boolean} whether the transition was accepted
   */
  setState(agentId, newState) {
    if (!VALID_STATES.includes(newState)) return false;

    const current = this.getState(agentId);
    const allowed = STATE_TRANSITIONS[current];

    if (allowed && !allowed.includes(newState) && current !== newState) {
      // Force transition anyway but log warning
      process.stderr.write(
        `[agent-state] Warning: ${agentId} transition ${current} -> ${newState} is not in allowed transitions\n`,
      );
    }

    this.#states.set(agentId, newState);
    this.#notifyListeners(agentId, newState);
    return true;
  }

  /**
   * Register a listener for state changes.
   * @param {(agentId: string, state: string) => void} listener
   * @returns {() => void} unsubscribe function
   */
  onStateChange(listener) {
    this.#listeners.push(listener);
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  #notifyListeners(agentId, state) {
    for (const listener of this.#listeners) {
      try {
        listener(agentId, state);
      } catch (err) {
        process.stderr.write(`[agent-state] Listener error: ${err}\n`);
      }
    }
  }
}
