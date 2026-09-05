// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { describe, expect, it } from "vitest";
import ts from "typescript";
import * as runtime from "../src/internal/core.js";
import * as markers from "../src/index.js";
import { DECORATOR_SHIM, transformError, transformFixture } from "./helpers.js";

const options = {
  shim: DECORATOR_SHIM,
  imports: `import { RpcTarget } from "capnweb";
    import { validateRpc, skipRpcValidation } from "capnweb-validate";\n`,
};

function evaluate(code: string): any {
  const js = ts.transpileModule(code, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  new Function("require", "exports", js)((name: string) => {
    if (name === "capnweb") return { RpcTarget: class {} };
    if (name === "capnweb-validate") return markers;
    if (name === "capnweb-validate/internal/core") return runtime;
    throw new Error(`unexpected import: ${name}`);
  }, exports);
  return exports;
}

describe("direct class validation lowering", () => {
  it("preserves live exports, static initialization, inheritance, identity and private fields", () => {
    const { code } = transformFixture(`
      export let runs = 0;
      @validateRpc()
      export class Base extends RpcTarget {
        static label = "base";
        static { runs++; }
        #secret = "hello";
        greet(name: string): string { return this.#secret + ":" + name; }
      }
      export const original = Base;
      @validateRpc()
      export class Child extends Base {
        child(value: number): number { return value; }
      }
      export default Base;
    `, options);
    expect(code).not.toMatch(/@validateRpc|@__cw\.__validateRpcClass/);
    const output = evaluate(code);
    expect(output.Base).toBe(output.original);
    expect(output.default).toBe(output.Base);
    expect(output.Base.name).toBe("Base");
    expect(output.Base.label).toBe("base");
    expect(output.runs).toBe(1);
    const child = new output.Child();
    expect(child).toBeInstanceOf(output.Base);
    expect(child.greet("world")).toBe("hello:world");
    expect(child.child(42)).toBe(42);
    expect(() => child.greet(42)).toThrow(/string/);
    expect(() => child.child("bad")).toThrow(/number/);
  });

  it.each([
    ["@validateRpc()", "@skipRpcValidation()"],
    ["@vr()", "@skip()"],
    ["@cv.validateRpc()", "@cv.skipRpcValidation"],
  ])("removes owned class and method markers (%s)", (classMarker, methodMarker) => {
    const { code } = transformFixture(`
      import { validateRpc as vr, skipRpcValidation as skip } from "capnweb-validate";
      import * as cv from "capnweb-validate";
      ${classMarker}
      export class Api extends RpcTarget {
        ${methodMarker}
        unchecked(value: string): string { return value; }
        checked(value: string): string { return value; }
      }
    `, options);
    expect(code).not.toContain("@");
    const { Api } = evaluate(code);
    expect(new Api().unchecked(42)).toBe(42);
    expect(() => new Api().checked(42)).toThrow(/string/);
  });

  it.each([
    ["@validateRpc() export default class extends RpcTarget {}", /named class/],
    ["@validateRpc() export default class Api extends RpcTarget {}", /default-exported/],
    ["@validateRpc() @validateRpc() class Api extends RpcTarget {}", /only one/],
    ["declare const other: any; @other @validateRpc() class Api extends RpcTarget {}", /composed/],
  ])("rejects ambiguous class lowering: %s", (source, message) => {
    expect(transformError(source, options)).toMatch(message);
  });

  it("retains prototype identity through the shared runtime helper and decorator adapter", () => {
    class Api { value(input: string) { return input; } }
    const validator = { serviceName: "Api", methods: {
      value: { args: [runtime.v.string], returns: runtime.v.string },
    } };
    expect(runtime.__applyRpcClassValidation(Api, validator)).toBe(Api);
    expect(runtime.__validateRpcClass(validator)(Api)).toBe(Api);
    expect(() => new Api().value(42 as any)).toThrow(/string/);
  });
});
