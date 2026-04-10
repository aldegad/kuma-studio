#!/usr/bin/env node

import { readFileSync } from "node:fs";

import { classifySurfaceOutput } from "./surface-classifier.mjs";

const output = readFileSync(0, "utf8");
process.stdout.write(`${JSON.stringify(classifySurfaceOutput(output))}\n`);
