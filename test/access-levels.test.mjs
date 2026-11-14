import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopesForLevel } from '../lib/scopes.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.mjs');

function run(args = [], { env = {}, timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], {
      timeout,
      env: { ...process.env, AGENT_ANALYTICS_CREDENTIAL_PLATFORM: 'linux', ...env },
    }, (err, stdout, stderr) => {
      resolve({ code: err ? err.code : 0, stdout, stderr });
    });
  });
}

function stripAnsi(text) {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
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

function sessionConfig(session) {
  const configDir = mkdtempSync(join(tmpdir(), 'aa-access-'));
  writeFileSync(join(configDir, 'config.json'), `${JSON.stringify({
    agent_session: {
      id: 'sess_level',
      access_token: 'aas_level',
      refresh_token: 'aar_level',
      access_expires_at: 1893456000000,
      refresh_expires_at: 1924992000000,
      scopes: ['account:read'],
      ...session,
    },
  }, null, 2)}\n`);
  return configDir;
}

function accountServer(account = {}) {
  return startServer((req, res) => {
    if (req.method === 'GET' && req.url === '/account') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        email: 'owner@example.com',
        github_login: 'owner',
        tier: 'pro',
        projects_count: 1,
        ...account,
      }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'not found' }));
  });
}

describe('access level CLI', () => {
  it('shows admin login before the first create in help', async () => {
    const { code, stdout } = await run(['help']);
    const plain = stripAnsi(stdout);
    const admin = plain.indexOf('npx @agent-analytics/cli login --level admin');
    const create = plain.indexOf('npx @agent-analytics/cli create my-site --domain https://mysite.com');
    assert.equal(code, 0);
    assert.ok(admin !== -1 && create !== -1 && admin < create);
    assert.ok(plain.includes('--level <level>'));
    assert.ok(plain.includes('Do not pass --project'));
  });

  it('rejects an unknown level before the network', async () => {
    let calls = 0;
    const server = await startServer((_req, res) => {
      calls += 1;
      res.writeHead(500).end();
    });
    try {
      const { code, stdout } = await run(['login', '--level', 'write'], {
        env: { AGENT_ANALYTICS_URL: server.baseUrl },
      });
      const plain = stripAnsi(stdout);
      assert.notEqual(code, 0);
      assert.equal(calls, 0);
      assert.match(plain, /--level must be read, manage, or admin/);
      assert.match(plain, /login \[--project <name>\] \[--level read\|manage\|admin\]/);
    } finally {
      await server.close();
    }
  });

  it('sends project and level on detached start and still sends scopes', async () => {
    let body = null;
    const server = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/agent-sessions/start') {
        const raw = await new Promise((resolve) => {
          let data = '';
          req.on('data', (chunk) => { data += chunk; });
          req.on('end', () => resolve(data));
        });
        body = JSON.parse(raw);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          auth_request_id: 'req-level',
          authorize_url: 'https://approve.example/req-level',
          poll_token: 'aap_level',
        }));
        return;
      }
      res.writeHead(404).end();
    });
    try {
      const { code } = await run([
        'login', '--detached', '--project', 'my-site', '--level', 'manage',
      ], { env: { AGENT_ANALYTICS_URL: server.baseUrl } });
      assert.equal(code, 0);
      assert.equal(body.level, 'manage');
      assert.equal(body.project, 'my-site');
      assert.deepEqual(body.scopes, [...scopesForLevel('manage')]);
      assert.equal(body.mode, 'detached');
      assert.equal('poll_token' in body, false);
    } finally {
      await server.close();
    }
  });

  it('prints legacy for an old session and the stored grant for a new one', async () => {
    const legacyDir = sessionConfig({});
    const grantedDir = sessionConfig({ level: 'manage', project: 'my-site' });
    const server = await accountServer();
    try {
      const env = { AGENT_ANALYTICS_URL: server.baseUrl };
      const legacy = await run(['whoami', '--config-dir', legacyDir], { env });
      const granted = await run(['whoami', '--config-dir', grantedDir], { env });
      const legacyText = stripAnsi(legacy.stdout);
      const grantedText = stripAnsi(granted.stdout);
      assert.equal(legacy.code, 0);
      assert.equal(granted.code, 0);
      assert.match(legacyText, /Project: all/);
      assert.match(legacyText, /Level:\s+legacy/);
      assert.match(grantedText, /Project: my-site/);
      assert.match(grantedText, /Level:\s+manage/);
    } finally {
      await server.close();
    }
  });

  it('prefers the level and project returned by the account payload', async () => {
    const configDir = sessionConfig({ level: 'read', project: 'old-site' });
    const server = await accountServer({ level: 'admin', project: null });
    try {
      const { code, stdout } = await run(['whoami', '--config-dir', configDir], {
        env: { AGENT_ANALYTICS_URL: server.baseUrl },
      });
      const plain = stripAnsi(stdout);
      assert.equal(code, 0);
      assert.match(plain, /Project: all/);
      assert.match(plain, /Level:\s+admin/);
    } finally {
      await server.close();
    }
  });

  it('tells create to run login --level admin when the level is too low or the grant is one project', async () => {
    const cases = [
      [{ level: 'read', project: null }, /This session is read/],
      [{ level: 'manage', project: null }, /This session is manage/],
      [{ level: 'admin', project: 'my-site' }, /limited to project "my-site"/],
    ];
    for (const [session, pattern] of cases) {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500).end();
      });
      try {
        const { code, stdout } = await run([
          'create', 'my-site', '--domain', 'https://my-site.example', '--config-dir', sessionConfig(session),
        ], { env: { AGENT_ANALYTICS_URL: server.baseUrl } });
        const plain = stripAnsi(stdout);
        assert.notEqual(code, 0);
        assert.equal(calls, 0);
        assert.match(plain, /run login --level admin/);
        assert.match(plain, pattern);
        assert.equal(plain.includes('login --level admin --project'), false);
      } finally {
        await server.close();
      }
    }
  });

  it('lets admin on all projects create, and hints when a legacy session is forbidden', async () => {
    let posts = 0;
    const server = await startServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/projects') {
        posts += 1;
        res.writeHead(posts === 1 ? 201 : 403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(posts === 1
          ? {
            id: 'proj_new',
            name: 'my-site',
            project_token: 'aat_new',
            allowed_origins: 'https://my-site.example',
            snippet: '<script></script>',
            api_example: 'curl /stats',
          }
          : { code: 'FORBIDDEN_SCOPE', message: 'agent session level cannot create projects' }));
        return;
      }
      res.writeHead(404).end();
    });
    try {
      const env = { AGENT_ANALYTICS_URL: server.baseUrl };
      const created = await run([
        'create', 'my-site', '--domain', 'https://my-site.example',
        '--config-dir', sessionConfig({ level: 'admin', project: null }),
      ], { env });
      const legacy = await run([
        'create', 'my-site', '--domain', 'https://my-site.example',
        '--config-dir', sessionConfig({}),
      ], { env });
      assert.equal(created.code, 0);
      assert.match(stripAnsi(created.stdout), /Project created/);
      assert.notEqual(legacy.code, 0);
      assert.match(stripAnsi(legacy.stdout), /run login --level admin/);
      assert.equal(posts, 2);
    } finally {
      await server.close();
    }
  });

  it('hints on erasure when the level is too low or the project is outside the grant', async () => {
    const server = await startServer((req, res) => {
      if (req.method === 'POST' && req.url === '/erasures') {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          code: 'FORBIDDEN_SCOPE',
          message: 'agent session level cannot erase',
        }));
        return;
      }
      if (req.url.startsWith('/erasures')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'PROJECT_NOT_FOUND', message: 'Project not found.' }));
        return;
      }
      res.writeHead(404).end();
    });
    try {
      const env = { AGENT_ANALYTICS_URL: server.baseUrl };
      const readDir = sessionConfig({ level: 'read', project: 'my-site' });
      const erase = await run([
        'erase', 'my-site', '--user-id', 'user-secret-9f3a', '--confirm', 'erase',
        '--config-dir', readDir,
      ], { env });
      const list = await run(['erasures', 'other-site', '--config-dir', readDir], { env });
      const got = await run(['erasures', 'get', 'era_123', '--config-dir', readDir], { env });
      const eraseText = stripAnsi(erase.stdout);
      const listText = stripAnsi(list.stdout);
      const gotText = stripAnsi(got.stdout);
      assert.notEqual(erase.code, 0);
      assert.match(eraseText, /This session is read/);
      assert.match(eraseText, /run login --level manage/);
      assert.equal(eraseText.includes('user-secret-9f3a'), false);
      assert.match(listText, /outside that grant/);
      assert.match(listText, /my-site/);
      assert.match(gotText, /outside its grant/);
      assert.match(gotText, /whoami/);
    } finally {
      await server.close();
    }
  });
});
