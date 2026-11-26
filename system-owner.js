'use strict';

const OWNER_EMAIL = 'nazirhasan811213@gmail.com';

function systemRole(user) {
  if (user?.role !== 'admin' || user.status !== 'active') return null;
  return String(user.email).toLowerCase() === OWNER_EMAIL ? 'owner' : 'system_admin';
}

function adminActivityPath(path) {
  const match = /^\/api\/admin\/(clients|ibs|registrations)\/([0-9a-f-]{36})\/(handover\/release|reset-account|master-reset|switch-mt5|setup\/(?:settings|manual-exit|ea-connect)|status|profile|password|ib|promote-ib|review)$/i.exec(path);
  if (match) return { action: match[1] + '/' + match[3], target: match[2] };
  if (/^\/api\/admin\/promotion(?:\/[a-z0-9_-]{1,48})?$/.test(path)) return { action: 'promotion' };
  const known = new Set([
    '/api/admin/vps/resolve', '/api/admin/telegram/send', '/api/admin/telegram/preview',
    '/api/admin/monitoring/notifications', '/api/admin/user-trade-monitor',
    '/api/admin/system/registration', '/api/admin/system/auto-entry', '/api/admin/ibs'
  ]);
  return known.has(path) ? { action: path.slice('/api/admin/'.length) } : { action: 'admin-api' };
}

module.exports = { OWNER_EMAIL, systemRole, adminActivityPath };
