'use strict';

function createAdminLoginStore({createHash, randomUUID}, ipTools) {
const LOGIN = '__login_event__', INFO = '__user_info__';
const parse = text => { try { const value = JSON.parse(text); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch (_) { return {}; } };
const time = value => Number.isFinite(Date.parse(value)) ? Date.parse(value) : 0;

function isAdminLoginEvent(event) {
  return event.source === 'admin_login' && event.is_admin === true;
}

// Compare the complete stored content in PostgreSQL, rather than using a
// process-local mutex. Concurrent instances must preserve unrelated changes.
async function updateInfo(db, userName, makePatch) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const found = await db.from('posts').select('id, content').eq('user_name', userName).eq('media_type', INFO)
      .order('created_at', {ascending:false}).limit(1).maybeSingle();
    if (found.error) throw found.error;
    const info = parse(found.data && found.data.content);
    const patch = makePatch(info);
    if (!patch) return false;
    const content = JSON.stringify({...info, ...patch});
    if (found.data) {
      let query = db.from('posts').update({content}).eq('id', found.data.id);
      query = found.data.content == null ? query.is('content', null) : query.eq('content', found.data.content);
      const saved = await query.select('id').maybeSingle();
      if (saved.error) throw saved.error;
      if (saved.data) return true;
    } else {
      const saved = await db.from('posts').insert([{
        user_name:userName, media_type:INFO, content, actor_key:'user_info_' + createHash('md5').update(userName).digest('hex')
      }]).select('id').maybeSingle();
      if (!saved.error && saved.data) return true;
      if (saved.error && String(saved.error.code) !== '23505') throw saved.error;
    }
  }
  throw Error('admin_login_info_conflict');
}

async function refreshAdminLoginLocation({db, userName, eventId, ip, location, initial = false}) {
  if (!location || typeof location !== 'object' || !location.source_ip) throw Error('invalid_ip_location');
  const {normalizeIpAddress} = ipTools;
  if (!normalizeIpAddress(ip) || normalizeIpAddress(ip) !== normalizeIpAddress(location.source_ip)) throw Error('event_mismatch');
  let body, eventUpdated = false;
  for (let attempt = 0; attempt < 5; attempt++) {
    const found = await db.from('posts').select('id, content').eq('id', eventId).eq('user_name', userName).eq('media_type', LOGIN).maybeSingle();
    if (found.error) throw found.error;
    body = parse(found.data && found.data.content);
    if (!found.data || !isAdminLoginEvent(body) || body.ip !== ip) throw Error('event_mismatch');
    // A slow initial lookup cannot replace an administrator's completed refresh.
    if ((initial && body.ip_location) || time(body.ip_location && body.ip_location.resolved_at) > time(location.resolved_at)) break;
    const saved = await db.from('posts').update({content:JSON.stringify({...body, ip_location:location})})
      .eq('id', eventId).eq('content', found.data.content).select('id').maybeSingle();
    if (saved.error) throw saved.error;
    if (saved.data) { eventUpdated = true; break; }
    if (attempt === 4) throw Error('admin_login_event_conflict');
  }
  if (!eventUpdated) return {ok:true, event_updated:false, current_updated:false};
  const currentUpdated = await updateInfo(db, userName, info => {
    if (info.last_auth_event_id !== eventId || info.last_ip !== ip || info.last_login !== body.login_at) return null;
    if (time(info.last_ip_location && info.last_ip_location.resolved_at) > time(location.resolved_at)) return null;
    return {last_ip_location:location, last_ip_location_ip:ip};
  });
  return {ok:true, event_updated:true, current_updated:currentUpdated};
}

async function recordAdminLogin({db, userName, event, resolve, loginAt = new Date().toISOString()}) {
  const eventId = randomUUID();
  const body = {...event, login_at:loginAt, source:'admin_login', is_admin:true,
    authority:'server_admin_authentication', method:'password', ip_location:null};
  const saved = await db.from('posts').insert([{
    id:eventId, user_name:userName, media_type:LOGIN, media_url:event.device_id,
    content:JSON.stringify(body), actor_key:'admin_login_' + eventId, created_at:loginAt
  }]);
  if (saved.error) throw saved.error;
  await updateInfo(db, userName, info => {
    if (time(info.last_login) > time(loginAt)) return null;
    return {
      last_login:loginAt, last_visit:time(info.last_visit) > time(loginAt) ? info.last_visit : loginAt,
      last_device:[event.device_type,event.os,event.browser].filter(Boolean).join(' · '),
      last_device_id:event.device_id, last_ip:event.ip, last_auth_event_id:eventId,
      last_ip_location:null, last_ip_location_ip:null
    };
  });
  const location = await resolve(event.ip);
  if (location) await refreshAdminLoginLocation({db, userName, eventId, ip:event.ip, location, initial:true});
  return {event_id:eventId, login_at:loginAt};
}

return {recordAdminLogin, refreshAdminLoginLocation, isAdminLoginEvent};
}
module.exports = {createAdminLoginStore, ...createAdminLoginStore(require('node:crypto'),require('../js/ip-location'))};
