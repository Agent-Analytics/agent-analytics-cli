export const DEFAULT_AGENT_SESSION_SCOPES = Object.freeze([
  'account:read',
  'projects:read',
  'projects:write',
  'analytics:read',
  'experiments:write',
  'replays:read',
  'replays:write',
  'feedback:write',
  'live:read',
]);

export const ACCESS_LEVELS = Object.freeze(['read', 'manage', 'admin']);
export const DEFAULT_ACCESS_LEVEL = 'read';

const READ_SCOPES = Object.freeze([
  'account:read',
  'projects:read',
  'analytics:read',
  'experiments:read',
  'live:read',
  'replays:read',
]);

const MANAGE_SCOPES = Object.freeze([
  ...READ_SCOPES,
  'projects:write',
  'experiments:write',
  'feedback:write',
  'replays:write',
  'erasures:write',
]);

const SCOPES_BY_LEVEL = Object.freeze({
  read: READ_SCOPES,
  manage: MANAGE_SCOPES,
  // Older servers have no admin scope. Account actions such as creating a
  // project are enforced by level on current servers. admin still sends the
  // manage list so an older server can erase and write.
  admin: MANAGE_SCOPES,
});

export function normalizeAccessLevel(level) {
  if (level == null || String(level).trim() === '') return DEFAULT_ACCESS_LEVEL;
  const value = String(level).trim().toLowerCase();
  if (!ACCESS_LEVELS.includes(value)) {
    const error = new Error('--level must be read, manage, or admin.');
    error.code = 'INVALID_ACCESS_LEVEL';
    throw error;
  }
  return value;
}

export function scopesForLevel(level = DEFAULT_ACCESS_LEVEL) {
  return SCOPES_BY_LEVEL[normalizeAccessLevel(level)];
}

function grantScopes(session) {
  if (!Array.isArray(session?.scopes)) return [];
  return session.scopes
    .filter((scope) => typeof scope === 'string' && scope.trim())
    .map((scope) => scope.trim());
}

export function sessionGrant(session = {}) {
  const rawLevel = typeof session?.level === 'string' ? session.level.trim().toLowerCase() : '';
  const level = rawLevel === 'read' || rawLevel === 'manage' || rawLevel === 'admin' || rawLevel === 'legacy' || rawLevel === 'custom'
    ? rawLevel
    : 'legacy';
  const projectName = typeof session?.project === 'string' && session.project.trim()
    ? session.project.trim()
    : null;
  return {
    level,
    project: projectName || 'all',
    projectName,
    scopes: grantScopes(session),
  };
}

export function mergeSessionGrant(session = {}, envelope = {}) {
  const next = { ...(session || {}) };
  if (next.level == null && envelope?.level != null) next.level = envelope.level;
  if (!Object.prototype.hasOwnProperty.call(next, 'project')
    && envelope
    && Object.prototype.hasOwnProperty.call(envelope, 'project')) {
    next.project = envelope.project;
  }
  if (!Array.isArray(next.scopes) && Array.isArray(envelope?.scopes)) next.scopes = envelope.scopes;
  return next;
}

export function sessionCanCreateProject(session = {}) {
  const grant = sessionGrant(session);
  // legacy has no level column. custom is an exact scope list with no level.
  // Neither tells the CLI whether create is allowed, so the server decides.
  if (grant.level === 'legacy' || grant.level === 'custom') return null;
  return grant.level === 'admin' && !grant.projectName;
}
