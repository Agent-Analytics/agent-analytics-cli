import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

function runCli(args, { port }) {
  const child = spawn(process.execPath, [resolve('bin/cli.mjs'), ...args], {
    cwd: resolve('.'),
    env: {
      ...process.env,
      AGENT_ANALYTICS_API_KEY: 'aak_test123',
      AGENT_ANALYTICS_URL: `http://127.0.0.1:${port}`,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  return once(child, 'close').then(([code]) => ({ code, stdout, stderr }));
}

async function withFunnelServer(assertRequest, response, fn) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null;
    assertRequest({ method: req.method, url: req.url, body });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    await fn(server.address().port);
  } finally {
    server.close();
  }
}

const funnelResponse = {
  steps_source: 'request.steps',
  identity_basis: 'resolved_user_id_or_user_id',
  steps: [
    { step: 1, event: 'page_view', users: 5, strict_survivors: 5, raw_activity: { event_count: 8 }, conversion_from_previous: 1, conversion_rate: 1 },
    { step: 2, event: 'signup', users: 2, strict_survivors: 2, raw_activity: { event_count: 3 }, conversion_from_previous: 0.4, conversion_rate: 0.4 },
  ],
  overall_conversion_rate: 0.4,
  warnings: [],
  caveats: [],
};

test('funnel command forwards --steps-json file payload', async () => {
  const tempDir = mkdtempSync(join(tmpdir(), 'aa-funnel-'));
  const file = join(tempDir, 'funnel.json');
  writeFileSync(file, JSON.stringify({
    steps: [
      { event: 'page_view', filters: [{ field: 'properties.path', op: 'prefix', value: '/products' }] },
      { event: 'signup' },
    ],
  }));

  try {
    await withFunnelServer(({ method, url, body }) => {
      assert.equal(method, 'POST');
      assert.equal(url, '/funnel');
      assert.deepEqual(body.steps, [
        { event: 'page_view', filters: [{ field: 'properties.path', op: 'prefix', value: '/products' }] },
        { event: 'signup' },
      ]);
      assert.equal(body.project, 'shop');
      assert.equal(body.since, '7d');
    }, funnelResponse, async (port) => {
      const { code, stdout, stderr } = await runCli(['funnel', 'shop', '--steps-json', file, '--since', '7d', '--json'], { port });
      assert.equal(code, 0, stderr);
      const data = JSON.parse(stdout);
      assert.equal(data.identity_basis, 'resolved_user_id_or_user_id');
    });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

test('funnel command forwards --from-context without steps', async () => {
  await withFunnelServer(({ body }) => {
    assert.equal(body.project, 'shop');
    assert.equal(body.from_context, true);
    assert.equal(Object.prototype.hasOwnProperty.call(body, 'steps'), false);
  }, { ...funnelResponse, steps_source: 'project_context.activation_events' }, async (port) => {
    const { code, stdout, stderr } = await runCli(['funnel', 'shop', '--from-context'], { port });
    assert.equal(code, 0, stderr);
    assert.match(stdout, /Step source:/);
    assert.match(stdout, /project_context\.activation_events/);
  });
});

test('packed CLI exposes structured funnel flags in help', () => {
  const packJson = execFileSync('npm', ['pack', '--json'], { cwd: resolve('.'), encoding: 'utf8' });
  const [{ filename }] = JSON.parse(packJson);

  try {
    const output = execFileSync('npx', ['--yes', `./${filename}`, 'funnel', '--help'], {
      cwd: resolve('.'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    assert.match(output, /--steps-json/);
    assert.match(output, /--from-context/);
    assert.match(output, /--json/);
    assert.match(output, /raw_activity/);
    assert.match(output, /strict_survivors/);
  } finally {
    rmSync(join(resolve('.'), filename), { force: true });
  }
});

test('direct funnel help is available before auth', () => {
  const configDir = mkdtempSync(join(tmpdir(), 'aa-funnel-help-'));

  try {
    const output = execFileSync(process.execPath, [resolve('bin/cli.mjs'), '--config-dir', configDir, 'funnel', '--help'], {
      cwd: resolve('.'),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    assert.match(output, /--steps-json/);
    assert.match(output, /--from-context/);
    assert.match(output, /raw_activity/);
    assert.doesNotMatch(output, /Not logged in/);
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});

test('direct funnel execution still requires auth', () => {
  const configDir = mkdtempSync(join(tmpdir(), 'aa-funnel-auth-'));

  try {
    assert.throws(() => {
      execFileSync(process.execPath, [resolve('bin/cli.mjs'), '--config-dir', configDir, 'funnel', 'shop'], {
        cwd: resolve('.'),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }, (err) => {
      assert.equal(err.status, 1);
      assert.match(err.stdout, /Not logged in/);
      return true;
    });
  } finally {
    rmSync(configDir, { recursive: true, force: true });
  }
});
