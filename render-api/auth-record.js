'use strict';

// Database unavailability is not proof of an invalid account. Callers must
// return a retryable response without revoking cookies or accepting credentials.
async function readAuthRecord(supabase, userName, marker, fields = 'id') {
  let result = await supabase.from('posts').select(fields).eq('user_name', userName).eq('media_type', marker).maybeSingle();
  if (result && result.error && String(result.error.code) === 'PGRST116') {
    result = await supabase.from('posts').select(fields).eq('user_name', userName).eq('media_type', marker)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
  }
  if (!result || result.error) throw (result && result.error || new Error('auth_query_unavailable'));
  return result.data || null;
}
module.exports = { readAuthRecord };
