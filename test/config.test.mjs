import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { getConfig, saveConfig, getApiKey, setApiKey, getBaseUrl } from '../lib/config.mjs';

describe('config', () => {
  describe('getConfig', () => {
    it('returns an object', () => {
      const config = getConfig();
      assert.equal(typeof config, 'object');
      assert.ok(config !== null);
    });
  });

  describe('saveConfig / getConfig roundtrip', () => {
    let originalConfig;

    before(() => {
      originalConfig = getConfig();
    });

    after(() => {
      saveConfig(originalConfig);
    });

    it('persists and reads back config', () => {
      const testKey = `test_roundtrip_${Date.now()}`;
      const config = getConfig();
      config._test = testKey;
      saveConfig(config);

      const loaded = getConfig();
      assert.equal(loaded._test, testKey);
    });
  });

  describe('getApiKey', () => {
    const originalEnv = process.env.AGENT_ANALYTICS_API_KEY;

    after(() => {
      if (originalEnv === undefined) {
        delete process.env.AGENT_ANALYTICS_API_KEY;
      } else {
        process.env.AGENT_ANALYTICS_API_KEY = originalEnv;
      }
    });

    it('returns env var when set', () => {
      process.env.AGENT_ANALYTICS_API_KEY = 'aak_from_env';
      assert.equal(getApiKey(), 'aak_from_env');
    });

    it('returns null when no env var and no config key', () => {
      delete process.env.AGENT_ANALYTICS_API_KEY;
      const orig = getConfig();
      const backup = orig.api_key;
      delete orig.api_key;
      saveConfig(orig);

      const key = getApiKey();
      // Restore
      if (backup) { orig.api_key = backup; saveConfig(orig); }

      assert.equal(key, null);
    });
  });

  describe('setApiKey', () => {
    let originalConfig;

    before(() => { originalConfig = getConfig(); });
    after(() => { saveConfig(originalConfig); });

    it('stores key in config file', () => {
      setApiKey('aak_test_set');
      const config = getConfig();
      assert.equal(config.api_key, 'aak_test_set');
    });
  });

  describe('getBaseUrl', () => {
    const originalEnv = process.env.AGENT_ANALYTICS_URL;

    after(() => {
      if (originalEnv === undefined) {
        delete process.env.AGENT_ANALYTICS_URL;
      } else {
        process.env.AGENT_ANALYTICS_URL = originalEnv;
      }
    });

    it('returns env var when set', () => {
      process.env.AGENT_ANALYTICS_URL = 'https://custom.example.com';
      assert.equal(getBaseUrl(), 'https://custom.example.com');
    });

    it('returns default URL when no env var or config', () => {
      delete process.env.AGENT_ANALYTICS_URL;
      assert.equal(getBaseUrl(), 'https://api.agentanalytics.sh');
    });
  });
});
