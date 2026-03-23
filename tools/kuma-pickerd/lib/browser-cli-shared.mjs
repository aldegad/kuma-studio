import { accessSync, constants } from "node:fs";
import { resolve } from "node:path";

import { readOptionalString } from "./cli-options.mjs";

export function readKeyboardModifierFlags(options) {
  return {
    shiftKey: options["shift"] === true,
    altKey: options["alt"] === true,
    ctrlKey: options["ctrl"] === true,
    metaKey: options["meta"] === true,
  };
}

export function readRequiredLocalFilePaths(options) {
  const rawFiles = readOptionalString(options, "files");
  if (!rawFiles) {
    throw new Error("browser-set-files requires --files.");
  }

  const files = readFileList(rawFiles);
  if (files.length === 0) {
    throw new Error("browser-set-files requires --files.");
  }

  return files.map((filePath) => {
    const absolutePath = resolve(filePath);
    try {
      accessSync(absolutePath, constants.R_OK);
    } catch {
      throw new Error(`File is not readable: ${absolutePath}`);
    }

    return absolutePath;
  });
}

function readFileList(rawFiles) {
  if (rawFiles.startsWith("[")) {
    let parsed = null;
    try {
      parsed = JSON.parse(rawFiles);
    } catch (error) {
      throw new Error(`Failed to parse --files JSON: ${error instanceof Error ? error.message : String(error)}`);
    }

    if (!Array.isArray(parsed)) {
      throw new Error("--files JSON must be an array of file paths.");
    }

    return parsed
      .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
      .filter(Boolean);
  }

  return rawFiles
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
