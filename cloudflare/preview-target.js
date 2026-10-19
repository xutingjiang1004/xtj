'use strict';

// Public resource identifiers, not credentials. Verified against the existing
// Cloudflare project before deployment; keep this tool scoped to its preview.
const PREVIEW_TARGET = Object.freeze({
  accountId: '4476d05f51667a3d178c6dc7c42ef280',
  project: 'xtj-preview',
  branch: 'migration-preview',
  sourceBranch: 'migration/cloudflare-pages-20261016',
  productionBranch: 'preview-production-unused',
  hostname: 'migration-preview.xtj-preview.pages.dev',
  wranglerVersion: '4.151.1'
});

function resolvePreviewAccountId(requested, configured) {
  // A managed variable may be an opaque proxy placeholder. The already verified
  // public account ID avoids passing that placeholder into a URL or CLI error.
  const value = requested !== undefined ? requested
    : /^[a-f0-9]{32}$/i.test(configured || '') ? configured : PREVIEW_TARGET.accountId;
  if (!/^[a-f0-9]{32}$/i.test(value || '') || value.toLowerCase() !== PREVIEW_TARGET.accountId) {
    throw Object.assign(new Error('Unexpected preview account'), { code: 'unexpected_preview_account' });
  }
  return PREVIEW_TARGET.accountId;
}

module.exports = { PREVIEW_TARGET, resolvePreviewAccountId };
