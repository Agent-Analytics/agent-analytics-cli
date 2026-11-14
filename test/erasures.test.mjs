import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { agentSessionEnv } from './auth-test-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');
const USER_ID = 'user-secret-9f3a';
const SESSION_ID = 'sess-secret-9f3a';
const EMAIL_RAW = 'Erase-Secret@Example.com';
const EMAIL = 'erase-secret@example.com';
const SUBJECTS = [USER_ID, SESSION_ID, EMAIL_RAW, EMAIL];

function run(args = [], { env = {}, timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], {
      timeout,
      env: { ...process.env, AGENT_ANALYTICS_CREDENTIAL_PLATFORM: 'linux', ...env },
    }, (err, stdout, stderr) => {
      resolve({
        code: err ? err.code : 0,
        stdout,
        stderr,
      });
    });
  });
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function readRequestJson(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      resolve(body ? JSON.parse(body) : null);
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
          return new Promise((res, rej) => server.close((err) => err ? rej(err) : res()));
        },
      });
    });
  });
}

function assertNoSubject(result, subjects = SUBJECTS) {
  const text = `${result.stdout}\n${result.stderr}`;
  for (const subject of subjects) {
    assert.equal(text.includes(subject), false, 'erasure output included the subject');
  }
}

function receipt(overrides = {}) {
  return {
    id: 'era_123',
    status: 'completed',
    project: 'my-site',
    subject_type: 'user_id',
    counts: {
      events: 4,
      sessions: 2,
      identity_rows: 3,
      profiles: 1,
      email_lookups: 0,
      replay_sessions: 1,
      replay_objects: 2,
    },
    replay_included: true,
    completed_at: '2026-11-13T20:00:00.000Z',
    ...overrides,
  };
}

function authEnv(baseUrl) {
  return {
    ...agentSessionEnv('aas_test123'),
    AGENT_ANALYTICS_URL: baseUrl,
  };
}

describe('erasures', () => {
  describe('help', () => {
    it('shows erase help before auth', async () => {
      const { code, stdout } = await run(['erase', '--help']);
      const plain = stripAnsi(stdout);
      assert.equal(code, 0);
      assert.match(plain, /erase <project> \(--user-id <id> \| --session-id <id> \| --email <email>\) --confirm erase/);
      assert.ok(plain.includes('--include-replays=false'));
      assert.ok(plain.includes('--confirm-large'));
      assert.ok(plain.includes('--idempotency-key'));
      assert.ok(plain.includes('does not print the subject'));
      assert.ok(plain.includes('erasures:write'));
      assert.ok(plain.includes('INVALID_ERASURE'));
      assert.ok(plain.includes('CONFIRM_LARGE_REQUIRED'));
      assert.ok(plain.includes('FORBIDDEN (403, agent session missing required scope: erasures:write)'));
      assert.equal(plain.includes('FORBIDDEN_SCOPE'), false);
      assert.equal(plain.includes('processing'), false);
      assert.ok(plain.includes('DEMO_READ_ONLY'));
      assert.ok(plain.includes('PROJECT_NOT_FOUND'));
      assert.ok(plain.includes('IDEMPOTENCY_CONFLICT'));
      assert.ok(plain.includes('erasure_rate_limit'));
    });

    it('shows erasures help before auth', async () => {
      const { code, stdout } = await run(['erasures', '-h']);
      const plain = stripAnsi(stdout);
      assert.equal(code, 0);
      assert.ok(plain.includes('erasures <project> [--json]'));
      assert.ok(plain.includes('erasures get <id> [--json]'));
      assert.ok(plain.includes('100 newest'));
    });

    it('lists erase on the main help screen', async () => {
      const { code, stdout } = await run(['--help']);
      const plain = stripAnsi(stdout);
      assert.equal(code, 0);
      assert.ok(plain.includes('erase <project>'));
      assert.ok(plain.includes('erasures <project>'));
      assert.ok(plain.includes('erasures get <id>'));
      assert.ok(plain.includes('--confirm erase'));
      assert.ok(plain.includes('--session-id <id>'));
      assert.ok(plain.includes('--idempotency-key <key>'));
      assert.ok(plain.includes('--include-replays <bool>'));
      assert.ok(plain.includes('--confirm-large'));
      assert.ok(plain.includes('--portfolio'));
    });
  });

  describe('local refusal', () => {
    async function refuses(args, pattern) {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });
      try {
        const result = await run(args, { env: authEnv(server.baseUrl) });
        assert.notEqual(result.code, 0);
        assert.equal(calls, 0);
        assert.match(stripAnsi(result.stdout), pattern);
        assertNoSubject(result);
        return result;
      } finally {
        await server.close();
      }
    }

    it('refuses a missing confirm, a wrong confirm, and a confirm that is the subject', async () => {
      await refuses(
        ['erase', 'my-site', '--user-id', USER_ID],
        /Erasure requires --confirm erase\./,
      );
      await refuses(
        ['erase', 'my-site', '--user-id', USER_ID, '--confirm', 'delete'],
        /Erasure requires --confirm erase\./,
      );
      await refuses(
        ['erase', 'my-site', '--confirm', USER_ID, '--session-id', SESSION_ID],
        /Erasure requires --confirm erase\./,
      );
    });

    it('refuses zero subjects and two subjects before calling the API', async () => {
      await refuses(
        ['erase', 'my-site', '--confirm', 'erase'],
        /Pass exactly one of --user-id, --session-id, or --email\./,
      );
      await refuses(
        ['erase', 'my-site', '--user-id', USER_ID, '--session-id', SESSION_ID, '--confirm', 'erase'],
        /cannot be combined/,
      );
      await refuses(
        ['erase', 'my-site', '--user-id', USER_ID, '--email', EMAIL_RAW, '--confirm', 'erase'],
        /cannot be combined/,
      );
      await refuses(
        ['erase', 'my-site', '--session-id', SESSION_ID, '--email', EMAIL, '--confirm=erase'],
        /cannot be combined/,
      );
      await refuses(
        ['erase', 'my-site', '--user-id', USER_ID, '--session-id', SESSION_ID, '--email', EMAIL_RAW, '--confirm', 'erase'],
        /cannot be combined/,
      );
    });

    it('refuses an empty subject, a subject over 256 characters, and portfolio without email', async () => {
      const longId = `long-${'x'.repeat(260)}`;
      await refuses(
        ['erase', 'my-site', '--user-id=', '--confirm', 'erase'],
        /The subject is empty\./,
      );
      await refuses(
        ['erase', 'my-site', '--session-id', '   ', '--confirm', 'erase'],
        /The subject is empty\./,
      );
      await refuses(
        ['erase', 'my-site', '--email', '   ', '--confirm', 'erase'],
        /The subject is empty\./,
      );
      const longResult = await refuses(
        ['erase', 'my-site', '--user-id', longId, '--confirm', 'erase'],
        /The subject is longer than 256 characters\./,
      );
      assert.equal(`${longResult.stdout}${longResult.stderr}`.includes(longId), false);
      await refuses(
        ['erase', 'my-site', '--user-id', USER_ID, '--confirm', 'erase', '--portfolio'],
        /--portfolio is only valid with --email\./,
      );
      await refuses(
        ['erase', 'my-site', '--session-id', SESSION_ID, '--confirm', 'erase', '--portfolio=true'],
        /--portfolio is only valid with --email\./,
      );
    });

    it('refuses a missing value, a duplicate flag, and demo erase before the API', async () => {
      await refuses(
        ['erase', 'my-site', '--include-replays', '--user-id', USER_ID, '--confirm', 'erase'],
        /--include-replays must be true or false\./,
      );
      const duplicate = await refuses(
        ['erase', 'my-site', '--user-id', USER_ID, '--user-id', 'other-secret-9f3a', '--confirm', 'erase'],
        /Pass --user-id once\./,
      );
      assert.equal(`${duplicate.stdout}${duplicate.stderr}`.includes('other-secret-9f3a'), false);
      await refuses(
        ['erase', 'my-site', '--idempotency-key=', '--user-id', USER_ID, '--confirm', 'erase'],
        /The idempotency key is empty\./,
      );

      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });
      try {
        const result = await run([
          '--demo', 'erase', 'my-site', '--email', EMAIL_RAW, '--confirm', 'erase',
        ], { env: authEnv(server.baseUrl) });
        assert.notEqual(result.code, 0);
        assert.equal(calls, 0);
        assert.match(stripAnsi(result.stdout), /Demo mode is read-only/);
        assertNoSubject(result);
      } finally {
        await server.close();
      }
    });

    it('does not print the subject when the caller is not logged in', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });
      try {
        const result = await run([
          'erase', 'my-site', '--email', EMAIL_RAW, '--confirm', 'erase',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_CONFIG_DIR: '/tmp/agent-analytics-erasure-missing-auth',
          },
        });
        assert.notEqual(result.code, 0);
        assert.equal(calls, 0);
        assert.match(stripAnsi(result.stdout), /Not logged in/);
        assertNoSubject(result);
      } finally {
        await server.close();
      }
    });
  });

  describe('erase', () => {
    it('generates an idempotency key, posts one user id, and does not print the subject', async () => {
      let request;
      const body = receipt();
      const server = await startServer(async (req, res) => {
        request = {
          method: req.method,
          url: req.url,
          authorization: req.headers.authorization,
          body: await readRequestJson(req),
        };
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...body,
          user_id: USER_ID,
          email: EMAIL,
          subject_hash: 'hash-secret-aabbccdd',
        }));
      });

      try {
        const result = await run([
          'erase', 'my-site', '--user-id', USER_ID, '--confirm', 'erase',
        ], { env: authEnv(server.baseUrl) });
        const plain = stripAnsi(result.stdout);
        const key = result.stderr.match(/^idempotency_key: ([0-9a-f-]{36})$/m)?.[1];

        assert.equal(result.code, 0);
        assert.equal(request.method, 'POST');
        assert.equal(request.url, '/erasures');
        assert.equal(request.authorization, 'Bearer aas_test123');
        assert.equal(key, request.body.idempotency_key);
        assert.match(key, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
        assert.deepEqual(request.body, {
          project: 'my-site',
          idempotency_key: key,
          confirm: 'erase',
          user_id: USER_ID,
          include_replays: true,
        });
        assert.ok(plain.includes('Erasure era_123'));
        assert.ok(plain.includes('Status: completed'));
        assert.ok(plain.includes('Subject: user_id'));
        assert.ok(plain.includes('Replays: included'));
        assert.ok(plain.includes('Events: 4'));
        assert.ok(plain.includes('Sessions: 2'));
        assert.ok(plain.includes('Identity rows: 3'));
        assert.ok(plain.includes('Profiles: 1'));
        assert.ok(plain.includes('Email lookups: 0'));
        assert.ok(plain.includes('Replay sessions: 1'));
        assert.ok(plain.includes('Replay objects: 2'));
        assert.ok(plain.includes('Completed: 2026-11-13T20:00:00.000Z'));
        assert.ok(plain.includes(`Idempotency key: ${key}`));
        assert.equal(plain.includes('hash-secret-aabbccdd'), false);
        assertNoSubject(result);
      } finally {
        await server.close();
      }
    });

    it('sends a supplied key, include_replays false, and confirm_large', async () => {
      let requestBody;
      const server = await startServer(async (req, res) => {
        requestBody = await readRequestJson(req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(receipt({
          subject_type: 'session_id',
          replay_included: false,
        })));
      });

      try {
        const result = await run([
          'erase', 'my-site',
          '--session-id', SESSION_ID,
          '--confirm=erase',
          '--idempotency-key', 'supplied-key-9f3a',
          '--include-replays=false',
          '--confirm-large',
        ], { env: authEnv(server.baseUrl) });
        const plain = stripAnsi(result.stdout);

        assert.equal(result.code, 0);
        assert.deepEqual(requestBody, {
          project: 'my-site',
          idempotency_key: 'supplied-key-9f3a',
          confirm: 'erase',
          session_id: SESSION_ID,
          include_replays: false,
          confirm_large: true,
        });
        assert.equal(result.stderr.includes('idempotency_key'), false);
        assert.equal(plain.includes('supplied-key-9f3a'), false);
        assert.ok(plain.includes('Replays: skipped'));
        assert.ok(plain.includes('Subject: session_id'));
        assertNoSubject(result);
      } finally {
        await server.close();
      }
    });

    it('normalizes email, sends portfolio, and --json hides the subject', async () => {
      let requestBody;
      const payload = receipt({
        subject_type: 'email',
        counts: {
          events: 8,
          sessions: 1,
          identity_rows: 2,
          profiles: 1,
          email_lookups: 1,
          replay_sessions: 0,
          replay_objects: 0,
        },
      });
      const server = await startServer(async (req, res) => {
        requestBody = await readRequestJson(req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...payload,
          email: EMAIL,
          user_id: USER_ID,
          error: `removed ${EMAIL_RAW}`,
        }));
      });

      try {
        const result = await run([
          'erase', 'my-site',
          '--email', EMAIL_RAW,
          '--confirm', 'erase',
          '--portfolio',
          '--include-replays', 'false',
          '--json',
        ], { env: authEnv(server.baseUrl) });
        const parsed = JSON.parse(result.stdout);
        const key = parsed.idempotency_key;

        assert.equal(result.code, 0);
        assert.equal(requestBody.email, EMAIL);
        assert.equal(requestBody.portfolio, true);
        assert.equal(requestBody.include_replays, false);
        assert.equal(requestBody.confirm_large, undefined);
        assert.equal(requestBody.user_id, undefined);
        assert.equal(requestBody.session_id, undefined);
        assert.equal(key, requestBody.idempotency_key);
        assert.match(result.stderr, new RegExp(`idempotency_key: ${key}`));
        assert.deepEqual(parsed, {
          idempotency_key: key,
          counts: payload.counts,
          id: 'era_123',
          status: 'completed',
          project: 'my-site',
          subject_type: 'email',
          replay_included: true,
          completed_at: '2026-11-13T20:00:00.000Z',
        });
        assert.equal(result.stdout.includes('Erasure era_123'), false);
        assertNoSubject(result);
      } finally {
        await server.close();
      }
    });

    it('prints a poll hint for a running job and keeps exit code 0', async () => {
      const server = await startServer((_req, res) => {
        res.writeHead(202, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(receipt({
          status: 'running',
          completed_at: null,
          replay_included: true,
        })));
      });

      try {
        const result = await run([
          'erase', 'my-site', '--user-id', USER_ID, '--confirm', 'erase',
        ], { env: authEnv(server.baseUrl) });
        const plain = stripAnsi(result.stdout);
        assert.equal(result.code, 0);
        assert.ok(plain.includes('Status: running'));
        assert.ok(plain.includes('Poll: npx @agent-analytics/cli erasures get era_123'));
        assert.equal(plain.includes('Completed:'), false);
        assertNoSubject(result);
      } finally {
        await server.close();
      }
    });

    it('drops a processing status instead of polling it', async () => {
      const server = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(receipt({ status: 'processing', completed_at: null })));
      });

      try {
        const env = authEnv(server.baseUrl);
        const human = await run([
          'erase', 'my-site', '--user-id', USER_ID, '--confirm', 'erase',
        ], { env });
        const json = await run([
          'erase', 'my-site', '--user-id', USER_ID, '--confirm', 'erase', '--json',
        ], { env });
        const plain = stripAnsi(human.stdout);
        const parsed = JSON.parse(json.stdout);

        assert.equal(human.code, 0);
        assert.equal(json.code, 0);
        assert.equal(plain.includes('processing'), false);
        assert.equal(plain.includes('Poll:'), false);
        assert.equal(plain.includes('Status:'), false);
        assert.equal(parsed.status, undefined);
        assert.equal(json.stdout.includes('processing'), false);
        assertNoSubject(human);
        assertNoSubject(json);
      } finally {
        await server.close();
      }
    });

    it('prints API errors without an upgrade handoff or the subject', async () => {
      const cases = [
        {
          status: 400,
          body: { code: 'CONFIRM_LARGE_REQUIRED', message: `too many events for ${USER_ID}` },
          includes: ['CONFIRM_LARGE_REQUIRED', '--confirm-large', 'new idempotency key'],
          excludes: ['upgrade-link'],
        },
        {
          status: 403,
          body: { error: 'FORBIDDEN', message: 'agent session missing required scope: erasures:write' },
          includes: [
            'agent session missing required scope: erasures:write',
            'analytics:read and projects:write are not enough',
          ],
          excludes: ['upgrade-link', 'FORBIDDEN_SCOPE'],
        },
        {
          status: 403,
          body: { error: 'DEMO_READ_ONLY', message: 'Demo data is read-only.' },
          includes: ['Demo data is read-only.'],
          excludes: ['upgrade-link'],
        },
        {
          status: 404,
          body: { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' },
          includes: ['Project not found.'],
          excludes: ['upgrade-link'],
        },
        {
          status: 409,
          body: { code: 'IDEMPOTENCY_CONFLICT', message: `conflict for ${USER_ID}` },
          includes: ['IDEMPOTENCY_CONFLICT', 'different request body'],
          excludes: ['upgrade-link'],
        },
        {
          status: 429,
          body: {
            error: 'RATE_LIMITED',
            reason: 'erasure_rate_limit',
            message: 'Upgrade your plan. Too many erasure requests.',
          },
          includes: ['Upgrade your plan. Too many erasure requests.', '20 per account per hour', 'not metered as a read'],
          excludes: ['upgrade-link'],
        },
        {
          status: 400,
          body: { code: 'INVALID_ERASURE', message: 'confirm must be erase' },
          includes: ['confirm must be erase'],
          excludes: ['upgrade-link'],
        },
      ];

      for (const item of cases) {
        let calls = 0;
        const server = await startServer(async (req, res) => {
          calls += 1;
          await readRequestJson(req);
          res.writeHead(item.status, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(item.body));
        });
        try {
          const result = await run([
            'erase', 'my-site', '--user-id', USER_ID, '--confirm', 'erase',
          ], { env: authEnv(server.baseUrl) });
          const plain = stripAnsi(result.stdout);
          assert.equal(calls, 1);
          assert.notEqual(result.code, 0);
          assert.match(result.stderr, /^idempotency_key: [0-9a-f-]{36}$/m);
          assert.match(plain, /idempotency_key: [0-9a-f-]{36}/);
          for (const text of item.includes) assert.ok(plain.includes(text), text);
          for (const text of item.excludes) assert.equal(plain.includes(text), false, text);
          assertNoSubject(result);
        } finally {
          await server.close();
        }
      }
    });
  });

  describe('list and get', () => {
    it('lists receipts and prints --json without subject fields', async () => {
      let urls = [];
      const rows = [
        receipt({ id: 'era_new', status: 'running', completed_at: null, subject_type: 'email' }),
        receipt({ id: 'era_old', subject_type: 'session_id' }),
      ];
      const server = await startServer((req, res) => {
        urls.push(req.url);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          erasures: rows.map((row) => ({
            ...row,
            email: EMAIL,
            user_id: USER_ID,
            subject_hash: 'hash-secret-aabbccdd',
          })),
        }));
      });

      try {
        const env = authEnv(server.baseUrl);
        const human = await run(['erasures', 'my-site'], { env });
        const json = await run(['erasures', '--json', 'my-site'], { env });
        const plain = stripAnsi(human.stdout);
        const parsed = JSON.parse(json.stdout);

        assert.equal(human.code, 0);
        assert.equal(json.code, 0);
        assert.deepEqual(urls, ['/erasures?project=my-site', '/erasures?project=my-site']);
        assert.ok(plain.includes('Erasures: my-site'));
        assert.ok(plain.includes('era_new  running  email  events 4  sessions 2'));
        assert.ok(plain.includes('era_old  completed  session_id  events 4  sessions 2  2026-11-13T20:00:00.000Z'));
        assert.ok(plain.includes('2 shown. The list is the 100 newest.'));
        assert.equal(parsed.erasures.length, 2);
        assert.equal(parsed.erasures[0].id, 'era_new');
        assert.equal(parsed.erasures[0].status, 'running');
        assert.equal(parsed.erasures[0].email, undefined);
        assert.equal(parsed.erasures[0].user_id, undefined);
        assert.equal(parsed.erasures[0].subject_hash, undefined);
        assertNoSubject(human);
        assertNoSubject(json);
        assert.equal(json.stdout.includes('hash-secret-aabbccdd'), false);
      } finally {
        await server.close();
      }
    });

    it('prints an empty list and fetches one receipt by id', async () => {
      const server = await startServer((req, res) => {
        if (req.url === '/erasures?project=my-site') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ erasures: [] }));
          return;
        }
        assert.equal(req.url, '/erasures/era_123');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...receipt({ status: 'failed', error: 'storage timeout', completed_at: null }),
          session_id: SESSION_ID,
        }));
      });

      try {
        const env = authEnv(server.baseUrl);
        const empty = await run(['erasures', 'my-site'], { env });
        const got = await run(['erasures', 'get', 'era_123', '--json'], { env });
        const parsed = JSON.parse(got.stdout);

        assert.equal(empty.code, 0);
        assert.ok(stripAnsi(empty.stdout).includes('No erasures found.'));
        assert.equal(got.code, 0);
        assert.equal(parsed.id, 'era_123');
        assert.equal(parsed.status, 'failed');
        assert.equal(parsed.error, 'storage timeout');
        assert.equal(parsed.session_id, undefined);
        assert.equal(parsed.idempotency_key, undefined);
        assertNoSubject(empty);
        assertNoSubject(got);
      } finally {
        await server.close();
      }
    });

    it('accepts a top-level array and refuses a get without an id', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify([receipt({ id: 'era_only' })]));
      });
      try {
        const listed = await run(['erasures', 'my-site', '--json'], { env: authEnv(server.baseUrl) });
        const missing = await run(['erasures', 'get'], { env: authEnv(server.baseUrl) });
        assert.equal(listed.code, 0);
        assert.deepEqual(JSON.parse(listed.stdout)[0].id, 'era_only');
        assert.equal(calls, 1);
        assert.notEqual(missing.code, 0);
        assert.match(stripAnsi(missing.stdout), /erasures get <id>/);
      } finally {
        await server.close();
      }
    });
  });
});
