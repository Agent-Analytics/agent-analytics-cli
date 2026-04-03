import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loginDetached, loginInteractive } from '../lib/auth-flow.mjs';
import { AgentAnalyticsAPI } from '../lib/api.mjs';

async function withServer(handler, fn) {
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  try {
    await fn(baseUrl);
  } finally {
    await new Promise((resolve, reject) => server.close((err) => err ? reject(err) : resolve()));
  }
}

describe('auth flow helpers', () => {
  it('completes interactive login with loopback callback + PKCE exchange', async () => {
    let callbackUrl = null;
    let startPayload = null;
    let exchangePayload = null;
    let pending = null;

    await withServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const payload = body ? JSON.parse(body) : {};
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          startPayload = payload;
          callbackUrl = payload.callback_url;
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-1',
            authorize_url: 'https://approve.example/req-1',
            approval_code: 'ABC12345',
            poll_token: 'aap_1',
          }));
          return;
        }

        if (req.method === 'POST' && req.url === '/agent-sessions/exchange') {
          exchangePayload = payload;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            agent_session: {
              id: 'sess-1',
              access_token: 'aas_access',
              refresh_token: 'aar_refresh',
              access_expires_at: Date.now() + 60000,
              refresh_expires_at: Date.now() + 600000,
            },
            account: {
              email: 'agent@example.com',
              tier: 'free',
            },
          }));
          return;
        }

        res.writeHead(404).end();
      });
    }, async (baseUrl) => {
      const api = new AgentAnalyticsAPI(null, baseUrl);
      const result = await loginInteractive(api, {
        onPending(started) {
          pending = started;
        },
        timeoutMs: 2000,
        async openUrl() {
          const callback = new URL(callbackUrl);
          callback.searchParams.set('request_id', 'req-1');
          callback.searchParams.set('exchange_code', 'aae_exchange');
          await fetch(callback);
        },
      });

      assert.equal(startPayload.mode, 'interactive');
      assert.ok(startPayload.code_challenge);
      assert.equal(pending.authorize_url, 'https://approve.example/req-1');
      assert.equal(pending.approval_code, 'ABC12345');
      assert.equal(exchangePayload.auth_request_id, 'req-1');
      assert.equal(exchangePayload.exchange_code, 'aae_exchange');
      assert.ok(exchangePayload.code_verifier);
      assert.equal(result.agent_session.access_token, 'aas_access');
    });
  });

  it('completes detached login by polling until approval', async () => {
    let pollCount = 0;
    await withServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const payload = body ? JSON.parse(body) : {};
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-detached',
            authorize_url: 'https://approve.example/req-detached',
            approval_code: 'ZYXW9876',
            poll_token: 'aap_detached',
          }));
          return;
        }
        if (req.method === 'POST' && req.url === '/agent-sessions/poll') {
          pollCount += 1;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(
            pollCount === 1
              ? { status: 'pending' }
              : { status: 'approved', exchange_code: 'aae_detached' }
          ));
          return;
        }
        if (req.method === 'POST' && req.url === '/agent-sessions/exchange') {
          assert.equal(payload.exchange_code, 'aae_detached');
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            agent_session: {
              id: 'sess-2',
              access_token: 'aas_detached',
              refresh_token: 'aar_detached',
              access_expires_at: Date.now() + 60000,
              refresh_expires_at: Date.now() + 600000,
            },
            account: {
              email: 'detached@example.com',
              tier: 'pro',
            },
          }));
          return;
        }
        res.writeHead(404).end();
      });
    }, async (baseUrl) => {
      const api = new AgentAnalyticsAPI(null, baseUrl);
      const result = await loginDetached(api, {
        timeoutMs: 2000,
        pollIntervalMs: 10,
      });
      assert.equal(result.started.auth_request_id, 'req-detached');
      assert.equal(result.exchanged.agent_session.refresh_token, 'aar_detached');
    });
  });

  it('reports a resumable command when detached approval times out', async () => {
    await withServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-timeout',
            authorize_url: 'https://approve.example/req-timeout',
            approval_code: 'TIME1234',
            poll_token: 'aap_timeout',
          }));
          return;
        }
        if (req.method === 'POST' && req.url === '/agent-sessions/poll') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'pending' }));
          return;
        }
        res.writeHead(404).end();
      });
    }, async (baseUrl) => {
      const api = new AgentAnalyticsAPI(null, baseUrl);
      await assert.rejects(
        () => loginDetached(api, {
          timeoutMs: 30,
          pollIntervalMs: 10,
        }),
        /Resume later with npx @agent-analytics\/cli login --auth-request req-timeout --exchange-code <code>/
      );
    });
  });
});
