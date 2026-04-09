import { DEFAULT_AGENT_SESSION_SCOPES } from './scopes.mjs';

export async function startPaperclipAuth(api, {
  workspaceId,
  label = '📎Paperclip Workspace',
  clientName = 'Paperclip',
} = {}) {
  return api.startAgentSession({
    mode: 'detached',
    client_type: 'paperclip',
    client_name: clientName,
    client_instance_id: workspaceId || null,
    label,
    scopes: DEFAULT_AGENT_SESSION_SCOPES,
    metadata: {
      platform: 'paperclip',
      workspace_id: workspaceId || null,
    },
  });
}

export async function startOpenClawAuth(api, {
  runtimeId,
  label = 'OpenClaw Runtime',
  clientName = 'OpenClaw',
} = {}) {
  return api.startAgentSession({
    mode: 'detached',
    client_type: 'openclaw',
    client_name: clientName,
    client_instance_id: runtimeId || null,
    label,
    scopes: DEFAULT_AGENT_SESSION_SCOPES,
    metadata: {
      platform: 'openclaw',
      runtime_id: runtimeId || null,
    },
  });
}

export async function completeManagedRuntimeAuth(api, {
  authRequestId,
  exchangeCode,
}) {
  return api.exchangeAgentSession(authRequestId, exchangeCode);
}
