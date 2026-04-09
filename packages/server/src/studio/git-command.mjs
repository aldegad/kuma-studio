import { execSync } from "node:child_process";

const GIT_STDIO_PIPE = ["ignore", "pipe", "pipe"];

export function buildGitExecOptions(options = {}) {
  const {
    stdio: _ignoredStdio,
    ...rest
  } = options ?? {};

  return {
    ...rest,
    stdio: GIT_STDIO_PIPE,
  };
}

export function execGitSync(command, options = {}) {
  const {
    execSyncImpl = execSync,
    ...rest
  } = options ?? {};

  return execSyncImpl(command, buildGitExecOptions(rest));
}
