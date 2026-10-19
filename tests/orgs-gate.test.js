// Lane Q / G6: organization admin gate.
// Covers public projections, superadmin CRUD, org-admin scope, membership moves,
// last-admin protection, force delete and audit rows.
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

let h;
let adminToken;
let studentToken;
let teacherToken;
let orgId;

const OTHER_ORG = 2; // seeded AGH

before(async () => {
  h = await startServer({ prefix: 'satori-orgs-' });
  adminToken = await h.loginAs('admin', 'admin123');
  studentToken = await h.loginAs('jan_kowalski', 'student123');
  teacherToken = await h.loginAs('g_herman', 'teacher123');
});
after(async () => { if (h) await h.close(); });

function orgAuditRows() {
  return h.store.query('audit', (row) => String(row.action || '').startsWith('org.'));
}

test('public organization list keeps {items}, adds memberCount, hides admins and emails', async () => {
  const r = await h.api('/api/orgs');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.items));
  assert.ok(r.body.items.length >= 3);
  for (const org of r.body.items) {
    assert.equal(typeof org.memberCount, 'number');
    assert.equal(org.admins, undefined, 'public list must not expose admins');
    assert.equal(org.email, undefined);
  }
  assert.doesNotMatch(r.text, /@[a-z0-9.-]+\.[a-z]{2,}/i, 'public org list must not expose emails');
});

test('negative: anonymous and students cannot mutate organizations', async () => {
  const anonCreate = await h.api('/api/orgs', { method: 'POST', ...h.json({ name: 'Anon Org' }) });
  assert.equal(anonCreate.status, 401);
  assert.equal(anonCreate.body.error.code, 'AUTH');

  const studentCreate = await h.api('/api/orgs', { method: 'POST', ...h.json({ name: 'Student Org' }) }, studentToken);
  assert.equal(studentCreate.status, 403);
  assert.equal(studentCreate.body.error.code, 'FORBIDDEN');

  const studentPatch = await h.api(`/api/orgs/${OTHER_ORG}`, { method: 'PATCH', ...h.json({ name: 'Nope' }) }, studentToken);
  assert.equal(studentPatch.status, 403);

  const studentDelete = await h.api(`/api/orgs/${OTHER_ORG}`, { method: 'DELETE' }, studentToken);
  assert.equal(studentDelete.status, 403);

  const studentMembers = await h.api(`/api/orgs/${OTHER_ORG}/members`, {}, studentToken);
  assert.equal(studentMembers.status, 403, 'non-manager cannot list members');
  assert.equal(studentMembers.body.error.code, 'FORBIDDEN');

  const anonMembers = await h.api(`/api/orgs/${OTHER_ORG}/members`);
  assert.equal(anonMembers.status, 401);
});

test('superadmin creates an organization with validation', async () => {
  const shortName = await h.api('/api/orgs', { method: 'POST', ...h.json({ name: 'Valid University', shortName: 'A' }) }, adminToken);
  assert.equal(shortName.status, 400);
  assert.equal(shortName.body.error.code, 'ORG_SHORT_INVALID');
  assert.equal(shortName.body.error.field, 'shortName');

  const noName = await h.api('/api/orgs', { method: 'POST', ...h.json({ name: ' ' }) }, adminToken);
  assert.equal(noName.status, 400);
  assert.equal(noName.body.error.code, 'ORG_NAME_INVALID');

  const badWebsite = await h.api('/api/orgs', { method: 'POST', ...h.json({ name: 'Bad Web University', website: 'ftp://example.org' }) }, adminToken);
  assert.equal(badWebsite.status, 400);
  assert.equal(badWebsite.body.error.code, 'ORG_WEBSITE_INVALID');

  const created = await h.api('/api/orgs', {
    method: 'POST',
    ...h.json({
      name: 'Test University',
      shortName: 'TU',
      country: 'PL',
      website: 'https://tu.example.edu',
      description: 'Created by the org gate test.',
    }),
  }, adminToken);
  assert.equal(created.status, 201);
  assert.equal(created.body.name, 'Test University');
  assert.equal(created.body.memberCount, 0);
  assert.deepEqual(created.body.admins, []);
  assert.ok(created.body.createdAt);
  assert.ok(created.body.updatedAt);

  const audit = orgAuditRows().find((row) => row.action === 'org.create' && row.target === `org:${created.body.id}`);
  assert.ok(audit, 'create must be audited');
  assert.equal(audit.actorLogin, 'admin');

  orgId = created.body.id;
});

test('organization detail exposes admins only to managers', async () => {
  const added = await h.api(`/api/orgs/${orgId}/admins`, { method: 'POST', ...h.json({ login: 'g_herman' }) }, adminToken);
  assert.equal(added.status, 200);
  assert.deepEqual(added.body.admins, ['g_herman']);

  const unknown = await h.api(`/api/orgs/${orgId}/admins`, { method: 'POST', ...h.json({ login: 'ghost_user' }) }, adminToken);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'USER_NOT_FOUND');

  const duplicate = await h.api(`/api/orgs/${orgId}/admins`, { method: 'POST', ...h.json({ login: 'g_herman' }) }, adminToken);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.unchanged, true);

  const anon = await h.api(`/api/orgs/${orgId}`);
  assert.equal(anon.status, 200);
  assert.equal(anon.body.admins, undefined, 'anonymous detail must not expose admins');
  assert.doesNotMatch(anon.text, /@[a-z0-9.-]+\.[a-z]{2,}/i);

  const student = await h.api(`/api/orgs/${orgId}`, {}, studentToken);
  assert.equal(student.body.admins, undefined, 'student detail must not expose admins');

  const manager = await h.api(`/api/orgs/${orgId}`, {}, teacherToken);
  assert.deepEqual(manager.body.admins, ['g_herman'], 'org admin sees admin logins');

  const superadmin = await h.api(`/api/orgs/${orgId}`, {}, adminToken);
  assert.deepEqual(superadmin.body.admins, ['g_herman']);
});

test('GET /api/me/orgs lists the caller organizations with superadmin flag', async () => {
  const student = await h.api('/api/me/orgs', {}, studentToken);
  assert.equal(student.status, 200);
  assert.equal(student.body.superadmin, false);
  assert.deepEqual(student.body.items, []);

  const teacher = await h.api('/api/me/orgs', {}, teacherToken);
  assert.equal(teacher.status, 200);
  assert.equal(teacher.body.superadmin, false);
  assert.deepEqual(teacher.body.items.map((o) => o.id), [orgId]);
  assert.deepEqual(teacher.body.items[0].admins, ['g_herman']);

  const admin = await h.api('/api/me/orgs', {}, adminToken);
  assert.equal(admin.status, 200);
  assert.equal(admin.body.superadmin, true);
  assert.ok(admin.body.items.length >= 3);

  const anon = await h.api('/api/me/orgs');
  assert.equal(anon.status, 401);
});

test('org admin can edit own organization but not another', async () => {
  const own = await h.api(`/api/orgs/${orgId}`, { method: 'PATCH', ...h.json({ description: 'Edited by org admin.', country: 'PL' }) }, teacherToken);
  assert.equal(own.status, 200);
  assert.equal(own.body.description, 'Edited by org admin.');
  assert.equal(own.body.name, 'Test University', 'unsent fields must be preserved');

  const invalid = await h.api(`/api/orgs/${orgId}`, { method: 'PATCH', ...h.json({ website: 'javascript:alert(1)' }) }, teacherToken);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'ORG_WEBSITE_INVALID');

  const empty = await h.api(`/api/orgs/${orgId}`, { method: 'PATCH', ...h.json({}) }, teacherToken);
  assert.equal(empty.status, 400);
  assert.equal(empty.body.error.code, 'ORG_NO_FIELDS');

  const other = await h.api(`/api/orgs/${OTHER_ORG}`, { method: 'PATCH', ...h.json({ name: 'Hijacked' }) }, teacherToken);
  assert.equal(other.status, 403);
  assert.equal(other.body.error.code, 'FORBIDDEN');

  const otherMembers = await h.api(`/api/orgs/${OTHER_ORG}/members`, {}, teacherToken);
  assert.equal(otherMembers.status, 403);

  const otherAdmins = await h.api(`/api/orgs/${OTHER_ORG}/admins`, { method: 'POST', ...h.json({ login: 'g_herman' }) }, teacherToken);
  assert.equal(otherAdmins.status, 403);

  const audit = orgAuditRows().find((row) => row.action === 'org.update' && row.target === `org:${orgId}`);
  assert.ok(audit, 'update must be audited');
});

test('member add/remove enforces unknown user, other-org and duplicate guards', async () => {
  const unknown = await h.api(`/api/orgs/${orgId}/members`, { method: 'POST', ...h.json({ login: 'ghost_user' }) }, teacherToken);
  assert.equal(unknown.status, 404);
  assert.equal(unknown.body.error.code, 'USER_NOT_FOUND');

  const otherOrg = await h.api(`/api/orgs/${orgId}/members`, { method: 'POST', ...h.json({ login: 'jan_kowalski' }) }, teacherToken);
  assert.equal(otherOrg.status, 409);
  assert.equal(otherOrg.body.error.code, 'MEMBER_OTHER_ORG');

  const moved = await h.api(`/api/orgs/${orgId}/members`, { method: 'POST', ...h.json({ login: 'jan_kowalski', move: true }) }, teacherToken);
  assert.equal(moved.status, 200);
  assert.equal(moved.body.moved, true);

  const duplicate = await h.api(`/api/orgs/${orgId}/members`, { method: 'POST', ...h.json({ login: 'jan_kowalski' }) }, teacherToken);
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'MEMBER_EXISTS');

  const list = await h.api(`/api/orgs/${orgId}/members`, {}, teacherToken);
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  const member = list.body.items[0];
  assert.equal(member.login, 'jan_kowalski');
  assert.equal(member.email, 'jan@uj.edu.pl');
  assert.deepEqual(member.rolesGlobal, ['student']);
  assert.equal(member.pass, undefined, 'member list must not leak password hash');
  assert.equal(member.sessions, undefined);

  const detail = await h.api(`/api/orgs/${orgId}`);
  assert.equal(detail.body.memberCount, 1);

  const unknownMember = await h.api(`/api/orgs/${orgId}/members/999999`, { method: 'DELETE' }, teacherToken);
  assert.equal(unknownMember.status, 404);
  assert.equal(unknownMember.body.error.code, 'USER_NOT_FOUND');

  const studentRemove = await h.api(`/api/orgs/${orgId}/members/${member.id}`, { method: 'DELETE' }, studentToken);
  assert.equal(studentRemove.status, 403);

  const otherRemove = await h.api(`/api/orgs/${OTHER_ORG}/members/${member.id}`, { method: 'DELETE' }, teacherToken);
  assert.equal(otherRemove.status, 403);

  const removed = await h.api(`/api/orgs/${orgId}/members/${member.id}`, { method: 'DELETE' }, teacherToken);
  assert.equal(removed.status, 200);
  assert.equal(removed.body.removed, true);

  const emptyList = await h.api(`/api/orgs/${orgId}/members`, {}, teacherToken);
  assert.equal(emptyList.body.items.length, 0);

  const readded = await h.api(`/api/orgs/${orgId}/members`, { method: 'POST', ...h.json({ login: 'jan_kowalski' }) }, teacherToken);
  assert.equal(readded.status, 200);
  assert.equal(readded.body.moved, false);

  const audit = orgAuditRows().find((row) => row.action === 'org.member.add' && row.target === `org:${orgId}`);
  assert.ok(audit, 'member add must be audited');
  assert.equal(audit.meta.movedFrom, 1);

  const auditRemove = orgAuditRows().find((row) => row.action === 'org.member.remove' && row.target === `org:${orgId}`);
  assert.ok(auditRemove, 'member removal must be audited');
});

test('last organization admin cannot be removed by an org admin', async () => {
  const last = await h.api(`/api/orgs/${orgId}/admins`, { method: 'POST', ...h.json({ login: 'g_herman', remove: true }) }, teacherToken);
  assert.equal(last.status, 403);
  assert.equal(last.body.error.code, 'LAST_ORG_ADMIN');

  const notAdmin = await h.api(`/api/orgs/${orgId}/admins`, { method: 'POST', ...h.json({ login: 'jan_kowalski', remove: true }) }, adminToken);
  assert.equal(notAdmin.status, 404);
  assert.equal(notAdmin.body.error.code, 'ADMIN_NOT_FOUND');

  const removed = await h.api(`/api/orgs/${orgId}/admins`, { method: 'POST', ...h.json({ login: 'g_herman', remove: true }) }, adminToken);
  assert.equal(removed.status, 200);
  assert.deepEqual(removed.body.admins, []);

  const audit = orgAuditRows().find((row) => row.action === 'org.admin.remove' && row.target === `org:${orgId}`);
  assert.ok(audit, 'admin removal must be audited');
});

test('delete refuses members without force and detaches them with force', async () => {
  const unknownOrg = await h.api('/api/orgs/999999', {}, adminToken);
  assert.equal(unknownOrg.status, 404);
  assert.equal(unknownOrg.body.error.code, 'ORG_NOT_FOUND');

  const anonDelete = await h.api(`/api/orgs/${orgId}`, { method: 'DELETE' });
  assert.equal(anonDelete.status, 401);

  const studentDelete = await h.api(`/api/orgs/${orgId}`, { method: 'DELETE' }, studentToken);
  assert.equal(studentDelete.status, 403);

  const orgAdminDelete = await h.api(`/api/orgs/${orgId}`, { method: 'DELETE' }, teacherToken);
  assert.equal(orgAdminDelete.status, 403, 'org admin cannot delete an organization');

  const guarded = await h.api(`/api/orgs/${orgId}`, { method: 'DELETE' }, adminToken);
  assert.equal(guarded.status, 409);
  assert.equal(guarded.body.error.code, 'ORG_HAS_MEMBERS');

  const forced = await h.api(`/api/orgs/${orgId}?force=true`, { method: 'DELETE' }, adminToken);
  assert.equal(forced.status, 200);
  assert.equal(forced.body.detached, 1);

  const gone = await h.api(`/api/orgs/${orgId}`, {}, adminToken);
  assert.equal(gone.status, 404);

  const member = await h.api(`/api/orgs/${orgId}/members`, {}, teacherToken);
  assert.equal(member.status, 404);

  assert.equal(h.store.get('users', 3).affiliationOrgId, null, 'forced delete detaches members');
});

test('organization mutations leave audit rows with actor login', async () => {
  const actions = new Set(orgAuditRows().map((row) => row.action));
  for (const action of ['org.create', 'org.update', 'org.member.add', 'org.admin.add', 'org.admin.remove', 'org.delete']) {
    assert.ok(actions.has(action), `missing audit action ${action}`);
  }
  const rows = orgAuditRows();
  assert.ok(rows.length >= 6);
  for (const row of rows) {
    assert.ok(row.actorId != null);
    assert.ok(row.actorLogin);
    assert.ok(row.at);
    assert.ok(row.target);
  }
});
