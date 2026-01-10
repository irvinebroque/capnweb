// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Hand-crafted REST SDK - What you'd typically generate from OpenAPI
 * 
 * This is a MINIMAL implementation. A production SDK would also need:
 * - Retry logic
 * - Authentication handling
 * - Request/response interceptors
 * - Error type mapping
 * - Request cancellation
 * - Caching
 * 
 * Total: ~80 lines (vs ~5 for Cap'n Web)
 */

import type { User, Post, Comment } from '../../src/types';

const BASE_URL = '/rest';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(
  path: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
    ...options,
  });

  if (!response.ok) {
    let message = response.statusText;
    try {
      const body = await response.json();
      message = body.error || message;
    } catch {
      // ignore parse errors
    }
    throw new ApiError(response.status, message);
  }

  return response.json();
}

export class BlogApiSdk {
  // ─────────────────────────────────────────────────────────────
  // Users
  // ─────────────────────────────────────────────────────────────

  async getUser(id: string): Promise<User> {
    return request(`/users/${encodeURIComponent(id)}`);
  }

  async listUsers(): Promise<User[]> {
    return request('/users');
  }

  // ─────────────────────────────────────────────────────────────
  // Posts
  // ─────────────────────────────────────────────────────────────

  async createPost(authorId: string, title: string, body: string): Promise<Post> {
    return request('/posts', {
      method: 'POST',
      body: JSON.stringify({ authorId, title, body }),
    });
  }

  async getPost(id: string): Promise<Post> {
    return request(`/posts/${encodeURIComponent(id)}`);
  }

  async listPosts(): Promise<Post[]> {
    return request('/posts');
  }

  async updatePost(id: string, title: string, body: string): Promise<Post> {
    return request(`/posts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify({ title, body }),
    });
  }

  async deletePost(id: string): Promise<{ success: boolean }> {
    return request(`/posts/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  // ─────────────────────────────────────────────────────────────
  // Comments
  // ─────────────────────────────────────────────────────────────

  async createComment(postId: string, authorId: string, body: string): Promise<Comment> {
    return request(`/posts/${encodeURIComponent(postId)}/comments`, {
      method: 'POST',
      body: JSON.stringify({ authorId, body }),
    });
  }

  async listComments(postId: string): Promise<Comment[]> {
    return request(`/posts/${encodeURIComponent(postId)}/comments`);
  }

  async deleteComment(id: string): Promise<{ success: boolean }> {
    return request(`/comments/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}

// Export a factory function for consistency with capnweb-client
export const createRestSdk = () => new BlogApiSdk();
