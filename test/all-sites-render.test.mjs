import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');

function startMockServer(responseData) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(responseData));
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

describe('all-sites command rendering', () => {
  it('renders summary, daily trend, and top projects', async () => {
    const { server, url } = await startMockServer({
      scope: 'account',
      period: {
        label: '7d',
        from: '2026-03-03',
        to: '2026-03-09',
        previous_from: '2026-02-24',
        previous_to: '2026-03-02',
      },
      summary: {
        total_projects: 3,
        active_projects: 2,
        total_events: { current: 120, previous: 90, change: 30, change_pct: 33 },
      },
      time_series: [
        { date: '2026-03-03', events: 10 },
        { date: '2026-03-09', events: 40 },
      ],
      projects: [
        { id: 'p1', name: 'alpha', events: 80, share_pct: 66.7, last_active_date: '2026-03-09' },
        { id: 'p2', name: 'beta', events: 40, share_pct: 33.3, last_active_date: '2026-03-08' },
      ],
      remaining_projects: 0,
    });

    try {
      const { code, stdout } = await runCli(['all-sites', '--period', '7d'], {
        AGENT_ANALYTICS_API_KEY: 'aak_test',
        AGENT_ANALYTICS_URL: url,
      });

      assert.equal(code, 0);
      assert.ok(stdout.includes('All Sites'));
      assert.ok(stdout.includes('Total events'));
      assert.ok(stdout.includes('120'));
      assert.ok(stdout.includes('33%'));
      assert.ok(stdout.includes('Active projects'));
      assert.ok(stdout.includes('2 of 3'));
      assert.ok(stdout.includes('2026-03-03'));
      assert.ok(stdout.includes('2026-03-09'));
      assert.ok(stdout.includes('alpha'));
      assert.ok(stdout.includes('beta'));
    } finally {
      server.close();
    }
  });

  it('handles empty project activity without crashing', async () => {
    const { server, url } = await startMockServer({
      scope: 'account',
      period: {
        label: '7d',
        from: '2026-03-03',
        to: '2026-03-09',
        previous_from: '2026-02-24',
        previous_to: '2026-03-02',
      },
      summary: {
        total_projects: 2,
        active_projects: 0,
        total_events: { current: 0, previous: 0, change: 0, change_pct: 0 },
      },
      time_series: [
        { date: '2026-03-03', events: 0 },
        { date: '2026-03-09', events: 0 },
      ],
      projects: [],
      remaining_projects: 0,
    });

    try {
      const { code, stdout } = await runCli(['all-sites'], {
        AGENT_ANALYTICS_API_KEY: 'aak_test',
        AGENT_ANALYTICS_URL: url,
      });

      assert.equal(code, 0);
      assert.ok(stdout.includes('All Sites'));
      assert.ok(stdout.includes('No active projects in this period.'));
    } finally {
      server.close();
    }
  });
});
