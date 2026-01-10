// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { RpcTarget } from 'capnweb';
import type { BlogApi, User, Post, Comment } from './types.js';
import { users, posts, comments, generateId } from './data.js';

/**
 * The Blog API implementation using Cap'n Web.
 * 
 * This single class provides:
 * - The Cap'n Web RPC interface (automatic)
 * - Full TypeScript types for clients (via `import type`)
 * - Business logic that can also be used by REST endpoints
 */
export class Api extends RpcTarget implements BlogApi {
  // ─────────────────────────────────────────────────────────────
  // Users
  // ─────────────────────────────────────────────────────────────

  async getUser(id: string): Promise<User> {
    const user = users.get(id);
    if (!user) throw new Error(`User not found: ${id}`);
    return user;
  }

  async listUsers(): Promise<User[]> {
    return Array.from(users.values());
  }

  // ─────────────────────────────────────────────────────────────
  // Posts
  // ─────────────────────────────────────────────────────────────

  async createPost(authorId: string, title: string, body: string): Promise<Post> {
    if (!users.has(authorId)) {
      throw new Error(`Author not found: ${authorId}`);
    }
    const post: Post = {
      id: generateId(),
      authorId,
      title,
      body,
      createdAt: new Date().toISOString(),
    };
    posts.set(post.id, post);
    return post;
  }

  async getPost(id: string): Promise<Post> {
    const post = posts.get(id);
    if (!post) throw new Error(`Post not found: ${id}`);
    return post;
  }

  async listPosts(): Promise<Post[]> {
    return Array.from(posts.values());
  }

  async updatePost(id: string, title: string, body: string): Promise<Post> {
    const post = posts.get(id);
    if (!post) throw new Error(`Post not found: ${id}`);
    post.title = title;
    post.body = body;
    return post;
  }

  async deletePost(id: string): Promise<{ success: boolean }> {
    const existed = posts.delete(id);
    if (!existed) throw new Error(`Post not found: ${id}`);
    // Also delete associated comments
    for (const [cid, comment] of comments) {
      if (comment.postId === id) comments.delete(cid);
    }
    return { success: true };
  }

  // ─────────────────────────────────────────────────────────────
  // Comments
  // ─────────────────────────────────────────────────────────────

  async createComment(postId: string, authorId: string, body: string): Promise<Comment> {
    if (!posts.has(postId)) {
      throw new Error(`Post not found: ${postId}`);
    }
    if (!users.has(authorId)) {
      throw new Error(`Author not found: ${authorId}`);
    }
    const comment: Comment = {
      id: generateId(),
      postId,
      authorId,
      body,
      createdAt: new Date().toISOString(),
    };
    comments.set(comment.id, comment);
    return comment;
  }

  async listComments(postId: string): Promise<Comment[]> {
    return Array.from(comments.values()).filter(c => c.postId === postId);
  }

  async deleteComment(id: string): Promise<{ success: boolean }> {
    const existed = comments.delete(id);
    if (!existed) throw new Error(`Comment not found: ${id}`);
    return { success: true };
  }
}
