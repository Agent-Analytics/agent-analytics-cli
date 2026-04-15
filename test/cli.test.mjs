import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');

function run(args = [], { env = {}, timeout = 5000 } = {}) {
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], {
      timeout,
      env: { ...process.env, ...env },
    }, (err, stdout, stderr) => {
      resolve({
        code: err ? err.code : 0,
        stdout,
        stderr,
      });
    });
  });
}

function createTempConfigHome(config) {
  const xdgConfigHome = mkdtempSync(join(tmpdir(), 'agent-analytics-cli-'));
  const configDir = join(xdgConfigHome, 'agent-analytics');
  const configFile = join(configDir, 'config.json');

  if (config !== undefined) {
    mkdirSync(configDir, { recursive: true });
    writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  }

  return {
    xdgConfigHome,
    configFile,
    cleanup() {
      rmSync(xdgConfigHome, { recursive: true, force: true });
    },
  };
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
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

describe('CLI', () => {
  describe('help', () => {
    it('shows help with --help flag', async () => {
      const { code, stdout } = await run(['--help']);
      const plain = stripAnsi(stdout);
      assert.equal(code, 0);
      assert.ok(stdout.includes('Agent Analytics'));
      assert.ok(stdout.includes('ANALYTICS'));
      assert.ok(stdout.includes('login'));
      assert.ok(stdout.includes('logout'));
      assert.ok(stdout.includes('stats'));
      assert.ok(stdout.includes('all-sites'));
      assert.ok(stdout.includes('bot-traffic'));
      assert.ok(plain.includes('paths <name>'));
      assert.ok(stdout.includes('feedback'));
    });

    it('shows help with help command', async () => {
      const { code, stdout } = await run(['help']);
      assert.equal(code, 0);
      assert.ok(stdout.includes('USAGE'));
    });

    it('shows help with -h flag', async () => {
      const { code, stdout } = await run(['-h']);
      assert.equal(code, 0);
      assert.ok(stdout.includes('ANALYTICS'));
    });

    it('shows help with no arguments', async () => {
      const { code, stdout } = await run([]);
      assert.equal(code, 0);
      assert.ok(stdout.includes('agent-analytics'));
      assert.ok(stdout.includes('logout'));
    });
  });

  describe('unknown command', () => {
    it('exits with error for unknown command', async () => {
      const { code, stdout } = await run(['nonexistent']);
      assert.notEqual(code, 0);
      assert.ok(stdout.includes('Unknown command: nonexistent'));
    });
  });

  describe('login without token', () => {
    it('starts the detached agent-session login flow and prints the manual resume command', async () => {
      const server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          if (req.method === 'POST' && req.url === '/agent-sessions/start') {
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              auth_request_id: 'req-cli-detached',
              authorize_url: 'https://approve.example/req-cli-detached',
              approval_code: 'CLI12345',
              poll_token: 'aap_cli_detached',
            }));
            return;
          }
          if (req.method === 'POST' && req.url === '/agent-sessions/poll') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'pending' }));
            return;
          }
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
        });
      });

      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const { code, stdout } = await run(['login', '--detached'], {
          env: { AGENT_ANALYTICS_URL: baseUrl },
          timeout: 1200,
        });

        assert.equal(code, null);
        assert.ok(stdout.includes('Agent Analytics — Detached Login'));
        assert.ok(stdout.includes('Approval URL:'));
        assert.ok(stdout.includes('req-cli-detached'));
        assert.ok(stdout.includes('login --auth-request req-cli-detached --exchange-code <code>'));
      } finally {
        await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      }
    });
  });

  describe('feedback', () => {
    it('shows usage guidance when message is missing', async () => {
      const { code, stdout } = await run(['feedback'], {
        env: {
          AGENT_ANALYTICS_API_KEY: 'aak_test123',
        },
      });

      assert.notEqual(code, 0);
      assert.ok(stdout.includes('Usage: npx @agent-analytics/cli feedback'));
    });
  });

  describe('query', () => {
    it('forwards --count-mode session_then_user to the /query payload', async () => {
      let requestBody;
      const server = createServer((req, res) => {
        if (req.method !== 'POST' || req.url !== '/query') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }

        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          requestBody = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            period: { from: '2026-03-01', to: '2026-03-30' },
            rows: [],
            count: 0,
          }));
        });
      });

      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const { code, stdout } = await run([
          'query',
          'my-site',
          '--metrics', 'event_count',
          '--count-mode', 'session_then_user',
          '--limit', '25',
        ], {
          env: {
            AGENT_ANALYTICS_API_KEY: 'aak_test123',
            AGENT_ANALYTICS_URL: baseUrl,
          },
        });

        assert.equal(code, 0);
        assert.ok(stdout.includes('Query: my-site'));
        assert.deepEqual(requestBody, {
          project: 'my-site',
          metrics: ['event_count'],
          limit: 25,
          count_mode: 'session_then_user',
        });
      } finally {
        await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      }
    });

    it('documents raw event rows as the default count mode', async () => {
      const { code, stdout } = await run(['query'], {
        env: {
          AGENT_ANALYTICS_API_KEY: 'aak_test123',
        },
      });
      const output = stripAnsi(stdout);

      assert.notEqual(code, 0);
      assert.ok(output.includes('--count-mode raw or session_then_user (default: raw event rows)'));
      assert.ok(output.includes('--count-mode session_then_user'));
      assert.ok(!output.includes('mixed session/no-session duplicates collapse by user'));
    });
  });

  describe('breakdown', () => {
    async function runBreakdown(args) {
      let requestUrl;
      const server = createServer((req, res) => {
        requestUrl = req.url;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          property: 'path',
          event: 'page_view',
          values: [],
          total_events: 0,
          total_with_property: 0,
        }));
      });

      await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      const baseUrl = `http://127.0.0.1:${address.port}`;

      try {
        const result = await run(args, {
          env: {
            AGENT_ANALYTICS_API_KEY: 'aak_test123',
            AGENT_ANALYTICS_URL: baseUrl,
          },
        });
        return { ...result, requestUrl };
      } finally {
        await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      }
    }

    it('forwards --days as since to /breakdown', async () => {
      const { code, requestUrl } = await runBreakdown([
        'breakdown',
        'my-site',
        '--property', 'path',
        '--event', 'page_view',
        '--days', '1',
      ]);

      assert.equal(code, 0);
      assert.equal(requestUrl, '/breakdown?project=my-site&property=path&event=page_view&since=1d&limit=20');
    });

    it('forwards --since directly to /breakdown', async () => {
      const { code, requestUrl } = await runBreakdown([
        'breakdown',
        'my-site',
        '--property', 'path',
        '--since', '2026-04-13',
      ]);

      assert.equal(code, 0);
      assert.equal(requestUrl, '/breakdown?project=my-site&property=path&since=2026-04-13&limit=20');
    });

    it('prefers --since over --days for /breakdown', async () => {
      const { code, requestUrl } = await runBreakdown([
        'breakdown',
        'my-site',
        '--property', 'path',
        '--since', '2026-04-13',
        '--days', '1',
      ]);

      assert.equal(code, 0);
      assert.equal(requestUrl, '/breakdown?project=my-site&property=path&since=2026-04-13&limit=20');
    });
  });

  describe('projects', () => {
    const stylioProject = {
      id: 'proj-stylio',
      name: 'stylio',
      project_token: 'aat_stylio',
      allowed_origins: 'https://stylio.app',
      created_at: '2026-04-12T12:00:00.000Z',
    };

    it('prints project ids', async () => {
      const server = await startServer((req, res) => {
        if (req.method === 'GET' && req.url === '/projects') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ projects: [stylioProject] }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run(['projects'], {
          env: {
            AGENT_ANALYTICS_API_KEY: 'aak_test123',
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        assert.equal(code, 0);
        assert.ok(stripAnsi(stdout).includes('id: proj-stylio'));
      } finally {
        await server.close();
      }
    });

    it('updates origins by resolving project name to id', async () => {
      let patchBody;
      let patchUrl;
      const server = await startServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/projects') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ projects: [stylioProject] }));
          return;
        }
        if (req.method === 'PATCH' && req.url === '/projects/proj-stylio') {
          patchUrl = req.url;
          patchBody = await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ...stylioProject,
            allowed_origins: patchBody.allowed_origins,
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run([
          'update',
          'stylio',
          '--origins',
          'https://stylio.app,http://lvh.me:3101',
        ], {
          env: {
            AGENT_ANALYTICS_API_KEY: 'aak_test123',
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        assert.equal(code, 0);
        assert.equal(patchUrl, '/projects/proj-stylio');
        assert.deepEqual(patchBody, {
          allowed_origins: 'https://stylio.app,http://lvh.me:3101',
        });
        assert.ok(stdout.includes('Project stylio updated'));
      } finally {
        await server.close();
      }
    });

    it('updates origins by id without requiring name', async () => {
      let patchBody;
      const server = await startServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/projects') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ projects: [stylioProject] }));
          return;
        }
        if (req.method === 'PATCH' && req.url === '/projects/proj-stylio') {
          patchBody = await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ...stylioProject,
            allowed_origins: patchBody.allowed_origins,
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code } = await run([
          'update',
          'proj-stylio',
          '--origins',
          'https://stylio.app,http://lvh.me:3101',
        ], {
          env: {
            AGENT_ANALYTICS_API_KEY: 'aak_test123',
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        assert.equal(code, 0);
        assert.deepEqual(patchBody, {
          allowed_origins: 'https://stylio.app,http://lvh.me:3101',
        });
      } finally {
        await server.close();
      }
    });

    it('gets a project by resolving project name to id', async () => {
      let detailUrl;
      const server = await startServer((req, res) => {
        if (req.method === 'GET' && req.url === '/projects') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ projects: [stylioProject] }));
          return;
        }
        if (req.method === 'GET' && req.url === '/projects/proj-stylio') {
          detailUrl = req.url;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(stylioProject));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run(['project', 'stylio'], {
          env: {
            AGENT_ANALYTICS_API_KEY: 'aak_test123',
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        assert.equal(code, 0);
        assert.equal(detailUrl, '/projects/proj-stylio');
        assert.ok(stdout.includes('Project: stylio'));
      } finally {
        await server.close();
      }
    });

    it('deletes a project by resolving project name to id', async () => {
      let deleteUrl;
      const server = await startServer((req, res) => {
        if (req.method === 'GET' && req.url === '/projects') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ projects: [stylioProject] }));
          return;
        }
        if (req.method === 'DELETE' && req.url === '/projects/proj-stylio') {
          deleteUrl = req.url;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run(['delete', 'stylio'], {
          env: {
            AGENT_ANALYTICS_API_KEY: 'aak_test123',
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        assert.equal(code, 0);
        assert.equal(deleteUrl, '/projects/proj-stylio');
        assert.ok(stdout.includes('Project stylio deleted'));
      } finally {
        await server.close();
      }
    });
  });

  describe('logout', () => {
    it('clears stored auth and preserves non-auth config', async () => {
      const temp = createTempConfigHome({
        api_key: 'aak_saved',
        email: 'dev@example.com',
        github_login: 'devuser',
        base_url: 'https://custom.example.com',
      });

      try {
        const { code, stdout } = await run(['logout'], {
          env: {
            XDG_CONFIG_HOME: temp.xdgConfigHome,
            AGENT_ANALYTICS_API_KEY: '',
          },
        });

        assert.equal(code, 0);
        assert.ok(stdout.includes('Logged out locally'));
        assert.deepEqual(readJson(temp.configFile), {
          base_url: 'https://custom.example.com',
        });
      } finally {
        temp.cleanup();
      }
    });

    it('succeeds when no saved auth exists', async () => {
      const temp = createTempConfigHome();

      try {
        const { code, stdout } = await run(['logout'], {
          env: {
            XDG_CONFIG_HOME: temp.xdgConfigHome,
            AGENT_ANALYTICS_API_KEY: '',
          },
        });

        assert.equal(code, 0);
        assert.ok(stdout.includes('Already logged out locally'));
      } finally {
        temp.cleanup();
      }
    });

    it('is idempotent when config exists without auth fields', async () => {
      const temp = createTempConfigHome({
        base_url: 'https://custom.example.com',
      });

      try {
        const { code, stdout } = await run(['logout'], {
          env: {
            XDG_CONFIG_HOME: temp.xdgConfigHome,
            AGENT_ANALYTICS_API_KEY: '',
          },
        });

        assert.equal(code, 0);
        assert.ok(stdout.includes('Already logged out locally'));
        assert.deepEqual(readJson(temp.configFile), {
          base_url: 'https://custom.example.com',
        });
      } finally {
        temp.cleanup();
      }
    });

    it('warns when AGENT_ANALYTICS_API_KEY is still set', async () => {
      const temp = createTempConfigHome({
        api_key: 'aak_saved',
        email: 'dev@example.com',
      });

      try {
        const { code, stdout } = await run(['logout'], {
          env: {
            XDG_CONFIG_HOME: temp.xdgConfigHome,
            AGENT_ANALYTICS_API_KEY: 'aak_env_override',
          },
        });

        assert.equal(code, 0);
        assert.ok(stdout.includes('AGENT_ANALYTICS_API_KEY'));
        assert.ok(stdout.includes('unset AGENT_ANALYTICS_API_KEY'));
      } finally {
        temp.cleanup();
      }
    });
  });
});
