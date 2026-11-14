import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { scopesForLevel } from '../lib/scopes.mjs';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'cli.mjs');

function run(args, env, timeout = 8000) {
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

function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => resolve(data ? JSON.parse(data) : null));
  });
}

describe('access level e2e against a mocked server', () => {
  it('logs in, prints the granted project and level, and blocks erase and create until admin on all projects', async () => {
    const home = mkdtempSync(join(tmpdir(), 'aa-e2e-'));
    const browserScript = join(home, 'browser.mjs');
    writeFileSync(browserScript, `
      const response = await fetch(process.argv[2], { redirect: 'follow' });
      if (!response.ok) process.exit(1);
    `);

    const starts = [];
    let callbackUrl = null;
    let projectPosts = 0;
    const grants = [
      {
        level: 'read',
        project: 'my-site',
        access_token: 'aas_read_grant',
        scopes: [...scopesForLevel('read')],
      },
      {
        level: 'admin',
        project: null,
        access_token: 'aas_admin_grant',
        scopes: [...scopesForLevel('admin')],
      },
    ];

    const server = createServer(async (req, res) => {
      if (req.method === 'POST' && req.url === '/agent-sessions/start') {
        const body = await readBody(req);
        starts.push(body);
        callbackUrl = body.callback_url;
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          auth_request_id: `req-${starts.length}`,
          authorize_url: `http://127.0.0.1:${server.address().port}/approve`,
          poll_token: `aap_poll_${starts.length}`,
        }));
        return;
      }

      if (req.method === 'GET' && req.url === '/approve') {
        const callback = new URL(callbackUrl);
        callback.searchParams.set('request_id', `req-${starts.length}`);
        callback.searchParams.set('exchange_code', `aae_${starts.length}`);
        res.writeHead(302, { Location: callback.toString() });
        res.end();
        return;
      }

      if (req.method === 'POST' && req.url === '/agent-sessions/exchange') {
        await readBody(req);
        const grant = grants[starts.length - 1];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          agent_session: {
            id: `sess-${starts.length}`,
            access_token: grant.access_token,
            refresh_token: `aar_${starts.length}`,
            access_expires_at: 1893456000000,
            refresh_expires_at: 1924992000000,
            scopes: grant.scopes,
            level: grant.level,
            project: grant.project,
          },
          account: { email: 'owner@example.com', tier: 'pro' },
        }));
        return;
      }

      if (req.method === 'GET' && req.url === '/account') {
        const token = req.headers.authorization;
        const grant = token === 'Bearer aas_admin_grant' ? grants[1] : grants[0];
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          email: 'owner@example.com',
          github_login: 'owner',
          tier: 'pro',
          projects_count: 1,
          level: grant.level,
          project: grant.project,
        }));
        return;
      }

      if (req.method === 'POST' && req.url === '/erasures') {
        const body = await readBody(req);
        if (req.headers.authorization !== 'Bearer aas_read_grant') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 'FORBIDDEN_SCOPE', message: 'wrong session' }));
          return;
        }
        const status = body.project === 'my-site' ? 403 : 404;
        const payload = body.project === 'my-site'
          ? { code: 'FORBIDDEN_SCOPE', message: 'agent session level cannot erase' }
          : { code: 'PROJECT_NOT_FOUND', message: 'Project not found.' };
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(payload));
        return;
      }

      if (req.method === 'GET' && req.url.startsWith('/erasures')) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ code: 'PROJECT_NOT_FOUND', message: 'Project not found.' }));
        return;
      }

      if (req.method === 'POST' && req.url === '/projects') {
        projectPosts += 1;
        await readBody(req);
        if (req.headers.authorization !== 'Bearer aas_admin_grant') {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 'FORBIDDEN_SCOPE', message: 'level too low' }));
          return;
        }
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          id: 'proj_e2e',
          name: 'my-site',
          project_token: 'aat_e2e',
          allowed_origins: 'https://my-site.example',
          snippet: '<script></script>',
          api_example: 'curl /stats',
        }));
        return;
      }

      res.writeHead(404).end();
    });

    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const env = {
      AGENT_ANALYTICS_URL: baseUrl,
      AGENT_ANALYTICS_OPEN_COMMAND: `node ${browserScript}`,
      XDG_CONFIG_HOME: home,
    };

    try {
      const first = await run([
        'login', '--project', 'other-site', '--level', 'admin',
      ], env);
      assert.equal(first.code, 0, first.stdout);
      assert.equal(starts[0].level, 'admin');
      assert.equal(starts[0].project, 'other-site');
      assert.deepEqual(starts[0].scopes, [...scopesForLevel('admin')]);
      assert.equal('poll_token' in starts[0], false);

      const who = await run(['whoami'], env);
      const whoText = stripAnsi(who.stdout);
      assert.equal(who.code, 0, who.stdout);
      assert.match(whoText, /Project: my-site/);
      assert.match(whoText, /Level:\s+read/);

      const outside = await run([
        'erase', 'other-site', '--user-id', 'user-secret-9f3a', '--confirm', 'erase',
      ], env);
      const outsideText = stripAnsi(outside.stdout);
      assert.notEqual(outside.code, 0);
      assert.match(outsideText, /granted project "my-site"/);
      assert.match(outsideText, /outside that grant/);
      assert.equal(outsideText.includes('user-secret-9f3a'), false);

      const listed = await run(['erasures', 'other-site'], env);
      assert.match(stripAnsi(listed.stdout), /outside that grant/);

      const low = await run([
        'erase', 'my-site', '--session-id', 'sess-secret-9f3a', '--confirm', 'erase',
      ], env);
      const lowText = stripAnsi(low.stdout);
      assert.match(lowText, /This session is read/);
      assert.match(lowText, /run login --level manage/);
      assert.equal(lowText.includes('sess-secret-9f3a'), false);

      const blockedCreate = await run([
        'create', 'my-site', '--domain', 'https://my-site.example',
      ], env);
      assert.notEqual(blockedCreate.code, 0);
      assert.match(stripAnsi(blockedCreate.stdout), /run login --level admin/);
      assert.equal(projectPosts, 0);

      const second = await run(['login', '--level', 'admin'], env);
      assert.equal(second.code, 0, second.stdout);
      assert.equal(starts[1].level, 'admin');
      assert.equal('project' in starts[1], false);
      assert.deepEqual(starts[1].scopes, [...scopesForLevel('admin')]);

      const adminWho = stripAnsi((await run(['whoami'], env)).stdout);
      assert.match(adminWho, /Project: all/);
      assert.match(adminWho, /Level:\s+admin/);

      const created = await run([
        'create', 'my-site', '--domain', 'https://my-site.example',
      ], env);
      assert.equal(created.code, 0, created.stdout);
      assert.match(stripAnsi(created.stdout), /Project created/);
      assert.equal(projectPosts, 1);

      const stored = JSON.parse(readFileSync(join(home, 'agent-analytics', 'config.json'), 'utf8'));
      assert.equal(stored.agent_session.level, 'admin');
      assert.equal(stored.agent_session.project, null);
      assert.equal(stored.agent_session.access_token, 'aas_admin_grant');
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
