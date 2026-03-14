import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI = join(__dirname, '..', 'bin', 'cli.mjs');

function run(args = [], { env = {} } = {}) {
  return new Promise((resolve) => {
    execFile('node', [CLI, ...args], {
      timeout: 5000,
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

describe('CLI', () => {
  describe('help', () => {
    it('shows help with --help flag', async () => {
      const { code, stdout } = await run(['--help']);
      assert.equal(code, 0);
      assert.ok(stdout.includes('Agent Analytics'));
      assert.ok(stdout.includes('ANALYTICS'));
      assert.ok(stdout.includes('login'));
      assert.ok(stdout.includes('logout'));
      assert.ok(stdout.includes('stats'));
      assert.ok(stdout.includes('all-sites'));
      assert.ok(stdout.includes('bot-traffic'));
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
    it('shows login instructions when no token provided', async () => {
      const { code, stdout } = await run(['login']);
      assert.equal(code, 0);
      assert.ok(stdout.includes('API key'));
      assert.ok(stdout.includes('--token'));
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
