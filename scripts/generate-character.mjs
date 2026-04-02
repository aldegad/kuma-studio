#!/usr/bin/env node

/**
 * Generate character assets using OpenAI Image Gen API.
 *
 * Usage:
 *   node scripts/generate-character.mjs --animal beaver --name "Tookdaki" --role "Developer" [--state idle]
 *   node scripts/generate-character.mjs --all   # Generate all kuma team characters
 *
 * Requires OPENAI_API_KEY environment variable.
 */

import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = resolve(__dirname, "../packages/studio-web/src/assets/characters");
const OPENAI_ENV_PATH = join(homedir(), ".claude", ".env.openai");

const KUMA_TEAM = [
  { id: "kuma", name: "Kuma", animal: "bear", role: "Leader" },
  { id: "rumi", name: "Rumi", animal: "fox", role: "Team Lead" },
  { id: "darami", name: "Darami", animal: "chipmunk", role: "SNS/Marketing Analyst" },
  { id: "buri", name: "Buri", animal: "eagle", role: "Market Analyst" },
  { id: "howl", name: "Howl", animal: "wolf", role: "Operator" },
  { id: "tookdaki", name: "Tookdaki", animal: "beaver", role: "Developer" },
  { id: "saemi", name: "Saemi", animal: "parrot", role: "Code Critic" },
  { id: "bamdori", name: "Bamdori", animal: "hedgehog", role: "QA Engineer" },
  { id: "noeuri", name: "Noeuri", animal: "deer", role: "Strategy Director" },
  { id: "kongkongi", name: "Kongkongi", animal: "rabbit", role: "Content Creator" },
  { id: "moongchi", name: "Moongchi", animal: "cat", role: "UX/Growth Specialist" },
  { id: "jjooni", name: "Jjooni", animal: "hamster", role: "Business Analyst" },
];

const STATES = ["idle", "working", "thinking", "completed", "error"];

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--all") {
      args.all = true;
    } else if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[++i];
    }
  }
  return args;
}

async function generateImage(prompt, apiKey) {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-image-1",
      prompt,
      n: 1,
      size: "1024x1024",
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  return data.data?.[0]?.b64_json ?? data.data?.[0]?.url ?? null;
}

async function main() {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    process.stderr.write("Error: OPENAI_API_KEY environment variable is required.\n");
    process.stderr.write(`Run: source ${OPENAI_ENV_PATH}\n`);
    process.exitCode = 1;
    return;
  }

  const args = parseArgs(process.argv.slice(2));

  if (args.all) {
    process.stdout.write(`Generating assets for all ${KUMA_TEAM.length} characters...\n`);
    for (const member of KUMA_TEAM) {
      process.stdout.write(`  Generating ${member.name} (${member.animal})...\n`);
      // Just generate idle state for now
      await generateForCharacter(member, "idle", apiKey);
    }
    process.stdout.write("Done!\n");
  } else if (args.animal && args.name && args.role) {
    const state = args.state ?? "idle";
    await generateForCharacter(
      { id: args.name.toLowerCase(), name: args.name, animal: args.animal, role: args.role },
      state,
      apiKey,
    );
  } else {
    process.stdout.write("Usage:\n");
    process.stdout.write('  node scripts/generate-character.mjs --animal beaver --name "Tookdaki" --role "Developer"\n');
    process.stdout.write("  node scripts/generate-character.mjs --all\n");
  }
}

async function generateForCharacter(character, state, apiKey) {
  const dir = resolve(ASSETS_DIR, character.id);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const stateDescriptions = {
    idle: "sitting at a wooden desk, sipping coffee and looking relaxed",
    working: "typing enthusiastically on a keyboard with focused eyes",
    thinking: "resting chin on paw with a question mark floating above head",
    completed: "jumping with joy with arms raised in celebration",
    error: "looking startled with a sweat drop, holding up a small warning sign",
  };

  const prompt = `A cute 2.5D illustration of a ${character.animal} character named ${character.name}, working as a ${character.role} in a cozy woodland office. Style: soft lines, warm colors, large expressive eyes, chibi proportions. The character is ${stateDescriptions[state] ?? stateDescriptions.idle}. Background: transparent. Aspect ratio: 1:1.`;

  try {
    const result = await generateImage(prompt, apiKey);
    if (result) {
      if (result.startsWith("http")) {
        process.stdout.write(`    ${state}: ${result}\n`);
        // Download and save
        const imageRes = await fetch(result);
        const buffer = Buffer.from(await imageRes.arrayBuffer());
        writeFileSync(resolve(dir, `${state}.png`), buffer);
      } else {
        // base64
        writeFileSync(resolve(dir, `${state}.png`), Buffer.from(result, "base64"));
      }
      process.stdout.write(`    Saved: ${dir}/${state}.png\n`);
    }
  } catch (err) {
    process.stderr.write(`    Error generating ${character.name} ${state}: ${err.message}\n`);
  }

  // Write meta.json
  const metaPath = resolve(dir, "meta.json");
  if (!existsSync(metaPath)) {
    const meta = {
      id: character.id,
      name: character.name,
      animal: character.animal,
      team: "kuma",
      states: {},
    };
    for (const s of STATES) {
      meta.states[s] = { frames: 1, frameDuration: 500, loop: s !== "completed" };
    }
    writeFileSync(metaPath, JSON.stringify(meta, null, 2) + "\n");
    process.stdout.write(`    Meta: ${metaPath}\n`);
  }
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exitCode = 1;
});
