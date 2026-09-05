// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { describe, expect, it } from "vitest";
import { checkedMethod, loadValidator, SHIM, transformFixture } from "./helpers.js";
import { wrapClientStub, wrapServerTarget } from "../src/internal/core.js";

describe("module-wide nested service sharing", () => {
  it("shares a recursive capability across roots and keeps nested argument checks", () => {
    const { code } = transformFixture(`
      interface Shared extends RpcTarget {
        value(input: { id: string }): string;
        next(): Shared;
      }
      class First extends RpcTarget { shared(): Shared { return null as any; } }
      class Second extends RpcTarget { shared(): Shared { return null as any; } }
      export const first = newWorkersRpcResponse(null as any, new First());
      export const second = newWorkersRpcResponse(null as any, new Second());
    `);
    expect(code.match(/serviceName: "Shared"/g)).toHaveLength(1);
    class Shared {
      value(input: { id: string }) { return input.id; }
      next() { return this; }
    }
    for (const name of ["First", "Second"]) {
      const validator = loadValidator(code, `__capnweb_validate_${name}_server`);
      const root = wrapServerTarget({ shared: () => new Shared() }, validator);
      expect(root.shared().next().next().value({ id: "ok" })).toBe("ok");
      expect(() => root.shared().next().value({ id: 42 as any })).toThrow(/id/);
    }
  });

  it("initializes mutually recursive capability validators without eager cycles", () => {
    const { code } = transformFixture(`
      interface Left extends RpcTarget { right(): Right; value(input: string): string; }
      interface Right extends RpcTarget { left(): Left; }
      class Api extends RpcTarget { left(): Left { return null as any; } }
    `, { target: "new Api()" });
    expect(code.match(/serviceName: "Left"/g)).toHaveLength(1);
    expect(code.match(/serviceName: "Right"/g)).toHaveLength(1);
    const left = { right: () => right, value: (input: string) => input };
    const right = { left: () => left };
    const root = wrapServerTarget({ left: () => left }, loadValidator(code));
    expect(root.left().right().left().value("ok")).toBe("ok");
    expect(() => root.left().right().left().value(42 as any)).toThrow(/string/);
  });

  it("shares a named-shape map across nested services resolved from the same root", () => {
    const { code } = transformFixture(`
      interface Record { uniqueField: string; child?: Record; }
      interface Child extends RpcTarget { accept(record: Record): void; }
      class Api extends RpcTarget {
        accept(record: Record): void {}
        child(): Child { return null as any; }
      }
    `, { target: "new Api()" });
    expect(code.match(/"uniqueField": __cw.v.string/g)).toHaveLength(1);
    const validator = loadValidator(code);
    const root = wrapServerTarget({ accept() {}, child: () => ({ accept() {} }) }, validator);
    expect(() => root.child().accept({ uniqueField: "ok", child: { uniqueField: 1 } } as any))
      .toThrow(/Child\.accept\[0\]\.child/);
  });

  it("keeps same-named services with different contracts separate", () => {
    const { code } = transformFixture(`
      namespace Text { export interface Shared extends RpcTarget { value(input: string): string; } }
      namespace Number { export interface Shared extends RpcTarget { value(input: number): number; } }
      class Api extends RpcTarget {
        text(): Text.Shared { return null as any; }
        number(): Number.Shared { return null as any; }
      }
    `, { target: "new Api()" });
    expect(code.match(/serviceName: "Shared"/g)).toHaveLength(2);
    const root = wrapServerTarget({
      text: () => ({ value: (input: string) => input }),
      number: () => ({ value: (input: number) => input }),
    }, loadValidator(code));
    expect(root.text().value("ok")).toBe("ok");
    expect(root.number().value(42)).toBe(42);
    expect(() => root.text().value(42 as any)).toThrow(/string/);
    expect(() => root.number().value("bad" as any)).toThrow(/number/);
  });

  it("keeps server argument checks and client result checks separate", () => {
    const { code } = transformFixture(`
      import { validateStub } from "capnweb-validate";
      interface Child extends RpcTarget { value(input: string): { kind: "movie" }; }
      class Api extends RpcTarget { child(): Child { return null as any; } }
      export const client = validateStub<Api>({});
    `, {
      target: "new Api()",
      shim: `${SHIM}\ndeclare module "capnweb-validate" {
        export function validateStub<T>(stub: object): unknown;
      }`,
    });
    expect(code.match(/serviceName: "Child"/g)).toHaveLength(2);
    const server = loadValidator(code, "__capnweb_validate_Child_server");
    const client = loadValidator(code, "__capnweb_validate_Child_client");
    expect(checkedMethod(server, "value").args).toHaveLength(1);
    expect(checkedMethod(client, "value").args).toBeUndefined();
    const wrapped = wrapClientStub({ value: () => ({ kind: "music" }) }, client) as {
      value(input: string): unknown;
    };
    expect(() => wrapped.value("ok")).toThrow(/kind/);
  });
});
