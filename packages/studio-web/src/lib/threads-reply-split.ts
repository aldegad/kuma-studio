const HR_LINE = /^\s*---\s*$/;
const FENCE_OPEN = /^\s*(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^\s*(`{3,}|~{3,})\s*$/;

export function splitReplies(body: string): string[] {
  if (!body) return [""];

  const lines = body.split("\n");
  const out: string[] = [];
  let buffer: string[] = [];
  let openFence: string | null = null;

  for (const line of lines) {
    if (openFence) {
      const close = line.match(FENCE_CLOSE);
      if (close && close[1][0] === openFence[0] && close[1].length >= openFence.length) {
        openFence = null;
      }
      buffer.push(line);
      continue;
    }

    const open = line.match(FENCE_OPEN);
    if (open) {
      openFence = open[1];
      buffer.push(line);
      continue;
    }

    if (HR_LINE.test(line)) {
      out.push(buffer.join("\n"));
      buffer = [];
    } else {
      buffer.push(line);
    }
  }
  out.push(buffer.join("\n"));

  return out.map((chunk) => chunk.replace(/^\n+|\n+$/g, ""));
}

export function joinReplies(replies: string[]): string {
  return replies.map((reply) => reply.replace(/^\n+|\n+$/g, "")).join("\n\n---\n\n");
}

export const THREADS_REPLY_LIMIT = 500;

export function countChars(text: string): number {
  return Array.from(text).length;
}

export interface ReplyAttachment {
  marker: string;
  info: string;
  content: string;
}

export interface ParsedReply {
  body: string;
  attachments: ReplyAttachment[];
}

export function parseReply(raw: string): ParsedReply {
  if (!raw) return { body: "", attachments: [] };

  const lines = raw.split("\n");
  const bodyLines: string[] = [];
  const attachments: ReplyAttachment[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const open = line.match(FENCE_OPEN);
    if (open) {
      const marker = open[1];
      const info = (open[2] ?? "").trim();
      const contentLines: string[] = [];
      let j = i + 1;
      let closed = false;
      while (j < lines.length) {
        const closeMatch = lines[j].match(/^\s*(`{3,}|~{3,})\s*$/);
        if (closeMatch && closeMatch[1][0] === marker[0] && closeMatch[1].length >= marker.length) {
          closed = true;
          break;
        }
        contentLines.push(lines[j]);
        j++;
      }
      if (closed) {
        attachments.push({
          marker,
          info,
          content: contentLines.join("\n"),
        });
        i = j + 1;
        continue;
      }
    }
    bodyLines.push(line);
    i++;
  }

  const body = bodyLines.join("\n").replace(/^\n+|\n+$/g, "");
  return { body, attachments };
}

export function assembleReply(parsed: ParsedReply): string {
  const parts: string[] = [];
  const trimmedBody = parsed.body.replace(/^\n+|\n+$/g, "");
  if (trimmedBody) parts.push(trimmedBody);
  for (const att of parsed.attachments) {
    const fenceOpen = att.info ? `${att.marker}${att.info}` : att.marker;
    parts.push(`${fenceOpen}\n${att.content}\n${att.marker}`);
  }
  return parts.join("\n\n");
}
