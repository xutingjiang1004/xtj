'use strict';
const { readAuthRecord } = require('./auth-record');
async function readAccountIdentity(db, userName, adminName) {
  let row = await readAuthRecord(db, userName, '__auth__', 'id,created_at');
  if (!row && userName === adminName) {
    row = await readAuthRecord(db, userName, '__admin_auth__', 'id,created_at');
    if (!row) return { id: 'admin:' + adminName, created_at: '1970-01-01T00:00:00Z' };
  }
  return row;
}
function matchesAccount(payload, account, lifetime) {
  if (!payload || !account) return false;
  if (payload.account_id) return payload.account_id === String(account.id);
  // Old signed sessions remain usable only for an account that already existed
  // when they were issued. A recreated name cannot inherit a legacy session.
  const issued = Number(payload.exp) - lifetime;
  return Number.isFinite(issued) && Date.parse(account.created_at) < issued - 1000;
}
module.exports = { readAccountIdentity, matchesAccount };
