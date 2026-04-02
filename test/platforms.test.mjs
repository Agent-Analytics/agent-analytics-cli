import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { completeManagedRuntimeAuth, startOpenClawAuth, startPaperclipAuth } from '../lib/platforms.mjs';

describe('managed runtime adapters', () => {
  it('starts a Paperclip detached auth request with platform metadata', async () => {
    let payload = null;
    const api = {
      async startAgentSession(body) {
        payload = body;
        return { auth_request_id: 'req-paperclip' };
      },
    };

    await startPaperclipAuth(api, { workspaceId: 'workspace-1' });
    assert.deepEqual(payload.metadata, {
      platform: 'paperclip',
      workspace_id: 'workspace-1',
    });
    assert.equal(payload.client_type, 'paperclip');
    assert.equal(payload.mode, 'detached');
  });

  it('starts an OpenClaw detached auth request with platform metadata', async () => {
    let payload = null;
    const api = {
      async startAgentSession(body) {
        payload = body;
        return { auth_request_id: 'req-openclaw' };
      },
    };

    await startOpenClawAuth(api, { runtimeId: 'runtime-99' });
    assert.deepEqual(payload.metadata, {
      platform: 'openclaw',
      runtime_id: 'runtime-99',
    });
    assert.equal(payload.client_type, 'openclaw');
  });

  it('completes a managed runtime exchange through the generic contract', async () => {
    let received = null;
    const api = {
      async exchangeAgentSession(authRequestId, exchangeCode) {
        received = { authRequestId, exchangeCode };
        return { ok: true };
      },
    };

    await completeManagedRuntimeAuth(api, {
      authRequestId: 'req-1',
      exchangeCode: 'aae_123',
    });

    assert.deepEqual(received, {
      authRequestId: 'req-1',
      exchangeCode: 'aae_123',
    });
  });
});
