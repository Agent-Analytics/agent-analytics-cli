import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { AgentAnalyticsAPI } from '../lib/api.mjs';

describe('AgentAnalyticsAPI', () => {
  describe('constructor', () => {
    it('stores apiKey and baseUrl', () => {
      const api = new AgentAnalyticsAPI('aak_test', 'https://custom.example.com');
      assert.equal(api.apiKey, 'aak_test');
      assert.equal(api.baseUrl, 'https://custom.example.com');
    });

    it('uses default baseUrl', () => {
      const api = new AgentAnalyticsAPI('aak_test');
      assert.equal(api.baseUrl, 'https://app.agentanalytics.sh');
    });
  });

  describe('request', () => {
    let originalFetch;
    let lastFetchUrl;
    let lastFetchOpts;

    before(() => { originalFetch = globalThis.fetch; });
    after(() => { globalThis.fetch = originalFetch; });

    beforeEach(() => {
      lastFetchUrl = null;
      lastFetchOpts = null;
      globalThis.fetch = async (url, opts) => {
        lastFetchUrl = url;
        lastFetchOpts = opts;
        return { ok: true, json: async () => ({ success: true }) };
      };
    });

    it('sends GET with API key header', async () => {
      const api = new AgentAnalyticsAPI('aak_key', 'https://test.example.com');
      await api.request('GET', '/account');

      assert.equal(lastFetchUrl, 'https://test.example.com/account');
      assert.equal(lastFetchOpts.method, 'GET');
      assert.equal(lastFetchOpts.headers['X-API-Key'], 'aak_key');
      assert.equal(lastFetchOpts.headers['Content-Type'], 'application/json');
      assert.equal(lastFetchOpts.body, undefined);
    });

    it('sends POST with JSON body', async () => {
      const api = new AgentAnalyticsAPI('aak_key', 'https://test.example.com');
      await api.request('POST', '/projects', { name: 'test' });

      assert.equal(lastFetchOpts.method, 'POST');
      assert.equal(lastFetchOpts.body, JSON.stringify({ name: 'test' }));
    });

    it('omits API key header when no key', async () => {
      const api = new AgentAnalyticsAPI(null, 'https://test.example.com');
      await api.request('GET', '/health');

      assert.equal(lastFetchOpts.headers['X-API-Key'], undefined);
    });

    it('throws on non-ok response with error message', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Invalid API key' }),
      });

      const api = new AgentAnalyticsAPI('bad_key', 'https://test.example.com');
      await assert.rejects(
        () => api.request('GET', '/account'),
        { message: 'Invalid API key' }
      );
    });

    it('throws with HTTP status when no error message', async () => {
      globalThis.fetch = async () => ({
        ok: false,
        status: 500,
        json: async () => ({}),
      });

      const api = new AgentAnalyticsAPI('aak_key', 'https://test.example.com');
      await assert.rejects(
        () => api.request('GET', '/stats'),
        { message: 'HTTP 500' }
      );
    });
  });

  describe('API methods build correct URLs', () => {
    let lastUrl;
    let lastMethod;

    before(() => {
      globalThis.fetch = async (url, opts) => {
        lastUrl = url;
        lastMethod = opts.method;
        return { ok: true, json: async () => ({}) };
      };
    });

    after(() => {
      // Restore is handled by parent suite's after
    });

    const api = new AgentAnalyticsAPI('aak_test', 'https://api.test');

    it('getAccount → GET /account', async () => {
      await api.getAccount();
      assert.equal(lastUrl, 'https://api.test/account');
      assert.equal(lastMethod, 'GET');
    });

    it('revokeKey → POST /account/revoke-key', async () => {
      await api.revokeKey();
      assert.equal(lastUrl, 'https://api.test/account/revoke-key');
      assert.equal(lastMethod, 'POST');
    });

    it('createProject → POST /projects', async () => {
      await api.createProject('my-site', 'https://my.site');
      assert.equal(lastUrl, 'https://api.test/projects');
      assert.equal(lastMethod, 'POST');
    });

    it('listProjects → GET /projects', async () => {
      await api.listProjects();
      assert.equal(lastUrl, 'https://api.test/projects');
      assert.equal(lastMethod, 'GET');
    });

    it('deleteProject → DELETE /projects/:id', async () => {
      await api.deleteProject('proj_123');
      assert.equal(lastUrl, 'https://api.test/projects/proj_123');
      assert.equal(lastMethod, 'DELETE');
    });

    it('getStats → GET /stats with query params', async () => {
      await api.getStats('my-site', 30);
      assert.equal(lastUrl, 'https://api.test/stats?project=my-site&days=30');
    });

    it('getStats encodes project name', async () => {
      await api.getStats('my site');
      assert.ok(lastUrl.includes('project=my%20site'));
    });

    it('getEvents → GET /events with defaults', async () => {
      await api.getEvents('my-site');
      assert.equal(lastUrl, 'https://api.test/events?project=my-site&days=7&limit=100');
    });

    it('getEvents with event filter', async () => {
      await api.getEvents('my-site', { event: 'page_view', days: 14, limit: 50 });
      assert.equal(lastUrl, 'https://api.test/events?project=my-site&days=14&limit=50&event=page_view');
    });

    it('getProperties → GET /properties', async () => {
      await api.getProperties('my-site', 60);
      assert.equal(lastUrl, 'https://api.test/properties?project=my-site&days=60');
    });
  });

});
