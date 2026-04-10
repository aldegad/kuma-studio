#!/usr/bin/env node

import {
  readSurfaceRegistryFile,
  removeSurfaceFromRegistry,
  resolveProjectAnchorSurface,
  resolveRegistryMemberContext,
  upsertRegistryLabelSurface,
  writeSurfaceRegistryFile,
} from "./surface-registry.mjs";

/**
 * @param {unknown} value
 * @returns {void}
 */
function writeJson(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

const [, , command = "", ...args] = process.argv;

switch (command) {
  case "upsert-label-surface": {
    const [registryPath = "", projectId = "", label = "", surface = ""] = args;
    const nextRegistry = upsertRegistryLabelSurface(
      readSurfaceRegistryFile(registryPath),
      projectId,
      label,
      surface,
    );
    writeSurfaceRegistryFile(registryPath, nextRegistry);
    writeJson(nextRegistry);
    break;
  }
  case "remove-surface": {
    const [registryPath = "", surface = "", projectFilter = ""] = args;
    const nextRegistry = removeSurfaceFromRegistry(
      readSurfaceRegistryFile(registryPath),
      surface,
      projectFilter,
    );
    writeSurfaceRegistryFile(registryPath, nextRegistry);
    writeJson(nextRegistry);
    break;
  }
  case "resolve-project-anchor-surface": {
    const [registryPath = "", projectId = ""] = args;
    const surface = resolveProjectAnchorSurface(readSurfaceRegistryFile(registryPath), projectId);
    if (!surface) {
      process.exit(1);
    }
    process.stdout.write(`${surface}\n`);
    break;
  }
  case "resolve-member-context": {
    const [registryPath = "", requestedProject = "", rawMember = ""] = args;
    const member = JSON.parse(rawMember);
    const context = resolveRegistryMemberContext(
      readSurfaceRegistryFile(registryPath),
      member,
      requestedProject,
    );
    if (!context) {
      process.exit(1);
    }
    writeJson(context);
    break;
  }
  default:
    process.stderr.write(`Unknown surface-registry command: ${command}\n`);
    process.exit(1);
}
