import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

    it('rejects raw API key auth locally', async () => {
      const config = createExplicitConfigDir({ api_key: 'aak_raw' });

      try {
        const { code, stdout } = await run(['upgrade-link', '--detached', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: 'http://127.0.0.1:9' },
        });

        assert.notEqual(code, 0);
        assert.ok(stripAnsi(stdout).includes('requires browser-approved CLI login'));
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
        assert.ok(plain.includes('Need+funnels'));
        assert.ok(plain.includes('command='));
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
        assert.ok(plain.includes('properties my-site'));
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

    it('writes login --token auth to an explicit --config-dir after the command', async () => {
      const config = createExplicitConfigDir();
      const server = await startAccountServer({ expectedAuth: 'aak_config_token' });

      try {
        const { code, stdout } = await run(['login', '--token', 'aak_config_token', '--config-dir', config.configDir], {
          env: { AGENT_ANALYTICS_URL: server.baseUrl, XDG_CONFIG_HOME: mkdtempSync(join(tmpdir(), 'agent-analytics-unused-xdg-')) },
        });

        assert.equal(code, 0);
        assert.ok(stdout.includes(config.configFile));
        assert.equal(readJson(config.configFile).api_key, 'aak_config_token');
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

    it('prints detached resume commands with explicit --config-dir', async () => {
      const config = createExplicitConfigDir();
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          await readRequestJson(req);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-config-dir',
            authorize_url: 'https://approve.example/req-config-dir',
            approval_code: 'CFG12345',
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
            approval_code: 'ENV12345',
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

    it('auth status prints local metadata without token values or network access', async () => {
      const config = createExplicitConfigDir({
        email: 'local@example.com',
        github_login: 'localdev',
        google_name: 'Local Dev',
        tier: 'free',
        agent_session: {
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
        assert.ok(plain.includes('stored agent session'));
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

    it('fails loudly when --config-dir is missing a value', async () => {
      const { code, stdout } = await run(['whoami', '--config-dir']);

      assert.notEqual(code, 0);
      assert.ok(stripAnsi(stdout).includes('Missing value for --config-dir'));
    });
  });

  describe('login without token', () => {
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
              approval_code: 'CLI12345',
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
            approval_code: 'RACE1234',
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
          AGENT_ANALYTICS_API_KEY: 'aak_test123',
        },
      });

      assert.notEqual(code, 0);
      assert.ok(stdout.includes('Usage: npx @agent-analytics/cli feedback'));
    });
  });

  describe('context', () => {
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
            AGENT_ANALYTICS_API_KEY: 'aak_test123',
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

  describe('website analysis scan command', () => {
    it('returns anonymous preview JSON for scan <url> --json without saved auth', async () => {
      const tempHome = createTempConfigHome();
      let requestBody;
      let authHeader;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/website-scans') {
          authHeader = req.headers.authorization || req.headers['x-api-key'];
          requestBody = await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            analysis_id: 'scan_anon',
            mode: 'anonymous_preview',
            normalized_url: 'https://example.com/',
            resume_token: 'rst_preview',
            preview: {
              current_blindspots: ['Cannot see signup intent'],
              minimum_viable_instrumentation: [{
                event: 'primary_cta_clicked',
                priority: 1,
                why_this_matters_now: 'Intent starts here.',
                current_blindspot: 'CTA intent is unknown.',
                unlocks_questions: ['Which page creates intent?'],
                agent_capability_after_install: 'Rank pages by intent.',
              }],
              not_needed_yet: [],
              goal_driven_funnels: [],
              after_install_agent_behavior: [],
              analytics_detected: { providers: [] },
            },
          }));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'not found' }));
      });

      try {
        const { code, stdout } = await run(['scan', 'example.com/pricing', '--json'], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: '',
            XDG_CONFIG_HOME: tempHome.xdgConfigHome,
          },
        });
        const data = JSON.parse(stdout);

        assert.equal(code, 0);
        assert.equal(authHeader, undefined);
        assert.deepEqual(requestBody, { url: 'example.com/pricing' });
        assert.equal(data.analysis_id, 'scan_anon');
        assert.equal(data.resume_token, 'rst_preview');
      } finally {
        await server.close();
        tempHome.cleanup();
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

    it('upgrades a resumed analysis with auth when --full is passed', async () => {
      let requestBody;
      let requestAuth;
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/website-scans/scan_anon/upgrade') {
          requestAuth = req.headers['x-api-key'];
          requestBody = await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            analysis_id: 'scan_anon',
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
          'scan',
          '--resume', 'scan_anon',
          '--resume-token', 'rst_preview',
          '--full',
          '--project', 'example-site',
          '--json',
        ], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: 'aak_test123',
          },
        });
        const data = JSON.parse(stdout);

        assert.equal(code, 0);
        assert.equal(requestAuth, 'aak_test123');
        assert.deepEqual(requestBody, {
          resume_token: 'rst_preview',
          project: 'example-site',
        });
        assert.equal(data.mode, 'full');
      } finally {
        await server.close();
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
        if (req.method === 'POST' && req.url === '/website-scans') {
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

    it('refreshes an expired agent session before a direct full scan', async () => {
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
        if (req.method === 'POST' && req.url === '/website-scans') {
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
        assert.equal(refreshCalls, 1);
        assert.deepEqual(requestAuths, ['Bearer aas_expired_scan', 'Bearer aas_refreshed_scan']);
        assert.deepEqual(requestBodies, [
          { url: 'https://example.com/', mode: 'full', project: 'example-site' },
          { url: 'https://example.com/', mode: 'full', project: 'example-site' },
        ]);
        assert.equal(readJson(config.configFile).agent_session.access_token, 'aas_refreshed_scan');
        assert.equal(data.analysis_id, 'scan_full_after_refresh');
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('uses an anonymous request for scan <url> previews unless a project is supplied', async () => {
      let requestAuth;
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
        if (req.method === 'POST' && req.url === '/website-scans') {
          requestAuth = req.headers.authorization;
          await readRequestJson(req);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            ok: true,
            analysis_id: 'scan_auth_preview',
            mode: 'anonymous_preview',
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
        assert.equal(requestAuth, undefined);
        assert.equal(data.mode, 'anonymous_preview');
      } finally {
        await server.close();
        config.cleanup();
      }
    });

    it('prints login guidance for scan --full without auth', async () => {
      const tempHome = createTempConfigHome();
      const { code, stdout } = await run([
        'scan',
        '--resume', 'scan_anon',
        '--resume-token', 'rst_preview',
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

    it('prints retry timing for a busy anonymous analyzer response', async () => {
      const tempHome = createTempConfigHome();
      const server = await startServer(async (req, res) => {
        if (req.method === 'POST' && req.url === '/website-scans') {
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
        const { code, stdout } = await run(['scan', 'https://busy.example'], {
          env: {
            AGENT_ANALYTICS_URL: server.baseUrl,
            AGENT_ANALYTICS_API_KEY: '',
            XDG_CONFIG_HOME: tempHome.xdgConfigHome,
          },
        });
        const output = stripAnsi(stdout);

        assert.notEqual(code, 0);
        assert.ok(output.includes('free analyzer is busy'));
        assert.ok(output.includes('17 seconds'));
      } finally {
        await server.close();
        tempHome.cleanup();
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
            AGENT_ANALYTICS_API_KEY: 'aak_test123',
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
