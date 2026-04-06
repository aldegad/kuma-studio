/**
 * Lightweight markdown-to-JSX renderer — no external dependencies.
 * Supports: headings, tables, code blocks, inline code, blockquotes,
 * bold/italic, links, unordered/ordered lists, horizontal rules.
 */

import { type ReactNode, useMemo } from "react";

interface MarkdownBodyProps {
  content: string;
}

/* ─── inline formatting ─── */

function renderInline(text: string): ReactNode[] {
  const tokens: ReactNode[] = [];
  // Process: bold, italic, inline code, links
  const regex =
    /(\*\*(.+?)\*\*)|(\*(.+?)\*)|(`([^`]+)`)|\[([^\]]+)\]\(([^)]+)\)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push(text.slice(lastIndex, match.index));
    }

    if (match[1]) {
      // **bold**
      tokens.push(
        <strong key={match.index} className="font-bold" style={{ color: "var(--t-primary)" }}>
          {match[2]}
        </strong>,
      );
    } else if (match[3]) {
      // *italic*
      tokens.push(
        <em key={match.index} className="italic" style={{ color: "var(--t-secondary)" }}>
          {match[4]}
        </em>,
      );
    } else if (match[5]) {
      // `code`
      tokens.push(
        <code
          key={match.index}
          className="rounded-md px-1.5 py-0.5 font-mono text-[0.85em]"
          style={{ background: "var(--input-bg)", color: "var(--t-secondary)", border: "1px solid var(--card-border)" }}
        >
          {match[6]}
        </code>,
      );
    } else if (match[7]) {
      // [text](url)
      tokens.push(
        <a
          key={match.index}
          href={match[8]}
          className="underline underline-offset-2 transition-colors hover:opacity-80"
          style={{ color: "var(--t-accent, #6366f1)" }}
          target="_blank"
          rel="noopener noreferrer"
        >
          {match[7]}
        </a>,
      );
    }
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < text.length) {
    tokens.push(text.slice(lastIndex));
  }

  return tokens.length > 0 ? tokens : [text];
}

/* ─── table parser ─── */

function parseTable(lines: string[]): { headers: string[]; rows: string[][] } | null {
  if (lines.length < 2) return null;
  const headerCells = lines[0]
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());

  // Check separator line
  const sep = lines[1].trim();
  if (!/^\|?[\s\-:|]+\|/.test(sep)) return null;

  const rows: string[][] = [];
  for (let i = 2; i < lines.length; i++) {
    const cells = lines[i]
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
    rows.push(cells);
  }
  return { headers: headerCells, rows };
}

/* ─── block-level parser ─── */

interface Block {
  type: "heading" | "table" | "codeblock" | "blockquote" | "list" | "hr" | "paragraph";
  level?: number; // heading level
  lang?: string; // code block language
  lines: string[];
  ordered?: boolean;
}

function parseBlocks(content: string): Block[] {
  const rawLines = content.split(/\r?\n/);
  const blocks: Block[] = [];
  let i = 0;

  while (i < rawLines.length) {
    const line = rawLines[i];

    // Empty line → skip
    if (line.trim() === "") {
      i++;
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim()) || /^\*\*\*+$/.test(line.trim())) {
      blocks.push({ type: "hr", lines: [] });
      i++;
      continue;
    }

    // Heading
    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: headingMatch[1].length,
        lines: [headingMatch[2]],
      });
      i++;
      continue;
    }

    // Fenced code block
    const codeMatch = line.match(/^```(\w*)/);
    if (codeMatch) {
      const lang = codeMatch[1] || "";
      const codeLines: string[] = [];
      i++;
      while (i < rawLines.length && !rawLines[i].startsWith("```")) {
        codeLines.push(rawLines[i]);
        i++;
      }
      blocks.push({ type: "codeblock", lang, lines: codeLines });
      i++; // skip closing ```
      continue;
    }

    // Table (starts with |)
    if (line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < rawLines.length && rawLines[i].trim().startsWith("|")) {
        tableLines.push(rawLines[i]);
        i++;
      }
      blocks.push({ type: "table", lines: tableLines });
      continue;
    }

    // Blockquote
    if (line.trim().startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < rawLines.length && rawLines[i].trim().startsWith(">")) {
        quoteLines.push(rawLines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      blocks.push({ type: "blockquote", lines: quoteLines });
      continue;
    }

    // Unordered list (- item, but NOT checklist - [ ] or - [x])
    if (/^\s*[-*]\s+/.test(line) && !/^\s*[-*]\s+\[[ xX]\]/.test(line)) {
      const listLines: string[] = [];
      while (
        i < rawLines.length &&
        /^\s*[-*]\s+/.test(rawLines[i]) &&
        !/^\s*[-*]\s+\[[ xX]\]/.test(rawLines[i])
      ) {
        listLines.push(rawLines[i].replace(/^\s*[-*]\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered: false, lines: listLines });
      continue;
    }

    // Ordered list
    if (/^\s*\d+\.\s+/.test(line)) {
      const listLines: string[] = [];
      while (i < rawLines.length && /^\s*\d+\.\s+/.test(rawLines[i])) {
        listLines.push(rawLines[i].replace(/^\s*\d+\.\s+/, ""));
        i++;
      }
      blocks.push({ type: "list", ordered: true, lines: listLines });
      continue;
    }

    // Checklist items → skip (rendered by the checklist renderer)
    if (/^\s*[-*]\s+\[[ xX]\]/.test(line)) {
      i++;
      continue;
    }

    // Paragraph (consecutive non-empty, non-special lines)
    {
      const paraLines: string[] = [];
      while (
        i < rawLines.length &&
        rawLines[i].trim() !== "" &&
        !/^#{1,6}\s/.test(rawLines[i]) &&
        !rawLines[i].startsWith("```") &&
        !rawLines[i].trim().startsWith("|") &&
        !rawLines[i].trim().startsWith(">") &&
        !/^\s*[-*]\s+/.test(rawLines[i]) &&
        !/^\s*\d+\.\s+/.test(rawLines[i]) &&
        !/^---+$/.test(rawLines[i].trim())
      ) {
        paraLines.push(rawLines[i]);
        i++;
      }
      if (paraLines.length > 0) {
        blocks.push({ type: "paragraph", lines: paraLines });
      }
    }
  }

  return blocks;
}

/* ─── block renderers ─── */

function HeadingBlock({ level, text }: { level: number; text: string }) {
  const sizes: Record<number, string> = {
    1: "text-[17px] font-extrabold mt-5 mb-2",
    2: "text-[15px] font-bold mt-4 mb-1.5",
    3: "text-[13px] font-bold mt-3 mb-1",
    4: "text-[12px] font-semibold mt-2 mb-1",
    5: "text-[11px] font-semibold mt-2 mb-0.5",
    6: "text-[11px] font-medium mt-1 mb-0.5",
  };
  return (
    <div
      className={`${sizes[level] ?? sizes[3]} leading-snug`}
      style={{ color: "var(--t-primary)" }}
    >
      {renderInline(text)}
    </div>
  );
}

function TableBlock({ lines }: { lines: string[] }) {
  const table = parseTable(lines);
  if (!table) return null;

  return (
    <div className="my-2 overflow-x-auto rounded-lg border" style={{ borderColor: "var(--card-border)" }}>
      <table className="w-full text-[12px]" style={{ borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ background: "var(--input-bg)" }}>
            {table.headers.map((h, i) => (
              <th
                key={i}
                className="px-3 py-2 text-left font-bold"
                style={{ color: "var(--t-primary)", borderBottom: "1px solid var(--card-border)" }}
              >
                {renderInline(h)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, ri) => (
            <tr
              key={ri}
              style={{
                background: ri % 2 === 0 ? "transparent" : "var(--input-bg)",
                borderBottom: ri < table.rows.length - 1 ? "1px solid var(--border-subtle)" : undefined,
              }}
            >
              {row.map((cell, ci) => (
                <td
                  key={ci}
                  className="px-3 py-1.5"
                  style={{ color: "var(--t-secondary)" }}
                >
                  {renderInline(cell)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeBlock({ lang, lines }: { lang?: string; lines: string[] }) {
  return (
    <div className="my-2 overflow-hidden rounded-lg border" style={{ borderColor: "var(--card-border)" }}>
      {lang && (
        <div
          className="px-3 py-1 text-[9px] font-bold uppercase tracking-wider"
          style={{ background: "var(--input-bg)", color: "var(--t-faint)", borderBottom: "1px solid var(--card-border)" }}
        >
          {lang}
        </div>
      )}
      <pre
        className="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed"
        style={{ background: "var(--input-bg)", color: "var(--t-secondary)", margin: 0 }}
      >
        {lines.join("\n")}
      </pre>
    </div>
  );
}

function BlockquoteBlock({ lines }: { lines: string[] }) {
  return (
    <blockquote
      className="my-2 rounded-r-lg border-l-[3px] px-3 py-2 text-[12px] leading-relaxed"
      style={{
        borderColor: "var(--t-faint)",
        background: "var(--input-bg)",
        color: "var(--t-secondary)",
      }}
    >
      {lines.map((line, i) => (
        <span key={i}>
          {renderInline(line)}
          {i < lines.length - 1 && <br />}
        </span>
      ))}
    </blockquote>
  );
}

function ListBlock({ lines, ordered }: { lines: string[]; ordered: boolean }) {
  const Tag = ordered ? "ol" : "ul";
  return (
    <Tag
      className={`my-1.5 space-y-0.5 pl-5 text-[12px] leading-relaxed ${ordered ? "list-decimal" : "list-disc"}`}
      style={{ color: "var(--t-secondary)" }}
    >
      {lines.map((line, i) => (
        <li key={i}>{renderInline(line)}</li>
      ))}
    </Tag>
  );
}

function ParagraphBlock({ lines }: { lines: string[] }) {
  return (
    <p
      className="my-1.5 text-[12px] leading-relaxed"
      style={{ color: "var(--t-secondary)" }}
    >
      {lines.map((line, i) => (
        <span key={i}>
          {renderInline(line)}
          {i < lines.length - 1 && " "}
        </span>
      ))}
    </p>
  );
}

/* ─── main component ─── */

export function MarkdownBody({ content }: MarkdownBodyProps) {
  const blocks = useMemo(() => parseBlocks(content), [content]);

  if (blocks.length === 0) {
    return null;
  }

  return (
    <div className="markdown-body space-y-0.5">
      {blocks.map((block, i) => {
        switch (block.type) {
          case "heading":
            return <HeadingBlock key={i} level={block.level ?? 2} text={block.lines[0]} />;
          case "table":
            return <TableBlock key={i} lines={block.lines} />;
          case "codeblock":
            return <CodeBlock key={i} lang={block.lang} lines={block.lines} />;
          case "blockquote":
            return <BlockquoteBlock key={i} lines={block.lines} />;
          case "list":
            return <ListBlock key={i} lines={block.lines} ordered={block.ordered ?? false} />;
          case "hr":
            return (
              <hr
                key={i}
                className="my-3"
                style={{ borderColor: "var(--border-subtle)" }}
              />
            );
          case "paragraph":
            return <ParagraphBlock key={i} lines={block.lines} />;
          default:
            return null;
        }
      })}
    </div>
  );
}
