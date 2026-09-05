// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { getHeapStatistics } from "node:v8";
import ts from "typescript";
import packageJson from "../../package.json" with { type: "json" };

import { createTransformContext, type TransformContextOptions } from "./context.js";
import { transformModule } from "./transform-module.js";

export type ProgramGraph = {
  schemaVersion: 1;
  tsconfig: string;
  compilerVersion: string;
  transformPackageVersion: string;
  rootFileCount: number;
  sourceFileCount: number;
  rootFiles: string[];
  sourceFiles: string[];
  markerFiles: string[];
};

type MemoryStage = {
  heapUsedBytes: number;
  rssBytes: number;
  externalBytes: number;
  arrayBuffersBytes: number;
  maxRssBytes: number;
  peakMallocedBytes: number;
};

export type ProgramMemoryObservation = {
  schemaVersion: 1;
  graphSha256: string;
  environment: {
    nodeVersion: string;
    os: string;
    architecture: string;
    runnerLabel: string;
  };
  elapsedProgramConstructionMs: number;
  transformedMarkerFileCount: number;
  stages: {
    afterProgramAndChecker: MemoryStage;
    afterMarkerTransforms: MemoryStage;
    afterContextDisposal: MemoryStage;
  };
  v8HeapLimitBytes: number;
};

export async function inspectProgram(options: TransformContextOptions & {
  memory?: boolean;
  runnerLabel?: string;
}): Promise<{
  graph: ProgramGraph;
  graphSha256: string;
  memory?: ProgramMemoryObservation;
}> {
  if (options.memory && typeof globalThis.gc !== "function") {
    throw new Error("capnweb-validate: memory inspection requires Node --expose-gc.");
  }
  let cwd = resolve(options.cwd ?? process.cwd());
  let context = createTransformContext(options);
  let constructionStarted = performance.now();
  let graph: ProgramGraph;
  let elapsedProgramConstructionMs: number;
  let afterProgramAndChecker: MemoryStage | undefined;
  let afterMarkerTransforms: MemoryStage | undefined;
  try {
    context.getProgram();
    context.getChecker();
    elapsedProgramConstructionMs = performance.now() - constructionStarted;
    afterProgramAndChecker = options.memory ? measureMemory() : undefined;

    let rootFiles = context.getProgram().getRootFileNames().map((file) => stablePath(file, cwd)).sort();
    let sourceFiles = context.getProgram().getSourceFiles()
      .map((file) => stablePath(file.fileName, cwd)).sort();
    let markerFiles: string[] = [];
    // Use the same file filters and marker resolution as a build, including aliases,
    // namespaces and shadowed imports. Inspection must not maintain its own scanner.
    for (let file of context.listSourceFiles()) {
      let code = await readFile(file, "utf8");
      if (transformModule(context, file, code)) markerFiles.push(stablePath(file, cwd));
    }
    markerFiles.sort();
    graph = {
      schemaVersion: 1,
      tsconfig: stablePath(context.getProgram().getCompilerOptions().configFilePath as string, cwd),
      compilerVersion: ts.version,
      transformPackageVersion: packageJson.version,
      rootFileCount: rootFiles.length,
      sourceFileCount: sourceFiles.length,
      rootFiles,
      sourceFiles,
      markerFiles,
    };
    afterMarkerTransforms = options.memory ? measureMemory() : undefined;
  } finally {
    context.dispose();
  }
  // Only path strings and scalar measurements survive disposal, not AST nodes.
  let afterContextDisposal = options.memory ? measureMemory() : undefined;
  let graphText = `${JSON.stringify(graph, null, 2)}\n`;
  let graphSha256 = createHash("sha256").update(graphText).digest("hex");
  let memory = options.memory ? {
    schemaVersion: 1 as const,
    graphSha256,
    environment: {
      nodeVersion: process.version,
      os: platform(),
      architecture: arch(),
      runnerLabel: options.runnerLabel ?? process.env.RUNNER_NAME ??
        (process.env.CI ? "ci" : "local"),
    },
    elapsedProgramConstructionMs,
    transformedMarkerFileCount: graph.markerFiles.length,
    stages: {
      afterProgramAndChecker: afterProgramAndChecker!,
      afterMarkerTransforms: afterMarkerTransforms!,
      afterContextDisposal: afterContextDisposal!,
    },
    v8HeapLimitBytes: getHeapStatistics().heap_size_limit,
  } satisfies ProgramMemoryObservation : undefined;
  return { graph, graphSha256, memory };
}

function measureMemory(): MemoryStage {
  globalThis.gc!();
  let usage = process.memoryUsage();
  let resources = process.resourceUsage();
  let heap = getHeapStatistics();
  return {
    heapUsedBytes: usage.heapUsed,
    rssBytes: usage.rss,
    externalBytes: usage.external,
    arrayBuffersBytes: usage.arrayBuffers,
    maxRssBytes: resources.maxRSS * 1024,
    peakMallocedBytes: heap.peak_malloced_memory,
  };
}

function stablePath(file: string, cwd: string): string {
  return relative(cwd, resolve(file)).replace(/\\/g, "/") || ".";
}
