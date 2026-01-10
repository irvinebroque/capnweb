// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import type { User, Post, Comment } from './types.js';

/**
 * In-memory data store for the demo.
 * In a real application, this would be a database.
 */

export const users = new Map<string, User>([
  ['u1', { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' }],
  ['u2', { id: 'u2', name: 'Alan Turing', email: 'alan@example.com' }],
  ['u3', { id: 'u3', name: 'Grace Hopper', email: 'grace@example.com' }],
]);

export const posts = new Map<string, Post>([
  ['p1', {
    id: 'p1',
    authorId: 'u1',
    title: 'Introduction to Analytical Engines',
    body: 'The Analytical Engine has no pretensions whatever to originate anything.',
    createdAt: '2024-01-15T10:00:00Z',
  }],
  ['p2', {
    id: 'p2',
    authorId: 'u2',
    title: 'On Computable Numbers',
    body: 'We may compare a man in the process of computing a real number to a machine.',
    createdAt: '2024-01-16T14:30:00Z',
  }],
]);

export const comments = new Map<string, Comment>([
  ['c1', {
    id: 'c1',
    postId: 'p1',
    authorId: 'u2',
    body: 'Fascinating work on the Analytical Engine!',
    createdAt: '2024-01-15T11:00:00Z',
  }],
  ['c2', {
    id: 'c2',
    postId: 'p1',
    authorId: 'u3',
    body: 'This reminds me of my work on compilers.',
    createdAt: '2024-01-15T12:00:00Z',
  }],
]);

let idCounter = 100;
export function generateId(): string {
  return `gen_${++idCounter}`;
}
