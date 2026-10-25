'use strict';
const {execFileSync}=require('node:child_process'),{createClient}=require('@supabase/supabase-js');
async function withLocalPostgrest(connectionString,run){
 const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key];
 const docker=(...args)=>execFileSync('docker',['--host=unix:///var/run/docker.sock',...args],{env,encoding:'utf8',timeout:15000}).trim();
 const uri=new URL(connectionString);if(!['localhost','127.0.0.1','[::1]'].includes(uri.hostname))throw Error('Local fixture required');
 uri.hostname=docker('inspect',process.env.XTJ_TEST_PG_CONTAINER||'xtj-deep-pg','--format','{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}');uri.port='5432';
 const id=docker('run','-d','-p','127.0.0.1::3000','-e','PGRST_DB_URI='+uri.href,'-e','PGRST_DB_ANON_ROLE=service_role','-e','PGRST_DB_MAX_ROWS=1000','postgrest/postgrest:v14.0');
 try{
  const address=docker('port',id,'3000/tcp'),origin='http://'+address;
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(origin+'/')).ok){ready=true;break}}catch(_){}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('Local PostgREST did not start');
  const sb=createClient(origin,'local-fixture-only',{global:{fetch:(url,init={})=>{const headers=new Headers(init.headers);headers.delete('authorization');return fetch(String(url).replace('/rest/v1/','/'),{...init,headers});}}});
  return await run(sb);
 }finally{docker('rm','-f',id);}
}
module.exports={withLocalPostgrest};
