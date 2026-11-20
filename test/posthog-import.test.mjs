import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { agentSessionEnv } from './auth-test-helpers.mjs';
import {
  assertPosthogHost,
  buildPosthogQuery,
  chunkIdForEvents,
  explainImportError,
  parseExportDocument,
  prepareImportEvent,
  redactSecrets,
  runPosthogImport,
  selectEvents,
} from '../lib/posthog-import.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');
const SECRET = 'phx_test_secret_value_should_not_leak';
const JOB_ID = 'phi_314e0bdb53ca31921bde0068d7e088aeb73c870f1fc1c3ce';

function run(args = [], { env = {}, timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], {
      timeout,
      env: {
        ...process.env,
        AGENT_ANALYTICS_CREDENTIAL_PLATFORM: 'linux',
        POSTHOG_PERSONAL_API_KEY: '',
        POSTHOG_HOST: '',
        POSTHOG_PROJECT_ID: '',
        ...env,
      },
    }, (err, stdout, stderr) => {
      resolve({
        code: err ? (err.code ?? 1) : 0,
        stdout,
        stderr,
      });
    });
  });
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function readRequest(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      let json = null;
      if (raw) {
        try {
          json = JSON.parse(raw);
        } catch {
          json = null;
        }
      }
      resolve({ raw, json });
    });
  });
}

function startServer(handler) {
  const server = createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        baseUrl: `http://127.0.0.1:${address.port}`,
        close() {
          return new Promise((res, rej) => server.close((err) => (err ? rej(err) : res())));
        },
      });
    });
  });
}

function event(index, extra = {}) {
  return {
    uuid: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    event: '$pageview',
    distinct_id: `user-${index}`,
    timestamp: new Date(Date.UTC(2026, 10, 1, 0, 0, index)).toISOString(),
    properties: { $pathname: '/pricing', $session_id: 'sess-1' },
    ...extra,
  };
}

function counts(overrides = {}) {
  return {
    received: 0,
    accepted: 0,
    inserted: 0,
    duplicate: 0,
    skipped: 0,
    outside_retention: 0,
    erased: 0,
    page_views: 0,
    identifies: 0,
    aliases: 0,
    chunks: 0,
    skipped_reasons: {},
    ...overrides,
  };
}

function job(overrides = {}) {
  return {
    id: JOB_ID,
    project: 'my-site',
    project_id: 'proj_abc',
    status: 'open',
    dry_run: true,
    source: 'export',
    counts: counts(),
    usage: { counts_toward_monthly_limit: false, metered: false },
    limits: {
      chunk_events: 40,
      alias_events: 10,
      job_events: 1000000,
      open_jobs: 5,
      retention_days: 90,
      retention_cutoff: '2026-08-22',
    },
    created_at: 1,
    updated_at: 1,
    completed_at: null,
    ...overrides,
  };
}

function assertNoSecret(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  assert.equal(text.includes(SECRET), false);
  assert.equal(text.includes('phx_'), false);
}

describe('posthog import library', () => {
  it('parses a JSON array, an events object, and JSONL', () => {
    const row = event(1);
    assert.equal(parseExportDocument(JSON.stringify([row])).length, 1);
    assert.equal(parseExportDocument(JSON.stringify({ events: [row, row] })).length, 2);
    assert.equal(parseExportDocument(`${JSON.stringify(row)}\n\n${JSON.stringify(row)}\n`).length, 2);
    assert.equal(parseExportDocument(`\uFEFF${JSON.stringify([row])}`).length, 1);
    assert.throws(() => parseExportDocument('['), /not valid JSON/);
    assert.throws(() => parseExportDocument('not-json\n'), /Line 1/);
  });

  it('filters dates and limit, and holds back a PostHog key', () => {
    const rows = [
      event(1, { timestamp: '2026-10-01T00:00:00.000Z' }),
      event(2, { timestamp: '2026-11-02T00:00:00.000Z' }),
      event(3, { timestamp: '2026-11-03T00:00:00.000Z', properties: { note: SECRET } }),
    ];
    const selected = selectEvents(rows, {
      fromMs: Date.parse('2026-11-01T00:00:00.000Z'),
      toMs: Date.parse('2026-11-02T23:59:59.999Z'),
      secret: SECRET,
    });
    assert.equal(selected.events.length, 1);
    assert.equal(selected.events[0].uuid, rows[1].uuid);
    assert.equal(selected.skippedWindow, 1);
    assert.equal(selected.skippedSecret, 1);
    assert.deepEqual(selectEvents(rows.slice(0, 2), { limit: 1 }).events.map((row) => row.uuid), [rows[0].uuid]);
  });

  it('strips secret field names and builds a stable chunk id', () => {
    const prepared = prepareImportEvent({
      uuid: event(1).uuid,
      event: 'signup',
      distinct_id: 'user-1',
      timestamp: '2026-11-01T00:00:00.000Z',
      properties: { api_key: 'not-the-prefix', plan: 'pro' },
      person: { email: 'person@example.com' },
    });
    assert.equal(prepared.event.properties.api_key, undefined);
    assert.equal(prepared.event.properties.plan, 'pro');
    assert.equal(prepared.event.person, undefined);
    const first = chunkIdForEvents([prepared.event]);
    const again = chunkIdForEvents([{ uuid: prepared.event.uuid, event: 'other' }]);
    assert.equal(first, again);
    assert.match(first, /^page-[a-f0-9]{32}$/);
    assert.notEqual(first, chunkIdForEvents([{ uuid: event(2).uuid }]));
  });

  it('builds a HogQL keyset without the API key', () => {
    const first = buildPosthogQuery({
      fromMs: Date.parse('2026-11-01T00:00:00.000Z'),
      toMs: Date.parse('2026-11-02T23:59:59.999Z'),
      limit: 40,
    });
    assert.match(first, /timestamp >= toDateTime64\('2026-11-01 00:00:00\.000', 3, 'UTC'\)/);
    assert.match(first, /timestamp <= toDateTime64\('2026-11-02 23:59:59\.999', 3, 'UTC'\)/);
    assert.match(first, /ORDER BY timestamp ASC, uuid ASC/);
    assert.match(first, /LIMIT 40/);
    assert.equal(first.includes('OFFSET'), false);
    const second = buildPosthogQuery({
      cursor: { timestampMs: Date.parse('2026-11-01T00:00:00.000Z'), uuid: event(1).uuid },
      limit: 40,
    });
    assert.match(second, new RegExp(event(1).uuid));
    assert.equal(second.includes(SECRET), false);
    assert.throws(() => assertPosthogHost('http://example.com', 'https://api.agentanalytics.sh'), /https/);
    assert.throws(
      () => assertPosthogHost('https://api.agentanalytics.sh', 'https://api.agentanalytics.sh'),
      /Agent Analytics API/,
    );
    assert.equal(assertPosthogHost('http://127.0.0.1:9', 'https://api.agentanalytics.sh'), 'http://127.0.0.1:9');
  });

  it('explains the import error codes', () => {
    assert.match(explainImportError({ code: 'FORBIDDEN_SCOPE', status: 403 }), /manage or admin/);
    assert.match(explainImportError({ code: 'FORBIDDEN_SCOPE' }), /aak_/);
    assert.match(explainImportError({ code: 'PROJECT_NOT_FOUND' }, { project: 'my-site' }), /my-site/);
    assert.match(explainImportError({ code: 'IMPORT_LIMIT' }), /5 open import jobs/);
    assert.match(explainImportError({ code: 'IMPORT_LIMIT' }), /1,000,000/);
    assert.match(explainImportError({ code: 'DEMO_READ_ONLY' }), /agentanalytics-demo/);
    assert.match(explainImportError({ status: 500 }, { jobId: JOB_ID, write: true }), new RegExp(`--resume ${JOB_ID} --yes`));
    assert.equal(redactSecrets(`key ${SECRET} and phx_other`, SECRET).includes('phx_'), false);
  });

  it('retries 429 and 500 on a chunk, and does not retry create on 500', async () => {
    const calls = [];
    let chunkAttempts = 0;
    const api = {
      async createPosthogImport(body) {
        calls.push(['create', body]);
        if (body.failCreate) {
          const error = new Error('unavailable');
          error.status = 500;
          throw error;
        }
        return job({ dry_run: body.dry_run, source: body.source });
      },
      async postPosthogImportChunk(id, body) {
        chunkAttempts += 1;
        calls.push(['chunk', body.chunk_id, body.events.length, body.dry_run, chunkAttempts]);
        if (chunkAttempts < 3) {
          const error = new Error('busy');
          error.status = chunkAttempts === 1 ? 429 : 500;
          error.retryAfter = '0';
          throw error;
        }
        return {
          replayed: false,
          chunk_id: body.chunk_id,
          counts: counts({ received: 1, inserted: 0, outside_retention: 1 }),
          sample: [{ uuid: body.events[0].uuid, event: 'page_view', user_id: 'user-1', timestamp: 1, path: '/pricing' }],
        };
      },
      async getPosthogImport() {
        return job();
      },
      async completePosthogImport() {
        return job({ status: 'completed', counts: counts({ received: 1, outside_retention: 1, chunks: 1 }) });
      },
    };
    const result = await runPosthogImport({
      api,
      project: 'my-site',
      source: 'export',
      dryRun: true,
      events: [event(1)],
      secret: SECRET,
      sleep: async () => {},
    });
    assert.equal(chunkAttempts, 3);
    const chunkIds = calls.filter((call) => call[0] === 'chunk').map((call) => call[1]);
    assert.equal(chunkIds[0], chunkIds[1]);
    assert.equal(chunkIds[1], chunkIds[2]);
    assert.equal(result.job.status, 'completed');
    assert.equal(result.job.counts.outside_retention, 1);

    let createCalls = 0;
    await assert.rejects(() => runPosthogImport({
      api: {
        async createPosthogImport() {
          createCalls += 1;
          const error = new Error('down');
          error.status = 500;
          throw error;
        },
      },
      project: 'my-site',
      source: 'export',
      dryRun: true,
      events: [event(1)],
      sleep: async () => {},
    }), /down/);
    assert.equal(createCalls, 1);
  });

  it('splits an oversized chunk and an alias overflow without sending the key', async () => {
    const posted = [];
    const api = {
      async createPosthogImport(body) {
        return job({ dry_run: body.dry_run === true, source: body.source });
      },
      async postPosthogImportChunk(_id, body) {
        posted.push(body);
        assertNoSecret(body);
        if (body.events.length > 2) {
          const error = new Error('too many identity aliases in one chunk (max 10)');
          error.status = 400;
          error.code = 'IMPORT_INVALID';
          throw error;
        }
        return { replayed: false, counts: counts({ received: body.events.length }), sample: [] };
      },
      async getPosthogImport() {
        return job({ dry_run: false });
      },
      async completePosthogImport() {
        return job({ dry_run: false, status: 'completed', counts: counts({ inserted: 4 }) });
      },
    };
    const bulky = [0, 1, 2, 3].map((index) => event(index, {
      properties: { blob: 'x'.repeat(300 * 1024) },
    }));
    const result = await runPosthogImport({
      api,
      project: 'my-site',
      source: 'export',
      dryRun: false,
      events: bulky,
      secret: SECRET,
      sleep: async () => {},
    });
    assert.equal(result.job.counts.inserted, 4);
    assert.ok(posted.length >= 2);
    assert.ok(posted.every((body) => body.events.length <= 2));
    assert.ok(posted.every((body) => body.dry_run == null));
    assert.ok(posted.every((body) => Buffer.byteLength(JSON.stringify(body)) <= 512 * 1024));

    const aliasPosts = [];
    await runPosthogImport({
      api: {
        async createPosthogImport(body) {
          return job({ dry_run: body.dry_run === true, source: body.source });
        },
        async postPosthogImportChunk(_id, body) {
          aliasPosts.push(body.events.length);
          if (body.events.length > 2) {
            const error = new Error('too many identity aliases in one chunk (max 10)');
            error.status = 400;
            error.code = 'IMPORT_INVALID';
            throw error;
          }
          return { replayed: false, counts: counts({ received: body.events.length }) };
        },
        async getPosthogImport() {
          return job({ dry_run: false });
        },
        async completePosthogImport() {
          return job({ dry_run: false, status: 'completed', counts: counts({ inserted: 4 }) });
        },
      },
      project: 'my-site',
      source: 'export',
      dryRun: false,
      events: [0, 1, 2, 3].map((index) => event(index)),
      sleep: async () => {},
    });
    assert.deepEqual(aliasPosts, [4, 2, 2]);
  });

  it('replays a resumed chunk and refuses to escalate a dry run', async () => {
    const posts = [];
    const api = {
      async createPosthogImport() {
        throw new Error('create should not run');
      },
      async getPosthogImport() {
        return job({ dry_run: false, status: 'open' });
      },
      async postPosthogImportChunk(_id, body) {
        posts.push(body);
        return { replayed: true, counts: counts({ inserted: 1, chunks: 1 }) };
      },
      async completePosthogImport() {
        return job({
          dry_run: false,
          status: 'completed',
          counts: counts({ inserted: 1, duplicate: 2, skipped: 3, outside_retention: 4 }),
        });
      },
    };
    const result = await runPosthogImport({
      api,
      project: 'my-site',
      source: 'export',
      dryRun: false,
      resumeJobId: JOB_ID,
      events: [event(1)],
      sleep: async () => {},
    });
    assert.equal(posts.length, 1);
    assert.equal(result.chunksReplayed, 1);
    assert.equal(result.job.counts.outside_retention, 4);

    await assert.rejects(() => runPosthogImport({
      api: {
        async getPosthogImport() {
          return job({ dry_run: true, status: 'open' });
        },
      },
      project: 'my-site',
      source: 'export',
      dryRun: false,
      resumeJobId: JOB_ID,
      events: [event(1)],
      sleep: async () => {},
    }), /cannot be turned into writes/);
  });
});

describe('import posthog command', () => {
  it('shows import help from the command and the main help', async () => {
    const command = await run(['import', 'posthog', '--help']);
    const plain = stripAnsi(command.stdout);
    assert.equal(command.code, 0);
    assert.match(plain, /import posthog --project <name>/);
    assert.match(plain, /--yes/);
    assert.match(plain, /POSTHOG_PERSONAL_API_KEY/);
    assert.match(plain, /outside_retention/);
    assert.match(plain, /FORBIDDEN_SCOPE/);
    const root = await run(['--help']);
    assert.match(stripAnsi(root.stdout), /import posthog/);
    assert.match(stripAnsi(root.stdout), /--yes/);
  });

  it('refuses demo mode, a missing source, and a missing login', async () => {
    const demo = await run(['--demo', 'import', 'posthog', '--project', 'my-site', '--file', 'export.json']);
    assert.equal(demo.code, 1);
    assert.match(stripAnsi(demo.stdout), /Demo mode is read-only/);
    const config = agentSessionEnv();
    const missing = await run(['import', 'posthog', '--project', 'my-site'], { env: config });
    assert.equal(missing.code, 1);
    assert.match(stripAnsi(missing.stdout), /--file <path> or --api/);
    const both = await run(['import', 'posthog', '--project', 'my-site', '--file', 'a.json', '--api'], { env: config });
    assert.equal(both.code, 1);
    assert.match(stripAnsi(both.stdout), /not both/);
    const anon = await run(['import', 'posthog', '--project', 'my-site', '--file', 'missing.json'], {
      env: { AGENT_ANALYTICS_CONFIG_DIR: mkdtempSync(join(tmpdir(), 'aa-empty-')) },
    });
    assert.equal(anon.code, 1);
    assert.match(stripAnsi(anon.stdout), /Not logged in/);
  });

  it('dry-runs a file in chunks and does not send or print the PostHog key', async () => {
    const seen = [];
    const rows = Array.from({ length: 41 }, (_, index) => event(index));
    rows.push(event(99, { properties: { api_key: SECRET, note: SECRET } }));
    const dir = mkdtempSync(join(tmpdir(), 'posthog-export-'));
    const file = join(dir, 'export.json');
    writeFileSync(file, JSON.stringify(rows));
    const server = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const body = await readRequest(req);
      seen.push({ method: req.method, path: url.pathname, headers: req.headers, body });
      if (req.method === 'POST' && url.pathname === '/imports/posthog') {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(job({ dry_run: true, source: 'export' })));
        return;
      }
      if (req.method === 'POST' && url.pathname === `/imports/posthog/${JOB_ID}/chunks`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          replayed: false,
          chunk_id: body.json.chunk_id,
          dry_run: true,
          counts: counts({ received: body.json.events.length, outside_retention: 1 }),
          sample: [{
            uuid: body.json.events[0].uuid,
            event: 'page_view',
            user_id: body.json.events[0].distinct_id,
            timestamp: Date.parse('2026-11-01T00:00:00.000Z'),
            path: '/pricing',
          }],
        }));
        return;
      }
      if (req.method === 'GET' && url.pathname === `/imports/posthog/${JOB_ID}`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(job()));
        return;
      }
      if (req.method === 'POST' && url.pathname === `/imports/posthog/${JOB_ID}/complete`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(job({
          status: 'completed',
          dry_run: true,
          counts: counts({ received: 41, inserted: 0, duplicate: 2, skipped: 3, outside_retention: 4, chunks: 2 }),
        })));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'NOT_FOUND', message: 'import not found' }));
    });
    const config = agentSessionEnv();
    try {
      const result = await run([
        'import', 'posthog', '--project', 'my-site', '--file', file,
      ], {
        env: {
          ...config,
          AGENT_ANALYTICS_URL: server.baseUrl,
          POSTHOG_PERSONAL_API_KEY: SECRET,
          POSTHOG_HOST: 'http://127.0.0.1:9',
        },
      });
      const plain = stripAnsi(`${result.stdout}\n${result.stderr}`);
      assert.equal(result.code, 0, plain);
      assert.match(plain, /Dry run/);
      assert.match(plain, /inserted 0 {2}duplicate 2 {2}skipped 3 {2}outside_retention 4/);
      assert.match(plain, /outside_retention: events older than the plan retention window \(cutoff 2026-08-22\)/);
      assert.match(plain, /page_view {2}user-0/);
      assert.match(plain, /Pass --yes/);
      assert.match(plain, /contained a PostHog key: 1/);
      assertNoSecret(plain);
      const creates = seen.filter((call) => call.method === 'POST' && call.path === '/imports/posthog');
      const chunks = seen.filter((call) => call.path.endsWith('/chunks'));
      assert.equal(creates.length, 1);
      assert.equal(creates[0].body.json.dry_run, true);
      assert.equal(creates[0].body.json.source, 'export');
      assert.equal(chunks.length, 2);
      assert.equal(chunks[0].body.json.events.length, 40);
      assert.equal(chunks[1].body.json.events.length, 1);
      assert.equal(chunks[0].body.json.dry_run, true);
      assert.equal(chunks[0].body.json.chunk_id, chunkIdForEvents(rows.slice(0, 40)));
      assert.equal(chunks[1].body.json.chunk_id, chunkIdForEvents([rows[40]]));
      for (const call of seen) {
        assertNoSecret(call.body.raw);
        assert.equal(JSON.stringify(call.headers).includes(SECRET), false);
        assert.equal(call.headers.authorization, 'Bearer aas_test123');
      }
      assert.equal(readFileSync(join(config.AGENT_ANALYTICS_CONFIG_DIR, 'config.json'), 'utf8').includes(SECRET), false);
      assert.equal(readFileSync(file, 'utf8').includes('"api_key"'), true);
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('writes with --yes, applies --from/--to/--limit, and reads JSONL', async () => {
    const seen = [];
    const rows = [
      event(1, { timestamp: '2026-10-01T00:00:00.000Z' }),
      event(2, { timestamp: '2026-11-02T03:04:05.000Z' }),
      event(3, { timestamp: '2026-11-02T04:00:00.000Z' }),
    ];
    const dir = mkdtempSync(join(tmpdir(), 'posthog-jsonl-'));
    const file = join(dir, 'export.jsonl');
    writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n'));
    const server = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const body = await readRequest(req);
      seen.push({ method: req.method, path: url.pathname, body });
      if (req.method === 'POST' && url.pathname === '/imports/posthog') {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(job({ dry_run: false, source: 'export' })));
        return;
      }
      if (url.pathname.endsWith('/chunks')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          replayed: false,
          counts: counts({ received: body.json.events.length, inserted: body.json.events.length }),
        }));
        return;
      }
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(job({ dry_run: false })));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(job({
        dry_run: false,
        status: 'completed',
        counts: counts({ inserted: 1, duplicate: 0, skipped: 0, outside_retention: 0 }),
      })));
    });
    const config = agentSessionEnv();
    try {
      const result = await run([
        'import', 'posthog', 'my-site', '--file', file, '--yes',
        '--from', '2026-11-02', '--to', '2026-11-02', '--limit', '1', '--json',
      ], { env: { ...config, AGENT_ANALYTICS_URL: server.baseUrl, POSTHOG_PERSONAL_API_KEY: SECRET } });
      assert.equal(result.code, 0, stripAnsi(`${result.stdout}\n${result.stderr}`));
      const payload = JSON.parse(result.stdout);
      assert.equal(payload.dry_run, false);
      assert.equal(payload.counts.inserted, 1);
      assert.match(payload.outside_retention_note, /outside_retention:/);
      assert.equal(result.stdout.includes(SECRET), false);
      const chunk = seen.find((call) => call.path.endsWith('/chunks'));
      assert.equal(chunk.body.json.events.length, 1);
      assert.equal(chunk.body.json.events[0].uuid, rows[1].uuid);
      assert.equal(Object.hasOwn(chunk.body.json, 'dry_run'), false);
      assert.equal(seen.find((call) => call.path === '/imports/posthog').body.json.dry_run, false);
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('pages the PostHog query API, retries, and keeps the key off Agent Analytics', async () => {
    const aa = [];
    const posthog = [];
    let queryAttempts = 0;
    let chunkAttempts = 0;
    const posthogServer = await startServer(async (req, res) => {
      const body = await readRequest(req);
      posthog.push({ method: req.method, url: req.url, headers: req.headers, body });
      queryAttempts += 1;
      if (queryAttempts === 1) {
        res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '0' });
        res.end(JSON.stringify({ detail: `slow down ${SECRET}` }));
        return;
      }
      const first = queryAttempts === 2;
      const row = event(first ? 1 : 2);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        columns: ['uuid', 'event', 'distinct_id', 'timestamp', 'properties'],
        results: [[row.uuid, row.event, row.distinct_id, '2026-11-01 00:00:00.000', row.properties]],
        hasMore: first,
      }));
    });
    const aaServer = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const body = await readRequest(req);
      aa.push({ method: req.method, path: url.pathname, headers: req.headers, body });
      if (req.method === 'POST' && url.pathname === '/imports/posthog') {
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(job({ dry_run: body.json?.dry_run === true, source: body.json?.source || 'api' })));
        return;
      }
      if (url.pathname.endsWith('/chunks')) {
        chunkAttempts += 1;
        if (chunkAttempts === 1) {
          res.writeHead(500, { 'Content-Type': 'application/json', 'Retry-After': '0' });
          res.end(JSON.stringify({ error: 'INTERNAL_ERROR', message: 'import failed' }));
          return;
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          replayed: false,
          counts: counts({ received: body.json.events.length, inserted: 0 }),
          sample: [],
        }));
        return;
      }
      if (req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(job({ dry_run: false, source: 'api' })));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(job({
        source: 'api',
        dry_run: false,
        status: 'completed',
        counts: counts({ inserted: 0, duplicate: 0, skipped: 0, outside_retention: 0, chunks: 2 }),
      })));
    });
    const config = agentSessionEnv();
    try {
      const result = await run([
        'import', 'posthog', '--project', 'my-site', '--api', '--posthog-project-id', '42', '--confirm', 'import',
      ], {
        env: {
          ...config,
          AGENT_ANALYTICS_URL: aaServer.baseUrl,
          POSTHOG_HOST: posthogServer.baseUrl,
          POSTHOG_PERSONAL_API_KEY: SECRET,
        },
      });
      const plain = stripAnsi(`${result.stdout}\n${result.stderr}`);
      assert.equal(result.code, 0, plain);
      assertNoSecret(plain);
      assert.equal(posthog.length, 3, posthog.map((call) => `${call.url} ${call.body.raw.slice(0, 180)}`).join('\n'));
      assert.equal(posthog[1].body.json.query.kind, 'HogQLQuery');
      assert.match(posthog[1].body.json.query.query, /LIMIT 40/);
      assert.match(posthog[2].body.json.query.query, new RegExp(event(1).uuid));
      for (const call of posthog) {
        assert.equal(call.headers.authorization, `Bearer ${SECRET}`);
        assert.equal(call.body.raw.includes(SECRET), false);
        assert.equal(call.url.includes(SECRET), false);
      }
      const chunks = aa.filter((call) => call.path.endsWith('/chunks'));
      assert.equal(chunks.length, 2);
      assert.equal(chunks[0].body.json.chunk_id, chunks[1].body.json.chunk_id);
      assert.deepEqual(chunks[1].body.json.events.map((row) => row.uuid), [event(1).uuid, event(2).uuid]);
      assert.equal(Object.hasOwn(chunks[0].body.json, 'dry_run'), false);
      for (const call of aa) {
        assertNoSecret(call.body.raw);
        assert.equal(JSON.stringify(call.headers).includes(SECRET), false);
        assert.equal(call.headers.authorization, 'Bearer aas_test123');
      }
      assert.match(plain, /inserted 0 {2}duplicate 0 {2}skipped 0 {2}outside_retention 0/);
    } finally {
      await posthogServer.close();
      await aaServer.close();
    }
  });

  it('resumes an open job and skips a committed chunk', async () => {
    const seen = [];
    const dir = mkdtempSync(join(tmpdir(), 'posthog-resume-'));
    const file = join(dir, 'export.json');
    writeFileSync(file, JSON.stringify([event(1)]));
    const server = await startServer(async (req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      const body = await readRequest(req);
      seen.push({ method: req.method, path: url.pathname, body });
      if (req.method === 'GET' && url.pathname === `/imports/posthog/${JOB_ID}`) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(job({ dry_run: false, status: 'open', source: 'export' })));
        return;
      }
      if (url.pathname.endsWith('/chunks')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ replayed: true, counts: counts({ inserted: 1 }) }));
        return;
      }
      if (url.pathname.endsWith('/complete')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(job({
          dry_run: false,
          status: 'completed',
          counts: counts({ inserted: 5, duplicate: 1, skipped: 2, outside_retention: 3 }),
        })));
        return;
      }
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'INTERNAL_ERROR', message: 'unexpected' }));
    });
    const config = agentSessionEnv();
    try {
      const result = await run([
        'import', 'posthog', '--project', 'my-site', '--file', file, '--yes', '--resume', JOB_ID,
      ], { env: { ...config, AGENT_ANALYTICS_URL: server.baseUrl } });
      const plain = stripAnsi(result.stdout);
      assert.equal(result.code, 0, plain);
      assert.match(plain, /already committed/);
      assert.match(plain, /inserted 5 {2}duplicate 1 {2}skipped 2 {2}outside_retention 3/);
      assert.equal(seen.some((call) => call.method === 'POST' && call.path === '/imports/posthog'), false);
      assert.equal(seen.filter((call) => call.path.endsWith('/chunks')).length, 1);
    } finally {
      await server.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('prints a clear message for scope, project, limit, and demo errors', async () => {
    const cases = [
      {
        status: 403,
        body: { error: 'FORBIDDEN_SCOPE', message: 'agent session missing required scope: imports:write' },
        pattern: /Import needs manage or admin \(scope imports:write\)/,
      },
      {
        status: 404,
        body: { error: 'PROJECT_NOT_FOUND', message: 'project not found' },
        pattern: /not granted that project/,
      },
      {
        status: 409,
        body: { error: 'IMPORT_LIMIT', message: 'at most 5 open import jobs' },
        pattern: /5 open import jobs/,
      },
      {
        status: 403,
        body: { error: 'DEMO_READ_ONLY', message: 'demo projects are read only' },
        pattern: /agentanalytics-demo/,
      },
    ];
    const dir = mkdtempSync(join(tmpdir(), 'posthog-errors-'));
    const file = join(dir, 'export.json');
    writeFileSync(file, JSON.stringify([event(1)]));
    const config = agentSessionEnv();
    try {
      for (const item of cases) {
        const server = await startServer(async (req, res) => {
          res.writeHead(item.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(item.body));
        });
        try {
          const result = await run([
            'import', 'posthog', '--project', 'my-site', '--file', file,
          ], { env: { ...config, AGENT_ANALYTICS_URL: server.baseUrl, POSTHOG_PERSONAL_API_KEY: SECRET } });
          const plain = stripAnsi(`${result.stdout}\n${result.stderr}`);
          assert.equal(result.code, 1, plain);
          assert.match(plain, item.pattern);
          assertNoSecret(plain);
        } finally {
          await server.close();
        }
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses to send the key when POSTHOG_HOST is the Agent Analytics API', async () => {
    const seen = [];
    const server = await startServer(async (req, res) => {
      seen.push(req.url);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{}');
    });
    const config = agentSessionEnv();
    try {
      const result = await run([
        'import', 'posthog', '--project', 'my-site', '--api', '--posthog-project-id', '42',
      ], {
        env: {
          ...config,
          AGENT_ANALYTICS_URL: server.baseUrl,
          POSTHOG_HOST: server.baseUrl,
          POSTHOG_PERSONAL_API_KEY: SECRET,
        },
      });
      const plain = stripAnsi(result.stdout);
      assert.equal(result.code, 1, plain);
      assert.match(plain, /sent only to PostHog/);
      assert.equal(seen.length, 0);
      assertNoSecret(plain);
    } finally {
      await server.close();
    }
  });
});
