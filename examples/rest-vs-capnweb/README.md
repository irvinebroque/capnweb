# Cap'n Web vs REST SDK Comparison

This example demonstrates the difference between using Cap'n Web and a traditional REST SDK approach.

## The Problem

Today, the common pattern for building API clients is:

1. Build a REST API (e.g., in a Cloudflare Worker)
2. Generate an OpenAPI specification
3. Generate a TypeScript SDK from the spec
4. Client imports SDK, calls methods

**Every API change requires regenerating and redistributing the SDK.**

## The Cap'n Web Solution

With Cap'n Web:

1. Server exposes methods by extending `RpcTarget`
2. Client connects, gets a typed stub
3. Types flow directly via TypeScript imports
4. **No generation step - types are just TypeScript**

## What This Demo Shows

### 1. Code Comparison

| Aspect | Cap'n Web | REST SDK |
|--------|-----------|----------|
| Client setup | ~5 lines | ~60+ lines |
| Server routing | 1 line (automatic) | ~100 lines |
| Type synchronization | Automatic | Manual |
| Code generation | None | Required |

### 2. Network Efficiency

The demo runs the same scenario with both approaches:

- Create a post
- Fetch the author's details
- List comments

**Cap'n Web**: All calls pipeline into **1 HTTP request** using promise pipelining.

**REST SDK**: Requires **3 sequential requests** (must await each before using its result).

### 3. Type Discovery

With Cap'n Web, your IDE gets full autocomplete and type checking by simply importing the server's type:

```typescript
import { newHttpBatchRpcSession } from 'capnweb';
import type { Api } from './worker';

const api = newHttpBatchRpcSession<Api>('/rpc');
// Full autocomplete, type checking, and documentation!
```

## Running the Demo

```bash
# From the repository root
npm run build              # Build capnweb

# Install web dependencies
cd examples/rest-vs-capnweb/web
npm install

# Build the web app
npm run build

# Return to example root and start the worker
cd ..
npx wrangler dev
```

Then open http://localhost:8787 in your browser.

## File Structure

```
rest-vs-capnweb/
├── src/
│   ├── types.ts       # Shared types (User, Post, Comment, BlogApi)
│   ├── data.ts        # In-memory mock data
│   ├── api.ts         # RpcTarget implementation (~70 lines)
│   └── worker.ts      # REST routes + capnweb endpoint (~120 lines)
├── web/
│   └── src/
│       ├── capnweb-client.ts  # Cap'n Web client (~5 lines)
│       ├── rest-sdk.ts        # Hand-crafted REST SDK (~80 lines)
│       └── App.tsx            # Comparison UI
├── wrangler.toml
└── README.md
```

## Key Takeaways

1. **Less Code**: Cap'n Web eliminates the boilerplate of hand-written SDK methods and server routing.

2. **Faster**: Promise pipelining lets you make dependent calls in a single round trip.

3. **Type Safe**: Types flow directly from server to client - no manual synchronization.

4. **No Build Step**: No need to generate, version, or distribute an SDK.
