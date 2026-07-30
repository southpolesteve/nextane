#!/usr/bin/env node

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await fs.rm(path.join(root, "package-dist"), {
  recursive: true,
  force: true,
});

const tsc = spawn(
  process.execPath,
  [
    path.join(root, "node_modules", "typescript", "bin", "tsc"),
    "--project",
    path.join(root, "tsconfig.package.json"),
  ],
  {
    cwd: root,
    stdio: "inherit",
  },
);

const code = await new Promise((resolve, reject) => {
  tsc.once("error", reject);
  tsc.once("exit", (exitCode, signal) => {
    if (signal) reject(new Error(`TypeScript exited on ${signal}`));
    else resolve(exitCode ?? 1);
  });
});
process.exitCode = code;
