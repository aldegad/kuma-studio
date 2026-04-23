#!/usr/bin/env node
import { copyFile, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const DEFAULT_DEST_DIR = resolve(join(homedir(), ".kuma", "studio", "fonts", "hwp"));
const HANCOM_DOWNLOAD_PAGE = "https://www.hancom.com/support/downloadCenter/download";

function parseArgs(argv) {
  const args = { from: "", dest: DEFAULT_DEST_DIR };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--from") {
      args.from = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--dest") {
      args.dest = argv[index + 1] ?? "";
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function readUrl(url) {
  const headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121 Safari/537.36 KumaStudio/1.0",
  };
  if (/^https:\/\/cdn\.hancom\.com\//iu.test(url)) {
    headers.Referer = HANCOM_DOWNLOAD_PAGE;
  }
  const response = await fetch(url, {
    headers,
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}`);
  }
  return response;
}

async function resolveHancomFontUrl() {
  const html = await (await readUrl(HANCOM_DOWNLOAD_PAGE)).text();
  const buildId = html.match(/"buildId":"([^"]+)"/u)?.[1];
  if (!buildId) {
    throw new Error("Could not find Hancom download page build id.");
  }

  const dataUrl = `https://www.hancom.com/_next/data/${buildId}/ko/support/downloadCenter/download.json?categoryCode=15`;
  const data = await (await readUrl(dataUrl)).json();
  for (const group of data?.pageProps?.downloads ?? []) {
    for (const version of group?.dwnVersion ?? []) {
      if (!String(version.versionNm ?? "").includes("함초롬")) {
        continue;
      }
      for (const file of version.fileList ?? []) {
        const url = String(file.attchFileUrl ?? "");
        if (url) {
          return url;
        }
      }
    }
  }

  throw new Error("Could not find HancomFont.zip in Hancom download data.");
}

async function copyInputToZip(input, targetZipPath) {
  if (!input) {
    input = await resolveHancomFontUrl();
  }

  if (/^https?:\/\//iu.test(input)) {
    const response = await readUrl(input);
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(targetZipPath, buffer);
    return input;
  }

  await copyFile(resolve(input), targetZipPath);
  return resolve(input);
}

async function assertZipFile(zipPath) {
  const buffer = await readFile(zipPath);
  if (buffer.length < 4 || buffer[0] !== 0x50 || buffer[1] !== 0x4b) {
    throw new Error("Downloaded file is not a ZIP archive. Hancom may have returned an error page.");
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("Usage: node scripts/install-hwp-fonts.mjs [--from HancomFont.zip|https://...] [--dest ~/.kuma/studio/fonts/hwp]");
    return;
  }

  const destDir = resolve(args.dest || DEFAULT_DEST_DIR);
  const workDir = await mkdtemp(join(tmpdir(), "kuma-hwp-fonts-"));
  try {
    const zipPath = join(workDir, "HancomFont.zip");
    const source = await copyInputToZip(args.from, zipPath);
    await assertZipFile(zipPath);

    const extractDir = join(workDir, "extract");
    await mkdir(extractDir, { recursive: true });
    await execFileAsync("unzip", ["-q", zipPath, "-d", extractDir]);

    const { stdout } = await execFileAsync("find", [extractDir, "-type", "f"]);
    const fontPaths = stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /\.(?:ttf|otf|woff|woff2)$/iu.test(line));

    if (fontPaths.length === 0) {
      throw new Error("ZIP archive did not contain supported font files.");
    }

    await mkdir(destDir, { recursive: true });
    const installed = [];
    for (const fontPath of fontPaths) {
      const targetPath = join(destDir, basename(fontPath));
      await copyFile(fontPath, targetPath);
      const metadata = await stat(targetPath);
      installed.push({ name: basename(targetPath), size: metadata.size });
    }

    console.log(`Installed ${installed.length} HWP font files from ${source}`);
    console.log(`Destination: ${destDir}`);
    for (const file of installed) {
      console.log(`- ${file.name} (${file.size.toLocaleString()} bytes)`);
    }
  } finally {
    await rm(workDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
