import { describe, expect, it } from "vitest";
import {
  assembleReply,
  countChars,
  joinReplies,
  parseReply,
  splitReplies,
} from "./threads-reply-split";

describe("splitReplies", () => {
  it("returns single empty reply for empty body", () => {
    expect(splitReplies("")).toEqual([""]);
  });

  it("returns single reply when no separators", () => {
    expect(splitReplies("hello\nworld")).toEqual(["hello\nworld"]);
  });

  it("splits on standalone --- lines", () => {
    const body = "first reply\n\n---\n\nsecond reply\n\n---\n\nthird";
    expect(splitReplies(body)).toEqual(["first reply", "second reply", "third"]);
  });

  it("ignores --- inside text (not standalone)", () => {
    const body = "line with --- inline\n\n---\n\nnext";
    expect(splitReplies(body)).toEqual(["line with --- inline", "next"]);
  });

  it("handles surrounding whitespace around ---", () => {
    const body = "a\n  ---  \nb";
    expect(splitReplies(body)).toEqual(["a", "b"]);
  });

  it("preserves empty replies on consecutive separators", () => {
    expect(splitReplies("a\n---\n---\nb")).toEqual(["a", "", "b"]);
  });

  it("ignores --- inside fenced code block (fence-aware)", () => {
    const raw = "header\n\n```\n---\ncontent\n---\n```\n\n---\n\ntail";
    expect(splitReplies(raw)).toEqual([
      "header\n\n```\n---\ncontent\n---\n```",
      "tail",
    ]);
  });

  it("ignores --- inside tilde fence", () => {
    const raw = "a\n\n~~~\n---\n~~~\n\n---\n\nb";
    expect(splitReplies(raw)).toEqual(["a\n\n~~~\n---\n~~~", "b"]);
  });

  it("does not cross fence types when closing", () => {
    const raw = "a\n\n```\n---\n~~~\n---\n```\n\n---\n\nb";
    expect(splitReplies(raw)).toEqual([
      "a\n\n```\n---\n~~~\n---\n```",
      "b",
    ]);
  });
});

describe("joinReplies", () => {
  it("joins with blank-line separators", () => {
    expect(joinReplies(["a", "b", "c"])).toBe("a\n\n---\n\nb\n\n---\n\nc");
  });

  it("is roughly inverse of splitReplies after normalization", () => {
    const src = "first\n\n---\n\nsecond\n\n---\n\nthird";
    expect(joinReplies(splitReplies(src))).toBe(src);
  });
});

describe("parseReply / assembleReply", () => {
  it("returns empty body and no attachments for empty raw", () => {
    expect(parseReply("")).toEqual({ body: "", attachments: [] });
  });

  it("leaves reply without code fence untouched", () => {
    const raw = "**헤더**\n\n짧은 본문";
    expect(parseReply(raw)).toEqual({
      body: "**헤더**\n\n짧은 본문",
      attachments: [],
    });
  });

  it("extracts a single code fence as attachment", () => {
    const raw = "**뇌 구조**\n\n```\ntree-content\n```";
    const parsed = parseReply(raw);
    expect(parsed.body).toBe("**뇌 구조**");
    expect(parsed.attachments).toEqual([
      { marker: "```", info: "", content: "tree-content" },
    ]);
  });

  it("preserves code fence language info", () => {
    const raw = "intro\n\n```ts\nconst a = 1;\n```";
    const parsed = parseReply(raw);
    expect(parsed.attachments[0]).toEqual({
      marker: "```",
      info: "ts",
      content: "const a = 1;",
    });
  });

  it("extracts multiple fences in order", () => {
    const raw = "A\n\n```\none\n```\n\nB\n\n```\ntwo\n```";
    const parsed = parseReply(raw);
    expect(parsed.body).toBe("A\n\n\nB");
    expect(parsed.attachments.map((a) => a.content)).toEqual(["one", "two"]);
  });

  it("leaves unclosed fence as body (no silent drop)", () => {
    const raw = "**header**\n\n```\nno close";
    const parsed = parseReply(raw);
    expect(parsed.attachments).toEqual([]);
    expect(parsed.body).toContain("```");
  });

  it("assemble is structural inverse of parse", () => {
    const raw = "**뇌 구조**\n\n```\ntree-content\n```";
    const parsed = parseReply(raw);
    const reassembled = assembleReply(parsed);
    const reparsed = parseReply(reassembled);
    expect(reparsed).toEqual(parsed);
  });

  it("assemble then parse preserves multiple attachments", () => {
    const parsed = {
      body: "intro",
      attachments: [
        { marker: "```", info: "ts", content: "const a = 1;" },
        { marker: "```", info: "", content: "plain" },
      ],
    };
    expect(parseReply(assembleReply(parsed))).toEqual(parsed);
  });
});

describe("countChars", () => {
  it("counts ascii length", () => {
    expect(countChars("hello")).toBe(5);
  });

  it("counts codepoints not UTF-16 units", () => {
    expect(countChars("한글 🦝")).toBe(countChars("한글 🦝"));
    expect(countChars("🦝")).toBe(1);
  });
});
