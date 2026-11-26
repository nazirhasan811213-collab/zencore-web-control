'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, writeFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { OWNER_EMAIL } = require('../system-owner');

test('owner alone manages admin access and sees recorded admin activity', { timeout: 20000 }, async () => {
  const root = path.resolve(__dirname, '..');
  const dir = mkdtempSync(path.join(tmpdir(), 'zc-owner-'));
  const preload = path.join(dir, 'seed.cjs');
  const base = 'http://127.0.0.1:18951';
  const ownerPassword = 'OwnerPassword2026!';
  const adminPassword = 'AdminPassword2026!';
  const clientPassword = 'ExistingClientPassword2026!';
  const clientEmail = 'member@owner.test';
  const adminEmail = 'operator@owner.test';
  writeFileSync(preload, `
    const {MemoryAuthStore}=require(${JSON.stringify(path.join(root, 'auth-store'))});
    const {hashPassword}=require(${JSON.stringify(path.join(root, 'auth-core'))});
    MemoryAuthStore.prototype.init=async function(){
      for(const account of [
        {email:${JSON.stringify(OWNER_EMAIL)},role:'admin'},
        {email:${JSON.stringify(clientEmail)},role:'client'}
      ]) await this.createUser({...account,displayName:'Seed Account',passwordHash:await hashPassword(account.role==='admin'?${JSON.stringify(ownerPassword)}:${JSON.stringify(clientPassword)})});
    };
  `);
  const child = spawn(process.execPath, ['-r', preload, '-r', './compat-v17.js', 'server-analysis.js'], {
    cwd: root,
    env: { ...process.env, PORT: '18951', NODE_ENV: 'test', DATABASE_URL: '',
      SITE_MODE: 'precision-entry', ZENCORE_AUTH_ENABLED: 'true',
      ZENCORE_AUTH_MEMORY: 'true', ZENCORE_INSECURE_COOKIE: 'true',
      ZENCORE_PUBLIC_VIEWER_ENABLED: 'false', ZENCORE_AUTOTRADE_ENABLED: 'false',
      ZENCORE_ADMIN_EMAILS: clientEmail },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const request = (route, { cookie, data, origin = base, method = data ? 'POST' : 'GET' } = {}) => fetch(base + route, {
    method, redirect: 'manual', headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(data ? { Origin: origin, 'Content-Type': 'application/json' } : {})
    },
    ...(data ? { body: JSON.stringify(data) } : {})
  });
  const login = (email, password) => request('/auth/login', { data: { email, password } });
  async function validLogin(email, password, wantRole) {
    const response = await login(email, password);
    const result = await response.json();
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.user.systemRole, wantRole);
    return response.headers.get('set-cookie').split(';')[0];
  }

  try {
    for (let i = 0; !output.includes('Auth ready') && i < 100; i++) {
      if (child.exitCode !== null) throw new Error(output);
      try {
        if ((await request('/auth/me')).status === 401) break;
      } catch (_) {}
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    const admins = '/api/admin/owner/admins';
    const activity = '/api/admin/owner/activity';
    const grant = { displayName: 'Operator', email: adminEmail, password: adminPassword, ownerPassword };

    assert.equal((await request(admins)).status, 401);
    const owner = await validLogin(OWNER_EMAIL, ownerPassword, 'owner');
    const client = await validLogin(clientEmail, clientPassword, null);
    assert.equal((await request(admins, { cookie: client })).status, 403);
    assert.equal((await request('/admin/owner', { cookie: owner })).status, 200);
    assert.equal((await request(admins, { cookie: owner, data: grant, origin: 'https://untrusted.test' })).status, 403);
    assert.equal((await request(admins, { cookie: owner, data: { ...grant, ownerPassword: 'wrong' } })).status, 401);
    assert.equal((await request(admins, { cookie: owner, data: { ...grant, email: OWNER_EMAIL } })).status, 400);
    assert.equal((await request(admins, { cookie: owner, data: { ...grant, email: clientEmail } })).status, 409);
    const created = await request(admins, { cookie: owner, data: grant });
    assert.equal(created.status, 201);
    const adminId = (await created.json()).admin.id;
    const admin = await validLogin(adminEmail, adminPassword, 'system_admin');
    assert.equal((await request('/admin/owner', { cookie: admin })).status, 302);
    assert.equal((await request(activity, { cookie: admin })).status, 403);
    assert.equal((await request(admins, { cookie: admin, data: grant })).status, 403);
    const ownerId = (await (await request('/auth/me', { cookie: owner })).json()).user.id;
    const revokeOwner = admins + '/' + ownerId + '/revoke';
    assert.equal((await request(revokeOwner, { cookie: admin, data: { ownerPassword } })).status, 403);
    assert.equal((await request(revokeOwner, { cookie: owner, data: { ownerPassword } })).status, 404);
    assert.equal((await request('/api/admin/system/registration', {
      cookie: admin, method: 'PATCH', data: { enabled: false, password: 'NeverLogThis' }
    })).status, 200);
    const globalEntry = '/api/admin/system/auto-entry';
    const patchGlobal = (cookie, paused, origin) => request(globalEntry, { cookie, method:'PATCH', data:{paused}, origin });
    assert.equal((await request(globalEntry)).status,401);
    assert.equal((await patchGlobal(client,true)).status,403);
    assert.equal((await patchGlobal(admin,true,'https://untrusted.test')).status,403);
    assert.equal((await patchGlobal(admin,'true')).status,400);
    assert.equal((await (await patchGlobal(admin,true)).json()).paused,true);
    assert.equal((await (await request(globalEntry,{cookie:owner})).json()).paused,true);
    assert.equal((await (await patchGlobal(owner,false)).json()).paused,false);
    assert.match(await (await request('/admin/system',{cookie:admin})).text(),/globalAutoEntryButton/);
    assert.match(await (await request('/admin/owner',{cookie:owner})).text(),/globalAutoEntryButton/);
    const remove = admins + '/' + adminId + '/revoke';
    assert.equal((await request(remove, { cookie: owner, data: { ownerPassword } })).status, 200);
    assert.equal((await request('/auth/me', { cookie: admin })).status, 401);
    assert.equal((await login(adminEmail, adminPassword)).status, 401);
    const restored = { ...grant, password: 'ReplacementPassword2026!' };
    assert.equal((await request(admins, { cookie: owner, data: restored })).status, 201);
    assert.equal((await request('/auth/me', { cookie: admin })).status, 401);
    await validLogin(adminEmail, restored.password, 'system_admin');
    const audit = await request(activity, { cookie: owner });
    assert.equal(audit.status, 200);
    const raw = await audit.text();
    assert.ok(![ownerPassword, adminPassword, 'NeverLogThis'].some(password => raw.includes(password)));
    const { events } = JSON.parse(raw);
    assert.equal(events.filter(e => e.action==='system/auto-entry'&&e.status===200).length,2);
    assert.ok(events.some(event => event.action === 'system/registration' && event.actorEmail === adminEmail && event.status === 200));
    assert.ok(events.some(event => event.action === 'auth/login' && event.actorEmail === adminEmail));
    assert.ok(events.some(event => event.action === 'admin/revoke' && event.target === adminEmail));
    assert.equal((await request(activity + '?before=invalid', { cookie: owner })).status, 400);

    const accounts = '/api/admin/owner/accounts';
    assert.equal((await request(accounts, { cookie: admin })).status, 401);
    assert.equal((await request(accounts, { cookie: client })).status, 403);
    const page = await request(accounts + '?search=member', { cookie: owner });
    const { accounts: matches } = await page.json();
    assert.deepEqual(matches.map(account => account.email), [clientEmail]);
    const endpoint = accounts + '/' + matches[0].id + '/role';
    const change = (role, expectedRole, fields = {}) => request(endpoint, {
      cookie: owner, data: { role, expectedRole, ownerPassword, ...fields }
    });
    assert.equal((await request(endpoint, { cookie: client, data: { role: 'admin' } })).status, 403);
    assert.equal((await change('owner', 'client')).status, 400);
    assert.equal((await change('viewer', 'client')).status, 200);
    assert.equal((await request('/auth/me', { cookie: client })).status, 401);
    const viewer = await validLogin(clientEmail, clientPassword, null);
    assert.equal((await request('/app', { cookie: viewer })).status, 200);
    assert.equal((await request('/api/admin/overview', { cookie: viewer })).status, 403);
    assert.equal((await request('/api/ib/overview', { cookie: viewer })).status, 403);
    for (const path of ['/api/account/profile', '/api/auto-trade/turn-on', '/api/analysis-ai', '/api/analysis-alerts/settings']) {
      const blocked = await request(path, { cookie: viewer, data: {} });
      assert.equal(blocked.status, 403);
      assert.equal((await blocked.json()).code, 'VIEW_ONLY');
    }
    const demo = await request('/api/auto-trade/state', { cookie: viewer });
    assert.equal((await demo.json()).viewerMode, true);
    assert.equal((await change('admin', 'client', { password: 'AnotherPassword2026!' })).status, 409);
    assert.equal((await change('admin', 'viewer', { ownerPassword: clientPassword })).status, 401);
    assert.equal((await change('ib', 'viewer', { ibCode: 'test-role-ib' })).status, 200);
    const ib = await validLogin(clientEmail, clientPassword, null);
    assert.equal((await request('/api/ib/overview', { cookie: ib })).status, 200);
    assert.equal((await change('client', 'ib')).status, 200);
    assert.equal((await request('/api/ib/overview', { cookie: ib })).status, 401);
    assert.equal((await change('admin', 'client')).status, 200);
    assert.equal((await login(clientEmail, ownerPassword)).status, 401);
    const promoted = await validLogin(clientEmail, clientPassword, 'system_admin');
    assert.equal((await request('/api/admin/overview', { cookie: promoted })).status, 200);
    assert.equal((await request(accounts, { cookie: promoted })).status, 403);
    const auditAfter = await (await request(activity, { cookie: owner })).json();
    assert.ok(auditAfter.events.some(event => event.action === 'roles/client/viewer' && event.target === clientEmail));
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
