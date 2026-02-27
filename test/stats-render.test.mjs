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

describe('stats command rendering', () => {
  it('renders timeSeries as daily chart', async () => {
    const { server, url } = await startMockServer({
      totals: { total_events: 100, unique_users: 10 },
      events: [{ event: 'page_view', count: 100, unique_users: 10 }],
      timeSeries: [
        { date: '2026-02-25', total_events: 40, unique_users: 5 },
        { date: '2026-02-26', total_events: 60, unique_users: 8 },
      ],
    });

    try {
      const { stdout } = await runCli(['stats', 'test-project'], {
        AGENT_ANALYTICS_API_KEY: 'aak_test',
        AGENT_ANALYTICS_URL: url,
      });

      // Should render the daily chart section
      assert.ok(stdout.includes('Daily:'), 'should show Daily heading');
      assert.ok(stdout.includes('2026-02-25'), 'should show first date');
      assert.ok(stdout.includes('2026-02-26'), 'should show second date');
      assert.ok(stdout.includes('40 events'), 'should show first day count');
      assert.ok(stdout.includes('60 events'), 'should show second day count');
    } finally {
      server.close();
    }
  });

  it('does not crash when timeSeries is absent', async () => {
    const { server, url } = await startMockServer({
      totals: { total_events: 5, unique_users: 1 },
      events: [],
    });

    try {
      const { code, stdout } = await runCli(['stats', 'test-project'], {
        AGENT_ANALYTICS_API_KEY: 'aak_test',
        AGENT_ANALYTICS_URL: url,
      });

      assert.equal(code, 0);
      assert.ok(!stdout.includes('Daily:'), 'should not show Daily when no timeSeries');
    } finally {
      server.close();
    }
  });
});
