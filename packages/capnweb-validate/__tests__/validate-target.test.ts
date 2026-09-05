// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { describe, expect, it } from "vitest";
import ts from "typescript";
import * as capnweb from "capnweb";
import * as runtime from "../src/internal/core.js";
import * as capnwebRuntime from "../src/internal/capnweb.js";
import * as markers from "../src/index.js";
import * as capnwebMarkers from "../src/capnweb.js";
import { SHIM, transformError, transformFixture } from "./helpers.js";

const shim = `${SHIM}
declare module "capnweb-validate" {
  export function validateTarget<T extends object>(target: T): T;
}
declare module "capnweb-validate/capnweb" {
  export function validateTarget<T extends object>(target: T): T;
}`;
const source = `
  import { RpcTarget } from "capnweb";
  import { validateTarget, validateTarget as exact } from "capnweb-validate";
  import * as cv from "capnweb-validate";
  import { newWorkersRpcResponse } from "capnweb-validate/capnweb";
  interface Child extends RpcTarget { greet(name: string): string; }
  interface Surface extends RpcTarget { readonly child: Child; value(name: string): string; }
  class ChildTarget extends RpcTarget {
    #prefix = "child";
    greet(name: string): string { return this.#prefix + ":" + name; }
    hidden(): string { return "hidden"; }
  }
  class Target extends RpcTarget {
    #prefix = "root";
    get child(): Child { return new ChildTarget(); }
    value(name: string): string { return this.#prefix + ":" + name; }
    hidden(): string { return "hidden"; }
  }
  export const root = validateTarget<Surface>(new Target());
  export const alias = exact<Surface>(new Target());
  export const namespace = cv.validateTarget<Surface>(new Target());
  export const inferred = validateTarget(new Target());
  export function response(request: Request) {
    return newWorkersRpcResponse(request, validateTarget<Surface>(new Target()));
  }
`;

function buildTarget() {
  const { code } = transformFixture(source, { shim, imports: "" });
  const compiled = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const imports: Record<string, unknown> = {
    "capnweb": capnweb,
    "capnweb-validate": markers,
    "capnweb-validate/capnweb": capnwebMarkers,
    "capnweb-validate/internal/core": runtime,
    "capnweb-validate/internal/capnweb": capnwebRuntime,
  };
  const exports: any = {};
  new Function("require", "exports", compiled)((name: string) => {
    if (!(name in imports)) throw new Error(`unexpected import: ${name}`);
    return imports[name];
  }, exports);
  return { code, ...exports };
}

describe("validateTarget", () => {
  it("fails closed without a transform and is available through both marker entrypoints", () => {
    expect(() => markers.validateTarget({})).toThrow(/before it was transformed/);
    expect(capnwebMarkers.validateTarget).toBe(markers.validateTarget);
  });

  it("uses the explicit interface, preserves private fields and wraps getter capabilities", () => {
    const { root, alias, namespace, inferred, code } = buildTarget();
    expect(code).toContain("__cvcore.wrapServerTarget<Surface>");
    expect(code).toContain("__cw.__newWorkersRpcResponseWithValidation");
    for (const target of [root, alias, namespace]) {
      expect(target.value("ok")).toBe("root:ok");
      expect(target.child.greet("ok")).toBe("child:ok");
      expect(() => target.value(42)).toThrow(/string/);
      expect(() => target.child.greet(42)).toThrow(/string/);
      expect(() => target.hidden()).toThrow(TypeError);
      expect(() => target.child.hidden()).toThrow(TypeError);
    }
    expect(inferred.hidden()).toBe("hidden");
  });

  it("enforces the root and returned capability through an unwrapped MessagePort transport", async () => {
    const { root } = buildTarget();
    const channel = new MessageChannel();
    using server = capnweb.newMessagePortRpcSession(channel.port1, root);
    using client = capnweb.newMessagePortRpcSession<any>(channel.port2);
    expect(await client.value("wire")).toBe("root:wire");
    expect(await client.child.greet("wire")).toBe("child:wire");
    await expect(Promise.resolve(client.value(42))).rejects.toThrow(/string/);
    await expect(Promise.resolve(client.child.greet(42))).rejects.toThrow(/string/);
    await expect(Promise.resolve(client.hidden())).rejects.toBeInstanceOf(TypeError);
    await expect(Promise.resolve(client.child.hidden())).rejects.toBeInstanceOf(TypeError);
  });

  it("supports the Cap'n Web marker entrypoint without transport-specific runtime imports", () => {
    const { code } = transformFixture(`
      import { validateTarget } from "capnweb-validate/capnweb";
      class Api { value(input: string): string { return input; } }
      export const api = validateTarget<Api>(new Api());
    `, { shim, imports: "" });
    expect(code).toContain('from "capnweb-validate/internal/core"');
    expect(code).not.toContain('from "capnweb-validate/internal/capnweb"');
  });

  it("rejects an unresolved target surface at build time", () => {
    expect(transformError(`
      import { validateTarget } from "capnweb-validate";
      declare const target: any;
      export const api = validateTarget(target);
    `, { shim, imports: "" })).toMatch(/concrete service type/);
  });
});
