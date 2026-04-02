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
  /** @type {Map<string, { status: string, task: string | null }>} agentId -> current state */
  #states = new Map();

  /** @type {Map<string, {nodeType: string, parentId: string|null, team: string|null}>} */
  #registry = new Map();

  /** @type {((agentId: string, snapshot: { status: string, task: string | null }) => void)[]} */
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
   * @returns {{ id: string, state: string, task: string | null, nodeType: string, children: object[] }}
   */
  getTreeState(agentId) {
    const meta = this.#registry.get(agentId);
    const children = this.getChildren(agentId);
    const snapshot = this.getSnapshot(agentId);
    return {
      id: agentId,
      state: snapshot.status,
      task: snapshot.task,
      nodeType: meta?.nodeType ?? "worker",
      children: children.map((childId) => this.getTreeState(childId)),
    };
  }

  /**
   * Get the current state snapshot for an agent.
   * @param {string} agentId
   * @returns {{ status: string, task: string | null }}
   */
  getSnapshot(agentId) {
    return this.#states.get(agentId) ?? { status: "idle", task: null };
  }

  /**
   * Get the current state of an agent.
   * @param {string} agentId
   * @returns {string}
   */
  getState(agentId) {
    return this.getSnapshot(agentId).status;
  }

  /**
   * Get the current task of an agent.
   * @param {string} agentId
   * @returns {string | null}
   */
  getTask(agentId) {
    return this.getSnapshot(agentId).task;
  }

  /**
   * Get all agent states.
   * @returns {Record<string, { status: string, task: string | null }>}
   */
  getAllStates() {
    return Object.fromEntries(this.#states);
  }

  /**
   * Set the state of an agent, validating the transition.
   * @param {string} agentId
   * @param {string} newState
   * @param {string | null | undefined} task
   * @returns {boolean} whether the transition was accepted
   */
  setState(agentId, newState, task = undefined) {
    if (!VALID_STATES.includes(newState)) return false;

    const current = this.getSnapshot(agentId);
    const allowed = STATE_TRANSITIONS[current.status];

    if (allowed && !allowed.includes(newState) && current.status !== newState) {
      // Force transition anyway but log warning
      process.stderr.write(
        `[agent-state] Warning: ${agentId} transition ${current.status} -> ${newState} is not in allowed transitions\n`,
      );
    }

    const nextTask =
      typeof task === "string"
        ? task.trim() || null
        : task === null || newState === "idle"
          ? null
          : current.task ?? null;

    if (current.status === newState && current.task === nextTask) {
      return true;
    }

    const snapshot = { status: newState, task: nextTask };
    this.#states.set(agentId, snapshot);
    this.#notifyListeners(agentId, snapshot);
    return true;
  }

  /**
   * Register a listener for state changes.
   * @param {(agentId: string, snapshot: { status: string, task: string | null }) => void} listener
   * @returns {() => void} unsubscribe function
   */
  onStateChange(listener) {
    this.#listeners.push(listener);
    return () => {
      this.#listeners = this.#listeners.filter((l) => l !== listener);
    };
  }

  #notifyListeners(agentId, snapshot) {
    for (const listener of this.#listeners) {
      try {
        listener(agentId, snapshot);
      } catch (err) {
        process.stderr.write(`[agent-state] Listener error: ${err}\n`);
      }
    }
  }
}
