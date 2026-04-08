/**
 * Studio WebSocket event broadcasting.
 * Sends kuma-studio:event messages to all connected WebSocket clients.
 */

/**
 * @typedef {import("ws").WebSocket} WS
 */

export class StudioWsEvents {
  /** @type {Set<WS>} */
  #clients = new Set();

  /**
   * Register a WebSocket client for studio events.
   * @param {WS} ws
   */
  addClient(ws) {
    this.#clients.add(ws);
    ws.on("close", () => this.#clients.delete(ws));
    ws.on("error", () => this.#clients.delete(ws));
  }

  /**
   * Remove a WebSocket client.
   * @param {WS} ws
   */
  removeClient(ws) {
    this.#clients.delete(ws);
  }

  /**
   * Broadcast a job card update event.
   * @param {object} card
   */
  broadcastJobCardUpdate(card) {
    this.#broadcast({
      type: "kuma-studio:event",
      event: { kind: "job-card-update", card },
    });
  }

  /**
   * Broadcast an agent state change event.
   * @param {string} agentId
   * @param {{ status: string, task: string | null }} snapshot
   */
  broadcastAgentStateChange(agentId, snapshot) {
    this.#broadcast({
      type: "kuma-studio:event",
      event: { kind: "agent-state-change", agentId, state: snapshot.status, task: snapshot.task },
    });
  }

  /**
   * Broadcast a token usage event.
   * @param {string} agentId
   * @param {number} tokens
   * @param {string} model
   */
  broadcastTokenUsage(agentId, tokens, model) {
    this.#broadcast({
      type: "kuma-studio:event",
      event: { kind: "token-usage", agentId, tokens, model },
    });
  }

  /**
   * Broadcast a stats snapshot.
   * @param {object} stats
   */
  broadcastStatsSnapshot(stats) {
    this.#broadcast({
      type: "kuma-studio:event",
      event: { kind: "stats-snapshot", stats },
    });
  }

  /**
   * Broadcast an office layout update.
   * @param {object} layout
   */
  broadcastOfficeLayoutUpdate(layout) {
    this.#broadcast({
      type: "kuma-studio:event",
      event: { kind: "office-layout-update", layout },
    });
  }

  /**
   * Broadcast a team status snapshot update.
   * @param {{ projects: Array<{ projectId: string, projectName: string, members: Array<{ id: string, state: string, lastOutputLines: string[], task: string | null, updatedAt: string | null }> }> }} snapshot
   */
  broadcastTeamStatusUpdate(snapshot) {
    this.#broadcast({
      type: "kuma-studio:team-status-update",
      snapshot,
    });
  }

  /**
   * Broadcast the current nightmode state.
   * @param {boolean} enabled
   */
  broadcastNightMode(enabled) {
    this.#broadcast({
      type: "kuma-studio:nightmode",
      enabled: enabled === true,
    });
  }

  /**
   * Broadcast the latest plans snapshot.
   * @param {object} snapshot
   */
  broadcastPlansUpdate(snapshot) {
    this.#broadcast({
      type: "kuma-studio:plans-update",
      snapshot,
    });
  }

  /**
   * Broadcast a team-config change event.
   * @param {object} payload
   */
  broadcastTeamConfigChanged(payload) {
    this.#broadcast({
      type: "kuma-studio:team-config-changed",
      payload,
    });
  }

  /**
   * Get the number of connected studio clients.
   * @returns {number}
   */
  get clientCount() {
    return this.#clients.size;
  }

  /**
   * @param {object} message
   */
  #broadcast(message) {
    const data = JSON.stringify(message);
    for (const client of this.#clients) {
      if (client.readyState === 1 /* OPEN */) {
        try {
          client.send(data);
        } catch {
          this.#clients.delete(client);
        }
      }
    }
  }
}
