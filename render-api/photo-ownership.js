'use strict';
const { PHOTO_BUCKET } = require('./photo-access');
async function lookupPhotoUpload(supabase, path) {
  const result = await supabase.from('photo_upload_registry').select('storage_path,user_name,upload_id,status').eq('storage_path', path).maybeSingle();
  if (!result || result.error) throw (result && result.error || new Error('photo_ownership_unavailable'));
  return result.data;
}
async function claimPhotoUpload(supabase, path, actor, uploadId) {
  const previous = await lookupPhotoUpload(supabase, path);
  if (previous) return previous.user_name === actor && previous.upload_id === uploadId && previous.status !== 'cleanup';
  // A failed upload must not let its caller claim somebody's pre-existing
  // legacy object. Storage deliberately permits only creation of a new path.
  const exists = await supabase.storage.from(PHOTO_BUCKET).exists(path);
  if (!exists || (exists.error && ![400, 404].includes(Number(exists.error.status || exists.error.statusCode)))) throw (exists && exists.error || new Error('photo_storage_unavailable'));
  if (exists.data !== false) return false;
  const insert = await supabase.from('photo_upload_registry').insert({ storage_path: path, user_name: actor, upload_id: uploadId });
  if (!insert || (insert.error && String(insert.error.code) !== '23505')) throw (insert && insert.error || new Error('photo_ownership_unavailable'));
  const row = await lookupPhotoUpload(supabase, path);
  return !!(row && row.user_name === actor && row.upload_id === uploadId && row.status !== 'cleanup');
}
async function ownsPhotoUpload(supabase, path, actor, uploadId) {
  const row = await lookupPhotoUpload(supabase, path);
  return !!(row && row.user_name === actor && row.upload_id === uploadId && row.status !== 'cleanup');
}
async function ownedPhotoUploadPaths(supabase, paths, actor, uploadId) {
  const result = await supabase.from('photo_upload_registry').select('storage_path').eq('user_name', actor).eq('upload_id', uploadId).in('storage_path', paths);
  if (!result || result.error) throw (result && result.error || new Error('photo_ownership_unavailable'));
  const allowed = new Set((result.data || []).map(row => row.storage_path));
  return paths.filter(path => allowed.has(path));
}
module.exports = { claimPhotoUpload, ownsPhotoUpload, ownedPhotoUploadPaths };
