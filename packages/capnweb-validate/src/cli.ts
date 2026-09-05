#!/usr/bin/env node
// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

// Wrangler entry point. Runs the per-module transform across a TS project
// and writes the rewritten output under `--out`, which the user points
// Wrangler at via a `predev` / `prebuild` script.

import { realpathSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { ValidationMode } from "./internal/core.js";
import { runBuild } from "./transform/run.js";
import { inspectProgram } from "./transform/inspect-program.js";

function usage(exitCode: number = 1): never {
  let out = exitCode === 0 ? console.log : console.error;
  out(`Usage:
  capnweb-validate build --out <dir> [options]
  capnweb-validate inspect-program --graph-out <file> [options]

Options:
  --out <dir>                 Directory to write transformed sources to. Required.
  --tsconfig <path>           Path to tsconfig.json. Defaults to ./tsconfig.json.
  --cwd <dir>                 Working directory. Defaults to process.cwd().
  --server-validation <mode>  How server-side checks behave: throw | warn. Default throw.
  --graph-out <file>           Write deterministic program-graph JSON.
  --memory-out <file>          Write environment-labelled memory JSON (requires --expose-gc).
  --runner-label <label>       Label the memory observation runner.
  -h, --help                  Show this message.`);
  process.exit(exitCode);
}

type BuildArgs = {
  out?: string;
  tsconfig?: string;
  cwd?: string;
  serverValidation?: ValidationMode;
};

type InspectArgs = {
  serverValidation?: ValidationMode;
  graphOut?: string;
  memoryOut?: string;
  runnerLabel?: string;
  tsconfig?: string;
  cwd?: string;
};

function parseMode(arg: string, value: string | undefined): ValidationMode {
  if (value === undefined) throw new Error(`${arg} requires a value.`);
  if (value !== "throw" && value !== "warn") {
    throw new Error(`${arg} must be one of throw, warn (got ${value}).`);
  }
  return value;
}

function parseBuildArgs(args: string[]): BuildArgs {
  let parsed: BuildArgs = {};
  for (let i = 0; i < args.length; i++) {
    let arg = args[i];
    if (arg === "--help" || arg === "-h") {
      usage(0);
    } else if (arg === "--out" || arg === "--tsconfig" || arg === "--cwd") {
      let value = args[++i];
      if (value === undefined) throw new Error(`${arg} requires a value.`);
      parsed[arg.slice(2) as "out" | "tsconfig" | "cwd"] = value;
    } else if (arg === "--server-validation") {
      parsed.serverValidation = parseMode(arg, args[++i]);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return parsed;
}

function parseInspectArgs(args: string[]): InspectArgs {
  let parsed: InspectArgs = {};
  const stringOptions = {
    "--graph-out": "graphOut",
    "--memory-out": "memoryOut",
    "--runner-label": "runnerLabel",
    "--tsconfig": "tsconfig",
    "--cwd": "cwd",
  } as const;
  for (let i = 0; i < args.length; i++) {
    let arg = args[i]!;
    if (arg === "--help" || arg === "-h") usage(0);
    if (arg === "--server-validation") {
      parsed.serverValidation = parseMode(arg, args[++i]);
    } else if (Object.hasOwn(stringOptions, arg)) {
      let value = args[++i];
      if (value === undefined || value.startsWith("--")) {
        throw new Error(`${arg} requires a value.`);
      }
      parsed[stringOptions[arg as keyof typeof stringOptions]] = value;
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return parsed;
}

async function main(): Promise<void> {
  let [command, ...rest] = process.argv.slice(2);
  if (command === undefined || command === "--help" || command === "-h") {
    usage(command === undefined ? 1 : 0);
  }
  if (command !== "build" && command !== "inspect-program") {
    throw new Error(`Unknown command: ${command}. Run with --help for usage.`);
  }
  if (command === "inspect-program") {
    let opts = parseInspectArgs(rest);
    if (!opts.graphOut) throw new Error("Missing --graph-out <file>.");
    let cwd = resolve(opts.cwd ?? process.cwd());
    let graphOut = resolve(cwd, opts.graphOut);
    let memoryOut = opts.memoryOut ? resolve(cwd, opts.memoryOut) : undefined;
    if (graphOut === memoryOut) {
      throw new Error("--graph-out and --memory-out must be different files.");
    }
    let result = await inspectProgram({
      cwd,
      tsconfig: opts.tsconfig,
      memory: Boolean(opts.memoryOut),
      runnerLabel: opts.runnerLabel,
      serverValidation: opts.serverValidation,
    });
    await mkdir(dirname(graphOut), { recursive: true });
    await writeFile(graphOut, `${JSON.stringify(result.graph, null, 2)}\n`);
    if (memoryOut && result.memory) {
      await mkdir(dirname(memoryOut), { recursive: true });
      await writeFile(memoryOut, `${JSON.stringify(result.memory, null, 2)}\n`);
    }
    console.log(
      `capnweb-validate: inspected ${result.graph.rootFileCount} roots, ` +
      `${result.graph.sourceFileCount} source files, ` +
      `${result.graph.markerFiles.length} marker files -> ${opts.graphOut}`
    );
    return;
  }
  let opts = parseBuildArgs(rest);
  if (!opts.out) {
    throw new Error(
        "Missing --out <dir>. Specify where to write transformed sources.");
  }
  let result = await runBuild({
    out: opts.out,
    tsconfig: opts.tsconfig,
    cwd: opts.cwd,
    serverValidation: opts.serverValidation,
  });
  console.log(
      `capnweb-validate: ${result.transformed} transformed, ` +
      `${result.copied} copied` +
      (result.skipped ? `, ${result.skipped} skipped (outside project)` : "") +
      ` -> ${opts.out}`);
}

if (isMain()) {
  main().catch((err) => {
    let message = err instanceof Error ? err.message : String(err);
    console.error(`capnweb-validate: ${message}`);
    process.exit(1);
  });
}

function isMain(): boolean {
  let entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
