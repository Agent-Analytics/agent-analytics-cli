import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';

const configs = [];

process.once('exit', () => {
  for (const config of configs) {
    config.cleanup();
  }
});

export function createAgentSessionConfig(accessToken = 'aas_test123') {
  const configDir = mkdtempSync(join(tmpdir(), 'agent-analytics-test-config-'));
  const configFile = join(configDir, 'config.json');
  writeFileSync(configFile, JSON.stringify({
    agent_session: {
      access_token: accessToken,
      refresh_token: 'aar_test123',
      access_expires_at: 1893456000000,
      refresh_expires_at: 1924992000000,
      scopes: ['account:read', 'projects:read', 'events:read', 'context:read', 'context:write'],
    },
  }, null, 2) + '\n');

  const config = {
    configDir,
    configFile,
    env: { AGENT_ANALYTICS_CONFIG_DIR: configDir },
    cleanup() {
      rmSync(configDir, { recursive: true, force: true });
    },
  };
  configs.push(config);
  return config;
}

export function agentSessionEnv(accessToken = 'aas_test123') {
  return createAgentSessionConfig(accessToken).env;
}
