// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { inspectProgram } from "../src/transform/inspect-program.js";

describe("program inspection", () => {
  let cwd: string;
  function write(file: string, text: string) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), text);
  }
  function cli(args: string[], gc = false, entry = "cli.cjs") {
    return spawnSync(process.execPath, [
      ...(gc ? ["--expose-gc"] : []),
      resolve("packages/capnweb-validate/dist", entry), ...args,
    ], { encoding: "utf8", cwd });
  }

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "capnweb-inspect-"));
    write("tsconfig.json", JSON.stringify({
      compilerOptions: { target: "es2022", module: "esnext", types: [] },
      files: ["shim.d.ts", "src/api.ts", "src/namespace.ts", "src/shadow.ts", "scripts/unused.ts"],
    }));
    write("shim.d.ts", `
      declare module "capnweb" { export class RpcTarget { readonly __RPC_TARGET_BRAND: never; } }
      declare module "capnweb-validate" { export function validateRpc(): any; }
      declare module "capnweb-validate/capnweb" {
        export function newWorkersRpcResponse(request: Request, target: object): Promise<Response>;
      }
    `);
    write("src/types.ts", "export interface Value { text: string; }");
    write("src/api.ts", `
      import { RpcTarget } from "capnweb";
      import { validateRpc as validate } from "capnweb-validate";
      import type { Value } from "./types";
      @validate() export class Api extends RpcTarget { value(input: Value) { return input.text; } }
    `);
    write("src/namespace.ts", `
      import { RpcTarget } from "capnweb";
      import * as cv from "capnweb-validate";
      @cv.validateRpc() export class Api extends RpcTarget { value(input: string) { return input; } }
    `);
    write("src/shadow.ts", `
      import { newWorkersRpcResponse } from "capnweb-validate/capnweb";
      export function local(newWorkersRpcResponse: (value: unknown) => unknown) {
        return newWorkersRpcResponse({});
      }
    `);
    write("scripts/unused.ts", "export const unused = true;");
  });

  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("reports deterministic roots, dependencies and actual marker files separately", async () => {
    const first = await inspectProgram({ cwd });
    const second = await inspectProgram({ cwd });
    expect(second).toEqual(first);
    expect(first.memory).toBeUndefined();
    expect(first.graph.tsconfig).toBe("tsconfig.json");
    expect(first.graph.rootFileCount).toBe(5);
    expect(first.graph.rootFiles).not.toContain("src/types.ts");
    expect(first.graph.sourceFiles).toContain("src/types.ts");
    expect(first.graph.markerFiles).toEqual(["src/api.ts", "src/namespace.ts"]);
    expect(first.graph.sourceFileCount).toBe(first.graph.sourceFiles.length);
    expect(first.graph.rootFiles).toEqual([...first.graph.rootFiles].sort());
    expect(first.graph.sourceFiles).toEqual([...first.graph.sourceFiles].sort());
    const pkg = JSON.parse(readFileSync("packages/capnweb-validate/package.json", "utf8"));
    expect(first.graph.transformPackageVersion).toBe(pkg.version);
    expect(first.graphSha256).toBe(createHash("sha256")
      .update(`${JSON.stringify(first.graph, null, 2)}\n`).digest("hex"));
  });

  it("honors transform filters while still reporting the compiler's complete program", async () => {
    const { graph } = await inspectProgram({ cwd, include: ["src/**"], exclude: ["src/namespace.ts"] });
    expect(graph.markerFiles).toEqual(["src/api.ts"]);
    expect(graph.rootFiles).toContain("src/namespace.ts");
    expect(graph.rootFiles).toContain("scripts/unused.ts");
  });

  it.each(["cli.cjs", "cli.mjs"])("writes separate graph and memory JSON through %s", (entry) => {
    const result = cli([
      "inspect-program", "--graph-out", "reports/graph.json",
      "--memory-out", "reports/memory.json", "--runner-label", "test-runner",
      "--server-validation", "warn",
    ], true, entry);
    expect(result.status, result.stderr).toBe(0);
    const graphText = readFileSync(join(cwd, "reports/graph.json"), "utf8");
    const graph = JSON.parse(graphText);
    const memory = JSON.parse(readFileSync(join(cwd, "reports/memory.json"), "utf8"));
    expect(graph.markerFiles).toEqual(["src/api.ts", "src/namespace.ts"]);
    expect(graph).not.toHaveProperty("environment");
    expect(memory.graphSha256).toBe(createHash("sha256").update(graphText).digest("hex"));
    expect(memory.environment.runnerLabel).toBe("test-runner");
    expect(memory.environment.nodeVersion).toBe(process.version);
    expect(memory.transformedMarkerFileCount).toBe(2);
    for (const stage of Object.values(memory.stages) as Record<string, number>[]) {
      for (const bytes of Object.values(stage)) {
        expect(Number.isFinite(bytes)).toBe(true);
        expect(bytes).toBeGreaterThanOrEqual(0);
      }
    }
  }, 15_000);

  it("requires explicit garbage collection for memory observations and writes no partial report", () => {
    const result = cli(["inspect-program", "--graph-out", "graph.json", "--memory-out", "memory.json"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("--expose-gc");
    expect(existsSync(join(cwd, "graph.json"))).toBe(false);
    expect(existsSync(join(cwd, "memory.json"))).toBe(false);
  });

  it.each([
    [[], "Missing --graph-out"],
    [["--graph-out"], "requires a value"],
    [["--graph-out", "--memory-out", "memory.json"], "requires a value"],
    [["--unknown"], "Unknown option"],
    [["--graph-out", "graph.json", "--server-validation", "invalid"], "throw, warn"],
  ])("rejects invalid CLI arguments %j", (args, message) => {
    const result = cli(["inspect-program", ...args]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(message);
  });

  it("rejects colliding report paths before overwriting an existing report", () => {
    write("report.json", "keep this report");
    const result = cli([
      "inspect-program", "--graph-out", "report.json", "--memory-out", "./report.json",
    ], true);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("must be different files");
    expect(readFileSync(join(cwd, "report.json"), "utf8")).toBe("keep this report");
  });

  it("keeps inspection opt-in for ordinary builds", () => {
    const result = cli(["build", "--out", "out"]);
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(cwd, "out/src/api.ts"))).toBe(true);
    expect(result.stdout).not.toContain("inspected");
    expect(existsSync(join(cwd, "graph.json"))).toBe(false);
    expect(existsSync(join(cwd, "memory.json"))).toBe(false);
  });
});
