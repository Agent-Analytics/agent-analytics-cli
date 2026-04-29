import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');

function stripAnsi(value) {
  return value.replace(/\x1b\[[0-9;]*m/g, '');
}

function startMockServer(responseData, responseHeaders = {}) {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json', ...responseHeaders });
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
        { bucket: '2026-02-25', total_events: 40, unique_users: 5 },
        { bucket: '2026-02-26', total_events: 60, unique_users: 8 },
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

  it('renders server-provided monthly billing estimates without hard-coded legacy pricing', async () => {
    const { server, url } = await startMockServer({
      totals: { total_events: 100, unique_users: 10 },
      events: [],
    }, {
      'X-Monthly-Usage': '36953',
      'X-Monthly-Estimated-Bill': '4',
      'X-Monthly-Limit': '250000',
      'X-Monthly-Usage-Percent': '14.78',
      'X-Monthly-Spend-Cap': '25',
    });

    try {
      const { stdout } = await runCli(['stats', 'test-project'], {
        AGENT_ANALYTICS_API_KEY: 'aak_test',
        AGENT_ANALYTICS_URL: url,
      });
      const plain = stripAnsi(stdout);

      assert.ok(
        plain.includes('Monthly usage: 36,953 events (est. bill $4.00) — 14.78% of $25.00 cap'),
        'should show the server-provided billing estimate and spend cap'
      );
      assert.ok(!plain.includes('$73.91'), 'should not use the old $2 per 1,000 events rate');
      assert.ok(!plain.includes('$500.00'), 'should not derive spend-cap dollars from the old rate');
    } finally {
      server.close();
    }
  });

  it('does not invent billing dollars from generic monthly usage headers', async () => {
    const { server, url } = await startMockServer({
      totals: { total_events: 100, unique_users: 10 },
      events: [],
    }, {
      'X-Monthly-Usage': '36953',
      'X-Monthly-Limit': '250000',
      'X-Monthly-Usage-Percent': '14.78',
    });

    try {
      const { stdout } = await runCli(['stats', 'test-project'], {
        AGENT_ANALYTICS_API_KEY: 'aak_test',
        AGENT_ANALYTICS_URL: url,
      });
      const plain = stripAnsi(stdout);

      assert.ok(
        plain.includes('Monthly usage: 36,953 events — 14.78% of 250,000-event cap'),
        'should show usage and event cap without guessing billing dollars'
      );
      assert.ok(!plain.includes('$'), 'should not display dollars without explicit billing headers');
    } finally {
      server.close();
    }
  });
});
