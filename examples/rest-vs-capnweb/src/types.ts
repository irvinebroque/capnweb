// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

/**
 * Shared types between server and clients.
 * 
 * With Cap'n Web, these types flow directly from the server implementation.
 * With a traditional REST SDK, these must be manually kept in sync or generated.
 */

export type User = {
  id: string;
  name: string;
  email: string;
};

export type Post = {
  id: string;
  authorId: string;
  title: string;
  body: string;
  createdAt: string;
};

export type Comment = {
  id: string;
  postId: string;
  authorId: string;
  body: string;
  createdAt: string;
};

/**
 * The Blog API interface.
 * 
 * With Cap'n Web, this interface is automatically available to clients
 * via `import type { Api }` - no SDK generation required.
 */
export interface BlogApi {
  // Users
  getUser(id: string): Promise<User>;
  listUsers(): Promise<User[]>;

  // Posts
  createPost(authorId: string, title: string, body: string): Promise<Post>;
  getPost(id: string): Promise<Post>;
  listPosts(): Promise<Post[]>;
  updatePost(id: string, title: string, body: string): Promise<Post>;
  deletePost(id: string): Promise<{ success: boolean }>;

  // Comments
  createComment(postId: string, authorId: string, body: string): Promise<Comment>;
  listComments(postId: string): Promise<Comment[]>;
  deleteComment(id: string): Promise<{ success: boolean }>;
}
