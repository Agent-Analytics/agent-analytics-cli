import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, it } from 'node:test';

import { AgentAnalyticsAPI } from '../lib/api.mjs';
import { DEFAULT_AGENT_SESSION_SCOPES } from '../lib/scopes.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');
const cleanups = [];

function run(args, env = {}) {
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], {
      env: { ...process.env, AGENT_ANALYTICS_CREDENTIAL_PLATFORM: 'linux', ...env },
    }, (error, stdout, stderr) => resolve({ code: error?.code || 0, stdout, stderr }));
  });
}

function tempConfig(baseUrl) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-analytics-replay-cli-'));
  writeFileSync(join(dir, 'config.json'), JSON.stringify({
    base_url: baseUrl,
    agent_session: {
      access_token: 'aas_replay_test',
      refresh_token: 'aar_replay_test',
      scopes: DEFAULT_AGENT_SESSION_SCOPES,
    },
  }));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function listen(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    cleanups.push(() => new Promise((done) => server.close(done)));
    resolve(baseUrl);
  }));
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) raw += chunk;
  return raw ? JSON.parse(raw) : null;
}

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()();
});

describe('session replay CLI', () => {
  it('requests dedicated replay read and write scopes by default', () => {
    assert.ok(DEFAULT_AGENT_SESSION_SCOPES.includes('replays:read'));
    assert.ok(DEFAULT_AGENT_SESSION_SCOPES.includes('replays:write'));
  });

  it('API methods use authenticated management routes without exposing object keys', async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls.push({ url: String(url), options });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    };
    try {
      const api = new AgentAnalyticsAPI({ access_token: 'aas_test' }, 'https://api.test');
      await api.getReplaySettings('my site');
      await api.listReplays({ project: 'my site', session_id: 'session-123' });
      await api.openReplay('rpl_123');
      await api.deleteReplayData({ project: 'my site' });
      assert.equal(calls[0].url, 'https://api.test/replays/settings?project=my%20site');
      assert.equal(calls[1].url, 'https://api.test/replays?project=my%20site&session_id=session-123');
      assert.equal(calls[2].url, 'https://api.test/replays/rpl_123/open');
      assert.deepEqual(JSON.parse(calls[3].options.body), {
        confirm: 'delete_replay_data',
        project: 'my site',
      });
      assert.equal(calls[0].options.headers.Authorization, 'Bearer aas_test');
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it('enables replay while preserving mandatory privacy and explaining the separate script', async () => {
    const requests = [];
    const baseUrl = await listen(async (request, response) => {
      requests.push({ method: request.method, url: request.url, body: await readJson(request) });
      const enabled = request.method === 'PUT';
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        ok: enabled,
        project: 'my-site',
        settings: {
          enabled,
          recording_start: enabled ? 'after_consent' : 'immediate',
          mask_inputs: true,
          redact_pii: true,
          mask_selectors: enabled ? ['.secret'] : [],
          block_selectors: [],
          ignore_selectors: [],
        },
        limits: { max_bytes: 2097152, max_duration_ms: 900000, retention_days: 30 },
      }));
    });
    const configDir = tempConfig(baseUrl);

    const result = await run([
      'replays', 'enable', 'my-site',
      '--recording-start', 'after_consent',
      '--mask', '.secret',
      '--config-dir', configDir,
    ]);

    assert.equal(result.code, 0);
    assert.equal(requests[0].method, 'GET');
    assert.equal(requests[1].method, 'PUT');
    assert.deepEqual(requests[1].body, {
      project: 'my-site',
      enabled: true,
      recording_start: 'after_consent',
      mask_inputs: true,
      redact_pii: true,
      mask_selectors: ['.secret'],
      block_selectors: [],
      ignore_selectors: [],
    });
    assert.match(result.stdout, /separate replay\.js script/i);
  });

  it('requires the explicit confirmation phrase for bulk deletion before any API call', async () => {
    let requests = 0;
    const baseUrl = await listen((_request, response) => {
      requests += 1;
      response.writeHead(500).end();
    });
    const configDir = tempConfig(baseUrl);

    const result = await run(['replays', 'delete', '--all', '--config-dir', configDir]);

    assert.equal(result.code, 1);
    assert.match(result.stdout, /--confirm delete_replay_data/);
    assert.equal(requests, 0);
  });

  it('finds and opens the newest playable replay for an analytics session', async () => {
    const requests = [];
    const baseUrl = await listen(async (request, response) => {
      requests.push({ method: request.method, url: request.url });
      response.writeHead(request.method === 'POST' ? 201 : 200, { 'Content-Type': 'application/json' });
      if (request.method === 'GET') {
        response.end(JSON.stringify({
          replays: [
            { id: 'rpl_newest', status: 'complete', has_full_snapshot: 1 },
            { id: 'rpl_older', status: 'complete', has_full_snapshot: 1 },
          ],
        }));
      } else {
        response.end(JSON.stringify({
          viewer_url: 'https://api.test/replay-viewer#aarv_test',
          expires_at: Date.now() + 300_000,
        }));
      }
    });
    const configDir = tempConfig(baseUrl);

    const result = await run([
      'replays', 'open',
      '--session', 'analytics-session-1',
      '--project', 'my-site',
      '--config-dir', configDir,
    ]);

    assert.equal(result.code, 0);
    assert.equal(requests[0].url, '/replays?project=my-site&session_id=analytics-session-1&limit=100');
    assert.equal(requests[1].url, '/replays/rpl_newest/open');
    assert.match(result.stdout, /Found 2 replay segments; opening the newest/);
    assert.match(result.stdout, /replay-viewer#aarv_test/);
  });

  it('marks replay availability in session listings and prints the direct open command', async () => {
    const baseUrl = await listen((_request, response) => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        project: 'my-site',
        sessions: [{
          session_id: 'analytics-session-1',
          start_time: Date.now(),
          duration: 2_000,
          is_bounce: 0,
          event_count: 3,
          entry_page: '/',
          exit_page: '/pricing',
          has_replay: true,
          replay_count: 2,
        }],
      }));
    });
    const configDir = tempConfig(baseUrl);

    const result = await run(['sessions', 'my-site', '--config-dir', configDir]);

    assert.equal(result.code, 0);
    assert.match(result.stdout, /2 replays/);
    assert.match(result.stdout, /session analytics-session-1/);
    assert.match(result.stdout, /replays open --session analytics-session-1 --project my-site/);
  });
});
