# AGENTS.md - Cap'n Web

> JavaScript/TypeScript-native RPC library with Promise Pipelining by Cloudflare

## Build Commands

```bash
npm run build              # Build ESM and CJS formats with tsup
npm run build:watch        # Watch mode build
```

Build outputs to `dist/`:
- `dist/index.js` (ESM)
- `dist/index.cjs` (CJS)
- `dist/index-workers.js` (Cloudflare Workers ESM)
- `dist/index-workers.cjs` (Cloudflare Workers CJS)
- `dist/index.d.ts` (TypeScript declarations)

## Test Commands

```bash
npm test                   # Run all tests (Vitest)
npm run test:watch         # Watch mode testing

# Run a single test file
npx vitest run __tests__/index.test.ts

# Run a specific test by name pattern
npx vitest run -t "supports calls"

# Run tests for a specific environment
npx vitest run --project=node
npx vitest run --project=workerd
npx vitest run --project=browsers-with-using
npx vitest run --project=browsers-without-using
```

## Project Structure

```
src/
├── index.ts           # Main public API exports
├── index-workers.ts   # Cloudflare Workers entry point
├── core.ts            # Core RPC implementation (RpcStub, RpcPromise, RpcTarget)
├── rpc.ts             # RPC session and transport logic
├── serialize.ts       # Serialization/deserialization (JSON-based)
├── batch.ts           # HTTP batch RPC transport
├── websocket.ts       # WebSocket RPC transport
├── messageport.ts     # MessagePort RPC transport
├── types.d.ts         # TypeScript type definitions
└── symbols.ts         # Shared symbols

__tests__/
├── index.test.ts      # Main test suite
├── workerd.test.ts    # Cloudflare Workers tests
├── test-server.ts     # Test server setup
└── test-util.ts       # Shared test utilities
```

## Code Style Guidelines

### Copyright Header

Every source file must have this header:
```typescript
// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit
```

### File Naming

- Source files: `lowercase-with-dashes.ts`
- Test files: `name.test.ts`
- Type definitions: `types.d.ts`

### Import Organization

1. External packages first
2. Relative imports from local modules
3. **Use `.js` extension for local imports** (ESM requirement)

```typescript
import { expect, it, describe } from "vitest"
import { RpcStub, RpcTarget } from "../src/index.js"
import { Counter, TestTarget } from "./test-util.js"
```

### Naming Conventions

| Element | Convention | Example |
|---------|------------|---------|
| Classes | PascalCase | `RpcStub`, `RpcSession` |
| Interfaces | PascalCase | `RpcTransport`, `RpcSessionOptions` |
| Type aliases | PascalCase | `PropertyPath`, `ExportId` |
| Functions/methods | camelCase | `getRemoteMain`, `newWebSocketRpcSession` |
| Variables | camelCase | `messageId`, `webSocket` |
| Private fields | #camelCase | `#webSocket`, `#sendQueue` |
| Constants/symbols | UPPER_SNAKE_CASE | `WORKERS_MODULE_SYMBOL` |
| Internal classes | Suffixed with `Impl` | `RpcSessionImpl` |

### TypeScript Patterns

- **Strict mode enabled** - no implicit any, strict null checks
- Use `unknown` over `any` where possible
- Generics for type-safe RPC interfaces
- Branded types for nominal typing (`__RPC_STUB_BRAND`, `__RPC_TARGET_BRAND`)

```typescript
export type RpcStub<T extends RpcCompatible<T>> = Stub<T>;
export type RpcPromise<T extends RpcCompatible<T>> = Stub<T> & Promise<Stubify<T>>;
```

### Error Handling

- Use standard JavaScript Error types (`Error`, `TypeError`, `RangeError`)
- Throw descriptive error messages
- Errors are serializable across RPC boundaries

```typescript
throw new Error("Cannot serialize RPC stubs without an RPC session.");
throw new TypeError("Cannot serialize value: " + stringValue);
throw new Error(`bad RPC message: ${JSON.stringify(msg)}`);
```

### Resource Management

- Implement `Symbol.dispose` for disposable resources
- Implement `Symbol.asyncDispose` for async cleanup
- Use `using` and `await using` keywords in tests

```typescript
class DisposableTarget extends RpcTarget {
  [Symbol.dispose]() { /* cleanup */ }
}
```

## Testing Patterns

- Use `describe()` for grouping related tests
- Use `it()` for individual test cases
- Use `await using` for automatic resource cleanup
- Test harness pattern with `TestHarness` class
- Use `expect.soft()` for non-fatal assertions in disposers

```typescript
describe("basic rpc", () => {
  it("supports calls", async () => {
    await using harness = new TestHarness(new TestTarget());
    expect(await harness.stub.square(3)).toBe(9);
  });
});
```

## Test Environments

Vitest runs tests across multiple environments:
1. **node** - Node.js environment
2. **workerd** - Cloudflare Workers (via `@cloudflare/vitest-pool-workers`)
3. **browsers-with-using** - Chromium with native `using` support
4. **browsers-without-using** - All browsers with transpiled `using`

## Key Design Principles

1. **Object-Capability Model** - Functions and objects can be passed by reference over RPC
2. **Promise Pipelining** - Chain RPC calls without awaiting intermediate results
3. **JSON-based Serialization** - Human-readable wire format with special type handling
4. **Cross-Platform** - Works in browsers, Node.js, and Cloudflare Workers
5. **TypeScript-First** - Full type safety with branded types
6. **Zero Dependencies** - No runtime dependencies

## Tech Stack

| Technology | Details |
|------------|---------|
| Language | TypeScript (strict mode) |
| Targets | Browsers, Node.js, Cloudflare Workers |
| Module system | ESM (with CJS build) |
| Build tool | tsup |
| Test framework | Vitest |
| Package manager | npm |
| Release management | Changesets |

## Polyfills Included

The codebase includes polyfills for:
- `Symbol.dispose` / `Symbol.asyncDispose`
- `Promise.withResolvers()`
