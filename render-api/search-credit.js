'use strict';
const crypto = require('node:crypto');

function createSearchCredit({ supabase, limits, adminName }) {
  return async function claim(context) {
    context = context && typeof context === 'object' ? context : {};
    const actor = String(context.userName || '');
    if (!actor) return { allowed: false, reason: 'no_user', quota: null };
    if (context.signal && context.signal.aborted) return { allowed: false, reason: 'cancelled', quota: null };
    if (actor === adminName) {
      context.searchConsumed = (Number(context.searchConsumed) || 0) + 1;
      return { allowed: true, reason: null, quota: null };
    }
    if (!context.searchRequestId) context.searchRequestId = crypto.randomUUID();
    const claimId = crypto.randomUUID();
    let result;
    // A lost response may follow commit. Retry the same durable claim, never
    // a fresh ID, and never bypass the database gate when it is unavailable.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        result = await supabase.rpc('claim_ai_search_credit', {
          p_user_name: actor, p_request_id: context.searchRequestId, p_claim_id: claimId,
          p_free_token_limit: limits.free_token_limit,
          p_pro_token_limit: limits.pro_token_limit,
          p_free_search_limit: limits.free_search_limit
        });
        if (result && !result.error && result.data) break;
      } catch (_) { result = null; }
    }
    if (!result || result.error || !result.data || typeof result.data.allowed !== 'boolean') {
      return { allowed: false, reason: 'quota_unavailable', quota: null };
    }
    const gate = result.data;
    if (gate.allowed && context.signal && context.signal.aborted) {
      try { await supabase.rpc('release_ai_search_credit', { p_user_name: actor, p_claim_id: claimId }); }
      catch (_) { /* The durable claim remains bounded and can be reconciled. */ }
      return { allowed: false, reason: 'cancelled', quota: gate.quota || null };
    }
    if (gate.allowed) context.searchConsumed = (Number(context.searchConsumed) || 0) + 1;
    return gate;
  };
}
module.exports = { createSearchCredit };
