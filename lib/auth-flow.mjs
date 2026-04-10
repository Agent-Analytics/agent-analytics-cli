import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { DEFAULT_AGENT_SESSION_SCOPES } from './scopes.mjs';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_INTERACTIVE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_DETACHED_TIMEOUT_MS = 30 * 60 * 1000;
const LOOPBACK_LOGO_PATHNAME = '/logo.png';
const LOOPBACK_LOGO_BYTES = readFileSync(new URL('../assets/logo.png', import.meta.url));

function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function formatDurationMs(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes === 1) return '1 minute';
  return `${minutes} minutes`;
}

export function createCodeVerifier() {
  return randomBytes(32).toString('hex');
}

export function openBrowser(url, { openUrl } = {}) {
  if (openUrl) {
    return Promise.resolve(openUrl(url));
  }

  const custom = process.env.AGENT_ANALYTICS_OPEN_COMMAND;
  if (custom) {
    const child = spawn(custom, [url], { stdio: 'ignore', shell: true, detached: true });
    child.unref();
    return Promise.resolve();
  }

  const platform = process.platform;
  const command = platform === 'darwin'
    ? 'open'
    : platform === 'win32'
      ? 'cmd'
      : 'xdg-open';
  const args = platform === 'win32' ? ['/c', 'start', '', url] : [url];
  const child = spawn(command, args, { stdio: 'ignore', detached: true });
  child.unref();
  return Promise.resolve();
}

function renderLoopbackCallbackPage() {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Agent Analytics Connected</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bitter:wght@500;600&family=IBM+Plex+Mono:wght@500;600&family=Outfit:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    :root {
      --text: #101313;
      --text-dim: #505757;
      --text-muted: #7d847d;
      --accent: #0f9f5b;
      --border: rgba(16, 19, 19, 0.1);
      --border-light: rgba(16, 19, 19, 0.06);
      --shadow: 0 24px 70px rgba(70, 58, 30, 0.08);
      --shadow-soft: 0 12px 30px rgba(70, 58, 30, 0.08);
      --font-body: 'Outfit', sans-serif;
      --font-serif: 'Bitter', serif;
      --font-mono: 'IBM Plex Mono', monospace;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      color: var(--text);
      font-family: var(--font-body);
      background:
        radial-gradient(circle at 12% 0%, rgba(15, 159, 91, 0.08), transparent 28%),
        radial-gradient(circle at 100% 10%, rgba(63, 109, 246, 0.07), transparent 30%),
        linear-gradient(180deg, #f7f2e6 0%, #efe8d8 45%, #f5f1e7 100%);
      -webkit-font-smoothing: antialiased;
    }
    body::before {
      content: "";
      position: fixed;
      inset: 0;
      pointer-events: none;
      background-image:
        linear-gradient(rgba(16, 19, 19, 0.025) 1px, transparent 1px),
        linear-gradient(90deg, rgba(16, 19, 19, 0.025) 1px, transparent 1px);
      background-size: 108px 108px;
      mask-image: radial-gradient(circle at 50% 18%, black 20%, transparent 72%);
      opacity: 0.32;
    }
    .shell {
      position: relative;
      z-index: 1;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .card {
      width: min(100%, 680px);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 28px 30px 24px;
      background: rgba(255, 255, 255, 0.72);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 20px;
    }
    .brand img {
      display: block;
      width: 84px;
      height: auto;
      flex: 0 0 auto;
    }
    .brand-copy {
      display: grid;
      gap: 4px;
    }
    .brand-title {
      color: var(--text);
      font-size: 1.5rem;
      font-weight: 700;
      line-height: 1;
      letter-spacing: -0.03em;
    }
    .brand-subtitle {
      color: var(--text-muted);
      font-family: var(--font-mono);
      font-size: 12px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
    }
    h1 {
      margin: 0 0 12px;
      font-family: var(--font-serif);
      font-size: clamp(1.85rem, 5vw, 2.3rem);
      line-height: 0.98;
      letter-spacing: -0.05em;
    }
    p {
      margin: 0;
      color: var(--text-dim);
      font-size: 15px;
      line-height: 1.62;
    }
    .lead {
      max-width: 40ch;
      margin-bottom: 18px;
    }
    .note {
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.55;
    }
    @media (max-width: 560px) {
      .card { padding: 24px 20px 20px; border-radius: 22px; }
      .brand { gap: 12px; }
      .brand img { width: 68px; }
      .brand-title { font-size: 1.2rem; }
      .brand-subtitle { font-size: 11px; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <div class="brand" aria-label="Agent Analytics">
        <img src="${LOOPBACK_LOGO_PATHNAME}" alt="Agent Analytics" width="240" height="191">
        <div class="brand-copy">
          <div class="brand-title">Agent Analytics</div>
          <div class="brand-subtitle">Agent-Ready Analytics</div>
        </div>
      </div>
      <h1>Your CLI is now connected.</h1>
      <p class="lead">Agent Analytics sent the finish code back to your CLI. You can close this tab.</p>
      <p class="note">Browsers usually block pages from closing tabs they did not open themselves.</p>
    </div>
  </div>
</body>
</html>`;
}

export async function loginInteractive(api, {
  openUrl,
  onPending,
  timeoutMs = DEFAULT_INTERACTIVE_TIMEOUT_MS,
  clientType = 'cli',
  clientName = 'Agent Analytics CLI',
} = {}) {
  const codeVerifier = createCodeVerifier();
  const codeChallenge = sha256Hex(codeVerifier);

  const callback = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname === LOOPBACK_LOGO_PATHNAME) {
        res.writeHead(200, {
          'Content-Type': 'image/png',
          'Content-Length': String(LOOPBACK_LOGO_BYTES.length),
          'Cache-Control': 'no-store',
        });
        res.end(LOOPBACK_LOGO_BYTES);
        return;
      }
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderLoopbackCallbackPage());
      clearTimeout(timeout);
      server.close();
      resolve({
        requestId: url.searchParams.get('request_id'),
        exchangeCode: url.searchParams.get('exchange_code'),
      });
    });

    server.listen(0, '127.0.0.1', async () => {
      try {
        const address = server.address();
        const callbackUrl = `http://127.0.0.1:${address.port}/callback`;
        const started = await api.startAgentSession({
          mode: 'interactive',
          client_type: clientType,
          client_name: clientName,
          client_instance_id: `pid:${process.pid}`,
          callback_url: callbackUrl,
          scopes: DEFAULT_AGENT_SESSION_SCOPES,
          code_challenge: codeChallenge,
          metadata: { runtime: 'cli' },
        });
        onPending?.(started);
        await openBrowser(started.authorize_url, { openUrl });
      } catch (error) {
        clearTimeout(timeout);
        server.close();
        reject(error);
      }
    });

    const timeout = setTimeout(() => {
      server.close();
      reject(new Error(`Timed out waiting for browser approval after ${formatDurationMs(timeoutMs)}`));
    }, timeoutMs);
  });

  if (!callback.requestId || !callback.exchangeCode) {
    throw new Error('Browser callback did not include an exchange code');
  }

  return api.exchangeAgentSession(callback.requestId, callback.exchangeCode, codeVerifier);
}

export async function loginDetached(api, {
  onPending,
  onPoll,
  timeoutMs = DEFAULT_DETACHED_TIMEOUT_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  clientType = 'cli',
  clientName = 'Agent Analytics CLI',
} = {}) {
  const started = await api.startAgentSession({
    mode: 'detached',
    client_type: clientType,
    client_name: clientName,
    client_instance_id: `pid:${process.pid}`,
    scopes: DEFAULT_AGENT_SESSION_SCOPES,
    metadata: { runtime: 'cli' },
  });

  onPending?.(started);

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await api.pollAgentSession(started.auth_request_id, started.poll_token);
    onPoll?.(status);
    if (status.status === 'approved' && status.exchange_code) {
      return {
        started,
        exchanged: await api.exchangeAgentSession(started.auth_request_id, status.exchange_code),
      };
    }
    if (status.status === 'revoked' || status.status === 'expired') {
      throw new Error(`Agent session ${status.status}`);
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  throw new Error(
    `Timed out waiting for detached approval after ${formatDurationMs(timeoutMs)}. ` +
    `Resume later with npx @agent-analytics/cli login --auth-request ${started.auth_request_id} --exchange-code <code>`
  );
}

export async function finishManualExchange(api, authRequestId, exchangeCode) {
  return api.exchangeAgentSession(authRequestId, exchangeCode);
}
