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

/** @typedef {"session" | "team" | "worker"} NodeType */

export class AgentStateManager {
  /** @type {Map<string, string>} agentId -> current state */
  #states = new Map();

  /** @type {Map<string, {nodeType: string, parentId: string|null, team: string|null}>} */
  #registry = new Map();

  /** @type {((agentId: string, state: string) => void)[]} */
  #listeners = [];

  /**
   * Register an agent in the hierarchy.
   * @param {string} agentId
   * @param {{ nodeType?: string, parentId?: string, team?: string }} meta
   */
  registerAgent(agentId, meta = {}) {
    this.#registry.set(agentId, {
      nodeType: meta.nodeType ?? "worker",
      parentId: meta.parentId ?? null,
      team: meta.team ?? null,
    });
  }

  /**
   * Get registry entry for an agent.
   * @param {string} agentId
   * @returns {{ nodeType: string, parentId: string|null, team: string|null } | null}
   */
  getAgentMeta(agentId) {
    return this.#registry.get(agentId) ?? null;
  }

  /**
   * Get direct children of an agent.
   * @param {string} parentId
   * @returns {string[]}
   */
  getChildren(parentId) {
    const children = [];
    for (const [id, meta] of this.#registry) {
      if (meta.parentId === parentId) {
        children.push(id);
      }
    }
    return children;
  }

  /**
   * Get all descendants (recursive) of an agent.
   * @param {string} rootId
   * @returns {string[]}
   */
  getDescendants(rootId) {
    const result = [];
    const queue = [rootId];
    while (queue.length > 0) {
      const current = queue.shift();
      const children = this.getChildren(current);
      for (const child of children) {
        result.push(child);
        queue.push(child);
      }
    }
    return result;
  }

  /**
   * Get the aggregated tree state for a node and its descendants.
   * @param {string} agentId
   * @returns {{ id: string, state: string, nodeType: string, children: object[] }}
   */
  getTreeState(agentId) {
    const meta = this.#registry.get(agentId);
    const children = this.getChildren(agentId);
    return {
      id: agentId,
      state: this.getState(agentId),
      nodeType: meta?.nodeType ?? "worker",
      children: children.map((childId) => this.getTreeState(childId)),
    };
  }

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
