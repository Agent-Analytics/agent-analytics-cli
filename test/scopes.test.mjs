import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AGENT_SESSION_SCOPES,
  normalizeAccessLevel,
  scopesForLevel,
  sessionCanCreateProject,
  sessionGrant,
} from '../lib/scopes.mjs';

describe('access levels', () => {
  it('defaults to read and rejects an unknown level', () => {
    assert.equal(normalizeAccessLevel(undefined), 'read');
    assert.equal(normalizeAccessLevel(' Manage '), 'manage');
    assert.throws(() => normalizeAccessLevel('write'), /--level must be read, manage, or admin/);
  });

  it('maps each level onto the scope list older servers understand', () => {
    const read = scopesForLevel('read');
    const manage = scopesForLevel('manage');
    assert.deepEqual(read, [
      'account:read',
      'projects:read',
      'analytics:read',
      'experiments:read',
      'live:read',
      'replays:read',
    ]);
    for (const scope of read) assert.ok(manage.includes(scope));
    for (const scope of ['projects:write', 'experiments:write', 'feedback:write', 'replays:write', 'erasures:write']) {
      assert.ok(manage.includes(scope));
      assert.equal(read.includes(scope), false);
    }
    assert.deepEqual(scopesForLevel('admin'), manage);
    for (const scope of DEFAULT_AGENT_SESSION_SCOPES) assert.ok(manage.includes(scope));
  });

  it('describes a missing level as legacy all-projects access', () => {
    assert.deepEqual(sessionGrant({}), { level: 'legacy', project: 'all', projectName: null, scopes: [] });
    assert.deepEqual(sessionGrant({ level: 'legacy', project: null }), {
      level: 'legacy',
      project: 'all',
      projectName: null,
      scopes: [],
    });
    assert.deepEqual(sessionGrant({ level: 'manage', project: ' my-site ' }), {
      level: 'manage',
      project: 'my-site',
      projectName: 'my-site',
      scopes: [],
    });
    assert.deepEqual(sessionGrant({
      level: 'custom',
      scopes: [' account:read ', 'projects:read', ''],
    }), {
      level: 'custom',
      project: 'all',
      projectName: null,
      scopes: ['account:read', 'projects:read'],
    });
  });

  it('allows project creation only for admin on all projects', () => {
    assert.equal(sessionCanCreateProject({}), null);
    assert.equal(sessionCanCreateProject({ level: 'legacy' }), null);
    assert.equal(sessionCanCreateProject({ level: 'custom', scopes: ['projects:write'] }), null);
    assert.equal(sessionCanCreateProject({ level: 'read', project: null }), false);
    assert.equal(sessionCanCreateProject({ level: 'manage', project: null }), false);
    assert.equal(sessionCanCreateProject({ level: 'admin', project: 'my-site' }), false);
    assert.equal(sessionCanCreateProject({ level: 'admin', project: null }), true);
    assert.equal(sessionCanCreateProject({ level: 'admin' }), true);
  });
});
