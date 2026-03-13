import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');

function startMockServer(handler) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(handler(req)));
    });
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, url: `http://127.0.0.1:${port}` });
    });
  });
}

function runCli(args, env) {
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], { timeout: 5000, env: { ...process.env, ...env } }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

describe('bot-traffic command rendering', () => {
  it('renders project bot traffic summaries', async () => {
    const { server, url } = await startMockServer(() => ({
      scope: 'project',
      project: 'test-site',
      period: { label: '7d', from: '2026-03-07', to: '2026-03-13' },
      summary: {
        automated_requests: { current: 5, previous: 2, change: 3, change_pct: 150 },
        dropped_events: { current: 8, previous: 3, change: 5, change_pct: 167 },
        last_seen_at: 1773370000000,
      },
      categories: [
        { category: 'ai_agent', requests: 3, dropped_events: 6, share_pct: 60 },
        { category: 'search_crawler', requests: 2, dropped_events: 2, share_pct: 40 },
      ],
      actors: [
        { actor: 'ChatGPT-User', category: 'ai_agent', requests: 3, dropped_events: 6, last_seen_at: 1773370000000 },
      ],
      time_series: [
        { date: '2026-03-13', requests: 5, dropped_events: 8 },
      ],
    }));

    try {
      const { code, stdout } = await runCli(['bot-traffic', 'test-site'], {
        AGENT_ANALYTICS_API_KEY: 'aak_test',
        AGENT_ANALYTICS_URL: url,
      });

      assert.equal(code, 0);
      assert.ok(stdout.includes('Bot Traffic: test-site'));
      assert.ok(stdout.includes('Automated requests'));
      assert.ok(stdout.includes('Dropped events'));
      assert.ok(stdout.includes('ChatGPT-User'));
      assert.ok(stdout.includes('ai_agent'));
    } finally {
      server.close();
    }
  });

  it('renders account bot traffic summaries with --all', async () => {
    const { server, url } = await startMockServer(() => ({
      scope: 'account',
      period: { label: '7d', from: '2026-03-07', to: '2026-03-13' },
      summary: {
        automated_requests: { current: 7, previous: 4, change: 3, change_pct: 75 },
        dropped_events: { current: 10, previous: 5, change: 5, change_pct: 100 },
        active_projects: 2,
        total_projects: 3,
        last_seen_at: 1773370000000,
      },
      categories: [
        { category: 'ai_agent', requests: 4, dropped_events: 7, share_pct: 57.1 },
      ],
      projects: [
        { name: 'test-site', requests: 4, dropped_events: 7, share_pct: 57.1, last_seen_at: '2026-03-13' },
      ],
      remaining_projects: 0,
      time_series: [
        { date: '2026-03-13', requests: 7, dropped_events: 10 },
      ],
    }));

    try {
      const { code, stdout } = await runCli(['bot-traffic', '--all'], {
        AGENT_ANALYTICS_API_KEY: 'aak_test',
        AGENT_ANALYTICS_URL: url,
      });

      assert.equal(code, 0);
      assert.ok(stdout.includes('All Sites Bot Traffic'));
      assert.ok(stdout.includes('2 active / 3 total'));
      assert.ok(stdout.includes('test-site'));
    } finally {
      server.close();
    }
  });
});
