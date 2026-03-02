#!/usr/bin/env node
/* src/router/seam/src/cli.ts */

import * as fs from "node:fs";
import * as path from "node:path";
import { generateRoutesFile } from "./generator.js";
import { scanPages } from "./scanner.js";
import { validateRouteTree } from "./validator.js";

const pagesDir = process.argv[2];
const outputPath = process.argv[3];

if (!pagesDir || !outputPath) {
  console.error("Usage: seam-router-generate <pagesDir> <outputPath>");
  process.exit(1);
}

const tree = scanPages({ pagesDir });
const errors = validateRouteTree(tree);

if (errors.length > 0) {
  for (const err of errors) {
    console.error(`[${err.type}] ${err.message}`);
  }
  process.exit(1);
}

const content = generateRoutesFile(tree, { outputPath });
const dir = path.dirname(outputPath);
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(outputPath, content, "utf-8");
console.log("generated routes.ts");
