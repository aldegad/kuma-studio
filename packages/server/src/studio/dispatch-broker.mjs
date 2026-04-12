import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export const DISPATCH_STATUSES = ["dispatched", "worker-done", "qa-passed", "qa-rejected", "failed"];
export const DISPATCH_TERMINAL_STATUSES = new Set(["qa-passed", "qa-rejected", "failed"]);
export const DISPATCH_MESSAGE_KINDS = ["instruction", "question", "answer", "status", "note", "blocker"];
export const DISPATCH_MESSAGE_BODY_SOURCES = ["original-user-text", "forwarded-summary", "direct-message", "lifecycle-event"];

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function cloneRecord(record) {
  return JSON.parse(JSON.stringify(record));
}

function isDispatchStatus(value) {
  return DISPATCH_STATUSES.includes(value);
}

function isDispatchMessageKind(value) {
  return DISPATCH_MESSAGE_KINDS.includes(value);
}

function isDispatchMessageBodySource(value) {
  return DISPATCH_MESSAGE_BODY_SOURCES.includes(value);
}

function isTerminalStatus(status) {
  return DISPATCH_TERMINAL_STATUSES.has(status);
}

function sortDispatchesDescending(dispatches) {
  return dispatches.sort((left, right) =>
    String(right?.updatedAt ?? "").localeCompare(String(left?.updatedAt ?? "")) ||
    String(right?.createdAt ?? "").localeCompare(String(left?.createdAt ?? "")) ||
    String(left?.taskId ?? "").localeCompare(String(right?.taskId ?? "")),
  );
}

function summarizeInstruction(value) {
  const normalized = normalizeString(value).replace(/\s+/gu, " ");
  return normalized ? normalized.slice(0, 200) : "";
}

function normalizeMessageText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeDispatchMessage(input, taskId, index) {
  const text = normalizeMessageText(input?.text);
  if (!text) {
    return null;
  }

  const now = new Date().toISOString();
  const id = normalizeString(input?.id) || `${taskId}:message:${String(index + 1).padStart(4, "0")}`;
  const kind = isDispatchMessageKind(input?.kind) ? input.kind : "note";

  return {
    id,
    kind,
    text,
    bodySource: isDispatchMessageBodySource(input?.bodySource)
      ? input.bodySource
      : kind === "instruction"
        ? "forwarded-summary"
        : "direct-message",
    from: normalizeString(input?.from),
    to: normalizeString(input?.to),
    fromLabel: normalizeString(input?.fromLabel),
    toLabel: normalizeString(input?.toLabel),
    fromSurface: normalizeString(input?.fromSurface),
    toSurface: normalizeString(input?.toSurface),
    source: normalizeString(input?.source),
    createdAt: normalizeString(input?.createdAt) || now,
  };
}

function normalizeDispatchMessages(items, taskId) {
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .map((item, index) => normalizeDispatchMessage(item, taskId, index))
    .filter(Boolean);
}

function createDispatchMessage(taskId, existingMessages, input = {}) {
  return normalizeDispatchMessage({
    ...input,
    id: normalizeString(input?.id) || `${taskId}:message:${String(existingMessages.length + 1).padStart(4, "0")}`,
    createdAt: normalizeString(input?.createdAt) || new Date().toISOString(),
  }, taskId, existingMessages.length);
}

function normalizeDispatchRecord(input, existing = null) {
  const now = new Date().toISOString();
  const taskId = normalizeString(input?.taskId) || normalizeString(existing?.taskId);
  const taskFile = normalizeString(input?.taskFile) || normalizeString(existing?.taskFile);
  const project = normalizeString(input?.project) || normalizeString(existing?.project);
  const initiator = normalizeString(input?.initiator) || normalizeString(existing?.initiator);
  const initiatorLabel = normalizeString(input?.initiatorLabel) || normalizeString(existing?.initiatorLabel);
  const worker = normalizeString(input?.worker) || normalizeString(existing?.worker);
  const workerId = normalizeString(input?.workerId) || normalizeString(existing?.workerId);
  const workerName = normalizeString(input?.workerName) || normalizeString(existing?.workerName);
  const workerType = normalizeString(input?.workerType) || normalizeString(existing?.workerType);
  const qa = normalizeString(input?.qa) || normalizeString(existing?.qa);
  const qaMember = normalizeString(input?.qaMember) || normalizeString(existing?.qaMember);
  const qaSurface = normalizeString(input?.qaSurface) || normalizeString(existing?.qaSurface);
  const resultFile = normalizeString(input?.resultFile) || normalizeString(existing?.resultFile);
  const signal = normalizeString(input?.signal) || normalizeString(existing?.signal);
  const instruction = typeof input?.instruction === "string" && input.instruction.trim()
    ? input.instruction.trim()
    : normalizeString(existing?.instruction);
  const summary = summarizeInstruction(input?.summary) || summarizeInstruction(existing?.summary);

  if (!taskId) {
    throw new Error("dispatch taskId is required");
  }
  if (!taskFile) {
    throw new Error(`dispatch ${taskId} is missing taskFile`);
  }

  const status = isDispatchStatus(input?.status) ? input.status : existing?.status ?? "dispatched";
  const messages = normalizeDispatchMessages(
    Array.isArray(input?.messages) ? input.messages : existing?.messages,
    taskId,
  );

  return {
    taskId,
    taskFile,
    project,
    initiator,
    initiatorLabel,
    worker,
    workerId,
    workerName,
    workerType,
    qa,
    qaMember,
    qaSurface,
    resultFile,
    signal,
    instruction,
    summary,
    messages,
    status,
    lastEvent: normalizeString(input?.lastEvent) || normalizeString(existing?.lastEvent),
    blocker: normalizeString(input?.blocker) || normalizeString(existing?.blocker),
    note: normalizeString(input?.note) || normalizeString(existing?.note),
    source: normalizeString(input?.source) || normalizeString(existing?.source),
    createdAt: normalizeString(existing?.createdAt) || now,
    updatedAt: now,
    workerCompletedAt: normalizeString(input?.workerCompletedAt) || normalizeString(existing?.workerCompletedAt),
    completedAt: normalizeString(input?.completedAt) || normalizeString(existing?.completedAt),
    failedAt: normalizeString(input?.failedAt) || normalizeString(existing?.failedAt),
  };
}

/**
 * @typedef {{
 *   type: "complete" | "fail" | "qa-pass" | "qa-reject",
 *   summary?: string,
 *   blocker?: string,
 *   note?: string,
 *   source?: string,
 *   resultFile?: string,
 * }} DispatchEventInput
 */

export class DispatchBroker {
  #dispatches = new Map();
  #listeners = [];
  #storagePath;
  #runLifecycleHook;

  /**
   * @param {{
   *   storagePath?: string | null,
   *   runLifecycleHook?: ((input: { event: string, taskFile: string, summary?: string, blocker?: string, note?: string }) => Promise<void> | void) | null,
   * }} [options]
   */
  constructor(options = {}) {
    this.#storagePath = typeof options.storagePath === "string" && options.storagePath.trim()
      ? options.storagePath
      : null;
    this.#runLifecycleHook = typeof options.runLifecycleHook === "function" ? options.runLifecycleHook : null;
    this.#load();
  }

  #load() {
    if (!this.#storagePath || !existsSync(this.#storagePath)) {
      return;
    }

    try {
      const raw = JSON.parse(readFileSync(this.#storagePath, "utf8"));
      const items = Array.isArray(raw?.dispatches) ? raw.dispatches : [];
      for (const item of items) {
        const record = normalizeDispatchRecord(item);
        this.#dispatches.set(record.taskId, record);
      }
    } catch (error) {
      process.stderr.write(`[dispatch-broker] failed to load persisted state: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  #persist() {
    if (!this.#storagePath) {
      return;
    }

    mkdirSync(dirname(this.#storagePath), { recursive: true });
    writeFileSync(this.#storagePath, JSON.stringify({
      updatedAt: new Date().toISOString(),
      dispatches: sortDispatchesDescending(Array.from(this.#dispatches.values()).map((record) => cloneRecord(record))),
    }, null, 2) + "\n", "utf8");
  }

  #notify(record) {
    const snapshot = cloneRecord(record);
    for (const listener of this.#listeners) {
      try {
        listener(snapshot);
      } catch (error) {
        process.stderr.write(`[dispatch-broker] listener failed: ${error instanceof Error ? error.message : String(error)}\n`);
      }
    }
  }

  async #emitLifecycleHook(input) {
    if (!this.#runLifecycleHook) {
      return;
    }

    try {
      await this.#runLifecycleHook(input);
    } catch (error) {
      process.stderr.write(`[dispatch-broker] lifecycle hook failed: ${error instanceof Error ? error.message : String(error)}\n`);
    }
  }

  onChange(listener) {
    this.#listeners.push(listener);
    return () => {
      this.#listeners = this.#listeners.filter((candidate) => candidate !== listener);
    };
  }

  getDispatch(taskId) {
    const record = this.#dispatches.get(normalizeString(taskId));
    return record ? cloneRecord(record) : null;
  }

  listDispatches(options = {}) {
    const status = normalizeString(options?.status);
    const onlyActive = status === "active";
    return sortDispatchesDescending(Array.from(this.#dispatches.values())
      .filter((record) => (onlyActive ? !isTerminalStatus(record.status) : true))
      .map((record) => cloneRecord(record)));
  }

  async registerDispatch(input) {
    const existing = this.#dispatches.get(normalizeString(input?.taskId)) ?? null;
    const seedMessages = Array.isArray(existing?.messages) ? existing.messages : [];
    if (!existing && normalizeMessageText(input?.instruction)) {
      const initialMessage = createDispatchMessage(normalizeString(input?.taskId), seedMessages, {
        kind: "instruction",
        text: input.instruction,
        bodySource: "forwarded-summary",
        from: "initiator",
        to: "worker",
        fromLabel: input?.initiatorLabel,
        toLabel: input?.workerName,
        fromSurface: input?.initiator,
        toSurface: input?.worker,
        source: "kuma-task",
      });
      if (initialMessage) {
        seedMessages.push(initialMessage);
      }
    }
    const record = normalizeDispatchRecord({
      ...input,
      status: "dispatched",
      lastEvent: "dispatched",
      blocker: "",
      note: "",
      completedAt: "",
      failedAt: "",
      workerCompletedAt: "",
      messages: seedMessages,
    }, existing);

    this.#dispatches.set(record.taskId, record);
    this.#persist();
    this.#notify(record);
    await this.#emitLifecycleHook({
      event: "dispatched",
      taskFile: record.taskFile,
      summary: record.summary,
    });
    return cloneRecord(record);
  }

  async reportEvent(taskId, input) {
    const normalizedTaskId = normalizeString(taskId);
    const current = this.#dispatches.get(normalizedTaskId);
    if (!current) {
      throw new Error(`Unknown dispatch: ${normalizedTaskId}`);
    }

    const type = normalizeString(input?.type);
    const now = new Date().toISOString();
    const source = normalizeString(input?.source);
    const resultFile = normalizeString(input?.resultFile);
    const summary = summarizeInstruction(input?.summary) || current.summary;
    const blocker = normalizeString(input?.blocker);
    const note = normalizeString(input?.note);
    const directCompletion = current.qa === "worker-self-report" || current.qa === "kuma-direct";

    if (isTerminalStatus(current.status)) {
      return cloneRecord(current);
    }

    const next = normalizeDispatchRecord({
      ...current,
      source: source || current.source,
      resultFile: resultFile || current.resultFile,
      summary,
      blocker: blocker || current.blocker,
      note: note || current.note,
      lastEvent: type,
    }, current);

    const lifecycleEvents = [];

    switch (type) {
      case "complete":
        next.workerCompletedAt = current.workerCompletedAt || now;
        next.status = directCompletion ? "qa-passed" : "worker-done";
        if (directCompletion) {
          next.completedAt = now;
        }
        lifecycleEvents.push({
          event: "worker-done",
          summary: current.qa === "worker-self-report"
            ? "worker result detected, awaiting final broker completion"
            : "worker result detected, awaiting QA",
        });
        if (directCompletion) {
          lifecycleEvents.push({
            event: "qa-passed",
            note: note || (current.qa === "worker-self-report" ? "worker-self-report broker completion" : "kuma-direct broker completion"),
          });
        }
        break;
      case "fail":
        next.status = "failed";
        next.failedAt = now;
        lifecycleEvents.push({
          event: "failed",
          summary: summary || "worker failed",
          blocker: blocker || note || "worker failed",
          note: note || blocker || "worker failed",
        });
        break;
      case "qa-pass":
        next.status = "qa-passed";
        next.completedAt = now;
        lifecycleEvents.push({
          event: "qa-passed",
          note: note || "QA PASS",
        });
        break;
      case "qa-reject":
        next.status = "qa-rejected";
        lifecycleEvents.push({
          event: "qa-rejected",
          summary: "QA rejected",
          blocker: blocker || note || "QA rejected",
          note: note || blocker || "QA rejected",
        });
        break;
      default:
        throw new Error(`Unsupported dispatch event: ${type}`);
    }

    this.#dispatches.set(next.taskId, next);
    this.#persist();
    this.#notify(next);

    for (const lifecycleEvent of lifecycleEvents) {
      await this.#emitLifecycleHook({
        event: lifecycleEvent.event,
        taskFile: next.taskFile,
        summary: lifecycleEvent.summary,
        blocker: lifecycleEvent.blocker,
        note: lifecycleEvent.note,
      });
    }

    return cloneRecord(next);
  }

  listMessages(taskId) {
    const record = this.#dispatches.get(normalizeString(taskId));
    return record ? cloneRecord(record.messages ?? []) : null;
  }

  async appendMessage(taskId, input) {
    const normalizedTaskId = normalizeString(taskId);
    const current = this.#dispatches.get(normalizedTaskId);
    if (!current) {
      throw new Error(`Unknown dispatch: ${normalizedTaskId}`);
    }

    const nextMessages = Array.isArray(current.messages) ? current.messages.slice() : [];
    const message = createDispatchMessage(normalizedTaskId, nextMessages, input);
    if (!message) {
      throw new Error("Dispatch message text is required.");
    }

    nextMessages.push(message);
    const next = normalizeDispatchRecord({
      ...current,
      messages: nextMessages,
      lastEvent: `message:${message.kind}`,
    }, current);

    this.#dispatches.set(next.taskId, next);
    this.#persist();
    this.#notify(next);
    return cloneRecord(next);
  }

}

export function isTerminalDispatchStatus(status) {
  return isTerminalStatus(status);
}
