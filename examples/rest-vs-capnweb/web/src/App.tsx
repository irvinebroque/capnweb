// Copyright (c) 2025 Cloudflare, Inc.
// Licensed under the MIT license found in the LICENSE.txt file or at:
//     https://opensource.org/license/mit

import { useState, useMemo } from 'react';
import { newHttpBatchRpcSession } from 'capnweb';
import type { Api } from '../../src/worker';
import { BlogApiSdk } from './rest-sdk';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

type NetworkEvent = { label: string; start: number; end: number };
type DemoResult = {
  requests: number;
  totalMs: number;
  data: unknown;
  network: NetworkEvent[];
};

// ─────────────────────────────────────────────────────────────
// Source Code Strings (for display)
// ─────────────────────────────────────────────────────────────

const CAPNWEB_CLIENT_CODE = `import { newHttpBatchRpcSession } from 'capnweb';
import type { Api } from '../../src/worker';

export const createClient = () => 
  newHttpBatchRpcSession<Api>('/rpc');`;

const REST_SDK_CODE = `import type { User, Post, Comment } from '../../src/types';

const BASE_URL = '/rest';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(\`\${BASE_URL}\${path}\`, {
    headers: { 'Content-Type': 'application/json', ...options?.headers },
    ...options,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || response.statusText);
  }
  return response.json();
}

export class BlogApiSdk {
  async getUser(id: string): Promise<User> {
    return request(\`/users/\${encodeURIComponent(id)}\`);
  }

  async listUsers(): Promise<User[]> {
    return request('/users');
  }

  async createPost(authorId: string, title: string, body: string): Promise<Post> {
    return request('/posts', {
      method: 'POST',
      body: JSON.stringify({ authorId, title, body }),
    });
  }

  async getPost(id: string): Promise<Post> {
    return request(\`/posts/\${encodeURIComponent(id)}\`);
  }

  async listPosts(): Promise<Post[]> {
    return request('/posts');
  }

  async updatePost(id: string, title: string, body: string): Promise<Post> {
    return request(\`/posts/\${encodeURIComponent(id)}\`, {
      method: 'PUT',
      body: JSON.stringify({ title, body }),
    });
  }

  async deletePost(id: string): Promise<{ success: boolean }> {
    return request(\`/posts/\${encodeURIComponent(id)}\`, { method: 'DELETE' });
  }

  async createComment(postId: string, authorId: string, body: string): Promise<Comment> {
    return request(\`/posts/\${encodeURIComponent(postId)}/comments\`, {
      method: 'POST',
      body: JSON.stringify({ authorId, body }),
    });
  }

  async listComments(postId: string): Promise<Comment[]> {
    return request(\`/posts/\${encodeURIComponent(postId)}/comments\`);
  }

  async deleteComment(id: string): Promise<{ success: boolean }> {
    return request(\`/comments/\${encodeURIComponent(id)}\`, { method: 'DELETE' });
  }
}`;

const CAPNWEB_USAGE = `// Cap'n Web: Pipelined calls in ONE request
const api = createClient();

// These calls are batched - post.authorId is used
// BEFORE the post promise resolves!
const post = api.createPost('u1', 'Hello', 'World');
const author = api.getUser(post.authorId);
const comments = api.listComments(post.id);

const [p, a, c] = await Promise.all([post, author, comments]);`;

const REST_USAGE = `// REST SDK: Sequential requests (3 round trips)
const sdk = new BlogApiSdk();

// Must await each call before using its result
const post = await sdk.createPost('u1', 'Hello', 'World');
const author = await sdk.getUser(post.authorId);
const comments = await sdk.listComments(post.id);`;

// ─────────────────────────────────────────────────────────────
// Main App Component
// ─────────────────────────────────────────────────────────────

export function App() {
  const [capnwebResult, setCapnwebResult] = useState<DemoResult | null>(null);
  const [restResult, setRestResult] = useState<DemoResult | null>(null);
  const [running, setRunning] = useState(false);
  const [activeTab, setActiveTab] = useState<'client' | 'usage'>('client');

  // Fetch wrapper to count requests and track timing
  const fetchTracker = useMemo(() => {
    let count = 0;
    let events: NetworkEvent[] = [];
    let origin = 0;
    const originalFetch = globalThis.fetch;

    return {
      install() {
        count = 0;
        events = [];
        origin = performance.now();
        (globalThis as any).fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
          const method = init?.method || 'GET';
          const start = performance.now() - origin;
          count++;
          const resp = await originalFetch(input, init);
          const end = performance.now() - origin;
          events.push({ label: `${method} ${url.replace(location.origin, '')}`, start, end });
          return resp;
        };
      },
      uninstall() {
        (globalThis as any).fetch = originalFetch;
      },
      getCount: () => count,
      getEvents: () => [...events],
      getOrigin: () => origin,
    };
  }, []);

  async function runCapnWebDemo(): Promise<DemoResult> {
    fetchTracker.install();
    const t0 = performance.now();

    try {
      const api = newHttpBatchRpcSession<Api>('/rpc');

      // Pipelined calls - all in ONE request!
      const post = api.createPost('u1', 'Cap\'n Web Post', 'This post was created with promise pipelining.');
      const author = api.getUser(post.authorId); // Uses post.authorId before post resolves!
      const allComments = api.listComments('p1'); // Fetch existing comments

      const [p, a, c] = await Promise.all([post, author, allComments]);

      const totalMs = performance.now() - t0;
      return {
        requests: fetchTracker.getCount(),
        totalMs,
        data: { post: p, author: a, comments: c },
        network: fetchTracker.getEvents(),
      };
    } finally {
      fetchTracker.uninstall();
    }
  }

  async function runRestDemo(): Promise<DemoResult> {
    fetchTracker.install();
    const t0 = performance.now();

    try {
      const sdk = new BlogApiSdk();

      // Sequential calls - each must await before the next
      const post = await sdk.createPost('u1', 'REST SDK Post', 'This post required 3 sequential requests.');
      const author = await sdk.getUser(post.authorId);
      const allComments = await sdk.listComments('p1');

      const totalMs = performance.now() - t0;
      return {
        requests: fetchTracker.getCount(),
        totalMs,
        data: { post, author, comments: allComments },
        network: fetchTracker.getEvents(),
      };
    } finally {
      fetchTracker.uninstall();
    }
  }

  async function runDemo() {
    if (running) return;
    setRunning(true);
    setCapnwebResult(null);
    setRestResult(null);

    try {
      const cw = await runCapnWebDemo();
      setCapnwebResult(cw);

      const rest = await runRestDemo();
      setRestResult(rest);
    } catch (err) {
      console.error('Demo error:', err);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Cap'n Web vs REST SDK</h1>
        <p style={styles.subtitle}>
          Compare a traditional hand-crafted REST SDK with Cap'n Web's approach
        </p>
      </header>

      {/* Code Comparison Section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Code Comparison</h2>
        
        <div style={styles.tabs}>
          <button
            style={{ ...styles.tab, ...(activeTab === 'client' ? styles.tabActive : {}) }}
            onClick={() => setActiveTab('client')}
          >
            Client Setup
          </button>
          <button
            style={{ ...styles.tab, ...(activeTab === 'usage' ? styles.tabActive : {}) }}
            onClick={() => setActiveTab('usage')}
          >
            Usage Example
          </button>
        </div>

        <div style={styles.codeGrid}>
          <div style={styles.codePanel}>
            <div style={styles.codePanelHeader}>
              <span style={styles.codePanelTitle}>Cap'n Web</span>
              <span style={styles.lineCount}>
                {activeTab === 'client' ? '5 lines' : '9 lines'}
              </span>
            </div>
            <pre style={styles.code}>
              {activeTab === 'client' ? CAPNWEB_CLIENT_CODE : CAPNWEB_USAGE}
            </pre>
          </div>

          <div style={styles.codePanel}>
            <div style={styles.codePanelHeader}>
              <span style={styles.codePanelTitle}>REST SDK</span>
              <span style={{ ...styles.lineCount, ...styles.lineCountWarning }}>
                {activeTab === 'client' ? '~60 lines' : '8 lines'}
              </span>
            </div>
            <pre style={styles.code}>
              {activeTab === 'client' ? REST_SDK_CODE : REST_USAGE}
            </pre>
          </div>
        </div>
      </section>

      {/* Live Demo Section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Live Demo</h2>
        <p style={styles.description}>
          Scenario: Create a post, fetch its author, and list comments.
          <br />
          Cap'n Web pipelines all calls into <strong>one request</strong>. 
          REST requires <strong>three sequential requests</strong>.
        </p>

        <button
          onClick={runDemo}
          disabled={running}
          style={{ ...styles.button, ...(running ? styles.buttonDisabled : {}) }}
        >
          {running ? 'Running...' : 'Run Comparison'}
        </button>

        {(capnwebResult || restResult) && (
          <div style={styles.resultsGrid}>
            <ResultPanel
              title="Cap'n Web"
              result={capnwebResult}
              accentColor="#3b82f6"
            />
            <ResultPanel
              title="REST SDK"
              result={restResult}
              accentColor="#ef4444"
            />
          </div>
        )}

        {capnwebResult && restResult && (
          <div style={styles.summary}>
            <h3 style={styles.summaryTitle}>Summary</h3>
            <table style={styles.summaryTable}>
              <thead>
                <tr>
                  <th style={styles.th}>Metric</th>
                  <th style={styles.th}>Cap'n Web</th>
                  <th style={styles.th}>REST SDK</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td style={styles.td}>Network Requests</td>
                  <td style={{ ...styles.td, ...styles.good }}>{capnwebResult.requests}</td>
                  <td style={{ ...styles.td, ...styles.bad }}>{restResult.requests}</td>
                </tr>
                <tr>
                  <td style={styles.td}>Total Time</td>
                  <td style={{ ...styles.td, ...styles.good }}>{capnwebResult.totalMs.toFixed(0)}ms</td>
                  <td style={{ ...styles.td, ...styles.bad }}>{restResult.totalMs.toFixed(0)}ms</td>
                </tr>
                <tr>
                  <td style={styles.td}>Time Saved</td>
                  <td style={{ ...styles.td, ...styles.good }} colSpan={2}>
                    {((1 - capnwebResult.totalMs / restResult.totalMs) * 100).toFixed(0)}% faster
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Type Discovery Section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>Type Discovery</h2>
        
        <div style={styles.discoveryGrid}>
          <div style={styles.discoveryPanel}>
            <h3 style={styles.discoveryTitle}>How Types Flow</h3>
            <p style={styles.discoveryText}>
              With Cap'n Web, your TypeScript types flow directly from the server implementation.
              Just import the type, and you get full autocomplete, type checking, and documentation.
            </p>
            <pre style={styles.code}>
{`// Server (worker.ts)
export class Api extends RpcTarget {
  async getUser(id: string): Promise<User> { ... }
  async createPost(...): Promise<Post> { ... }
}

// Client - types flow automatically!
import type { Api } from './worker';
const api = newHttpBatchRpcSession<Api>('/rpc');

// Full autocomplete & type safety
api.getUser('u1')     // knows it returns Promise<User>
api.createPost(...)   // knows the parameters & return type`}
            </pre>
          </div>

          <div style={{ ...styles.discoveryPanel, ...styles.futurePanel }}>
            <h3 style={styles.discoveryTitle}>Coming Soon: Runtime Discovery</h3>
            <p style={styles.discoveryText}>
              Today, types are shared at compile time via TypeScript imports.
              In the future, Cap'n Web will support <strong>runtime schema discovery</strong>:
            </p>
            <pre style={{ ...styles.code, opacity: 0.8 }}>
{`// Future API (not yet implemented)
const api = newHttpBatchRpcSession('/rpc');

// Discover available methods at runtime
const schema = await api.$schema();
// => { methods: ['getUser', 'createPost', ...], ... }

// Dynamic clients, runtime validation,
// and more - without code generation`}
            </pre>
            <p style={{ ...styles.discoveryText, fontStyle: 'italic', marginTop: 12 }}>
              This will enable dynamic clients, runtime validation, and API exploration
              tools - all without requiring code generation or schema files.
            </p>
          </div>
        </div>
      </section>

      {/* Stats Section */}
      <section style={styles.section}>
        <h2 style={styles.sectionTitle}>At a Glance</h2>
        <div style={styles.statsGrid}>
          <StatCard
            label="Client Code"
            capnweb="5 lines"
            rest="60+ lines"
            winner="capnweb"
          />
          <StatCard
            label="Server Routing"
            capnweb="1 line"
            rest="100+ lines"
            winner="capnweb"
          />
          <StatCard
            label="Type Sync"
            capnweb="Automatic"
            rest="Manual"
            winner="capnweb"
          />
          <StatCard
            label="Code Generation"
            capnweb="None"
            rest="Required"
            winner="capnweb"
          />
        </div>
      </section>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────

function ResultPanel({
  title,
  result,
  accentColor,
}: {
  title: string;
  result: DemoResult | null;
  accentColor: string;
}) {
  if (!result) {
    return (
      <div style={styles.resultPanel}>
        <h3 style={{ ...styles.resultTitle, borderColor: accentColor }}>{title}</h3>
        <div style={styles.resultLoading}>Waiting...</div>
      </div>
    );
  }

  const maxTime = Math.max(...result.network.map(e => e.end), 1);

  return (
    <div style={styles.resultPanel}>
      <h3 style={{ ...styles.resultTitle, borderColor: accentColor }}>{title}</h3>
      
      <div style={styles.resultStats}>
        <div>
          <strong>{result.requests}</strong> request{result.requests !== 1 ? 's' : ''}
        </div>
        <div>
          <strong>{result.totalMs.toFixed(0)}ms</strong> total
        </div>
      </div>

      {/* Network Timeline */}
      <div style={styles.timeline}>
        {result.network.map((event, i) => (
          <div key={i} style={styles.timelineRow}>
            <div style={styles.timelineLabel}>{event.label}</div>
            <div style={styles.timelineBar}>
              <div
                style={{
                  ...styles.timelineBarFill,
                  backgroundColor: accentColor,
                  left: `${(event.start / maxTime) * 100}%`,
                  width: `${((event.end - event.start) / maxTime) * 100}%`,
                }}
              />
            </div>
            <div style={styles.timelineTime}>{(event.end - event.start).toFixed(0)}ms</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatCard({
  label,
  capnweb,
  rest,
  winner,
}: {
  label: string;
  capnweb: string;
  rest: string;
  winner: 'capnweb' | 'rest';
}) {
  return (
    <div style={styles.statCard}>
      <div style={styles.statLabel}>{label}</div>
      <div style={styles.statValues}>
        <div style={{ ...styles.statValue, ...(winner === 'capnweb' ? styles.statWinner : {}) }}>
          <span style={styles.statName}>Cap'n Web</span>
          <span>{capnweb}</span>
        </div>
        <div style={{ ...styles.statValue, ...(winner === 'rest' ? styles.statWinner : {}) }}>
          <span style={styles.statName}>REST SDK</span>
          <span>{rest}</span>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Styles
// ─────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 1200,
    margin: '0 auto',
    padding: 24,
    lineHeight: 1.6,
  },
  header: {
    textAlign: 'center',
    marginBottom: 48,
  },
  title: {
    fontSize: 36,
    fontWeight: 700,
    margin: 0,
    color: '#111',
  },
  subtitle: {
    fontSize: 18,
    color: '#666',
    marginTop: 8,
  },
  section: {
    marginBottom: 48,
  },
  sectionTitle: {
    fontSize: 24,
    fontWeight: 600,
    marginBottom: 16,
    color: '#222',
  },
  description: {
    color: '#555',
    marginBottom: 16,
  },
  tabs: {
    display: 'flex',
    gap: 8,
    marginBottom: 16,
  },
  tab: {
    padding: '8px 16px',
    border: '1px solid #ddd',
    borderRadius: 6,
    background: '#fff',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 500,
  },
  tabActive: {
    background: '#111',
    color: '#fff',
    borderColor: '#111',
  },
  codeGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  codePanel: {
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    overflow: 'hidden',
  },
  codePanelHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '8px 12px',
    background: '#f5f5f5',
    borderBottom: '1px solid #e5e5e5',
  },
  codePanelTitle: {
    fontWeight: 600,
    fontSize: 14,
  },
  lineCount: {
    fontSize: 12,
    padding: '2px 8px',
    borderRadius: 4,
    background: '#22c55e',
    color: '#fff',
  },
  lineCountWarning: {
    background: '#f59e0b',
  },
  code: {
    margin: 0,
    padding: 12,
    fontSize: 12,
    lineHeight: 1.5,
    overflow: 'auto',
    background: '#fafafa',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace',
  },
  button: {
    padding: '12px 24px',
    fontSize: 16,
    fontWeight: 600,
    background: '#3b82f6',
    color: '#fff',
    border: 'none',
    borderRadius: 8,
    cursor: 'pointer',
  },
  buttonDisabled: {
    background: '#94a3b8',
    cursor: 'not-allowed',
  },
  resultsGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    marginTop: 24,
  },
  resultPanel: {
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    padding: 16,
  },
  resultTitle: {
    margin: '0 0 12px 0',
    paddingBottom: 8,
    borderBottom: '3px solid',
    fontSize: 18,
  },
  resultLoading: {
    color: '#999',
    fontStyle: 'italic',
  },
  resultStats: {
    display: 'flex',
    gap: 24,
    marginBottom: 16,
    fontSize: 14,
  },
  timeline: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  timelineRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 12,
  },
  timelineLabel: {
    width: 120,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'monospace',
  },
  timelineBar: {
    flex: 1,
    height: 16,
    background: '#f0f0f0',
    borderRadius: 4,
    position: 'relative',
  },
  timelineBarFill: {
    position: 'absolute',
    top: 0,
    height: '100%',
    borderRadius: 4,
    minWidth: 4,
  },
  timelineTime: {
    width: 50,
    textAlign: 'right',
    fontFamily: 'monospace',
  },
  summary: {
    marginTop: 24,
    padding: 16,
    background: '#f9fafb',
    borderRadius: 8,
  },
  summaryTitle: {
    margin: '0 0 12px 0',
    fontSize: 16,
  },
  summaryTable: {
    width: '100%',
    borderCollapse: 'collapse',
    fontSize: 14,
  },
  th: {
    textAlign: 'left',
    padding: '8px 12px',
    borderBottom: '2px solid #e5e5e5',
  },
  td: {
    padding: '8px 12px',
    borderBottom: '1px solid #e5e5e5',
  },
  good: {
    color: '#16a34a',
    fontWeight: 600,
  },
  bad: {
    color: '#dc2626',
  },
  discoveryGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
  },
  discoveryPanel: {
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    padding: 16,
  },
  futurePanel: {
    background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 100%)',
    borderColor: '#fcd34d',
  },
  discoveryTitle: {
    margin: '0 0 8px 0',
    fontSize: 16,
  },
  discoveryText: {
    fontSize: 14,
    color: '#555',
    margin: '0 0 12px 0',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 16,
  },
  statCard: {
    border: '1px solid #e5e5e5',
    borderRadius: 8,
    padding: 16,
    textAlign: 'center',
  },
  statLabel: {
    fontSize: 14,
    fontWeight: 600,
    marginBottom: 12,
    color: '#333',
  },
  statValues: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  statValue: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: 13,
    padding: '4px 8px',
    borderRadius: 4,
  },
  statWinner: {
    background: '#dcfce7',
    fontWeight: 600,
  },
  statName: {
    color: '#666',
  },
};
