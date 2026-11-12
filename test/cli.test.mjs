import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { agentSessionEnv } from './auth-test-helpers.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');

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
    configDir,
    configFile,
    cleanup() {
      rmSync(xdgConfigHome, { recursive: true, force: true });
    },
  };
}

function createExplicitConfigDir(config) {
  const configDir = mkdtempSync(join(tmpdir(), 'agent-analytics-explicit-config-'));
  const configFile = join(configDir, 'config.json');

  if (config !== undefined) {
    writeFileSync(configFile, JSON.stringify(config, null, 2) + '\n');
  }

  return {
    configDir,
    configFile,
    cleanup() {
      rmSync(configDir, { recursive: true, force: true });
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

  describe('public demo mode', () => {
    it('prints no-login demo prompts and commands', async () => {
      const { code, stdout } = await run(['demo']);
      const plain = stripAnsi(stdout);

      assert.equal(code, 0);
      assert.ok(plain.includes('Try Agent Analytics with seeded demo data'));
      assert.ok(plain.includes('npx @agent-analytics/cli@'));
      assert.ok(plain.includes('--demo projects'));
      assert.ok(plain.includes('Audit the signup leak'));
      assert.ok(plain.includes('--demo breakdown agentanalytics-demo --property path --event signup_started --days 30'));
    });

    it('fetches a demo session, uses bearer auth, and does not write config', async () => {
      const tempHome = createTempConfigHome();
      const explicitConfig = createExplicitConfigDir();
      let demoSessionCalls = 0;
      let projectsAuth;
      const server = await startServer((req, res) => {
        if (req.method === 'POST' && req.url === '/demo/session') {
          demoSessionCalls += 1;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            mode: 'demo',
            agent_session: {
              access_token: 'aas_demo_readonly',
              access_expires_at: Date.now() + 60_000,
              scopes: ['account:read', 'projects:read', 'analytics:read', 'experiments:read'],
            },
            projects: [{ name: 'agentanalytics-demo' }],
          }));
          return;
        }

        if (req.method === 'GET' && req.url === '/projects') {
          projectsAuth = req.headers.authorization;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            projects: [{
              id: 'proj-demo',
              name: 'agentanalytics-demo',
              project_token: 'aat_demo',
              allowed_origins: 'https://agentanalytics.sh',
              created_at: Date.now(),
            }],
          }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run(['--demo', 'projects', '--config-dir', explicitConfig.configDir], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            XDG_CONFIG_HOME: tempHome.xdgConfigHome,
          },
        });

        assert.equal(code, 0);
        assert.equal(demoSessionCalls, 1);
        assert.equal(projectsAuth, 'Bearer aas_demo_readonly');
        assert.ok(stdout.includes('agentanalytics-demo'));
        assert.equal(existsSync(tempHome.configFile), false);
        assert.equal(existsSync(explicitConfig.configFile), false);
      } finally {
        await server.close();
        tempHome.cleanup();
        explicitConfig.cleanup();
      }
    });

    it('blocks mutating commands locally before making API requests', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'should not be called' }));
      });

      try {
        const { code, stdout } = await run(['--demo', 'create', 'demo-site', '--domain', 'https://demo.example'], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });

        assert.notEqual(code, 0);
        assert.equal(calls, 0);
        assert.ok(stripAnsi(stdout).includes('Demo mode is read-only'));
      } finally {
        await server.close();
      }
    });
  });

  describe('upgrade-link', () => {
    it('requires exactly one mode flag before making network requests', async () => {
      const missing = await run(['upgrade-link']);
      assert.notEqual(missing.code, 0);
      assert.ok(stripAnsi(missing.stdout).includes('upgrade-link --detached|--wait'));

      const both = await run(['upgrade-link', '--detached', '--wait']);
      assert.notEqual(both.code, 0);
      assert.ok(stripAnsi(both.stdout).includes('upgrade-link --detached|--wait'));
    });

    it('treats saved raw API key auth as not logged in locally', async () => {
      const config = createExplicitConfigDir({ api_key: 'aak_raw' });

      try {
        const { code, stdout } = await run(['upgrade-link', '--detached', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: 'http://127.0.0.1:9' },
        });

        assert.notEqual(code, 0);
        assert.ok(stripAnsi(stdout).includes('Not logged in'));
        assert.ok(stripAnsi(stdout).includes('Run: npx @agent-analytics/cli login'));
      } finally {
        config.cleanup();
      }
    });

    it('prints an app-domain detached handoff link', async () => {
      const config = createExplicitConfigDir({
        agent_session: { access_token: 'aas_saved' },
      });
      let accountCalls = 0;
      const server = await startServer((req, res) => {
        if (req.method === 'GET' && req.url === '/account') {
          accountCalls += 1;
          assert.equal(req.headers.authorization, 'Bearer aas_saved');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'acct-free',
            email: 'free@example.com',
            tier: 'free',
            projects_count: 1,
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const { code, stdout } = await run([
          'upgrade-link',
          '--detached',
          '--reason',
          'Need funnels',
          '--command',
          'npx @agent-analytics/cli funnel my-site --steps page_view,signup',
          '--config-dir',
          config.configDir,
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_DASHBOARD_URL: 'https://app.example.test',
          },
        });
        const plain = stripAnsi(stdout);

        assert.equal(code, 0);
        assert.equal(accountCalls, 1);
        assert.ok(plain.includes('https://app.example.test/account/billing/agent-upgrade?'));
        assert.ok(plain.includes('account=acct-free'));
        assert.ok(plain.includes('mode=detached'));
        assert.ok(plain.includes('The+requested+analytics+task+needs+Pro.'));
        assert.ok(!plain.includes('command='));
        assert.ok(!plain.includes('Need+funnels'));
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('waits until the account becomes Pro', async () => {
      const config = createExplicitConfigDir({
        agent_session: { access_token: 'aas_saved' },
      });
      let accountCalls = 0;
      const server = await startServer((req, res) => {
        if (req.method === 'GET' && req.url === '/account') {
          accountCalls += 1;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'acct-wait',
            email: 'wait@example.com',
            tier: accountCalls >= 2 ? 'pro' : 'free',
            projects_count: 1,
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const { code, stdout } = await run(['upgrade-link', '--wait', '--config-dir', config.configDir], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_UPGRADE_POLL_INTERVAL_MS: '10',
            AGENT_ANALYTICS_UPGRADE_TIMEOUT_MS: '1000',
          },
        });
        const plain = stripAnsi(stdout);

        assert.equal(code, 0);
        assert.ok(accountCalls >= 2);
        assert.ok(plain.includes('Waiting for Pro activation'));
        assert.ok(plain.includes('Pro is active'));
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('times out cleanly while waiting for Pro activation', async () => {
      const config = createExplicitConfigDir({
        agent_session: { access_token: 'aas_saved' },
      });
      const server = await startServer((req, res) => {
        if (req.method === 'GET' && req.url === '/account') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'acct-timeout',
            email: 'timeout@example.com',
            tier: 'free',
            projects_count: 1,
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const { code, stdout } = await run(['upgrade-link', '--wait', '--config-dir', config.configDir], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_UPGRADE_POLL_INTERVAL_MS: '10',
            AGENT_ANALYTICS_UPGRADE_TIMEOUT_MS: '30',
          },
        });
        const plain = stripAnsi(stdout);

        assert.notEqual(code, 0);
        assert.ok(plain.includes('Still waiting for Pro activation'));
        assert.ok(plain.includes('Return to the agent'));
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('prints explicit upgrade commands for paid-only errors without creating checkout', async () => {
      const config = createExplicitConfigDir({
        agent_session: { access_token: 'aas_saved' },
      });
      let checkoutCalls = 0;
      const server = await startServer((req, res) => {
        if (req.method === 'GET' && req.url.startsWith('/properties?')) {
          res.writeHead(403, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'PRO_REQUIRED',
            message: 'This endpoint is available on paid plans.',
          }));
          return;
        }
        if (req.url.includes('/billing/checkout')) checkoutCalls += 1;
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const { code, stdout } = await run(['properties', 'my-site', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });
        const plain = stripAnsi(stdout);

        assert.notEqual(code, 0);
        assert.equal(checkoutCalls, 0);
        assert.ok(plain.includes('upgrade-link --detached'));
        assert.ok(plain.includes('upgrade-link --wait'));
        assert.ok(!plain.includes('--command'));
        assert.ok(plain.includes('Keep the original analytics command in this agent session'));
      } finally {
        await server.close();
        config.cleanup();
      }
    });
  });

  describe('config directory selection', () => {
    async function startAccountServer({ expectedAuth = 'Bearer aas_saved', refresh = false } = {}) {
      let accountCalls = 0;
      let refreshCalls = 0;
      const server = await startServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/account') {
          accountCalls += 1;
          if (refresh && accountCalls === 1) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'expired' }));
            return;
          }
          assert.equal(req.headers.authorization || req.headers['x-api-key'], expectedAuth);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            email: 'config@example.com',
            github_login: 'configdev',
            tier: 'pro',
            projects_count: 2,
          }));
          return;
        }

        if (req.method === 'POST' && req.url === '/agent-sessions/refresh') {
          refreshCalls += 1;
          await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            agent_session: {
              access_token: 'aas_refreshed',
              refresh_token: 'aar_saved',
              access_expires_at: 1893456000000,
              refresh_expires_at: 1924992000000,
              scopes: ['account:read'],
            },
          }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      return {
        ...server,
        get accountCalls() { return accountCalls; },
        get refreshCalls() { return refreshCalls; },
      };
    }

    it('rejects login --token instead of storing raw API-key auth', async () => {
      const config = createExplicitConfigDir();
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'should not be called' }));
      });

      try {
        const { code, stdout } = await run(['login', '--token', 'aak_config_token', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl, XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'agent-analytics-unused-xdg-')) },
        });
        const plain = stripAnsi(stdout);

        assert.notEqual(code, 0);
        assert.equal(calls, 0);
        assert.match(plain, /Usage: npx @agent-analytics\/cli login \[--detached/i);
        assert.match(plain, /browser/i);
        assert.match(plain, /detached/i);
        assert.equal(plain.includes('API key'), false);
        assert.equal(existsSync(config.configFile), false);
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('rejects positional login tokens as invalid command shape', async () => {
      const config = createExplicitConfigDir();
      const { code, stdout } = await run(['login', 'aak_positional_token', '--config-dir', config.configDir], {
        env: { AGENT_ANALYTICS_URL: 'http://127.0.0.1:9' },
      });
      const plain = stripAnsi(stdout);

      assert.notEqual(code, 0);
      assert.match(plain, /Usage: npx @agent-analytics\/cli login \[--detached/i);
      assert.match(plain, /browser/i);
      assert.match(plain, /detached/i);
      assert.equal(plain.includes('API key'), false);
      assert.equal(plain.includes('migration'), false);
      config.cleanup();
    });

    it('rejects login --auth-request without an exchange code instead of starting browser login', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'should not be called' }));
      });

      try {
        const { code, stdout } = await run(['login', '--auth-request', 'req_123'], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });
        const plain = stripAnsi(stdout);

        assert.notEqual(code, 0);
        assert.equal(calls, 0);
        assert.match(plain, /Usage: npx @agent-analytics\/cli login \[--detached/i);
        assert.match(plain, /browser/i);
        assert.match(plain, /detached/i);
        assert.equal(plain.includes('API key'), false);
        assert.equal(plain.includes('migration'), false);
      } finally {
        await server.close();
      }
    });

    it('rejects login --exchange-code without auth request with browser and detached usage', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'should not be called' }));
      });

      try {
        const { code, stdout } = await run(['login', '--exchange-code', 'aae_123'], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });
        const plain = stripAnsi(stdout);

        assert.notEqual(code, 0);
        assert.equal(calls, 0);
        assert.match(plain, /Usage: npx @agent-analytics\/cli login \[--detached/i);
        assert.match(plain, /browser/i);
        assert.match(plain, /detached/i);
        assert.equal(plain.includes('API key'), false);
        assert.equal(plain.includes('migration'), false);
      } finally {
        await server.close();
      }
    });

    it('rejects detached manual exchange shape before making network requests', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'should not be called' }));
      });

      try {
        const { code, stdout } = await run(['login', '--detached', '--auth-request', 'req_123', '--exchange-code', 'aae_123'], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });
        const plain = stripAnsi(stdout);

        assert.notEqual(code, 0);
        assert.equal(calls, 0);
        assert.match(plain, /Usage: npx @agent-analytics\/cli login \[--detached/i);
        assert.match(plain, /browser/i);
        assert.match(plain, /detached/i);
        assert.equal(plain.includes('API key'), false);
        assert.equal(plain.includes('migration'), false);
      } finally {
        await server.close();
      }
    });

    it('does not surface legacy config api_key or env API key in auth status', async () => {
      const config = createExplicitConfigDir({
        api_key: 'aak_legacy',
        email: 'old@example.com',
      });

      try {
        const { code, stdout } = await run(['auth', 'status', '--config-dir', config.configDir], {
          env: {
            AGENT_ANALYTICS_URL: 'http://127.0.0.1:9',
            AGENT_ANALYTICS_API_KEY: 'aak_env_legacy',
          },
        });
        const plain = stripAnsi(stdout);

        assert.equal(code, 0);
        assert.ok(plain.includes('Logged in:          no'));
        assert.ok(plain.includes('Credential storage: none'));
        assert.ok(plain.includes('Secrets in config:  no'));
        assert.ok(plain.includes('Auth:        none'));
        assert.equal(plain.includes('AGENT_ANALYTICS_API_KEY'), false);
        assert.equal(plain.includes('raw API key'), false);
        assert.equal(plain.includes('legacy'), false);
        assert.equal(plain.includes('migration'), false);
      } finally {
        config.cleanup();
      }
    });

    it('treats env/config API keys as not logged in for auth-required commands', async () => {
      const config = createExplicitConfigDir({ api_key: 'aak_legacy' });
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'should not be called' }));
      });

      try {
        const { code, stdout } = await run(['projects', '--config-dir', config.configDir], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: 'aak_env_legacy',
          },
        });

        assert.notEqual(code, 0);
        assert.equal(calls, 0);
        assert.ok(stripAnsi(stdout).includes('Not logged in'));
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('reads whoami auth from an explicit --config-dir before the command', async () => {
      const config = createExplicitConfigDir({
        agent_session: {
          id: 'sess_config',
          access_token: 'aas_saved',
          refresh_token: 'aar_saved',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });
      const server = await startAccountServer();

      try {
        const { code, stdout } = await run(['--config-dir', config.configDir, 'whoami'], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });
        const plain = stripAnsi(stdout);

        assert.equal(code, 0);
        assert.ok(plain.includes('config@example.com'));
        assert.ok(plain.includes(config.configFile));
        assert.ok(plain.includes('stored agent session'));
        assert.ok(plain.includes('2030-01-01T00:00:00.000Z'));
        assert.ok(plain.includes('2031-01-01T00:00:00.000Z'));
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('persists refreshed whoami expiry metadata before printing diagnostics', async () => {
      const config = createExplicitConfigDir({
        agent_session: {
          id: 'sess_config',
          access_token: 'aas_expired',
          refresh_token: 'aar_saved',
          access_expires_at: 1,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });
      const server = await startAccountServer({ expectedAuth: 'Bearer aas_refreshed', refresh: true });

      try {
        const { code, stdout } = await run(['whoami', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });
        const plain = stripAnsi(stdout);

        assert.equal(code, 0);
        assert.equal(server.refreshCalls, 1);
        assert.ok(plain.includes('2030-01-01T00:00:00.000Z'));
        assert.equal(readJson(config.configFile).agent_session.access_token, 'aas_refreshed');
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('uses AGENT_ANALYTICS_CONFIG_DIR without the flag', async () => {
      const config = createExplicitConfigDir({
        agent_session: {
          access_token: 'aas_saved',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
        },
      });
      const server = await startAccountServer();

      try {
        const { code, stdout } = await run(['whoami'], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_CONFIG_DIR: config.configDir,
          },
        });

        assert.equal(code, 0);
        assert.ok(stripAnsi(stdout).includes('AGENT_ANALYTICS_CONFIG_DIR'));
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('lets --config-dir override AGENT_ANALYTICS_CONFIG_DIR', async () => {
      const envConfig = createExplicitConfigDir({
        agent_session: { access_token: 'aas_wrong' },
      });
      const flagConfig = createExplicitConfigDir({
        agent_session: { access_token: 'aas_saved' },
      });
      const server = await startAccountServer();

      try {
        const { code, stdout } = await run(['whoami', '--config-dir', flagConfig.configDir], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_CONFIG_DIR: envConfig.configDir,
          },
        });

        assert.equal(code, 0);
        assert.ok(stripAnsi(stdout).includes('--config-dir'));
      } finally {
        await server.close();
        envConfig.cleanup();
        flagConfig.cleanup();
      }
    });

    it('logout clears only the selected explicit --config-dir', async () => {
      const selected = createExplicitConfigDir({
        api_key: 'aak_selected',
        email: 'selected@example.com',
      });
      const other = createExplicitConfigDir({
        api_key: 'aak_other',
        email: 'other@example.com',
      });

      try {
        const { code } = await run(['logout', '--config-dir', selected.configDir]);

        assert.equal(code, 0);
        assert.deepEqual(readJson(selected.configFile), {});
        assert.equal(readJson(other.configFile).api_key, 'aak_other');
      } finally {
        selected.cleanup();
        other.cleanup();
      }
    });

    it('logout revokes a stored agent session before clearing local auth', async () => {
      const config = createExplicitConfigDir({
        email: 'logout@example.com',
        agent_session: {
          id: 'sess_logout',
          access_token: 'aas_logout_secret',
          refresh_token: 'aar_logout_secret',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });
      let revokeCalls = 0;
      let revokePayload;
      let revokeAuth;
      let hadLocalAuthDuringRevoke = false;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/revoke') {
          revokeCalls += 1;
          revokeAuth = req.headers.authorization;
          revokePayload = await readRequestJson(req);
          hadLocalAuthDuringRevoke = Boolean(readJson(config.configFile).agent_session);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const { code, stdout, stderr } = await run(['logout', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });
        const combined = `${stdout}\n${stderr}`;

        assert.equal(code, 0);
        assert.equal(revokeCalls, 1);
        assert.equal(revokeAuth, 'Bearer aas_logout_secret');
        assert.deepEqual(revokePayload, { session_id: 'sess_logout' });
        assert.equal(hadLocalAuthDuringRevoke, true);
        assert.deepEqual(readJson(config.configFile), {});
        assert.equal(combined.includes('aas_logout_secret'), false);
        assert.equal(combined.includes('aar_logout_secret'), false);
        assert.equal(combined.includes('aak_'), false);
        assert.equal(combined.includes('agent_session'), false);
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('logout revokes and clears a native-keyring backed agent session using the fake keyring', async () => {
      const config = createExplicitConfigDir({
        email: 'native-logout@example.com',
        agent_session: {
          storage: 'native',
          credential: 'placeholder-is-not-used-for-lookup',
          id: 'sess_native_logout_metadata',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });
      const fakeKeyringFile = join(config.configDir, 'fake-keyring.json');
      let revokeCalls = 0;
      let revokePayload;
      let revokeAuth;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/revoke') {
          revokeCalls += 1;
          revokeAuth = req.headers.authorization;
          revokePayload = await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        writeFileSync(fakeKeyringFile, JSON.stringify({
          [`agent-analytics\0${server.baseUrl}|default`]: JSON.stringify({
            id: 'sess_native_logout',
            access_token: 'aas_native_logout_secret',
            refresh_token: 'aar_native_logout_secret',
            access_expires_at: 1893456000000,
            refresh_expires_at: 1924992000000,
            scopes: ['account:read'],
          }),
        }, null, 2) + '\n');

        const { code, stdout, stderr } = await run(['logout', '--config-dir', config.configDir], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_CREDENTIAL_PLATFORM: 'darwin',
            AGENT_ANALYTICS_FAKE_KEYRING_FILE: fakeKeyringFile,
          },
        });
        const combined = `${stdout}\n${stderr}`;

        assert.equal(code, 0);
        assert.equal(revokeCalls, 1);
        assert.equal(revokeAuth, 'Bearer aas_native_logout_secret');
        assert.deepEqual(revokePayload, { session_id: 'sess_native_logout' });
        assert.deepEqual(readJson(config.configFile), {});
        assert.deepEqual(readJson(fakeKeyringFile), {});
        assert.equal(combined.includes('aas_native_logout_secret'), false);
        assert.equal(combined.includes('aar_native_logout_secret'), false);
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('logout skips revoke and still clears native metadata when fake keyring cleanup fails', async () => {
      const config = createExplicitConfigDir({
        email: 'native-read-fail@example.com',
        agent_session: {
          storage: 'native',
          credential: 'broken-keyring-reference',
          id: 'sess_native_metadata_only',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });

      try {
        const { code, stdout, stderr } = await run(['logout', '--config-dir', config.configDir], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_CREDENTIAL_PLATFORM: 'darwin',
            AGENT_ANALYTICS_FAKE_KEYRING_FILE: config.configDir,
          },
        });
        const combined = `${stdout}\n${stderr}`;

        assert.equal(code, 0);
        assert.equal(calls, 0);
        assert.deepEqual(readJson(config.configFile), {});
        assert.ok(stripAnsi(combined).includes('Logged out locally'));
        assert.equal(combined.includes('sess_native_metadata_only'), false);
        assert.equal(combined.includes('agent_session'), false);
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('logout still clears local auth and exits 0 when session revoke fails', async () => {
      const config = createExplicitConfigDir({
        email: 'logout-fail@example.com',
        agent_session: {
          id: 'sess_logout_fail',
          access_token: 'aas_revoke_fail_secret',
          refresh_token: 'aar_revoke_fail_secret',
        },
      });
      let revokeCalls = 0;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/revoke') {
          revokeCalls += 1;
          await readRequestJson(req);
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'server unavailable' }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const { code, stdout, stderr } = await run(['logout', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });
        const combined = `${stdout}\n${stderr}`;

        assert.equal(code, 0);
        assert.equal(revokeCalls, 1);
        assert.deepEqual(readJson(config.configFile), {});
        assert.ok(stripAnsi(combined).includes('Logged out locally'));
        assert.equal(combined.includes('aas_revoke_fail_secret'), false);
        assert.equal(combined.includes('aar_revoke_fail_secret'), false);
        assert.equal(combined.includes('agent_session'), false);
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('logout does not revoke when there is no stored auth', async () => {
      const config = createExplicitConfigDir();
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });

      try {
        const { code } = await run(['logout', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });

        assert.equal(code, 0);
        assert.equal(calls, 0);
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('logout does not revoke without a stored session id', async () => {
      const config = createExplicitConfigDir({
        agent_session: {
          access_token: 'aas_no_session_id_secret',
          refresh_token: 'aar_no_session_id_secret',
        },
      });
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });

      try {
        const { code, stdout, stderr } = await run(['logout', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });

        assert.equal(code, 0);
        assert.equal(calls, 0);
        assert.deepEqual(readJson(config.configFile), {});
        assert.equal(`${stdout}\n${stderr}`.includes('aas_no_session_id_secret'), false);
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('logout does not revoke without usable token material', async () => {
      const config = createExplicitConfigDir({
        agent_session: {
          id: 'sess_without_tokens',
          access_expires_at: 1893456000000,
        },
      });
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });

      try {
        const { code } = await run(['logout', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });

        assert.equal(code, 0);
        assert.equal(calls, 0);
        assert.deepEqual(readJson(config.configFile), {});
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('prints detached resume commands with explicit --config-dir', async () => {
      const config = createExplicitConfigDir();
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          await readRequestJson(req);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-config-dir',
            authorize_url: 'https://approve.example/req-config-dir',
            poll_token: 'aap_config_dir',
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const { code, stdout } = await run(['--config-dir', config.configDir, 'login', '--detached'], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });
        const plain = stripAnsi(stdout);

        assert.equal(code, 0);
        assert.ok(plain.includes(`--config-dir ${config.configDir}`));
        assert.ok(plain.includes('login --auth-request req-config-dir --exchange-code <code>'));
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('prints detached resume commands with AGENT_ANALYTICS_CONFIG_DIR when env selected the path', async () => {
      const config = createExplicitConfigDir();
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          await readRequestJson(req);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-env-dir',
            authorize_url: 'https://approve.example/req-env-dir',
            poll_token: 'aap_env_dir',
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const { code, stdout } = await run(['login', '--detached'], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_CONFIG_DIR: config.configDir,
          },
        });
        const plain = stripAnsi(stdout);

        assert.equal(code, 0);
        assert.ok(plain.includes(`AGENT_ANALYTICS_CONFIG_DIR=${config.configDir}`));
        assert.ok(plain.includes('login --auth-request req-env-dir --exchange-code <code>'));
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('auth status reports file/config credential storage without token values or network access', async () => {
      const config = createExplicitConfigDir({
        email: 'local@example.com',
        github_login: 'localdev',
        google_name: 'Local Dev',
        tier: 'free',
        agent_session: {
          storage: 'file',
          id: 'sess_local',
          access_token: 'aas_secret_should_not_print',
          refresh_token: 'aar_secret_should_not_print',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read', 'projects:read'],
        },
      });

      try {
        const { code, stdout } = await run(['auth', 'status', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: 'http://127.0.0.1:9' },
        });
        const plain = stripAnsi(stdout);

        assert.equal(code, 0);
        assert.ok(plain.includes(config.configDir));
        assert.ok(plain.includes('Logged in:          yes'));
        assert.ok(plain.includes('Credential storage: file/config'));
        assert.ok(plain.includes('Secrets in config:  yes'));
        assert.ok(plain.includes('local@example.com'));
        assert.ok(plain.includes('sess_local'));
        assert.ok(plain.includes('account:read, projects:read'));
        assert.ok(plain.includes('2030-01-01T00:00:00.000Z'));
        assert.equal(plain.includes('aas_secret_should_not_print'), false);
        assert.equal(plain.includes('aar_secret_should_not_print'), false);
      } finally {
        config.cleanup();
      }
    });

    it('auth status reports native credential metadata without touching keychain or printing tokens', async () => {
      const config = createExplicitConfigDir({
        email: 'native@example.com',
        agent_session: {
          storage: 'native',
          credential: 'https://api.example.test|default',
          id: 'sess_native',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });

      try {
        const { code, stdout } = await run(['auth', 'status', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: 'http://127.0.0.1:9' },
        });
        const plain = stripAnsi(stdout);

        assert.equal(code, 0);
        assert.ok(plain.includes('Logged in:          yes'));
        assert.ok(plain.includes('Credential storage: native'));
        assert.ok(plain.includes('Credential account: https://api.example.test|default'));
        assert.ok(plain.includes('Secrets in config:  no'));
        assert.ok(plain.includes('native@example.com'));
        assert.ok(plain.includes('sess_native'));
        assert.equal(plain.includes('access_token'), false);
        assert.equal(plain.includes('refresh_token'), false);
      } finally {
        config.cleanup();
      }
    });

    it('fails loudly when --config-dir is missing a value', async () => {
      const { code, stdout } = await run(['whoami', '--config-dir']);

      assert.notEqual(code, 0);
      assert.ok(stripAnsi(stdout).includes('Missing value for --config-dir'));
    });
  });

  describe('login without token', () => {
    it('browser login stores an agent session that a later command uses as bearer auth', async () => {
      const tempHome = createTempConfigHome();
      const browserScript = join(tempHome.xdgConfigHome, 'fake-browser.mjs');
      writeFileSync(browserScript, `
        const url = process.argv[2];
        const response = await fetch(url, { redirect: 'follow' });
        if (!response.ok) process.exit(1);
      `);

      let callbackUrl;
      let exchangePayload;
      let projectsAuth;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          const body = await readRequestJson(req);
          callbackUrl = body.callback_url;
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-browser',
            authorize_url: `${server.baseUrl}/approve`,
            poll_token: 'aap_browser',
          }));
          return;
        }

        if (req.method === 'GET' && req.url === '/approve') {
          const callback = new URL(callbackUrl);
          callback.searchParams.set('request_id', 'req-browser');
          callback.searchParams.set('exchange_code', 'aae_browser');
          res.writeHead(302, { Location: callback.toString() });
          res.end();
          return;
        }

        if (req.method === 'POST' && req.url === '/agent-sessions/exchange') {
          exchangePayload = await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            agent_session: {
              id: 'sess-browser',
              access_token: 'aas_browser_saved',
              refresh_token: 'aar_browser_saved',
              access_expires_at: 1893456000000,
              refresh_expires_at: 1924992000000,
              scopes: ['account:read', 'projects:read'],
            },
            account: {
              email: 'browser@example.com',
              tier: 'pro',
            },
          }));
          return;
        }

        if (req.method === 'GET' && req.url === '/projects') {
          projectsAuth = req.headers.authorization;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            projects: [{
              id: 'proj_browser',
              name: 'browser-site',
              project_token: 'aat_browser',
              allowed_origins: 'https://browser.example',
              created_at: 1893456000000,
            }],
          }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const env = {
          AGENT_ANALYTICS_URL: server.baseUrl,
          AGENT_ANALYTICS_OPEN_COMMAND: `node ${browserScript}`,
          XDG_CONFIG_HOME: tempHome.xdgConfigHome,
          AGENT_ANALYTICS_API_KEY: '',
        };
        const login = await run(['login'], { env, timeout: 5000 });
        const config = readJson(tempHome.configFile);
        const projects = await run(['projects'], { env });

        assert.equal(login.code, 0);
        assert.equal(exchangePayload.auth_request_id, 'req-browser');
        assert.equal(exchangePayload.exchange_code, 'aae_browser');
        assert.ok(exchangePayload.code_verifier);
        assert.equal(config.agent_session.id, 'sess-browser');
        assert.equal(config.agent_session.access_token, 'aas_browser_saved');
        assert.equal(config.api_key, undefined);
        assert.equal(config.email, 'browser@example.com');
        assert.equal(projects.code, 0);
        assert.equal(projectsAuth, 'Bearer aas_browser_saved');
        assert.ok(projects.stdout.includes('browser-site'));
      } finally {
        await server.close();
        tempHome.cleanup();
      }
    });

    it('browser login in auto desktop mode stores secrets in fake native keyring and later command reads bearer auth', async () => {
      const tempHome = createTempConfigHome();
      const fakeKeyringFile = join(tempHome.xdgConfigHome, 'fake-keyring.json');
      const browserScript = join(tempHome.xdgConfigHome, 'fake-browser-native.mjs');
      writeFileSync(browserScript, `
        const url = process.argv[2];
        const response = await fetch(url, { redirect: 'follow' });
        if (!response.ok) process.exit(1);
      `);

      let callbackUrl;
      let projectsAuth;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          const body = await readRequestJson(req);
          callbackUrl = body.callback_url;
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-native-browser',
            authorize_url: `${server.baseUrl}/approve-native`,
            poll_token: 'aap_native_browser',
          }));
          return;
        }

        if (req.method === 'GET' && req.url === '/approve-native') {
          const callback = new URL(callbackUrl);
          callback.searchParams.set('request_id', 'req-native-browser');
          callback.searchParams.set('exchange_code', 'aae_native_browser');
          res.writeHead(302, { Location: callback.toString() });
          res.end();
          return;
        }

        if (req.method === 'POST' && req.url === '/agent-sessions/exchange') {
          await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            agent_session: {
              id: 'sess-native-browser',
              access_token: 'aas_native_browser_saved',
              refresh_token: 'aar_native_browser_saved',
              access_expires_at: 1893456000000,
              refresh_expires_at: 1924992000000,
              scopes: ['account:read', 'projects:read'],
            },
            account: {
              email: 'native-browser@example.com',
              tier: 'pro',
            },
          }));
          return;
        }

        if (req.method === 'GET' && req.url === '/projects') {
          projectsAuth = req.headers.authorization;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            projects: [{
              id: 'proj_native_browser',
              name: 'native-browser-site',
              project_token: 'aat_native_browser',
              allowed_origins: 'https://native-browser.example',
              created_at: 1893456000000,
            }],
          }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const env = {
          AGENT_ANALYTICS_URL: server.baseUrl,
          AGENT_ANALYTICS_OPEN_COMMAND: `node ${browserScript}`,
          XDG_CONFIG_HOME: tempHome.xdgConfigHome,
          AGENT_ANALYTICS_CREDENTIAL_PLATFORM: 'darwin',
          AGENT_ANALYTICS_FAKE_KEYRING_FILE: fakeKeyringFile,
        };
        const login = await run(['login'], { env, timeout: 5000 });
        const config = readJson(tempHome.configFile);
        const fakeKeyring = readJson(fakeKeyringFile);
        const projects = await run(['projects'], { env });

        assert.equal(login.code, 0);
        assert.equal(config.agent_session.storage, 'native');
        assert.equal(config.agent_session.access_token, undefined);
        assert.equal(config.agent_session.refresh_token, undefined);
        assert.equal(config.agent_session.id, 'sess-native-browser');
        assert.equal(config.email, 'native-browser@example.com');
        assert.equal(JSON.stringify(config).includes('aas_native_browser_saved'), false);
        assert.deepEqual(Object.keys(fakeKeyring), [`agent-analytics\0${server.baseUrl}|default`]);
        const nativePayload = JSON.parse(Object.values(fakeKeyring)[0]);
        assert.equal(nativePayload.access_token, 'aas_native_browser_saved');
        assert.equal(nativePayload.refresh_token, 'aar_native_browser_saved');
        assert.equal(nativePayload.id, 'sess-native-browser');
        assert.deepEqual(nativePayload.scopes, ['account:read', 'projects:read']);
        assert.equal(projects.code, 0);
        assert.equal(projectsAuth, 'Bearer aas_native_browser_saved');
        assert.ok(projects.stdout.includes('native-browser-site'));
      } finally {
        await server.close();
        tempHome.cleanup();
      }
    });

    it('browser login in auto desktop mode falls back to file storage with a visible warning when native persistence fails', async () => {
      const tempHome = createTempConfigHome();
      const browserScript = join(tempHome.xdgConfigHome, 'fake-browser-native-failure.mjs');
      writeFileSync(browserScript, `
        const url = process.argv[2];
        const response = await fetch(url, { redirect: 'follow' });
        if (!response.ok) process.exit(1);
      `);

      let callbackUrl;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          const body = await readRequestJson(req);
          callbackUrl = body.callback_url;
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-native-persist-fail',
            authorize_url: `${server.baseUrl}/approve-native-persist-fail`,
            poll_token: 'aap_native_persist_fail',
          }));
          return;
        }

        if (req.method === 'GET' && req.url === '/approve-native-persist-fail') {
          const callback = new URL(callbackUrl);
          callback.searchParams.set('request_id', 'req-native-persist-fail');
          callback.searchParams.set('exchange_code', 'aae_native_persist_fail');
          res.writeHead(302, { Location: callback.toString() });
          res.end();
          return;
        }

        if (req.method === 'POST' && req.url === '/agent-sessions/exchange') {
          await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            agent_session: {
              id: 'sess-native-persist-fail',
              access_token: 'aas_native_persist_fail',
              refresh_token: 'aar_native_persist_fail',
              access_expires_at: 1893456000000,
              refresh_expires_at: 1924992000000,
              scopes: ['account:read'],
            },
            account: {
              email: 'native-persist-fail@example.com',
              tier: 'pro',
            },
          }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const env = {
          AGENT_ANALYTICS_URL: server.baseUrl,
          AGENT_ANALYTICS_OPEN_COMMAND: `node ${browserScript}`,
          XDG_CONFIG_HOME: tempHome.xdgConfigHome,
          AGENT_ANALYTICS_CREDENTIAL_PLATFORM: 'darwin',
          AGENT_ANALYTICS_FAKE_KEYRING_FILE: tempHome.xdgConfigHome,
        };
        const login = await run(['login'], { env, timeout: 5000 });
        const plainStdout = stripAnsi(login.stdout);
        const plainStderr = stripAnsi(login.stderr);
        const config = readJson(tempHome.configFile);

        assert.equal(login.code, 0);
        assert.ok(plainStderr.includes('Native credential storage was unavailable'));
        assert.ok(plainStderr.includes('using file storage'));
        assert.equal(plainStdout.includes('Native credential storage was unavailable'), false);
        assert.equal(plainStdout.includes('using file storage'), false);
        assert.equal(config.agent_session.storage, 'file');
        assert.equal(config.agent_session.access_token, 'aas_native_persist_fail');
        assert.equal(config.agent_session.refresh_token, 'aar_native_persist_fail');
        assert.equal(config.email, 'native-persist-fail@example.com');
        assert.equal(plainStdout.includes('Retry with detached approval'), false);
      } finally {
        await server.close();
        tempHome.cleanup();
      }
    });

    it('token refresh in auto desktop mode falls back to file storage with a visible warning when native persistence fails', async () => {
      const tempHome = createTempConfigHome({
        agent_session: {
          storage: 'file',
          id: 'sess-refresh-old',
          access_token: 'aas_refresh_old',
          refresh_token: 'aar_refresh_old',
          access_expires_at: 1,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read', 'projects:read'],
        },
      });

      let refreshPayload;
      let projectsCalls = 0;
      let retriedProjectsAuth;
      const server = await startServer(async (req, res) => {
        if (req.method === 'GET' && req.url === '/projects') {
          projectsCalls += 1;
          if (projectsCalls === 1) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ message: 'expired access token' }));
            return;
          }

          retriedProjectsAuth = req.headers.authorization;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            projects: [{
              id: 'proj_refresh_fallback',
              name: 'refresh-fallback-site',
              project_token: 'aat_refresh_fallback',
              allowed_origins: 'https://refresh-fallback.example',
              created_at: 1893456000000,
            }],
          }));
          return;
        }

        if (req.method === 'POST' && req.url === '/agent-sessions/refresh') {
          refreshPayload = await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            agent_session: {
              id: 'sess-refresh-new',
              access_token: 'aas_refresh_new',
              refresh_token: 'aar_refresh_new',
              access_expires_at: 1893456000000,
              refresh_expires_at: 1924992000000,
              scopes: ['account:read', 'projects:read'],
            },
          }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const env = {
          AGENT_ANALYTICS_URL: server.baseUrl,
          XDG_CONFIG_HOME: tempHome.xdgConfigHome,
          AGENT_ANALYTICS_CREDENTIAL_PLATFORM: 'darwin',
          AGENT_ANALYTICS_FAKE_KEYRING_FILE: tempHome.xdgConfigHome,
        };
        const projects = await run(['projects'], { env });
        const plainStdout = stripAnsi(projects.stdout);
        const plainStderr = stripAnsi(projects.stderr);
        const config = readJson(tempHome.configFile);

        assert.equal(projects.code, 0);
        assert.equal(projectsCalls, 2);
        assert.deepEqual(refreshPayload, { refresh_token: 'aar_refresh_old' });
        assert.equal(retriedProjectsAuth, 'Bearer aas_refresh_new');
        assert.ok(plainStderr.includes('Native credential storage was unavailable'));
        assert.ok(plainStderr.includes('using file storage'));
        assert.equal(plainStdout.includes('Native credential storage was unavailable'), false);
        assert.equal(plainStdout.includes('using file storage'), false);
        assert.ok(plainStdout.includes('refresh-fallback-site'));
        assert.equal(plainStdout.includes('aas_refresh_new'), false);
        assert.equal(plainStdout.includes('aar_refresh_new'), false);
        assert.equal(plainStderr.includes('aas_refresh_new'), false);
        assert.equal(plainStderr.includes('aar_refresh_new'), false);
        assert.equal(config.agent_session.storage, 'file');
        assert.equal(config.agent_session.id, 'sess-refresh-new');
        assert.equal(config.agent_session.access_token, 'aas_refresh_new');
        assert.equal(config.agent_session.refresh_token, 'aar_refresh_new');
      } finally {
        await server.close();
        tempHome.cleanup();
      }
    });

    it('browser login in explicit native mode fails clearly when native persistence fails after approval', async () => {
      const tempHome = createTempConfigHome();
      const browserScript = join(tempHome.xdgConfigHome, 'fake-browser-explicit-native-failure.mjs');
      writeFileSync(browserScript, `
        const url = process.argv[2];
        const response = await fetch(url, { redirect: 'follow' });
        if (!response.ok) process.exit(1);
      `);

      let callbackUrl;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          const body = await readRequestJson(req);
          callbackUrl = body.callback_url;
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-explicit-native-fail',
            authorize_url: `${server.baseUrl}/approve-explicit-native-fail`,
            poll_token: 'aap_explicit_native_fail',
          }));
          return;
        }

        if (req.method === 'GET' && req.url === '/approve-explicit-native-fail') {
          const callback = new URL(callbackUrl);
          callback.searchParams.set('request_id', 'req-explicit-native-fail');
          callback.searchParams.set('exchange_code', 'aae_explicit_native_fail');
          res.writeHead(302, { Location: callback.toString() });
          res.end();
          return;
        }

        if (req.method === 'POST' && req.url === '/agent-sessions/exchange') {
          await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            agent_session: {
              id: 'sess-explicit-native-fail',
              access_token: 'aas_explicit_native_fail',
              refresh_token: 'aar_explicit_native_fail',
              access_expires_at: 1893456000000,
              refresh_expires_at: 1924992000000,
              scopes: ['account:read'],
            },
            account: {
              email: 'explicit-native-fail@example.com',
              tier: 'pro',
            },
          }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const env = {
          AGENT_ANALYTICS_URL: server.baseUrl,
          AGENT_ANALYTICS_OPEN_COMMAND: `node ${browserScript}`,
          XDG_CONFIG_HOME: tempHome.xdgConfigHome,
          AGENT_ANALYTICS_CREDENTIAL_STORE: 'native',
          AGENT_ANALYTICS_CREDENTIAL_PLATFORM: 'darwin',
          AGENT_ANALYTICS_FAKE_KEYRING_FILE: tempHome.xdgConfigHome,
        };
        const login = await run(['login'], { env, timeout: 5000 });
        const plain = stripAnsi(login.stdout);

        assert.notEqual(login.code, 0);
        assert.ok(plain.includes('Login approved, but saving the agent session failed'));
        assert.ok(plain.includes('Native credential storage unavailable'));
        assert.ok(plain.includes('AGENT_ANALYTICS_CREDENTIAL_STORE=file'));
        assert.equal(existsSync(tempHome.configFile), false);
        assert.equal(plain.includes('Retry with detached approval'), false);
      } finally {
        await server.close();
        tempHome.cleanup();
      }
    });

    it('detached login with polling stores an agent session that a later command uses as bearer auth', async () => {
      const tempHome = createTempConfigHome();
      let pollCount = 0;
      let exchangePayload;
      let projectsAuth;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          await readRequestJson(req);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-detached-green',
            authorize_url: 'https://approve.example/req-detached-green',
            poll_token: 'aap_detached_green',
          }));
          return;
        }

        if (req.method === 'POST' && req.url === '/agent-sessions/poll') {
          pollCount += 1;
          await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(
            pollCount === 1
              ? { status: 'pending' }
              : { status: 'approved', exchange_code: 'aae_detached_green' }
          ));
          return;
        }

        if (req.method === 'POST' && req.url === '/agent-sessions/exchange') {
          exchangePayload = await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            agent_session: {
              id: 'sess-detached-green',
              access_token: 'aas_detached_saved',
              refresh_token: 'aar_detached_saved',
              access_expires_at: 1893456000000,
              refresh_expires_at: 1924992000000,
              scopes: ['account:read', 'projects:read'],
            },
            account: {
              email: 'detached-green@example.com',
              tier: 'pro',
            },
          }));
          return;
        }

        if (req.method === 'GET' && req.url === '/projects') {
          projectsAuth = req.headers.authorization;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            projects: [{
              id: 'proj_detached',
              name: 'detached-site',
              project_token: 'aat_detached',
              allowed_origins: 'https://detached.example',
              created_at: 1893456000000,
            }],
          }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const env = {
          AGENT_ANALYTICS_URL: server.baseUrl,
          AGENT_ANALYTICS_AUTH_POLL_INTERVAL_MS: '10',
          XDG_CONFIG_HOME: tempHome.xdgConfigHome,
          AGENT_ANALYTICS_API_KEY: '',
        };
        const startedAt = Date.now();
        const login = await run(['login', '--detached', '--wait'], { env, timeout: 5000 });
        const elapsedMs = Date.now() - startedAt;
        const config = readJson(tempHome.configFile);
        const projects = await run(['projects'], { env });

        assert.equal(login.code, 0);
        assert.equal(pollCount, 2);
        assert.ok(elapsedMs < 1000, `expected focused detached login test to use fast poll interval, took ${elapsedMs}ms`);
        assert.equal(exchangePayload.auth_request_id, 'req-detached-green');
        assert.equal(exchangePayload.exchange_code, 'aae_detached_green');
        assert.equal(config.agent_session.id, 'sess-detached-green');
        assert.equal(config.agent_session.access_token, 'aas_detached_saved');
        assert.equal(config.api_key, undefined);
        assert.equal(projects.code, 0);
        assert.equal(projectsAuth, 'Bearer aas_detached_saved');
        assert.ok(projects.stdout.includes('detached-site'));
      } finally {
        await server.close();
        tempHome.cleanup();
      }
    });

    it('starts the detached agent-session handoff and exits after printing the manual resume command', async () => {
      let pollCount = 0;
      const server = createServer((req, res) => {
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          if (req.method === 'POST' && req.url === '/agent-sessions/start') {
            res.writeHead(201, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              auth_request_id: 'req-cli-detached',
              authorize_url: 'https://approve.example/req-cli-detached',
              poll_token: 'aap_cli_detached',
            }));
            return;
          }
          if (req.method === 'POST' && req.url === '/agent-sessions/poll') {
            pollCount += 1;
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

        assert.equal(code, 0);
        assert.ok(stdout.includes('Agent Analytics — Detached Login'));
        assert.ok(stdout.includes('Approval URL:'));
        assert.equal(stripAnsi(stdout).includes('Approval code:'), false);
        assert.ok(stdout.includes('req-cli-detached'));
        assert.ok(stdout.includes('login --auth-request req-cli-detached --exchange-code <code>'));
        assert.ok(stdout.includes('Detached approval request created: req-cli-detached'));
        assert.equal(pollCount, 0);
      } finally {
        await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
      }
    });

    async function runDetachedExchangeRace({ secondExchangeStatus = 400, secondExchangeMessage = 'auth request is not ready' } = {}) {
      const tempHome = createTempConfigHome();
      let pollCount = 0;
      let exchangeCount = 0;
      let exchanged = false;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          await readRequestJson(req);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-race',
            authorize_url: 'https://approve.example/req-race',
            poll_token: 'aap_race',
          }));
          return;
        }

        if (req.method === 'POST' && req.url === '/agent-sessions/poll') {
          await readRequestJson(req);
          pollCount += 1;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(
            pollCount === 1
              ? { status: 'pending' }
              : { status: 'approved', exchange_code: 'aae_race' }
          ));
          return;
        }

        if (req.method === 'POST' && req.url === '/agent-sessions/exchange') {
          const payload = await readRequestJson(req);
          exchangeCount += 1;
          if (exchanged) {
            res.writeHead(secondExchangeStatus, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ code: 'INVALID_STATE', message: secondExchangeMessage }));
            return;
          }

          assert.equal(payload.auth_request_id, 'req-race');
          assert.equal(payload.exchange_code, 'aae_race');
          exchanged = true;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            agent_session: {
              id: 'sess-race',
              access_token: 'aas_race',
              refresh_token: 'aar_race',
              access_expires_at: Date.now() + 60_000,
              refresh_expires_at: Date.now() + 600_000,
              scopes: ['account:read'],
            },
            account: {
              email: 'race@example.com',
              tier: 'pro',
            },
          }));
          return;
        }

        if (req.method === 'GET' && req.url === '/account') {
          if (req.headers.authorization === 'Bearer aas_race') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              email: 'race@example.com',
              tier: 'pro',
              projects_count: 4,
            }));
            return;
          }
          res.writeHead(401, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: 'unauthorized' }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const env = {
          AGENT_ANALYTICS_URL: server.baseUrl,
          XDG_CONFIG_HOME: tempHome.xdgConfigHome,
        };
        const detached = await run(['login', '--detached', '--wait'], { env });
        const manual = await run(['login', '--auth-request', 'req-race', '--exchange-code', 'aae_race'], { env });
        const config = readJson(tempHome.configFile);
        return { detached, manual, config, pollCount, exchangeCount };
      } finally {
        await server.close();
        tempHome.cleanup();
      }
    }

    it('treats old already-exchanged detached failures as success when local agent session verifies', async () => {
      const { detached, manual, config, pollCount, exchangeCount } = await runDetachedExchangeRace();

      assert.equal(detached.code, 0);
      assert.equal(manual.code, 0);
      assert.ok(manual.stdout.includes('Connected as'));
      assert.ok(manual.stdout.includes('race@example.com'));
      assert.equal(config.agent_session.id, 'sess-race');
      assert.equal(config.email, 'race@example.com');
      assert.equal(pollCount, 2);
      assert.equal(exchangeCount, 2);
    });

    it('treats explicit already-exchanged detached failures as success when local agent session verifies', async () => {
      const { manual, config } = await runDetachedExchangeRace({
        secondExchangeStatus: 409,
        secondExchangeMessage: 'auth request already exchanged',
      });

      assert.equal(manual.code, 0);
      assert.ok(manual.stdout.includes('Connected as'));
      assert.ok(manual.stdout.includes('race@example.com'));
      assert.equal(config.agent_session.id, 'sess-race');
    });

    it('keeps detached exchange failures when no valid local agent session exists', async () => {
      const tempHome = createTempConfigHome();
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/exchange') {
          await readRequestJson(req);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ code: 'INVALID_STATE', message: 'auth request is not ready' }));
          return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'not found' }));
      });

      try {
        const result = await run(['login', '--auth-request', 'req-race', '--exchange-code', 'aae_race'], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            XDG_CONFIG_HOME: tempHome.xdgConfigHome,
          },
        });

        assert.notEqual(result.code, 0);
        assert.ok(result.stdout.includes('auth request is not ready'));
      } finally {
        await server.close();
        tempHome.cleanup();
      }
    });
  });

  describe('feedback', () => {
    it('shows usage guidance when message is missing', async () => {
      const { code, stdout } = await run(['feedback'], {
        env: {
          ...agentSessionEnv('aas_test123'),
        },
      });

      assert.notEqual(code, 0);
      assert.ok(stdout.includes('Usage: npx @agent-analytics/cli feedback'));
    });
  });

  describe('context', () => {
    it('gets project context and renders annotations', async () => {
      const server = await startServer((req, res) => {
        if (req.method !== 'GET' || req.url !== '/project-context?project=my-site') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          project: 'my-site',
          project_context: {
            goals: [],
            activation_events: [],
            glossary: [],
            annotations: [{
              occurred_at: '2026-04-25T13:00:00.000Z',
              title: 'Changed pricing page offer',
              note: 'Moved annual plan discount above the fold.',
            }],
          },
        }));
      });

      try {
        const { code, stdout } = await run(['context', 'get', 'my-site'], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            ...agentSessionEnv('aas_test123'),
          },
        });

        assert.equal(code, 0);
        assert.ok(stdout.includes('Annotations:'));
        assert.ok(stdout.includes('2026-04-25T13:00:00.000Z'));
        assert.ok(stdout.includes('Changed pricing page offer'));
        assert.ok(stdout.includes('Moved annual plan discount above the fold.'));
      } finally {
        await server.close();
      }
    });

    it('sets project context from JSON with event-name glossary entries', async () => {
      let requestBody;
      const server = await startServer((req, res) => {
        if (req.method !== 'PUT' || req.url !== '/project-context') {
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
            ok: true,
            project: 'my-site',
            project_context: requestBody,
          }));
        });
      });

      try {
        const { code, stdout } = await run([
          'context',
          'set',
          'my-site',
          '--json',
          '{"goals":["Improve activation"],"activation_events":["signup_completed"],"glossary":[{"event_name":"signup_completed","term":"Signup","definition":"A verified account completed signup."}]}',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            ...agentSessionEnv('aas_test123'),
          },
        });

        assert.equal(code, 0);
        assert.equal(requestBody.project, 'my-site');
        assert.equal(requestBody.glossary[0].event_name, 'signup_completed');
        assert.ok(stdout.includes('Project context updated'));
        assert.ok(stdout.includes('signup_completed'));
      } finally {
        await server.close();
      }
    });

    it('sets project context from JSON with annotations', async () => {
      let requestBody;
      const server = await startServer((req, res) => {
        if (req.method !== 'PUT' || req.url !== '/project-context') {
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
            ok: true,
            project: 'my-site',
            project_context: requestBody,
          }));
        });
      });

      try {
        const { code, stdout } = await run([
          'context',
          'set',
          'my-site',
          '--json',
          '{"annotations":[{"occurred_at":"2026-04-25T13:00:00.000Z","title":"Changed pricing page offer","note":"Moved annual plan discount above the fold."}]}',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            ...agentSessionEnv('aas_test123'),
          },
        });

        assert.equal(code, 0);
        assert.equal(requestBody.project, 'my-site');
        assert.equal(requestBody.annotations[0].title, 'Changed pricing page offer');
        assert.ok(stdout.includes('Project context updated'));
        assert.ok(stdout.includes('Changed pricing page offer'));
      } finally {
        await server.close();
      }
    });
  });

  describe('portfolio-context', () => {
    it('gets portfolio context from the API', async () => {
      const server = await startServer((req, res) => {
        if (req.method !== 'GET' || req.url !== '/portfolio-context') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          portfolio_context: {
            goals: ['Increase qualified users who reach setup'],
            surface_roles: [
              { project_id: 'proj_1', project: 'agentanalytics.sh', role: 'scanner_and_conversion' },
              { project_id: 'proj_2', project: 'openorchestrators.org', role: 'discovery' },
            ],
            shared_milestones: ['qualified_click_to_product', 'project_created'],
            glossary: [
              { term: 'Qualified click', definition: 'A visitor reaches the main product with relevant intent.' },
            ],
          },
        }));
      });

      try {
        const { code, stdout } = await run([
          'portfolio-context',
          'get',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            ...agentSessionEnv('aas_test123'),
          },
        });

        assert.equal(code, 0);
        assert.ok(stdout.includes('Portfolio Context'));
        assert.ok(stdout.includes('agentanalytics.sh'));
        assert.ok(stdout.includes('qualified_click_to_product'));
      } finally {
        await server.close();
      }
    });

    it('sets portfolio context from JSON', async () => {
      let requestBody;
      const server = await startServer((req, res) => {
        if (req.method !== 'PUT' || req.url !== '/portfolio-context') {
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
            ok: true,
            portfolio_context: requestBody,
          }));
        });
      });

      try {
        const { code, stdout } = await run([
          'portfolio-context',
          'set',
          '--json',
          '{"goals":["Increase qualified users who reach setup"],"surface_roles":[{"project":"agentanalytics.sh","role":"scanner_and_conversion"}],"shared_milestones":["qualified_click_to_product"],"glossary":[{"term":"Qualified click","definition":"A visitor reaches the main product with relevant intent."}]}',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            ...agentSessionEnv('aas_test123'),
          },
        });

        assert.equal(code, 0);
        assert.equal(requestBody.surface_roles[0].project, 'agentanalytics.sh');
        assert.ok(stdout.includes('Portfolio context updated'));
        assert.ok(stdout.includes('scanner_and_conversion'));
      } finally {
        await server.close();
      }
    });
  });

  describe('portfolios', () => {
    it('creates and updates portfolios through /portfolios with explicit move intent', async () => {
      const requests = [];
      const server = await startServer(async (req, res) => {
        requests.push({ method: req.method, url: req.url, body: await readRequestJson(req) });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ok: true,
          portfolio: {
            id: 'pf_1',
            slug: 'growth',
            name: 'Growth',
            members: [],
          },
        }));
      });

      try {
        let result = await run([
          'portfolios', 'create', 'growth',
          '--name', 'Growth',
          '--projects', 'app,docs',
          '--move',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });
        assert.equal(result.code, 0);

        result = await run([
          'portfolios', 'update', 'growth',
          '--projects', 'app',
          '--move',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });
        assert.equal(result.code, 0);

        assert.deepEqual(requests[0], {
          method: 'POST',
          url: '/portfolios',
          body: { slug: 'growth', name: 'Growth', projects: ['app', 'docs'], allow_move: true },
        });
        assert.deepEqual(requests[1], {
          method: 'PATCH',
          url: '/portfolios/growth',
          body: { projects: ['app'], allow_move: true },
        });
      } finally {
        await server.close();
      }
    });
  });

  describe('query', () => {
    it('sends --email to /query for server-side scoped HMAC lookup', async () => {
      let requestBody;
      const server = await startServer(async (req, res) => {
        if (req.method !== 'POST' || req.url !== '/query') {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'not found' }));
          return;
        }

        requestBody = await readRequestJson(req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ rows: [], count: 0 }));
      });

      try {
        const { code } = await run([
          'query',
          'my-site',
          '--email', ' Alice@Example.com ',
          '--metrics', 'event_count',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        assert.equal(code, 0);
        assert.equal(requestBody.email, 'alice@example.com');
        assert.equal(requestBody.email_hash, undefined);
      } finally {
        await server.close();
      }
    });

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
            ...agentSessionEnv('aas_test123'),
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
          ...agentSessionEnv('aas_test123'),
        },
      });
      const output = stripAnsi(stdout);

      assert.notEqual(code, 0);
      assert.ok(output.includes('--count-mode raw or session_then_user (default: raw event rows)'));
      assert.ok(output.includes('--count-mode session_then_user'));
      assert.ok(output.includes('--property  Numeric event property key'));
      assert.ok(output.includes('--metrics p75 --property lcp'));
      assert.ok(!output.includes('mixed session/no-session duplicates collapse by user'));
    });

    it('posts sum and p75 with --property and prints n and skipped', async () => {
      let requestBody;
      const server = await startServer(async (req, res) => {
        requestBody = await readRequestJson(req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          period: { from: '2026-11-05', to: '2026-11-12' },
          rows: [{ event: 'purchase', sum: 290, avg: 29, n: 10, skipped: 2 }],
          count: 1,
        }));
      });

      try {
        const result = await run([
          'query', 'my-site',
          '--metrics', 'sum, avg, P75',
          '--property', 'revenue',
          '--filter', '[{"field":"event","op":"eq","value":"purchase"}]',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });
        const plain = stripAnsi(result.stdout);

        assert.equal(result.code, 0);
        assert.deepEqual(requestBody, {
          project: 'my-site',
          metrics: ['sum', 'avg', 'p75'],
          filters: [{ field: 'event', op: 'eq', value: 'purchase' }],
          property: 'revenue',
        });
        assert.ok(plain.includes('Query: my-site — revenue'));
        assert.ok(plain.includes('sum'));
        assert.ok(plain.includes('290'));
        assert.ok(plain.includes('skipped'));
        assert.ok(plain.includes('2'));
        assert.ok(plain.includes('n'));
      } finally {
        await server.close();
      }
    });

    it('rejects an aggregate metric without --property before calling the API', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });

      try {
        const env = {
          ...agentSessionEnv('aas_test123'),
          AGENT_ANALYTICS_URL: server.baseUrl,
        };
        const missing = await run(['query', 'my-site', '--metrics', 'p75'], { env });
        const invalid = await run(['query', 'my-site', '--metrics', 'avg', '--property', 'properties.revenue'], { env });

        assert.notEqual(missing.code, 0);
        assert.notEqual(invalid.code, 0);
        assert.equal(calls, 0);
        assert.ok(stripAnsi(missing.stdout).includes('--property <key> is required when --metrics includes sum, avg, p50, p75, or p95.'));
        assert.ok(stripAnsi(invalid.stdout).includes('Do not prefix it with properties.'));
      } finally {
        await server.close();
      }
    });
  });

  describe('identity lookup', () => {
    it('sends --email to /events as POST for server-side scoped HMAC lookup', async () => {
      let requestMethod;
      let requestUrl;
      let requestBody;
      const server = await startServer(async (req, res) => {
        requestMethod = req.method;
        requestUrl = req.url;
        requestBody = await readRequestJson(req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ events: [], count: 0 }));
      });

      try {
        const { code } = await run([
          'events',
          'my-site',
          '--email', ' Alice@Example.com ',
          '--days', '30',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        assert.equal(code, 0);
        assert.equal(requestMethod, 'POST');
        assert.equal(requestUrl, '/events');
        assert.equal(requestBody.email, 'alice@example.com');
        assert.equal(requestBody.email_hash, undefined);
      } finally {
        await server.close();
      }
    });

    it('renders journey rows with path, referrer, and session context', async () => {
      let requestMethod;
      let requestUrl;
      let requestBody;
      const server = await startServer(async (req, res) => {
        requestMethod = req.method;
        requestUrl = req.url;
        requestBody = await readRequestJson(req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          profiles: [{ user_id: 'user-1' }],
          events: [{
            timestamp: Date.UTC(2026, 0, 2, 3, 4, 5),
            event: 'page_view',
            user_id: 'user-1',
            session_id: 'sess-1',
            properties: {
              path: '/pricing',
              referrer: 'https://reddit.com/r/test',
              plan: 'pro',
            },
          }],
          count: 1,
        }));
      });

      try {
        const { code, stdout } = await run([
          'journey',
          'my-site',
          '--email', 'alice@example.com',
          '--since', '30d',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        const output = stripAnsi(stdout);
        assert.equal(code, 0);
        assert.equal(requestMethod, 'POST');
        assert.equal(requestUrl, '/journey');
        assert.equal(requestBody.email, 'alice@example.com');
        assert.equal(requestBody.email_hash, undefined);
        assert.ok(output.includes('matched user_id: user-1'));
        assert.ok(output.includes('page_view'));
        assert.ok(output.includes('/pricing'));
        assert.ok(output.includes('sess-1'));
        assert.ok(output.includes('"plan":"pro"'));
      } finally {
        await server.close();
      }
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
            ...agentSessionEnv('aas_test123'),
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

  describe('website analysis scan command', () => {
    it('tells unauthenticated CLI users to use the web preview and sign in first', async () => {
      const tempHome = createTempConfigHome();
      let requests = 0;
      const server = await startServer(async (req, res) => {
        requests += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'should not be called' }));
      });

      try {
        const { code, stdout } = await run(['scan', 'example.com/pricing', '--json'], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: '',
            XDG_CONFIG_HOME: tempHome.xdgConfigHome,
          },
        });
        const plain = stripAnsi(stdout);

        assert.notEqual(code, 0);
        assert.equal(requests, 0);
        assert.match(plain, /Website analysis preview is only available anonymously on the web/i);
        assert.match(plain, /https:\/\/agentanalytics\.sh\/analysis\//i);
        assert.match(plain, /sign in first/i);
        assert.match(plain, /Next step: npx @agent-analytics\/cli login/i);
        assert.match(plain, /Paperclip, OpenClaw, or issue-based runtimes/i);
        assert.match(plain, /login --detached/i);
      } finally {
        await server.close();
        tempHome.cleanup();
      }
    });

    it('lets hosted enforce --project for normal authenticated CLI website analysis', async () => {
      const config = createExplicitConfigDir({
        agent_session: {
          id: 'sess_scan_preview',
          access_token: 'aas_scan_preview',
          refresh_token: 'aar_scan_preview',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });
      let requestAuth;
      let requestBody;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/cli/website-scans') {
          requestAuth = req.headers.authorization;
          requestBody = await readRequestJson(req);
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: 'MISSING_FIELDS',
            message: 'project required for authenticated website analysis',
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run([
          '--config-dir', config.configDir,
          'scan',
          'https://example.com/',
          '--json',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: '',
          },
        });
        const plain = stripAnsi(stdout);

        assert.notEqual(code, 0);
        assert.equal(requestAuth, 'Bearer aas_scan_preview');
        assert.deepEqual(requestBody, { url: 'https://example.com/' });
        assert.match(plain, /requires --project for authenticated scans/i);
        assert.match(plain, /create my-site --domain https:\/\/example\.com\//i);
        assert.match(plain, /scan https:\/\/example\.com\/ --project my-site --json/i);
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('allows projectless authenticated scan responses for complimentary accounts', async () => {
      let requestAuth;
      let requestBody;
      const config = createExplicitConfigDir({
        agent_session: {
          id: 'sess_comp_scan_preview',
          access_token: 'aas_comp_scan_preview',
          refresh_token: 'aar_comp_scan_preview',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/cli/website-scans') {
          requestAuth = req.headers.authorization;
          requestBody = await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            analysis_id: 'scan_comp_projectless_preview',
            mode: 'authenticated_preview',
            normalized_url: 'https://example.com/',
            preview: {
              minimum_viable_instrumentation: [{ event: 'primary_cta_clicked', priority: 1 }],
            },
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run([
          '--config-dir', config.configDir,
          'scan',
          'https://example.com/',
          '--json',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: '',
          },
        });
        const data = JSON.parse(stdout);

        assert.equal(code, 0);
        assert.equal(requestAuth, 'Bearer aas_comp_scan_preview');
        assert.deepEqual(requestBody, { url: 'https://example.com/' });
        assert.equal(data.analysis_id, 'scan_comp_projectless_preview');
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('resumes an anonymous preview with scan --resume and --resume-token', async () => {
      const tempHome = createTempConfigHome();
      let requestUrl;
      const server = await startServer((req, res) => {
        requestUrl = req.url;
        if (req.method === 'GET' && req.url === '/website-scans/scan_anon?resume_token=rst_preview') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            analysis_id: 'scan_anon',
            mode: 'anonymous_preview',
            normalized_url: 'https://example.com/',
            preview: { minimum_viable_instrumentation: [] },
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run(['scan', '--resume', 'scan_anon', '--resume-token', 'rst_preview', '--json'], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: '',
            XDG_CONFIG_HOME: tempHome.xdgConfigHome,
          },
        });
        const data = JSON.parse(stdout);

        assert.equal(code, 0);
        assert.equal(requestUrl, '/website-scans/scan_anon?resume_token=rst_preview');
        assert.equal(data.analysis_id, 'scan_anon');
      } finally {
        await server.close();
        tempHome.cleanup();
      }
    });

    it('rejects preview upgrades before making an API request and explains the fresh full scan command', async () => {
      let requests = 0;
      const tempHome = createTempConfigHome();
      const server = await startServer((_req, res) => {
        requests += 1;
        res.writeHead(500);
        res.end('{}');
      });
      try {
        const { code, stdout, stderr } = await run(['scan', '--resume', 'scan_anon', '--resume-token', 'rst_preview', '--full'], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl, XDG_CONFIG_HOME: tempHome.xdgConfigHome },
        });
        assert.notEqual(code, 0);
        assert.match(stripAnsi(stdout + stderr), /Start a new scan: scan <url> --full/);
        assert.equal(requests, 0);
      } finally {
        await server.close();
        tempHome.cleanup();
      }
    });

    it('runs a direct authenticated full scan with scan <url> --full --project', async () => {
      let requestBody;
      let requestAuth;
      const config = createExplicitConfigDir({
        agent_session: {
          id: 'sess_scan_full',
          access_token: 'aas_scan_full',
          refresh_token: 'aar_scan_full',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/cli/website-scans') {
          requestAuth = req.headers.authorization;
          requestBody = await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            analysis_id: 'scan_full_direct',
            mode: 'full',
            normalized_url: 'https://example.com/',
            result: {
              minimum_viable_instrumentation: [{ event: 'primary_cta_clicked', priority: 1 }],
            },
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run([
          '--config-dir', config.configDir,
          'scan',
          'https://example.com/',
          '--full',
          '--project', 'example-site',
          '--json',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: '',
          },
        });
        const data = JSON.parse(stdout);

        assert.equal(code, 0);
        assert.equal(requestAuth, 'Bearer aas_scan_full');
        assert.deepEqual(requestBody, {
          url: 'https://example.com/',
          mode: 'full',
          project: 'example-site',
        });
        assert.equal(data.mode, 'full');
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('sends direct authenticated full scans without --project so hosted can allow complimentary accounts', async () => {
      let requestBody;
      let requestAuth;
      const config = createExplicitConfigDir({
        agent_session: {
          id: 'sess_comp_scan_full',
          access_token: 'aas_comp_scan_full',
          refresh_token: 'aar_comp_scan_full',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/cli/website-scans') {
          requestAuth = req.headers.authorization;
          requestBody = await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            analysis_id: 'scan_comp_full_projectless',
            mode: 'full',
            normalized_url: 'https://example.com/',
            result: {
              minimum_viable_instrumentation: [{ event: 'primary_cta_clicked', priority: 1 }],
            },
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run([
          '--config-dir', config.configDir,
          'scan',
          'https://example.com/',
          '--full',
          '--json',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: '',
          },
        });
        const data = JSON.parse(stdout);

        assert.equal(code, 0);
        assert.equal(requestAuth, 'Bearer aas_comp_scan_full');
        assert.deepEqual(requestBody, {
          url: 'https://example.com/',
          mode: 'full',
        });
        assert.equal(data.analysis_id, 'scan_comp_full_projectless');
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('keeps JSON stdout parseable and warns on stderr when refresh fallback uses file storage', async () => {
      const requestAuths = [];
      const requestBodies = [];
      let refreshCalls = 0;
      const config = createExplicitConfigDir({
        agent_session: {
          id: 'sess_scan_expired',
          access_token: 'aas_expired_scan',
          refresh_token: 'aar_scan_refresh',
          access_expires_at: 1,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/cli/website-scans') {
          requestAuths.push(req.headers.authorization);
          requestBodies.push(await readRequestJson(req));
          if (requestAuths.length === 1) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'AUTH_REQUIRED', message: 'login required for full analysis' }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            analysis_id: 'scan_full_after_refresh',
            mode: 'full',
            normalized_url: 'https://example.com/',
            result: {
              minimum_viable_instrumentation: [{ event: 'primary_cta_clicked', priority: 1 }],
            },
          }));
          return;
        }
        if (req.method === 'POST' && req.url === '/agent-sessions/refresh') {
          refreshCalls += 1;
          const body = await readRequestJson(req);
          assert.equal(body.refresh_token, 'aar_scan_refresh');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            agent_session: {
              id: 'sess_scan_expired',
              access_token: 'aas_refreshed_scan',
              refresh_token: 'aar_scan_refresh',
              access_expires_at: 1893456000000,
              refresh_expires_at: 1924992000000,
              scopes: ['account:read'],
            },
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const result = await run([
          '--config-dir', config.configDir,
          'scan',
          'https://example.com/',
          '--full',
          '--project', 'example-site',
          '--json',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: '',
            AGENT_ANALYTICS_CREDENTIAL_PLATFORM: 'darwin',
            AGENT_ANALYTICS_FAKE_KEYRING_FILE: config.configDir,
          },
        });
        const plainStdout = stripAnsi(result.stdout);
        const plainStderr = stripAnsi(result.stderr);
        const data = JSON.parse(result.stdout);

        assert.equal(result.code, 0);
        assert.equal(refreshCalls, 1);
        assert.ok(plainStderr.includes('Native credential storage was unavailable'));
        assert.ok(plainStderr.includes('using file storage'));
        assert.equal(plainStdout.includes('Native credential storage was unavailable'), false);
        assert.equal(plainStdout.includes('using file storage'), false);
        assert.equal(plainStdout.includes('aas_refreshed_scan'), false);
        assert.equal(plainStdout.includes('aar_scan_refresh'), false);
        assert.equal(plainStderr.includes('aas_refreshed_scan'), false);
        assert.equal(plainStderr.includes('aar_scan_refresh'), false);
        assert.deepEqual(requestAuths, ['Bearer aas_expired_scan', 'Bearer aas_refreshed_scan']);
        assert.deepEqual(requestBodies, [
          { url: 'https://example.com/', mode: 'full', project: 'example-site' },
          { url: 'https://example.com/', mode: 'full', project: 'example-site' },
        ]);
        const storedSession = readJson(config.configFile).agent_session;
        assert.equal(storedSession.storage, 'file');
        assert.equal(storedSession.access_token, 'aas_refreshed_scan');
        assert.equal(data.analysis_id, 'scan_full_after_refresh');
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('uses authenticated requests for scan <url> when a project is supplied', async () => {
      let requestAuth;
      let requestBody;
      const config = createExplicitConfigDir({
        agent_session: {
          id: 'sess_scan_preview',
          access_token: 'aas_scan_preview',
          refresh_token: 'aar_scan_preview',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/cli/website-scans') {
          requestAuth = req.headers.authorization;
          requestBody = await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            analysis_id: 'scan_auth_preview',
            mode: 'authenticated_preview',
            normalized_url: 'https://example.com/',
            preview: {
              minimum_viable_instrumentation: [{ event: 'primary_cta_clicked', priority: 1 }],
            },
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run([
          '--config-dir', config.configDir,
          'scan',
          'https://example.com/',
          '--project', 'example-site',
          '--json',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: '',
          },
        });
        const data = JSON.parse(stdout);

        assert.equal(code, 0);
        assert.equal(requestAuth, 'Bearer aas_scan_preview');
        assert.deepEqual(requestBody, {
          url: 'https://example.com/',
          project: 'example-site',
        });
        assert.equal(data.mode, 'authenticated_preview');
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('prints login guidance for scan --full without auth', async () => {
      const tempHome = createTempConfigHome();
      const { code, stdout } = await run([
        'scan',
        'https://example.com/',
        '--full',
      ], {
        env: {
          AGENT_ANALYTICS_API_KEY: '',
          XDG_CONFIG_HOME: tempHome.xdgConfigHome,
        },
      });

      assert.notEqual(code, 0);
      assert.ok(stripAnsi(stdout).includes('Not logged in'));
      assert.ok(stripAnsi(stdout).includes('login'));
      tempHome.cleanup();
    });

    it('prints retry timing for a busy authenticated analyzer response', async () => {
      const config = createExplicitConfigDir({
        agent_session: {
          id: 'sess_scan_busy',
          access_token: 'aas_scan_busy',
          refresh_token: 'aar_scan_busy',
          access_expires_at: 1893456000000,
          refresh_expires_at: 1924992000000,
          scopes: ['account:read'],
        },
      });
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/cli/website-scans') {
          await readRequestJson(req);
          res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '17' });
          res.end(JSON.stringify({
            error: 'SCAN_BUSY',
            message: 'The free analyzer is busy.',
            retry_after_seconds: 17,
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run([
          '--config-dir', config.configDir,
          'scan',
          'https://busy.example',
          '--project', 'busy-site',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: '',
          },
        });
        const output = stripAnsi(stdout);

        assert.notEqual(code, 0);
        assert.ok(output.includes('free analyzer is busy'));
        assert.ok(output.includes('17 seconds'));
      } finally {
        await server.close();
        config.cleanup();
      }
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
            ...agentSessionEnv('aas_test123'),
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
            ...agentSessionEnv('aas_test123'),
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
            ...agentSessionEnv('aas_test123'),
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
            ...agentSessionEnv('aas_test123'),
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

    it('passes --source-scan when creating a project', async () => {
      let requestBody;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/projects') {
          requestBody = await readRequestJson(req);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            id: 'proj-created',
            name: 'source-site',
            project_token: 'aat_created',
            allowed_origins: 'https://source.example',
            source_scan_id: 'scan_source',
            snippet: '<script></script>',
            api_example: 'curl /stats',
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run([
          'create',
          'source-site',
          '--domain', 'https://source.example',
          '--source-scan', 'scan_source',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        assert.equal(code, 0);
        assert.deepEqual(requestBody, {
          name: 'source-site',
          allowed_origins: 'https://source.example',
          source_scan_id: 'scan_source',
        });
        assert.ok(stdout.includes('Project created'));
      } finally {
        await server.close();
      }
    });

    it('handles pending account setup when creating a project without retrying', async () => {
      let postCount = 0;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/projects') {
          postCount += 1;
          await readRequestJson(req);
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            code: 'ACCOUNT_SETUP_PENDING',
            message: 'Account setup is still pending.',
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run([
          'create',
          'source-site',
          '--domain', 'https://source.example',
          '--source-scan', 'scan_source',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        const plain = stripAnsi(stdout);
        assert.notEqual(code, 0);
        assert.equal(postCount, 1);
        assert.ok(plain.includes('Account setup is still finishing.'));
        assert.ok(plain.includes('Run the same create command again shortly:'));
        assert.ok(plain.includes('npx @agent-analytics/cli create source-site --domain https://source.example --source-scan scan_source'));
        assert.ok(!plain.includes('Project created'));
        assert.ok(!plain.includes('Add this snippet'));
      } finally {
        await server.close();
      }
    });

    it('handles failed account setup when creating a project', async () => {
      let postCount = 0;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/projects') {
          postCount += 1;
          await readRequestJson(req);
          res.writeHead(409, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            code: 'ACCOUNT_SETUP_FAILED',
            message: 'Account setup failed.',
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run([
          'init',
          'source-site',
          '--domain', 'https://source.example',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        const plain = stripAnsi(stdout);
        assert.notEqual(code, 0);
        assert.equal(postCount, 1);
        assert.ok(plain.includes('Account setup failed.'));
        assert.ok(plain.includes('Contact support before creating projects.'));
        assert.ok(!plain.includes('Project created'));
        assert.ok(!plain.includes('Add this snippet'));
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
            ...agentSessionEnv('aas_test123'),
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

    it('does not warn about AGENT_ANALYTICS_API_KEY during logout', async () => {
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
        assert.ok(stdout.includes('Logged out locally'));
        assert.ok(!stdout.includes('unset AGENT_ANALYTICS_API_KEY'));
        assert.deepEqual(readJson(temp.configFile), {});
      } finally {
        temp.cleanup();
      }
    });
  });

  describe('compare and annotate', () => {
    const compareResponse = {
      project: 'my-site',
      project_id: 'proj_1',
      verdict: 'keep',
      reason: 'keep_threshold_met',
      reason_detail: 'Compare rate is above the keep threshold and the 90% interval excludes zero.',
      goal_event: 'landing_signup_cta_clicked',
      denominator_event: 'page_view',
      count_mode: 'unique_users',
      filters: [],
      window_source: 'ship_date',
      ship_date: '2026-04-08',
      window_days: 7,
      weekday_aligned: true,
      windows: {
        baseline: {
          date_from: '2026-04-01',
          date_to: '2026-04-07',
          day_count: 7,
          denominator_unique_users: 400,
          goal_unique_users: 42,
          goal_converters: 40,
          goal_users_outside_denominator: 2,
          count_mode: 'unique_users',
          rate: 0.1,
        },
        compare: {
          date_from: '2026-04-09',
          date_to: '2026-04-15',
          day_count: 7,
          denominator_unique_users: 400,
          goal_unique_users: 81,
          goal_converters: 80,
          goal_users_outside_denominator: 1,
          count_mode: 'unique_users',
          rate: 0.2,
        },
      },
      lift: 1,
      interval: {
        level: 0.9,
        method: 'newcombe_wilson_90',
        estimate: 'rate_difference',
        low: 0.081597,
        high: 0.118,
        excludes_zero: true,
        note: '90% interval for compare_rate - baseline_rate',
      },
      rule: {
        keep_threshold: 0.15,
        revert_threshold: -0.1,
        min_denominator: 200,
        min_goal_events: 20,
        defaults_applied: [],
      },
      guardrails: {
        confounded: true,
        annotations: [{
          occurred_at: '2026-04-10T13:00:00.000Z',
          title: 'Pricing copy changed',
          note: 'Moved the annual plan.',
          windows: ['compare'],
        }],
        traffic_mix: {
          shifted: true,
          properties: {
            utm_source: {
              shifts: [{ value: 'newsletter', baseline_share: 0.1, compare_share: 0.4 }],
            },
          },
        },
        incomplete_current_day: false,
        caveat: 'Before/after is not causal. A keep or revert verdict is a deterministic reading of this rule on these two windows, not proof that the change caused the difference.',
      },
    };

    it('prints compare usage without auth and says the read is free', async () => {
      const help = await run(['compare', '--help']);
      const plain = stripAnsi(help.stdout);
      assert.equal(help.code, 0);
      assert.ok(plain.includes('free read'));
      assert.ok(plain.includes('ship day + 8'));
      assert.ok(plain.includes("--metric 'p75(lcp)' --better lower"));
      assert.ok(plain.includes('interval_method: "none"'));
      assert.ok(plain.includes('per_user: true'));
      assert.ok(plain.includes('unique converters'));
      assert.ok(plain.includes('incomplete_current_day'));
      assert.ok(plain.includes('revert_threshold_met'));
      assert.ok(plain.includes('Thresholds are fractions (0.15 = +15%), and the absolute value must be 5 or less.'));
      assert.ok(plain.includes('--exclude-denominator "properties.title=Page not found | grokbotpages.com"'));

      const main = await run(['--help']);
      const mainPlain = stripAnsi(main.stdout);
      assert.ok(mainPlain.includes('ship day + 8'));
      assert.ok(mainPlain.includes('--exclude-denominator "properties.title=Page not found | grokbotpages.com"'));
    });

    it('sends repeatable --exclude-denominator values as denominator_filters', async () => {
      let body = null;
      const server = await startServer(async (req, res) => {
        body = await readRequestJson(req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          ...compareResponse,
          denominator_filters: [
            { field: 'properties.title', op: 'neq', value: 'Page not found | grokbotpages.com' },
            { field: 'properties.path', op: 'neq', value: 'a=b' },
          ],
        }));
      });

      try {
        const result = await run([
          'compare', 'my-site',
          '--ship-date', '2026-11-04',
          '--days', '7',
          '--goal', 'template_opened',
          '--exclude-denominator', 'properties.title=Page not found | grokbotpages.com',
          '--exclude-denominator', 'properties.path=a=b',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });
        const plain = stripAnsi(result.stdout);

        assert.equal(result.code, 0);
        assert.deepEqual(body.denominator_filters, [
          { field: 'properties.title', op: 'neq', value: 'Page not found | grokbotpages.com' },
          { field: 'properties.path', op: 'neq', value: 'a=b' },
        ]);
        assert.equal(body.filters, undefined);
        assert.ok(plain.includes('properties.title neq Page not found | grokbotpages.com'));
      } finally {
        await server.close();
      }
    });

    it('rejects an --exclude-denominator value without = before calling the API', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });

      try {
        const result = await run([
          'compare', 'my-site',
          '--ship-date', '2026-11-04',
          '--goal', 'template_opened',
          '--exclude-denominator', 'properties.title',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        assert.notEqual(result.code, 0);
        assert.equal(calls, 0);
        assert.ok(stripAnsi(result.stdout).includes('--exclude-denominator requires <field>=<value>'));
      } finally {
        await server.close();
      }
    });

    it('rejects a window length that is not a multiple of 7 before calling the API', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });

      try {
        const result = await run([
          'compare', 'my-site',
          '--ship-date', '2026-04-08',
          '--days', '10',
          '--goal', 'signup',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        assert.notEqual(result.code, 0);
        assert.equal(calls, 0);
        assert.ok(stripAnsi(result.stdout).includes('multiple of 7'));
      } finally {
        await server.close();
      }
    });

    it('posts ship_date compare fields and prints the API verdict', async () => {
      let body = null;
      const server = await startServer(async (req, res) => {
        body = await readRequestJson(req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(compareResponse));
      });

      try {
        const result = await run([
          'compare', 'my-site',
          '--ship-date', '2026-04-08',
          '--days', '7',
          '--goal', 'landing_signup_cta_clicked',
          '--denominator', 'page_view',
          '--keep-threshold', '0.15',
          '--revert-threshold', '-0.10',
          '--min-denominator', '200',
          '--min-goal-events', '20',
          '--filter', '[{"field":"country","op":"eq","value":"US"}]',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });
        const plain = stripAnsi(result.stdout);

        assert.equal(result.code, 0);
        assert.deepEqual(body, {
          project: 'my-site',
          goal_event: 'landing_signup_cta_clicked',
          denominator_event: 'page_view',
          filters: [{ field: 'country', op: 'eq', value: 'US' }],
          ship_date: '2026-04-08',
          window_days: 7,
          rule: {
            keep_threshold: 0.15,
            revert_threshold: -0.1,
            min_denominator: 200,
            min_goal_events: 20,
          },
        });
        assert.ok(plain.includes('Verdict:'));
        assert.ok(plain.includes('keep'));
        assert.ok(plain.includes('keep_threshold_met'));
        assert.ok(plain.includes('2026-04-01'));
        assert.ok(plain.includes('2026-04-09'));
        assert.ok(plain.includes('Compare rate is above the keep threshold and the 90% interval excludes zero.'));
        assert.ok(plain.includes('40 converters / 400 denominator users'));
        assert.ok(plain.includes('80 converters / 400 denominator users'));
        assert.ok(plain.includes('2 outside the denominator'));
        assert.ok(plain.includes('unique_users'));
        assert.ok(!plain.includes('goal events'));
        assert.ok(plain.includes('Lift:'));
        assert.ok(plain.includes('+100%'));
        assert.ok(plain.includes('90% interval'));
        assert.ok(plain.includes('newcombe_wilson_90'));
        assert.ok(plain.includes('rate_difference'));
        assert.ok(plain.includes('90% interval for compare_rate - baseline_rate'));
        assert.ok(plain.includes('Pricing copy changed'));
        assert.ok(plain.includes('newsletter'));
        assert.ok(plain.includes('Before/after is not causal'));
      } finally {
        await server.close();
      }
    });

    it('rejects a threshold whose absolute value is above 5 before calling the API', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });

      try {
        const env = {
          ...agentSessionEnv('aas_test123'),
          AGENT_ANALYTICS_URL: server.baseUrl,
        };
        const keep = await run([
          'compare', 'my-site',
          '--ship-date', '2026-04-08',
          '--goal', 'signup',
          '--keep-threshold', '15',
        ], { env });
        const revert = await run([
          'compare', 'my-site',
          '--ship-date', '2026-04-08',
          '--goal', 'signup',
          '--revert-threshold', '-5.1',
        ], { env });
        const message = 'Thresholds are fractions (0.15 = +15%), and the absolute value must be 5 or less.';

        assert.notEqual(keep.code, 0);
        assert.notEqual(revert.code, 0);
        assert.equal(calls, 0);
        assert.ok(stripAnsi(keep.stdout).includes(message));
        assert.ok(stripAnsi(revert.stdout).includes(message));
      } finally {
        await server.close();
      }
    });

    it('prints n/a for a null lift and handles a null interval', async () => {
      const server = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          project: 'my-site',
          verdict: 'extend',
          reason: 'zero_baseline',
          reason_detail: 'Baseline rate is zero, so lift is not defined.',
          count_mode: 'unique_users',
          lift: null,
          interval: null,
          windows: {
            baseline: {
              date_from: '2026-04-01',
              date_to: '2026-04-07',
              day_count: 7,
              denominator_unique_users: 400,
              goal_unique_users: 0,
              goal_converters: 0,
              goal_users_outside_denominator: 0,
              count_mode: 'unique_users',
              rate: 0,
            },
            compare: {
              date_from: '2026-04-09',
              date_to: '2026-04-15',
              day_count: 7,
              denominator_unique_users: 400,
              goal_unique_users: 10,
              goal_converters: 10,
              goal_users_outside_denominator: 0,
              count_mode: 'unique_users',
              rate: 0.025,
            },
          },
        }));
      });

      try {
        const result = await run([
          'compare', 'my-site',
          '--ship-date', '2026-04-08',
          '--goal', 'signup',
          '--keep-threshold', '5',
          '--revert-threshold', '-5',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });
        const plain = stripAnsi(result.stdout);

        assert.equal(result.code, 0);
        assert.ok(plain.includes('extend'));
        assert.ok(plain.includes('zero_baseline'));
        assert.ok(plain.includes('Baseline rate is zero, so lift is not defined.'));
        assert.ok(plain.includes('Lift: n/a'));
        assert.ok(plain.includes('not computed'));
        assert.ok(plain.includes('0 converters / 400 denominator users'));
        assert.ok(!plain.includes('undefined'));
      } finally {
        await server.close();
      }
    });

    it('prints the incomplete-day verdict as extend', async () => {
      const server = await startServer((_req, res) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          project: 'my-site',
          verdict: 'extend',
          reason: 'incomplete_current_day',
          reason_detail: 'Either window includes today UTC.',
          count_mode: 'unique_users',
          lift: 0.2,
          interval: {
            level: 0.9,
            method: 'newcombe_wilson_90',
            estimate: 'rate_difference',
            low: 0.01,
            high: 0.04,
            excludes_zero: true,
          },
          windows: compareResponse.windows,
        }));
      });

      try {
        const result = await run([
          'compare', 'my-site',
          '--ship-date', '2026-04-08',
          '--goal', 'signup',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });
        const plain = stripAnsi(result.stdout);

        assert.equal(result.code, 0);
        assert.ok(plain.includes('extend'));
        assert.ok(plain.includes('incomplete_current_day'));
        assert.ok(plain.includes('Either window includes today UTC.'));
        assert.ok(plain.includes('ship day + 8'));
      } finally {
        await server.close();
      }
    });

    it('omits optional compare fields and prints --json as the API body', async () => {
      let body = null;
      const server = await startServer(async (req, res) => {
        body = await readRequestJson(req);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(compareResponse));
      });

      try {
        const result = await run([
          'compare', 'my-site',
          '--goal', 'signup',
          '--baseline-from', '2026-04-01',
          '--baseline-to', '2026-04-07',
          '--compare-from', '2026-04-09',
          '--compare-to', '2026-04-15',
          '--json',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        assert.equal(result.code, 0);
        assert.deepEqual(body, {
          project: 'my-site',
          goal_event: 'signup',
          baseline: { date_from: '2026-04-01', date_to: '2026-04-07' },
          compare: { date_from: '2026-04-09', date_to: '2026-04-15' },
        });
        assert.deepEqual(JSON.parse(result.stdout), compareResponse);
      } finally {
        await server.close();
      }
    });

    it('appends an annotation and reports a duplicate without replacing the stored note', async () => {
      const bodies = [];
      let calls = 0;
      const server = await startServer(async (req, res) => {
        bodies.push(await readRequestJson(req));
        calls += 1;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(calls === 1
          ? {
            ok: true,
            appended: true,
            project: 'my-site',
            project_id: 'proj_1',
            annotation: {
              occurred_at: '2026-04-25T10:00:00.000Z',
              title: 'Changed pricing page offer',
              note: 'Moved annual plan discount above the fold.',
            },
            annotation_count: 4,
          }
          : {
            ok: true,
            appended: false,
            project: 'my-site',
            project_id: 'proj_1',
            annotation: {
              occurred_at: '2026-04-25T10:00:00.000Z',
              title: 'Changed pricing page offer',
              note: 'original note',
            },
            annotation_count: 4,
          }));
      });

      try {
        const env = {
          ...agentSessionEnv('aas_test123'),
          AGENT_ANALYTICS_URL: server.baseUrl,
        };
        const created = await run([
          'annotate', 'my-site',
          '--title', 'Changed pricing page offer',
          '--note', 'Moved annual plan discount above the fold.',
          '--at', '2026-04-25T13:00:00+03:00',
        ], { env });
        const duplicate = await run([
          'annotate', 'my-site',
          '--title', 'Changed pricing page offer',
          '--note', 'a different note',
          '--at', '2026-04-25T13:00:00+03:00',
        ], { env });

        assert.equal(created.code, 0);
        assert.equal(bodies[0].occurred_at, '2026-04-25T13:00:00+03:00');
        assert.equal(bodies[0].title, 'Changed pricing page offer');
        assert.equal(bodies[0].note, 'Moved annual plan discount above the fold.');
        assert.equal(bodies[0].project, 'my-site');
        assert.ok(stripAnsi(created.stdout).includes('annotation_count: 4'));

        assert.equal(duplicate.code, 0);
        const duplicateText = stripAnsi(duplicate.stdout);
        assert.ok(duplicateText.includes('appended: false'));
        assert.ok(duplicateText.includes('original note'));
        assert.ok(!duplicateText.includes('a different note'));
      } finally {
        await server.close();
      }
    });

    it('omits a blank annotation note and surfaces the 100 annotation cap', async () => {
      let body = null;
      const server = await startServer(async (req, res) => {
        body = await readRequestJson(req);
        res.writeHead(409, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          message: 'annotations can include at most 100 entries; this project already has 100, so the new annotation was not stored',
        }));
      });

      try {
        const result = await run([
          'annotate', 'my-site',
          '--title', 'Changed pricing page offer',
          '--note', '   ',
          '--at', '2026-04-25T13:00:00.000Z',
        ], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });

        assert.notEqual(result.code, 0);
        assert.deepEqual(body, {
          project: 'my-site',
          occurred_at: '2026-04-25T13:00:00.000Z',
          title: 'Changed pricing page offer',
        });
        assert.ok(stripAnsi(result.stdout).includes('at most 100 entries'));
      } finally {
        await server.close();
      }
    });

    it('blocks annotate in demo mode before making API requests', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });

      try {
        const result = await run([
          '--demo', 'annotate', 'my-site', '--title', 'Changed pricing page offer',
        ], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl },
        });

        assert.notEqual(result.code, 0);
        assert.equal(calls, 0);
        assert.ok(stripAnsi(result.stdout).includes('Demo mode is read-only'));
      } finally {
        await server.close();
      }
    });

    it('posts --metric and --better and prints value, n, and no interval', async () => {
      const bodies = [];
      const metricResponse = {
        project: 'my-site',
        verdict: 'keep',
        reason: 'keep_threshold_met',
        reason_detail: 'p75 moved in the better direction.',
        goal_event: '$web_vitals',
        denominator_event: 'page_view',
        metric: 'p75(lcp)',
        better: 'lower',
        per_user: false,
        ship_date: '2026-11-04',
        window_days: 7,
        weekday_aligned: true,
        lift: -0.125,
        interval: null,
        interval_method: 'none',
        windows: {
          baseline: { date_from: '2026-10-28', date_to: '2026-11-03', day_count: 7, value: 2400, n: 80, skipped: 4 },
          compare: { date_from: '2026-11-05', date_to: '2026-11-11', day_count: 7, value: 2100, n: 92, skipped: 1 },
        },
      };
      const server = await startServer(async (req, res) => {
        const body = await readRequestJson(req);
        bodies.push(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(body?.metric === 'sum(revenue)'
          ? {
            ...metricResponse,
            metric: 'sum(revenue)',
            better: 'higher',
            per_user: true,
            goal_event: 'purchase',
            windows: {
              baseline: { date_from: '2026-10-28', date_to: '2026-11-03', day_count: 7, value: 12.5, n: 40 },
              compare: { date_from: '2026-11-05', date_to: '2026-11-11', day_count: 7, value: 18, n: 44 },
            },
          }
          : metricResponse));
      });

      try {
        const env = {
          ...agentSessionEnv('aas_test123'),
          AGENT_ANALYTICS_URL: server.baseUrl,
        };
        const result = await run([
          'compare', 'my-site',
          '--ship-date', '2026-11-04',
          '--days', '7',
          '--goal', '$web_vitals',
          '--metric', 'P75(lcp)',
          '--better', 'LOWER',
        ], { env });
        const plain = stripAnsi(result.stdout);
        const summed = await run([
          'compare', 'my-site',
          '--ship-date', '2026-11-04',
          '--goal', 'purchase',
          '--metric', 'sum(revenue)',
          '--json',
        ], { env });

        assert.equal(result.code, 0);
        assert.deepEqual(bodies[0], {
          project: 'my-site',
          goal_event: '$web_vitals',
          ship_date: '2026-11-04',
          window_days: 7,
          metric: 'p75(lcp)',
          better: 'lower',
        });
        assert.deepEqual(bodies[1], {
          project: 'my-site',
          goal_event: 'purchase',
          ship_date: '2026-11-04',
          metric: 'sum(revenue)',
        });
        assert.ok(plain.includes('Metric: p75(lcp)'));
        assert.ok(plain.includes('better: lower'));
        assert.ok(!plain.includes('per_user: true'));
        assert.ok(plain.includes('value: 2400'));
        assert.ok(plain.includes('n=80'));
        assert.ok(plain.includes('skipped=4'));
        assert.ok(plain.includes('value: 2100'));
        assert.ok(plain.includes('n=92'));
        assert.ok(plain.includes('not computed'));
        assert.ok(plain.includes('none'));
        assert.ok(plain.includes('keep'));
        assert.ok(!plain.includes('undefined'));

        assert.equal(summed.code, 0);
        const summedBody = JSON.parse(summed.stdout);
        assert.equal(summedBody.per_user, true);
        assert.equal(summedBody.metric, 'sum(revenue)');
        assert.equal(summedBody.better, 'higher');
      } finally {
        await server.close();
      }
    });

    it('rejects a bad --metric or --better before calling the API', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });

      try {
        const env = {
          ...agentSessionEnv('aas_test123'),
          AGENT_ANALYTICS_URL: server.baseUrl,
        };
        const metric = await run([
          'compare', 'my-site',
          '--ship-date', '2026-11-04',
          '--goal', 'purchase',
          '--metric', 'p75(lcp-ms)',
        ], { env });
        const better = await run([
          'compare', 'my-site',
          '--ship-date', '2026-11-04',
          '--goal', 'purchase',
          '--metric', 'p75(lcp)',
          '--better', 'sideways',
        ], { env });
        const alone = await run([
          'compare', 'my-site',
          '--ship-date', '2026-11-04',
          '--goal', 'purchase',
          '--better', 'lower',
        ], { env });

        assert.notEqual(metric.code, 0);
        assert.notEqual(better.code, 0);
        assert.notEqual(alone.code, 0);
        assert.equal(calls, 0);
        assert.ok(stripAnsi(metric.stdout).includes("--metric must be sum(key), avg(key), p50(key), p75(key), or p95(key)."));
        assert.ok(stripAnsi(better.stdout).includes('--better must be higher or lower.'));
        assert.ok(stripAnsi(alone.stdout).includes('--better applies only with --metric.'));
      } finally {
        await server.close();
      }
    });
  });

  describe('errors', () => {
    const errorsResponse = {
      project: 'my-site',
      since: '7d',
      until: '2026-11-12',
      new_since: '2026-11-12',
      limit: 20,
      count: 1,
      groups: [{
        fingerprint: 'fp_undefined_read',
        message: 'Cannot read properties of undefined',
        source: 'app.js',
        count: 12,
        users: 4,
        sessions: 5,
        first_seen: '2026-11-12T01:00:00.000Z',
        last_seen: '2026-11-12T08:00:00.000Z',
        top_paths: ['/checkout', { path: '/pricing', count: 3 }, '/account', '/ignored-fourth'],
        new_since: true,
      }],
    };

    it('prints errors usage without auth', async () => {
      const help = await run(['errors', '--help']);
      const plain = stripAnsi(help.stdout);
      assert.equal(help.code, 0);
      assert.ok(plain.includes('GET /errors'));
      assert.ok(plain.includes('one metered read'));
      assert.ok(plain.includes('--since 7d --new-since 2026-11-12'));
      assert.ok(plain.includes('message, source, line, and col'));
      assert.ok(plain.includes('does not send a stack'));

      const main = await run(['--help']);
      const mainPlain = stripAnsi(main.stdout);
      assert.ok(mainPlain.includes('errors'));
      assert.ok(mainPlain.includes('Grouped $error events'));
      assert.ok(mainPlain.includes("--metric <fn(key)>"));
      assert.ok(mainPlain.includes('--new-since'));
    });

    it('calls GET /errors and prints groups, including --json', async () => {
      const urls = [];
      const server = await startServer((req, res) => {
        urls.push(req.url);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(errorsResponse));
      });

      try {
        const env = {
          ...agentSessionEnv('aas_test123'),
          AGENT_ANALYTICS_URL: server.baseUrl,
        };
        const result = await run([
          'errors', 'my-site',
          '--since', '7d',
          '--until', '2026-11-12',
          '--new-since', 'Changed pricing page offer',
          '--limit', '20',
        ], { env });
        const plain = stripAnsi(result.stdout);
        const json = await run([
          'errors', 'my-site',
          '--since', '2026-11-01',
          '--json',
        ], { env });

        assert.equal(result.code, 0);
        assert.equal(urls[0], '/errors?project=my-site&since=7d&until=2026-11-12&new_since=Changed%20pricing%20page%20offer&limit=20');
        assert.equal(urls[1], '/errors?project=my-site&since=2026-11-01&limit=20');
        assert.ok(plain.includes('Errors: my-site'));
        assert.ok(plain.includes('Cannot read properties of undefined'));
        assert.ok(plain.includes('new'));
        assert.ok(plain.includes('12 events  4 users  5 sessions'));
        assert.ok(plain.includes('source: app.js'));
        assert.ok(plain.includes('fingerprint: fp_undefined_read'));
        assert.ok(plain.includes('2026-11-12T01:00:00.000Z'));
        assert.ok(plain.includes('/checkout, /pricing (3), /account'));
        assert.ok(!plain.includes('/ignored-fourth'));
        assert.ok(plain.includes('1 groups'));
        assert.equal(json.code, 0);
        assert.deepEqual(JSON.parse(json.stdout), errorsResponse);
      } finally {
        await server.close();
      }
    });

    it('defaults since to 7d and limit to 20', async () => {
      let url = '';
      const server = await startServer((req, res) => {
        url = req.url;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ project: 'my-site', since: '7d', limit: 20, count: 0, groups: [] }));
      });

      try {
        const result = await run(['errors', 'my-site'], {
          env: {
            ...agentSessionEnv('aas_test123'),
            AGENT_ANALYTICS_URL: server.baseUrl,
          },
        });
        const plain = stripAnsi(result.stdout);

        assert.equal(result.code, 0);
        assert.equal(url, '/errors?project=my-site&since=7d&limit=20');
        assert.ok(plain.includes('No errors found.'));
      } finally {
        await server.close();
      }
    });

    it('rejects a bad window or limit before calling the API and surfaces an ambiguous annotation', async () => {
      let calls = 0;
      const server = await startServer((_req, res) => {
        calls += 1;
        if (calls === 1) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            message: 'new_since matched 2 annotations: "Shipped checkout" (2026-11-01), "Shipped pricing" (2026-11-04)',
          }));
          return;
        }
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'should not be called' }));
      });

      try {
        const env = {
          ...agentSessionEnv('aas_test123'),
          AGENT_ANALYTICS_URL: server.baseUrl,
        };
        const ambiguous = await run([
          'errors', 'my-site',
          '--new-since', 'Shipped',
        ], { env });
        const since = await run(['errors', 'my-site', '--since', 'yesterday'], { env });
        const until = await run(['errors', 'my-site', '--until', '2026-02-31'], { env });
        const limit = await run(['errors', 'my-site', '--limit', '101'], { env });

        assert.notEqual(ambiguous.code, 0);
        assert.equal(calls, 1);
        assert.ok(stripAnsi(ambiguous.stdout).includes('new_since matched 2 annotations'));
        assert.notEqual(since.code, 0);
        assert.notEqual(until.code, 0);
        assert.notEqual(limit.code, 0);
        assert.equal(calls, 1);
        assert.ok(stripAnsi(since.stdout).includes('--since must be a day window like 7d, or a YYYY-MM-DD date.'));
        assert.ok(stripAnsi(until.stdout).includes('--until must be a day window like 7d, or a YYYY-MM-DD date.'));
        assert.ok(stripAnsi(limit.stdout).includes('--limit must be an integer from 1 to 100.'));
      } finally {
        await server.close();
      }
    });
  });
});
