// Satori V2 — health, capabilities, discovery, and legacy compatibility routes.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { store } = require('../lib/store');
const judgeQueue = require('../lib/judgeQueue');
const emailQueue = require('../lib/emailQueue');
const J = require('../../../../packages/judge/src/judge');
const { send, sendText, readBody } = require('../lib/http');
const { authUser, audit, canReadContest, canManageContest } = require('../lib/authz');

// ---- organizations (G6) -----------------------------------------------------
// Canonical org fields: name, shortName, country, website, description, admins,
// createdAt, updatedAt. Unknown legacy fields (domainRegex) are preserved on write.
const ORG_NAME_MAX = 120;
const ORG_SHORT_MAX = 20;
const ORG_COUNTRY_MAX = 64;
const ORG_WEBSITE_MAX = 300;
const ORG_DESC_MAX = 4000;

function isSuperadmin(me) {
  return Boolean(me) && (me.rolesGlobal || []).includes('superadmin');
}
function isOrgAdmin(me, org) {
  if (!me || !org) return false;
  if (isSuperadmin(me)) return true;
  return (org.admins || []).map(String).includes(String(me.id));
}
function orgFail(res, status, code, message, hint, field) {
  const error = { code, message, hint };
  if (field) error.field = field;
  return send(res, status, { error });
}
function orgAuthRequired(res) {
  return orgFail(res, 401, 'AUTH', 'Login required.', 'POST /api/auth/token.');
}
function orgSuperadminOnly(res) {
  return orgFail(res, 403, 'FORBIDDEN', 'Superadmin only.', 'Ask a superadmin to create or delete organizations.');
}
function orgForbidden(res) {
  return orgFail(res, 403, 'FORBIDDEN', 'Organization admins only.', 'Ask an organization admin or a superadmin.');
}
function orgNotFound(res) {
  return orgFail(res, 404, 'ORG_NOT_FOUND', 'Organization not found.', 'Check the organization id.');
}
function orgMemberCount(orgId) {
  return store.query('users', (u) => String(u.affiliationOrgId) === String(orgId)).length;
}
function orgAdminLogins(org) {
  return (org.admins || [])
    .map((id) => store.get('users', id))
    .filter(Boolean)
    .map((u) => u.login);
}
function publicOrg(org, opts = {}) {
  const out = {
    id: org.id,
    name: org.name || '',
    shortName: org.shortName || '',
    country: org.country || '',
    website: org.website || '',
    description: org.description || '',
    domainRegex: org.domainRegex || '',
    createdAt: org.createdAt || null,
    updatedAt: org.updatedAt || null,
    memberCount: orgMemberCount(org.id),
  };
  if (opts.managers) out.admins = orgAdminLogins(org);
  return out;
}
function orgText(value) {
  if (value == null) return '';
  return String(value).trim();
}
function orgValidationError(code, message, hint, field) {
  return { error: { code, message, hint, field } };
}
// partial=false (create) requires name; partial=true (patch) validates only sent keys.
function validateOrgFields(body, { partial = false } = {}) {
  const b = body && typeof body === 'object' ? body : {};
  const patch = {};

  if (!partial || b.name !== undefined) {
    const name = orgText(b.name);
    if (name.length < 2 || name.length > ORG_NAME_MAX) {
      return orgValidationError('ORG_NAME_INVALID', `Organization name must be 2-${ORG_NAME_MAX} characters.`, 'Use the full organization name, e.g. "Jagiellonian University".', 'name');
    }
    patch.name = name;
  }

  if (!partial || b.shortName !== undefined) {
    const shortName = orgText(b.shortName);
    if (shortName && (shortName.length < 2 || shortName.length > ORG_SHORT_MAX)) {
      return orgValidationError('ORG_SHORT_INVALID', `Short name must be 2-${ORG_SHORT_MAX} characters, or empty.`, 'Use a short label, e.g. "UJ".', 'shortName');
    }
    patch.shortName = shortName;
  }

  if (!partial || b.country !== undefined) {
    const country = orgText(b.country);
    if (country.length > ORG_COUNTRY_MAX) {
      return orgValidationError('ORG_COUNTRY_INVALID', `Country must be at most ${ORG_COUNTRY_MAX} characters.`, 'Use a country name or ISO code.', 'country');
    }
    patch.country = country;
  }

  if (!partial || b.website !== undefined) {
    const website = orgText(b.website);
    if (website.length > ORG_WEBSITE_MAX) {
      return orgValidationError('ORG_WEBSITE_INVALID', `Website must be at most ${ORG_WEBSITE_MAX} characters.`, 'Use an http(s) URL or leave it empty.', 'website');
    }
    if (website) {
      let parsed;
      try { parsed = new URL(website); } catch {
        return orgValidationError('ORG_WEBSITE_INVALID', 'Website must be a valid http(s) URL.', 'Example: https://www.uj.edu.pl.', 'website');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return orgValidationError('ORG_WEBSITE_INVALID', 'Website must use http or https.', 'Example: https://www.uj.edu.pl.', 'website');
      }
    }
    patch.website = website;
  }

  if (!partial || b.description !== undefined) {
    const description = orgText(b.description);
    if (description.length > ORG_DESC_MAX) {
      return orgValidationError('ORG_DESC_INVALID', `Description must be at most ${ORG_DESC_MAX} characters.`, 'Shorten the description.', 'description');
    }
    patch.description = description;
  }

  return { patch };
}

async function handleOrgs(req, res, url, p, m) {
  if (p === '/api/orgs' && m === 'GET') {
    const items = store.all('organizations').map((org) => publicOrg(org));
    return send(res, 200, { items });
  }

  if (p === '/api/orgs' && m === 'POST') {
    const me = authUser(req);
    if (!me) return orgAuthRequired(res);
    if (!isSuperadmin(me)) return orgSuperadminOnly(res);
    const body = await readBody(req);
    const checked = validateOrgFields(body);
    if (checked.error) return send(res, 400, { error: checked.error });
    const now = new Date().toISOString();
    const org = store.insert('organizations', { ...checked.patch, admins: [], createdAt: now, updatedAt: now });
    audit(me.id, 'org.create', `org:${org.id}`, { name: org.name });
    return send(res, 201, publicOrg(org, { managers: true }));
  }

  if (p === '/api/me/orgs' && m === 'GET') {
    const me = authUser(req);
    if (!me) return orgAuthRequired(res);
    const superadmin = isSuperadmin(me);
    const items = store.all('organizations').filter((org) => superadmin || isOrgAdmin(me, org));
    return send(res, 200, { superadmin, items: items.map((org) => publicOrg(org, { managers: true })) });
  }

  let mt = p.match(/^\/api\/orgs\/([^/]+)\/members\/([^/]+)$/);
  if (mt && m === 'DELETE') {
    const me = authUser(req);
    if (!me) return orgAuthRequired(res);
    const org = store.get('organizations', mt[1]);
    if (!org) return orgNotFound(res);
    if (!isOrgAdmin(me, org)) return orgForbidden(res);
    const target = store.get('users', mt[2]);
    if (!target) return orgFail(res, 404, 'USER_NOT_FOUND', 'User not found.', 'Check the user id.');
    if (String(target.affiliationOrgId) !== String(org.id)) {
      return orgFail(res, 404, 'MEMBER_NOT_FOUND', 'User is not a member of this organization.', 'Refresh the member list.');
    }
    store.update('users', target.id, { affiliationOrgId: null });
    audit(me.id, 'org.member.remove', `org:${org.id}`, { userId: target.id, login: target.login });
    return send(res, 200, { ok: true, removed: true });
  }

  mt = p.match(/^\/api\/orgs\/([^/]+)\/members$/);
  if (mt && m === 'GET') {
    const me = authUser(req);
    if (!me) return orgAuthRequired(res);
    const org = store.get('organizations', mt[1]);
    if (!org) return orgNotFound(res);
    if (!isOrgAdmin(me, org)) return orgForbidden(res);
    const items = store.query('users', (u) => String(u.affiliationOrgId) === String(org.id))
      .map((u) => ({ id: u.id, login: u.login, firstName: u.firstName || '', lastName: u.lastName || '', email: u.email || '', rolesGlobal: u.rolesGlobal || [] }))
      .sort((a, b) => String(a.login).localeCompare(String(b.login)));
    return send(res, 200, { items });
  }

  if (mt && m === 'POST') {
    const me = authUser(req);
    if (!me) return orgAuthRequired(res);
    const org = store.get('organizations', mt[1]);
    if (!org) return orgNotFound(res);
    if (!isOrgAdmin(me, org)) return orgForbidden(res);
    const body = await readBody(req);
    const login = orgText(body.login).toLowerCase();
    if (!login) return orgFail(res, 400, 'LOGIN_REQUIRED', 'Login required.', 'Provide the user login, e.g. jan_kowalski.', 'login');
    const target = store.all('users').find((u) => String(u.login) === login);
    if (!target) return orgFail(res, 404, 'USER_NOT_FOUND', `User "${login}" not found.`, 'Check the login or register the user first.', 'login');
    if (String(target.affiliationOrgId) === String(org.id)) {
      return orgFail(res, 409, 'MEMBER_EXISTS', 'User already belongs to this organization.', 'No change needed.');
    }
    const previousOrgId = target.affiliationOrgId == null ? null : target.affiliationOrgId;
    const move = body.move === true || body.move === 'true';
    if (previousOrgId != null && String(previousOrgId) !== '' && !move) {
      return orgFail(res, 409, 'MEMBER_OTHER_ORG', 'User already belongs to another organization.', 'Send move:true to move the user.', 'login');
    }
    store.update('users', target.id, { affiliationOrgId: org.id });
    audit(me.id, 'org.member.add', `org:${org.id}`, { userId: target.id, login: target.login, movedFrom: previousOrgId });
    return send(res, 200, { ok: true, member: { id: target.id, login: target.login }, moved: previousOrgId != null });
  }

  mt = p.match(/^\/api\/orgs\/([^/]+)\/admins$/);
  if (mt && m === 'POST') {
    const me = authUser(req);
    if (!me) return orgAuthRequired(res);
    const org = store.get('organizations', mt[1]);
    if (!org) return orgNotFound(res);
    if (!isOrgAdmin(me, org)) return orgForbidden(res);
    const body = await readBody(req);
    const login = orgText(body.login).toLowerCase();
    if (!login) return orgFail(res, 400, 'LOGIN_REQUIRED', 'Login required.', 'Provide the user login, e.g. g_herman.', 'login');
    const target = store.all('users').find((u) => String(u.login) === login);
    if (!target) return orgFail(res, 404, 'USER_NOT_FOUND', `User "${login}" not found.`, 'Check the login or register the user first.', 'login');
    const current = (org.admins || []).map(String);
    const remove = body.remove === true || body.remove === 'true';

    if (!remove) {
      if (current.includes(String(target.id))) return send(res, 200, { ok: true, admins: orgAdminLogins(org), unchanged: true });
      const admins = [...(org.admins || []), target.id];
      const updated = store.update('organizations', org.id, { admins, updatedAt: new Date().toISOString() });
      audit(me.id, 'org.admin.add', `org:${org.id}`, { userId: target.id, login: target.login });
      return send(res, 200, { ok: true, admins: orgAdminLogins(updated) });
    }

    if (!current.includes(String(target.id))) {
      return orgFail(res, 404, 'ADMIN_NOT_FOUND', 'User is not an organization admin.', 'Refresh the admin list.');
    }
    if (current.length <= 1 && !isSuperadmin(me)) {
      return orgFail(res, 403, 'LAST_ORG_ADMIN', 'Cannot remove the last organization admin.', 'Add another admin first, or ask a superadmin.');
    }
    const admins = (org.admins || []).filter((id) => String(id) !== String(target.id));
    const updated = store.update('organizations', org.id, { admins, updatedAt: new Date().toISOString() });
    audit(me.id, 'org.admin.remove', `org:${org.id}`, { userId: target.id, login: target.login });
    return send(res, 200, { ok: true, admins: orgAdminLogins(updated) });
  }

  mt = p.match(/^\/api\/orgs\/([^/]+)$/);
  if (mt && m === 'GET') {
    const org = store.get('organizations', mt[1]);
    if (!org) return orgNotFound(res);
    const me = authUser(req);
    return send(res, 200, publicOrg(org, { managers: isOrgAdmin(me, org) }));
  }

  if (mt && m === 'PATCH') {
    const me = authUser(req);
    if (!me) return orgAuthRequired(res);
    const org = store.get('organizations', mt[1]);
    if (!org) return orgNotFound(res);
    if (!isOrgAdmin(me, org)) return orgForbidden(res);
    const body = await readBody(req);
    const checked = validateOrgFields(body, { partial: true });
    if (checked.error) return send(res, 400, { error: checked.error });
    if (Object.keys(checked.patch).length === 0) {
      return orgFail(res, 400, 'ORG_NO_FIELDS', 'No organization fields to update.', 'Send name, shortName, country, website or description.');
    }
    const updated = store.update('organizations', org.id, { ...checked.patch, updatedAt: new Date().toISOString() });
    audit(me.id, 'org.update', `org:${org.id}`, { fields: Object.keys(checked.patch) });
    return send(res, 200, publicOrg(updated, { managers: true }));
  }

  if (mt && m === 'DELETE') {
    const me = authUser(req);
    if (!me) return orgAuthRequired(res);
    if (!isSuperadmin(me)) return orgSuperadminOnly(res);
    const org = store.get('organizations', mt[1]);
    if (!org) return orgNotFound(res);
    const body = await readBody(req);
    const force = body.force === true || body.force === 'true' || url.searchParams.get('force') === 'true';
    const members = orgMemberCount(org.id);
    if (members > 0 && !force) {
      return orgFail(res, 409, 'ORG_HAS_MEMBERS', `Organization still has ${members} member(s).`, 'Move or detach members first, or repeat with force:true.');
    }
    if (members > 0) {
      const users = store.all('users');
      for (const user of users) {
        if (String(user.affiliationOrgId) === String(org.id)) user.affiliationOrgId = null;
      }
      store.replaceAll('users', users);
    }
    store.remove('organizations', org.id);
    audit(me.id, 'org.delete', `org:${org.id}`, { force, detached: members });
    return send(res, 200, { ok: true, deleted: true, detached: members });
  }

  return false;
}

function openapi() {
  return {
    openapi: '3.1.0',
    info: { title: 'Satori V2 API', version: '2.0.0' },
    paths: {
      '/api/auth/token': { post: { summary: 'Login, get JWT+refresh' } },
      '/api/contests': { get: { summary: 'List ?role=joined|pending|managed&q&archived' } },
      '/api/contests/{id}/problems': { get: { summary: 'Problem cockpit + inline verdict chips' } },
      '/api/submits': { post: { summary: 'Submit paste|file|gist (multipart|json)' }, get: { summary: 'Results table ?contest&problem&verdict&me&limit' } },
      '/api/submits/{id}/events': { get: { summary: 'SSE live queued→compiling→testing→judged' } },
      '/api/contests/{id}/rankings/live': { get: { summary: 'WS/SSE live scoreboard + freeze' } },
    },
  };
}

async function handle(req, res, url, p, m) {
  const u = url;
  // health / meta
  if (p === '/api/health' && m === 'GET') return send(res, 200, { ok: true, time: new Date().toISOString(), queue: judgeQueue.queueSize() });
  if (p === '/api/status' && m === 'GET') {
    const avail = J.languageAvailability();
    const queue = judgeQueue.queueSize();
    return send(res, 200, {
      queue,
      etaSec: queue * 4,
      etaNote: 'estimate from queue depth; one persistent worker thread judges serially',
      workers: ['worker_thread'],
      persistentQueue: true,
      local: true,
      languages: Object.entries(avail).filter(([, v]) => v).map(([k]) => k),
      missingToolchains: Object.entries(avail).filter(([, v]) => !v).map(([k]) => k),
      maintenance: null,
      sandbox: 'interim local runner — memory limits not enforced yet (docs/JUDGE_SANDBOX.md)',
    });
  }
  if (p === '/api/languages' && m === 'GET') {
    const avail = J.languageAvailability();
    return send(res, 200, { matrix: J.LANGUAGE_MATRIX.map((x) => ({ ...x, available: Boolean(avail[x.lang]) })) });
  }
  if (p === '/api/openapi.json' && m === 'GET') {
    try {
      const fs = require('node:fs');
      const f = path.join(__dirname, '..', '..', '..', '..', 'openapi.json');
      if (fs.existsSync(f)) return sendText(res, 200, fs.readFileSync(f, 'utf8'), 'application/json; charset=utf-8');
    } catch { /* fallthrough */ }
    return send(res, 200, openapi());
  }
  if (p === '/api/openapi.yaml' && m === 'GET') {
    try {
      const fs = require('node:fs');
      const f = path.join(__dirname, '..', '..', '..', '..', 'openapi.yaml');
      if (fs.existsSync(f)) return sendText(res, 200, fs.readFileSync(f, 'utf8'), 'text/yaml; charset=utf-8');
    } catch { /* fallthrough */ }
    return send(res, 200, openapi());
  }
  if (p === '/api/orgs' || p.startsWith('/api/orgs/') || p === '/api/me/orgs') return handleOrgs(req, res, u, p, m);

  if (p === '/api/admin/emails' && m === 'GET') {
    const me = authUser(req);
    if (!me) return send(res, 401, { error: { code: 'AUTH', message: 'Login required.' } });
    if (!isSuperadmin(me)) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Superadmin only.' } });
    const stats = emailQueue.emailQueueStats();
    const items = store.all('emails').slice(-100).reverse();
    return send(res, 200, { stats, items });
  }

  if (p === '/api/admin/emails/flush' && m === 'POST') {
    const me = authUser(req);
    if (!me) return send(res, 401, { error: { code: 'AUTH', message: 'Login required.' } });
    if (!isSuperadmin(me)) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Superadmin only.' } });
    const result = await emailQueue.flushEmailQueue();
    audit(me.id, 'admin.emails.flush', 'emails', result);
    return send(res, 200, result);
  }

  const emailRetryMt = p.match(/^\/api\/admin\/emails\/([^/]+)\/retry$/);
  if (emailRetryMt && m === 'POST') {
    const me = authUser(req);
    if (!me) return send(res, 401, { error: { code: 'AUTH', message: 'Login required.' } });
    if (!isSuperadmin(me)) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Superadmin only.' } });
    const updated = emailQueue.retryEmail(emailRetryMt[1]);
    if (!updated) return send(res, 404, { error: { code: 'EMAIL_NOT_FOUND', message: 'Queued email not found.' } });
    audit(me.id, 'admin.emails.retry', `email:${emailRetryMt[1]}`, {});
    return send(res, 200, { ok: true, email: updated });
  }

  if (p === '/api/search' && m === 'GET') {
    const q = (u.searchParams.get('q') || '').toLowerCase();
    if (!q) return send(res, 200, { contests: [], problems: [], users: [], announcements: [] });
    const me = authUser(req);
    const now = Date.now();
    const contests = store.all('contests').filter((c) => {
      if (!canReadContest(c, me)) return false;
      if (c.lifecycle === 'draft' && !canManageContest(me, c)) return false;
      return `${c.name || ''} ${c.description || ''}`.toLowerCase().includes(q);
    }).slice(0, 20);
    const announcementContest = new Map(contests.map((c) => [String(c.id), c]));
    const announcements = store.all('news')
      .filter((n) => {
        const at = Date.parse(n.scheduledAt || '');
        if (Number.isFinite(at) && at > now) return false;
        const c = n.contestId != null ? (announcementContest.get(String(n.contestId)) || store.get('contests', n.contestId)) : null;
        if (c && !canReadContest(c, me)) return false;
        return `${n.title || ''} ${n.bodyMd || n.bodyHtml || ''}`.toLowerCase().includes(q);
      })
      .map((n) => ({ id: n.id, contestId: n.contestId, title: n.title || '' }))
      .slice(0, 20);
    const problems = store.all('problems').filter((x) => {
      const c = x.contestId != null ? store.get('contests', x.contestId) : null;
      if ((x.visibility || 'visible') !== 'visible' && !canManageContest(me, c)) return false;
      if (c && !canReadContest(c, me)) return false;
      return String(x.name || '').toLowerCase().includes(q) || String(x.code || '').toLowerCase().includes(q);
    }).slice(0, 20);
    return send(res, 200, {
      contests,
      problems,
      users: store.all('users').filter((x) => x.login.includes(q)).map((x) => ({ id: x.id, login: x.login })).slice(0, 20),
      announcements,
    });
  }


  let mt;
  // V1 compat redirects (protect CLI-in-source comments: keep /contest/<id>/problems/<pid>)
  mt = p.match(/^\/contest\/(\d+)\/?$/);
  if (mt && m === 'GET') return send(res, 200, { v1: p, v2: `/api/contests/${mt[1]}`, redirect: `/contests/${mt[1]}` });
  mt = p.match(/^\/contest\/(\d+)\/problems(?:\/(\d+))?$/);
  if (mt && m === 'GET') {
    if (mt[2]) {
      const pr = store.get('problems', mt[2]);
      return send(res, 200, { v1: p, v2: `/api/problems/${mt[2]}`, problem: pr });
    }
    return send(res, 302, { v1: p, v2: `/api/contests/${mt[1]}/problems` });
  }
  mt = p.match(/^\/contest\/(\d+)\/ranking\/(\d+)$/);
  if (mt && m === 'GET') return send(res, 200, { v1: p, v2: `/api/contests/${mt[1]}/ranking` });
  mt = p.match(/^\/contest\/(\d+)\/results$/);
  if (mt && m === 'GET') return send(res, 200, { v1: p, v2: `/api/submits?contest=${mt[1]}` });
  mt = p.match(/^\/subpage\/(\d+)$/);
  if (mt && m === 'GET') {
    const sp = store.get('subpages', mt[1]);
    return send(res, 200, { v1: p, subpage: sp });
  }
  if (p === '/demo' && m === 'GET') {
    try {
      const fs = require('node:fs');
      const f = path.join(__dirname, '..', 'demo.html');
      return sendText(res, 200, fs.readFileSync(f, 'utf8'));
    } catch { return send(res, 500, { error: { code: 'DEMO', message: 'demo.html missing.', hint: '' } }); }
  }
  if ((p === '/' || p === '/api') && m === 'GET') {
    return sendText(res, 200, `<h1>Satori V2 API</h1><ul><li><a href="/demo">Demo UI (no install)</a></li><li><a href="/api/openapi.json">OpenAPI</a></li><li><a href="/api/health">health</a></li><li><a href="/api/languages">languages</a></li><li><a href="/api/status">status</a></li></ul>`);
  }
  return false;
}

module.exports = { handle, openapi };
