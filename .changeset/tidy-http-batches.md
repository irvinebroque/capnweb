---
"capnweb": patch
---

Dispose HTTP batch server sessions after capturing their responses, including on failure. This
releases the session's root and remaining exported capabilities in both the Fetch and Node HTTP
adapters. Pass a duplicated root stub when retaining an independently owned reference across batches.
