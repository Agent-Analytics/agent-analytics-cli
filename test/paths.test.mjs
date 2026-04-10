import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

test('paths command forwards bounded args and prints terminal nodes', async () => {
  let lastRequest = null;

  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    lastRequest = {
      method: req.method,
      url: req.url,
      body: chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : null,
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      project: 'my-site',
      goal_event: 'signup',
      period: { from: '2026-03-11', to: '2026-04-10' },
      bounds: { max_steps: 5, entry_limit: 10, path_limit: 5, candidate_session_cap: 5000 },
      entry_paths: [
        {
          entry_page: '/landing',
          sessions: 2,
          conversions: 1,
          conversion_rate: 0.5,
          exit_pages: [
            { exit_page: '/pricing', sessions: 1, conversions: 1, conversion_rate: 1, drop_offs: 0, drop_off_rate: 0 },
            { exit_page: '/landing', sessions: 1, conversions: 0, conversion_rate: 0, drop_offs: 1, drop_off_rate: 1 },
          ],
          tree: [
            {
              type: 'page',
              value: '/pricing',
              sessions: 1,
              conversions: 1,
              conversion_rate: 1,
              children: [
                { type: 'goal', value: 'signup', sessions: 1, conversions: 1, conversion_rate: 1, children: [] },
              ],
            },
            {
              type: 'event',
              value: 'cta_click',
              sessions: 1,
              conversions: 0,
              conversion_rate: 0,
              children: [
                { type: 'drop_off', value: '/landing', exit_page: '/landing', sessions: 1, conversions: 0, conversion_rate: 0, children: [] },
              ],
            },
          ],
        },
      ],
    }));
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();

  const child = spawn(process.execPath, [
    resolve('bin/cli.mjs'),
    'paths',
    'my-site',
    '--goal', 'signup',
    '--since', '30d',
    '--max-steps', '5',
    '--entry-limit', '10',
    '--path-limit', '5',
    '--candidate-session-cap', '5000',
  ], {
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

  const [code] = await once(child, 'close');
  server.close();

  assert.equal(code, 0, stderr);
  assert.equal(lastRequest.method, 'POST');
  assert.equal(lastRequest.url, '/paths');
  assert.deepEqual(lastRequest.body, {
    project: 'my-site',
    goal_event: 'signup',
    since: '30d',
    max_steps: 5,
    entry_limit: 10,
    path_limit: 5,
    candidate_session_cap: 5000,
  });
  assert.match(stdout, /Paths: my-site/);
  assert.match(stdout, /\/landing/);
  assert.match(stdout, /Exits:/);
  assert.match(stdout, /\/pricing/);
  assert.match(stdout, /goal:signup/);
  assert.match(stdout, /drop_off:\/landing/);
});
