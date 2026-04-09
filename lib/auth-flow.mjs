import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { DEFAULT_AGENT_SESSION_SCOPES } from './scopes.mjs';

const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_INTERACTIVE_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_DETACHED_TIMEOUT_MS = 30 * 60 * 1000;
const BRAND_MARK_SVG = `<svg width="512" height="512" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs>
    <linearGradient id="agentanalytics-cli-bars" x1="16" y1="18" x2="42" y2="52" gradientUnits="userSpaceOnUse">
      <stop stop-color="#F7BF47"/>
      <stop offset="0.55" stop-color="#EE8E21"/>
      <stop offset="1" stop-color="#D76818"/>
    </linearGradient>
    <linearGradient id="agentanalytics-cli-node" x1="42" y1="12" x2="56" y2="26" gradientUnits="userSpaceOnUse">
      <stop stop-color="#F8CF68"/>
      <stop offset="1" stop-color="#E87B1E"/>
    </linearGradient>
  </defs>
  <path d="M14 44C14 27.9837 22.5106 15 37.5 15C44.6702 15 50.2044 17.4802 53.5 22" stroke="#151718" stroke-width="4.75" stroke-linecap="round"/>
  <path d="M17.5 49C22.1962 52.7689 27.4761 54.5 33.5 54.5C45.3741 54.5 54 46.0463 54 34.5" stroke="#151718" stroke-width="4.75" stroke-linecap="round"/>
  <rect x="17" y="33" width="6.5" height="15" rx="3.25" fill="url(#agentanalytics-cli-bars)"/>
  <rect x="27" y="25" width="6.5" height="23" rx="3.25" fill="url(#agentanalytics-cli-bars)"/>
  <rect x="37" y="18" width="6.5" height="30" rx="3.25" fill="url(#agentanalytics-cli-bars)"/>
  <circle cx="54" cy="22" r="4.5" fill="url(#agentanalytics-cli-node)"/>
  <circle cx="54" cy="34.5" r="3.5" fill="#151718"/>
</svg>`;

function sha256Hex(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function formatDurationMs(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes === 1) return '1 minute';
  return `${minutes} minutes`;
}

function deriveDashboardUrl(apiBaseUrl) {
  if (process.env.AGENT_ANALYTICS_DASHBOARD_URL) {
    return process.env.AGENT_ANALYTICS_DASHBOARD_URL;
  }

  try {
    const url = new URL(apiBaseUrl);
    if (url.hostname === 'localhost' || url.hostname === '127.0.0.1') {
      return 'http://localhost:5173';
    }
    if (url.hostname === 'api.agentanalytics.sh') {
      return 'https://app.agentanalytics.sh';
    }
    if (url.hostname.startsWith('api.')) {
      url.hostname = `app.${url.hostname.slice(4)}`;
      return url.origin;
    }
  } catch {
    // fall back to production dashboard
  }

  return 'https://app.agentanalytics.sh';
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

function renderLoopbackCallbackPage(dashboardUrl) {
  const logoUrl = new URL('/logo.png', dashboardUrl).toString();
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
      width: min(100%, 470px);
      border: 1px solid var(--border);
      border-radius: 24px;
      padding: 30px;
      background: rgba(255, 255, 255, 0.72);
      box-shadow: var(--shadow);
      backdrop-filter: blur(18px);
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 24px;
    }
    .brand-mark {
      width: 54px;
      height: 54px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 18px;
      background: rgba(255, 255, 255, 0.84);
      border: 1px solid var(--border-light);
      box-shadow: var(--shadow-soft);
    }
    .brand-mark img {
      width: 40px;
      height: 40px;
      object-fit: contain;
    }
    .brand-copy {
      display: grid;
      gap: 4px;
    }
    .brand-copy strong {
      font-size: 17px;
      line-height: 1;
      letter-spacing: -0.03em;
    }
    .brand-copy span {
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: var(--text-muted);
    }
    .success {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      margin: 18px 0 14px;
      color: var(--accent);
      font-size: 13px;
      font-weight: 600;
    }
    .success-dot {
      width: 10px;
      height: 10px;
      border-radius: 999px;
      background: var(--accent);
      box-shadow: 0 0 0 6px rgba(15, 159, 91, 0.12);
    }
    h1 {
      margin: 0 0 12px;
      font-family: var(--font-serif);
      font-size: clamp(2rem, 6vw, 2.55rem);
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
      max-width: 36ch;
      margin-bottom: 12px;
    }
    .supporting {
      margin-bottom: 18px;
      color: var(--text-dim);
    }
    .redirect-note {
      margin-bottom: 18px;
      color: var(--text-muted);
      font-size: 13px;
      line-height: 1.55;
    }
    .plan-strip {
      display: grid;
      gap: 12px;
      margin: 0 0 20px;
      padding: 16px;
      border-radius: 20px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.76);
      box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.72);
    }
    .plan-copy {
      display: grid;
      gap: 8px;
    }
    .plan-copy strong {
      font-size: 14px;
      letter-spacing: -0.02em;
    }
    .plan-copy span {
      color: var(--text-dim);
      font-size: 14px;
      line-height: 1.55;
    }
    .plan-grid {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .plan-card {
      min-width: 0;
      padding: 14px 14px 12px;
      border-radius: 18px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.88);
    }
    .plan-card[data-tone="accent"] {
      border-color: rgba(15, 159, 91, 0.22);
      background:
        linear-gradient(180deg, rgba(15, 159, 91, 0.08), rgba(15, 159, 91, 0.03)),
        rgba(255, 255, 255, 0.92);
    }
    .plan-label {
      display: inline-flex;
      align-items: center;
      margin-bottom: 8px;
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(16, 19, 19, 0.06);
      color: var(--text);
      font-family: var(--font-mono);
      font-size: 11px;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .plan-card[data-tone="accent"] .plan-label {
      background: rgba(15, 159, 91, 0.12);
      color: #0b8b50;
    }
    .plan-card strong {
      display: block;
      margin-bottom: 6px;
      font-size: 15px;
      line-height: 1.35;
      letter-spacing: -0.02em;
    }
    .plan-card p {
      font-size: 13px;
      line-height: 1.55;
    }
    .plan-features {
      margin: 10px 0 0;
      padding: 0;
      list-style: none;
      display: grid;
      gap: 8px;
    }
    .plan-features li {
      color: var(--text-dim);
      font-size: 13px;
      line-height: 1.55;
    }
    .plan-features strong {
      display: inline;
      margin: 0;
      font-size: inherit;
      line-height: inherit;
      letter-spacing: normal;
      color: var(--text);
    }
    .actions {
      display: grid;
      gap: 12px;
    }
    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      min-height: 54px;
      padding: 0 18px;
      border-radius: 999px;
      border: 1px solid #101313;
      background: #101313;
      color: #f7f2e6;
      font-size: 15px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      box-shadow: var(--shadow-soft);
      transition: transform 0.18s ease, background 0.18s ease;
    }
    .button:hover { transform: translateY(-1px); background: #1d2323; }
    .button-secondary {
      border-color: var(--border);
      background: rgba(255, 255, 255, 0.72);
      color: var(--text);
    }
    .button-secondary:hover { background: rgba(255, 255, 255, 0.92); }
    .button:focus-visible {
      outline: 2px solid rgba(12, 143, 82, 0.28);
      outline-offset: 3px;
    }
    .hint {
      margin-top: 14px;
      color: var(--text-muted);
      font-size: 12px;
      line-height: 1.55;
    }
    @media (max-width: 560px) {
      .card { padding: 24px 20px; border-radius: 22px; }
      .brand-mark { width: 48px; height: 48px; border-radius: 16px; }
      .brand-mark img { width: 36px; height: 36px; }
      .button { min-height: 50px; font-size: 14px; }
      .plan-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>
  <div class="shell">
    <div class="card">
      <div class="brand" aria-label="Agent Analytics">
        <span class="brand-mark"><img src="${logoUrl}" alt="Agent Analytics" width="40" height="40"></span>
        <span class="brand-copy">
          <strong>Agent Analytics</strong>
          <span>Agent-Ready Analytics</span>
        </span>
      </div>
      <div class="success"><span class="success-dot"></span>Connected</div>
      <h1>Done, we did it.</h1>
      <p class="lead">Your agent should continue from here and handle the rest.</p>
      <p class="supporting">Meanwhile, you can open the Agent Analytics management page to see projects, usage, and billing.</p>
      <div class="plan-strip">
        <div class="plan-copy">
          <strong>You are on the free plan right now.</strong>
          <span>The pricing below matches the landing page, so you can see exactly where the upgrade path goes from here.</span>
        </div>
        <div class="plan-grid" aria-label="Plan summary">
          <section class="plan-card">
            <div class="plan-label">Cloud Free</div>
            <strong>Start free: 2 projects, 100k events/month, 500 agent/API reads/month</strong>
            <ul class="plan-features" aria-label="Cloud free features">
              <li><strong>Retention:</strong> 90 days.</li>
              <li><strong>Tracker:</strong> Basic tracker included. Advanced tracker is not included on free.</li>
              <li><strong>Analytics:</strong> Core surface only: project list, stats, and recent events.</li>
              <li><strong>Experiments:</strong> Not included.</li>
            </ul>
          </section>
          <section class="plan-card" data-tone="accent">
            <div class="plan-label">Cloud Pro</div>
            <strong>Pay as you go: $1 per 10k events with unlimited projects and no monthly caps</strong>
            <ul class="plan-features" aria-label="Cloud pro features">
              <li><strong>Retention:</strong> 365 days.</li>
              <li><strong>Tracker:</strong> Full tracker signals including impressions, scroll depth, clicks, forms, errors, performance, and web vitals.</li>
              <li><strong>Analytics:</strong> Full surface: funnels, retention, sessions, pages, heatmaps, insights, and live.</li>
              <li><strong>Experiments:</strong> Included, plus the full hosted analytics surface across plugin, skill, MCP, CLI, and API.</li>
            </ul>
          </section>
        </div>
      </div>
      <p class="redirect-note">Open the management page when you want to review projects, usage, or billing.</p>
      <div class="actions">
        <a class="button" id="open-dashboard" href="${dashboardUrl}">Open Management Page</a>
        <button class="button button-secondary" id="close-button" type="button">Close This Tab</button>
      </div>
      <p class="hint">If nothing happens, use the button above. Your CLI is already connected.</p>
    </div>
  </div>
  <script>
    const button = document.getElementById('close-button');
    if (button) {
      button.addEventListener('click', () => {
        window.close();
        setTimeout(() => {
          button.textContent = 'You can close this tab now';
        }, 120);
      });
    }
  </script>
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
  const dashboardUrl = deriveDashboardUrl(api.baseUrl);

  const callback = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(renderLoopbackCallbackPage(dashboardUrl));
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
