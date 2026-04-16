import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { loginDetached, loginInteractive, startDetachedLogin } from '../lib/auth-flow.mjs';
import { AgentAnalyticsAPI } from '../lib/api.mjs';
import { DEFAULT_AGENT_SESSION_SCOPES } from '../lib/scopes.mjs';

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
    let callbackHtml = '';
    let callbackLogo = null;
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
          const logoResponse = await fetch(new URL('/logo.png', callback));
          callbackLogo = {
            ok: logoResponse.ok,
            contentType: logoResponse.headers.get('content-type'),
            cacheControl: logoResponse.headers.get('cache-control'),
            bytes: (await logoResponse.arrayBuffer()).byteLength,
          };
          callback.searchParams.set('request_id', 'req-1');
          callback.searchParams.set('exchange_code', 'aae_exchange');
          const response = await fetch(callback);
          callbackHtml = await response.text();
        },
      });

      assert.equal(startPayload.mode, 'interactive');
      assert.ok(startPayload.code_challenge);
      assert.deepEqual(startPayload.scopes, DEFAULT_AGENT_SESSION_SCOPES);
      assert.equal(pending.authorize_url, 'https://approve.example/req-1');
      assert.equal(pending.approval_code, 'ABC12345');
      assert.equal(exchangePayload.auth_request_id, 'req-1');
      assert.equal(exchangePayload.exchange_code, 'aae_exchange');
      assert.ok(exchangePayload.code_verifier);
      assert.equal(result.agent_session.access_token, 'aas_access');
      assert.match(callbackHtml, /<title>Agent Analytics Connected<\/title>/);
      assert.match(callbackHtml, /<img src="\/logo\.png" alt="Agent Analytics"/);
      assert.match(callbackHtml, /Agent Analytics<\/div>/);
      assert.match(callbackHtml, /Agent-Ready Analytics<\/div>/);
      assert.match(callbackHtml, /<h1>Your CLI is now connected\.<\/h1>/);
      assert.match(callbackHtml, /Agent Analytics sent the finish code back to your CLI\./);
      assert.match(callbackHtml, /You can close this tab\./);
      assert.doesNotMatch(callbackHtml, /Open Management Page/);
      assert.doesNotMatch(callbackHtml, /Cloud Pro/);
      assert.doesNotMatch(callbackHtml, /free plan right now/i);
      assert.doesNotMatch(callbackHtml, /Connected<\/div>/);
      assert.doesNotMatch(callbackHtml, /If nothing happens/);
      assert.ok(callbackLogo);
      assert.equal(callbackLogo.ok, true);
      assert.equal(callbackLogo.contentType, 'image/png');
      assert.equal(callbackLogo.cacheControl, 'no-store');
      assert.ok(callbackLogo.bytes > 0);
    });
  });

  it('completes detached login by polling until approval', async () => {
    let pollCount = 0;
    let startPayload = null;
    await withServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const payload = body ? JSON.parse(body) : {};
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          startPayload = payload;
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
      assert.deepEqual(startPayload.scopes, DEFAULT_AGENT_SESSION_SCOPES);
      assert.equal(result.started.auth_request_id, 'req-detached');
      assert.equal(result.exchanged.agent_session.refresh_token, 'aar_detached');
    });
  });

  it('starts detached login without polling for handoff mode', async () => {
    let startPayload = null;
    let pollCount = 0;

    await withServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        const payload = body ? JSON.parse(body) : {};
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          startPayload = payload;
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-handoff',
            authorize_url: 'https://approve.example/req-handoff',
            approval_code: 'HAND1234',
            poll_token: 'aap_handoff',
          }));
          return;
        }
        if (req.method === 'POST' && req.url === '/agent-sessions/poll') {
          pollCount += 1;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'pending' }));
          return;
        }
        res.writeHead(404).end();
      });
    }, async (baseUrl) => {
      const api = new AgentAnalyticsAPI(null, baseUrl);
      const started = await startDetachedLogin(api);

      assert.equal(startPayload.mode, 'detached');
      assert.deepEqual(startPayload.scopes, DEFAULT_AGENT_SESSION_SCOPES);
      assert.equal(started.auth_request_id, 'req-handoff');
      assert.equal(started.approval_code, 'HAND1234');
      assert.equal(pollCount, 0);
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

  it('stops detached polling when the auth request was already exchanged', async () => {
    await withServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        if (req.method === 'POST' && req.url === '/agent-sessions/start') {
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            auth_request_id: 'req-exchanged',
            authorize_url: 'https://approve.example/req-exchanged',
            approval_code: 'DONE1234',
            poll_token: 'aap_exchanged',
          }));
          return;
        }
        if (req.method === 'POST' && req.url === '/agent-sessions/poll') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ status: 'exchanged', exchange_code: 'aae_exchanged' }));
          return;
        }
        res.writeHead(404).end();
      });
    }, async (baseUrl) => {
      const api = new AgentAnalyticsAPI(null, baseUrl);
      await assert.rejects(
        () => loginDetached(api, {
          timeoutMs: 2000,
          pollIntervalMs: 10,
        }),
        {
          code: 'AUTH_REQUEST_ALREADY_EXCHANGED',
          message: 'auth request already exchanged',
        }
      );
    });
  });
});
