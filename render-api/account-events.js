'use strict';
async function recordAccountAuthentication({supabase,req,userName,source,getClientIp,deviceId,detectDeviceTypeFromUA,detectOSFromUA,detectBrowserFromUA}) {
 const ip=getClientIp(req),ua=String(req.headers['user-agent']||'').slice(0,500);
 const result=await supabase.rpc('record_user_auth_event',{p_user_name:userName,p_source:source,p_event:{
  ip,ip_source:req._clientIpSource||'unknown',ip_version:require('net').isIP(ip)||null,user_agent:ua,
  device_id:String(deviceId||'').slice(0,120),device_type:detectDeviceTypeFromUA(ua),os:detectOSFromUA(ua),browser:detectBrowserFromUA(ua)
 }});
 if(!result||result.error||!result.data||!result.data.event_id)throw new Error('auth_event_store_failed');
 return result.data;
}
function authenticationEvents(events){return events.filter(event=>event.authority==='server_authentication'||event.source==='admin_login');}
module.exports={recordAccountAuthentication,authenticationEvents};
