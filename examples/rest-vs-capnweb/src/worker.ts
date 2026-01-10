// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { newWorkersRpcResponse } from 'capnweb';
import { Api } from './api.js';

// Re-export for client type imports
export { Api };
export type { BlogApi, User, Post, Comment } from './types.js';

type Env = {
  SIMULATED_DELAY_MS?: string;
};

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function error(message: string, status = 400): Response {
  return json({ error: message }, status);
}

function corsHeaders(request: Request): HeadersInit {
  return {
    'Access-Control-Allow-Origin': request.headers.get('Origin') || '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': request.headers.get('Access-Control-Request-Headers') || '*',
    'Vary': 'Origin',
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const api = new Api();

    // Simulate network delay if configured
    const delay = Number(env.SIMULATED_DELAY_MS ?? 0);
    if (delay > 0) await sleep(delay);

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(request) });
    }

    // ─────────────────────────────────────────────────────────────
    // Cap'n Web endpoint - ONE LINE handles everything!
    // ─────────────────────────────────────────────────────────────
    if (url.pathname === '/rpc') {
      const resp = await newWorkersRpcResponse(request, api);
      // Add CORS headers
      const headers = new Headers(resp.headers);
      Object.entries(corsHeaders(request)).forEach(([k, v]) => headers.set(k, v));
      return new Response(resp.body, { status: resp.status, headers });
    }

    // ─────────────────────────────────────────────────────────────
    // REST endpoints - Manual routing for each operation
    // This is the boilerplate that Cap'n Web eliminates!
    // ─────────────────────────────────────────────────────────────

    const addCors = (resp: Response) => {
      const headers = new Headers(resp.headers);
      Object.entries(corsHeaders(request)).forEach(([k, v]) => headers.set(k, v));
      return new Response(resp.body, { status: resp.status, headers });
    };

    try {
      // --- Users ---
      if (url.pathname === '/rest/users' && request.method === 'GET') {
        return addCors(json(await api.listUsers()));
      }

      const userMatch = url.pathname.match(/^\/rest\/users\/([\w-]+)$/);
      if (userMatch && request.method === 'GET') {
        return addCors(json(await api.getUser(userMatch[1])));
      }

      // --- Posts ---
      if (url.pathname === '/rest/posts' && request.method === 'GET') {
        return addCors(json(await api.listPosts()));
      }

      if (url.pathname === '/rest/posts' && request.method === 'POST') {
        const body = await request.json() as { authorId: string; title: string; body: string };
        return addCors(json(await api.createPost(body.authorId, body.title, body.body)));
      }

      const postMatch = url.pathname.match(/^\/rest\/posts\/([\w-]+)$/);
      if (postMatch && request.method === 'GET') {
        return addCors(json(await api.getPost(postMatch[1])));
      }

      if (postMatch && request.method === 'PUT') {
        const body = await request.json() as { title: string; body: string };
        return addCors(json(await api.updatePost(postMatch[1], body.title, body.body)));
      }

      if (postMatch && request.method === 'DELETE') {
        return addCors(json(await api.deletePost(postMatch[1])));
      }

      // --- Comments ---
      const commentsMatch = url.pathname.match(/^\/rest\/posts\/([\w-]+)\/comments$/);
      if (commentsMatch && request.method === 'GET') {
        return addCors(json(await api.listComments(commentsMatch[1])));
      }

      if (commentsMatch && request.method === 'POST') {
        const body = await request.json() as { authorId: string; body: string };
        return addCors(json(await api.createComment(commentsMatch[1], body.authorId, body.body)));
      }

      const commentMatch = url.pathname.match(/^\/rest\/comments\/([\w-]+)$/);
      if (commentMatch && request.method === 'DELETE') {
        return addCors(json(await api.deleteComment(commentMatch[1])));
      }

      // --- Not found ---
      return addCors(error('Not found', 404));

    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      return addCors(error(message, 500));
    }
  },
};
