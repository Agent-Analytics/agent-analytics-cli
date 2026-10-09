import { it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createAgentSessionConfig } from './auth-test-helpers.mjs';

const run = promisify(execFile);
const cli = new URL('../bin/cli.mjs', import.meta.url).pathname;

async function withUsage(data, task) {
  const requests = [];
  const server = createServer((req, res) => {
    requests.push({ method: req.method, path: req.url, auth: req.headers.authorization });
    res.writeHead(['/account/usage', '/account'].includes(req.url) ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const config = createAgentSessionConfig('aas_test');
  try {
    await task(async args => run('node', [cli, ...args], {
      env: { ...process.env, ...config.env, AGENT_ANALYTICS_API_KEY: '', AGENT_ANALYTICS_CREDENTIAL_PLATFORM: 'linux', AGENT_ANALYTICS_URL: `http://127.0.0.1:${server.address().port}` },
    }), requests);
  } finally {
    await new Promise(resolve => server.close(resolve));
    config.cleanup();
  }
}

it('prints a single structured payment handoff and preserves account-bound authority', async () => {
  const data = {
    tier: 'free',
    payment: { state: 'upgrade_available', agent_can_charge: false, pricing: { events_per_unit: 10000, unit_price_cents: 100 }, next_action: { url: 'https://app.test/account/billing/agent-upgrade?account=acct-test', reason: 'Needs Pro' } },
  };
  await withUsage(data, async (invoke, requests) => {
    const { stdout } = await invoke(['upgrade-link', '--detached', '--json', '--reason', 'Need funnels', '--command', 'funnel site']);
    const result = JSON.parse(stdout);
    assert.equal(result.payment.agent_can_charge, false);
    assert.deepEqual(result.payment.pricing, data.payment.pricing);
    const url = new URL(result.payment.next_action.url);
    assert.equal(url.searchParams.get('account'), 'acct-test');
    assert.equal(url.searchParams.get('reason'), 'The requested analytics task needs Pro.');
    assert.equal(url.searchParams.has('command'), false);
    assert.deepEqual(requests, [{ method: 'GET', path: '/account/usage', auth: 'Bearer aas_test' }]);
  });
});

it('keeps private commands and custom reasons out of both browser handoff formats', async () => {
  const data = { id: 'acct-test', tier: 'free', payment: { state: 'upgrade_available', next_action: { url: 'https://app.test/account/billing/agent-upgrade?account=acct-test' } } };
  const privateCommand = 'query site --email synthetic-customer@example.invalid --filter SYNTHETIC_PRIVATE_VALUE --token aas_synthetic_secret';
  const privateReason = 'Investigate synthetic-customer@example.invalid with SYNTHETIC_PRIVATE_VALUE';
  await withUsage(data, async invoke => {
    for (const format of [[], ['--json']]) {
      const { stdout } = await invoke(['upgrade-link', '--detached', ...format, '--reason', privateReason, '--command', privateCommand]);
      const decoded = decodeURIComponent(stdout);
      for (const sensitiveValue of ['synthetic-customer@example.invalid', 'SYNTHETIC_PRIVATE_VALUE', 'aas_synthetic_secret']) {
        assert.ok(!decoded.includes(sensitiveValue));
      }
      const link = format.length ? JSON.parse(stdout).payment.next_action.url : stdout.match(/https:\/\/[^\s\x1b]+/)[0];
      assert.equal(new URL(link).searchParams.has('command'), false);
    }
  });
});

it('returns hosted activation status without creating checkout or inventing another handoff', async () => {
  for (const state of ['active', 'checkout_pending', 'setup_required']) {
    const data = { tier: state === 'active' ? 'pro' : 'free', payment: { state, next_action: null } };
    await withUsage(data, async (invoke, requests) => {
      const { stdout } = await invoke(['upgrade-link', '--detached', '--json']);
      assert.deepEqual(JSON.parse(stdout), data);
      assert.equal(requests.length, 1);
      assert.equal(requests[0].method, 'GET');
    });
  }
});

it('lets an agent poll account usage as JSON with no credentials in the result', async () => {
  const data = { tier: 'pro', entitlement_source: 'complimentary', usage: { estimated_bill: 0 }, payment: { state: 'active', next_action: null } };
  await withUsage(data, async invoke => {
    const { stdout } = await invoke(['account-usage', '--json']);
    assert.deepEqual(JSON.parse(stdout), data);
    assert.ok(!stdout.includes('aas_test'));
  });
});

it('does not label complimentary Pro usage as a customer charge', async () => {
  const data = { tier: 'pro', entitlement_source: 'complimentary', usage: { estimated_bill: 0, total_events_this_month: 12000, total_reads_this_month: 3 }, payment: { state: 'active', next_action: null } };
  await withUsage(data, async invoke => {
    const { stdout } = await invoke(['account-usage']);
    assert.ok(stdout.includes('complimentary'));
    assert.ok(!stdout.includes('Estimated monthly bill'));
  });
});
