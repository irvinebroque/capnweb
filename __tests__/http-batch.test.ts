// Copyright (c) 2026 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import {
  RpcStub, RpcTarget, newHttpBatchRpcSession,
  newHttpBatchRpcResponse, nodeHttpBatchRpcResponse,
} from "../src/index.js";

describe.each(["fetch", "node"] as const)("%s HTTP batch session cleanup", (adapter) => {
  let disposed: { roots: number; children: number };
  let server: Server;
  let endpoint: string;
  let target: Root | RpcStub<Root>;

  class Child extends RpcTarget {
    value() { return 42; }
    fail() { throw new Error("expected method failure"); }
    [Symbol.dispose]() { disposed.children++; }
  }

  class Root extends RpcTarget {
    #retained?: RpcStub<Child>;

    child() { return new Child(); }
    async delayedChild() {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (disposed.roots !== 0) throw new Error("root disposed before call completed");
      return new Child();
    }
    retain(child: RpcStub<Child>) {
      this.#retained = child.dup();
      return true;
    }
    stream(fail = false) {
      let index = 0;
      return new ReadableStream<Uint8Array>({
        pull(controller) {
          if (disposed.roots !== 0) throw new Error("root disposed before stream drained");
          if (index++ === 0) controller.enqueue(new Uint8Array([1, 2, 3]));
          else if (fail) controller.error(new Error("expected stream failure"));
          else controller.close();
        },
      });
    }
    [Symbol.dispose]() {
      disposed.roots++;
      this.#retained?.[Symbol.dispose]();
    }
  }

  beforeEach(async () => {
    disposed = { roots: 0, children: 0 };
    target = new Root();
    server = createServer((request, response) => {
      void (async () => {
        if (adapter === "node") {
          await nodeHttpBatchRpcResponse(request, response, target);
        } else {
          // Bridge a real HTTP request into the Fetch adapter. Both adapters are
          // exercised through the public batch client and real wire serialization.
          let chunks: Buffer[] = [];
          for await (let chunk of request) chunks.push(chunk);
          let result = await newHttpBatchRpcResponse(new Request(endpoint, {
            method: request.method,
            body: request.method === "POST" ? Buffer.concat(chunks) : undefined,
          }), target);
          result.headers.forEach((value, name) => response.setHeader(name, value));
          response.writeHead(result.status);
          response.end(await result.text());
        }
      })().catch((error) => {
        response.writeHead(500);
        response.end(String(error));
      });
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    let address = server.address();
    if (!address || typeof address === "string") throw new Error("expected TCP listener");
    endpoint = `http://127.0.0.1:${address.port}/`;
  });

  afterEach(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  });

  it.each([false, true])("disposes root and returned targets after a call (failure: %s)", async (fail) => {
    using api = newHttpBatchRpcSession<Root>(endpoint);
    if (fail) {
      await expect(Promise.resolve(api.child().fail())).rejects.toThrow("expected method failure");
    } else {
      expect(await api.child().value()).toBe(42);
    }
    expect(disposed).toEqual({ roots: 1, children: 1 });
  });

  it("releases a duplicated capability retained by the root", async () => {
    using api = newHttpBatchRpcSession<Root>(endpoint);
    expect(await api.retain(api.child())).toBe(true);
    expect(disposed).toEqual({ roots: 1, children: 1 });
  });

  it("waits for asynchronous pipelined results before disposal", async () => {
    using api = newHttpBatchRpcSession<Root>(endpoint);
    expect(await api.delayedChild().value()).toBe(42);
    expect(disposed).toEqual({ roots: 1, children: 1 });
  });

  it("disposes the root after an empty batch", async () => {
    let response = await fetch(endpoint, { method: "POST", body: "" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(disposed).toEqual({ roots: 1, children: 0 });
  });

  it("disposes the root once when malformed wire input rejects the handler", async () => {
    let response = await fetch(endpoint, { method: "POST", body: "not-json" });
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("SyntaxError");
    expect(disposed).toEqual({ roots: 1, children: 0 });
  });

  it("preserves a completed single-chunk stream across session disposal", async () => {
    using api = newHttpBatchRpcSession<Root>(endpoint);
    let stream = await api.stream();
    expect(disposed.roots).toBe(1);
    let bytes = new Uint8Array(await new Response(stream).arrayBuffer());
    expect([...bytes]).toEqual([1, 2, 3]);
  });

  it("disposes the root when a stream errors without hanging", async () => {
    using api = newHttpBatchRpcSession<Root>(endpoint);
    await expect((async () => {
      let stream = await api.stream(true);
      await new Response(stream).arrayBuffer();
    })()).rejects.toThrow("expected stream failure");
    expect(disposed.roots).toBe(1);
  });

  it("releases only the session's reference when given a duplicated root stub", async () => {
    {
      using owner = new RpcStub(new Root());
      target = owner.dup();
      using api = newHttpBatchRpcSession<Root>(endpoint);
      expect(await api.child().value()).toBe(42);
      expect(disposed).toEqual({ roots: 0, children: 1 });
    }
    expect(disposed).toEqual({ roots: 1, children: 1 });
  });

  it("does not take ownership of the root when rejecting a non-POST request", async () => {
    let response = await fetch(endpoint);
    expect(response.status).toBe(405);
    expect(await response.text()).toBe(
      adapter === "fetch" ? "This endpoint only accepts POST requests." : ""
    );
    expect(disposed).toEqual({ roots: 0, children: 0 });
  });
});
