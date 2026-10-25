'use strict';
const {Client,Pool}=require('pg'),{randomUUID}=require('node:crypto'),fs=require('node:fs'),path=require('node:path');
async function withBackendDatabase(run) {
 const url=new URL(process.env.XTJ_TEST_DATABASE_URL);
 if(!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw Error('Disposable local database required');
 const admin=new Client({connectionString:url.href});await admin.connect();const name='xtj_deep_'+randomUUID().replaceAll('-','');await admin.query('CREATE DATABASE '+name);url.pathname='/'+name;
 const db=new Client({connectionString:url.href});await db.connect();const pool=new Pool({connectionString:url.href,max:4});
 try{
  await db.query(`DO $$ BEGIN CREATE ROLE anon;EXCEPTION WHEN duplicate_object THEN NULL;END $$;
   DO $$ BEGIN CREATE ROLE authenticated;EXCEPTION WHEN duplicate_object THEN NULL;END $$;
   DO $$ BEGIN CREATE ROLE service_role BYPASSRLS;EXCEPTION WHEN duplicate_object THEN NULL;END $$;
   CREATE EXTENSION pgcrypto;CREATE SCHEMA extensions;CREATE SCHEMA auth;
   CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS 'SELECT NULL::uuid';
   CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS 'SELECT ''{}''::jsonb';
   CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql AS 'SELECT current_user::text';
   CREATE SCHEMA storage;CREATE TABLE storage.buckets(id text PRIMARY KEY,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   CREATE TABLE storage.objects(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),bucket_id text,name text,owner uuid,created_at timestamptz DEFAULT now());ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
   CREATE PUBLICATION supabase_realtime;`);
  const directory=path.resolve(__dirname,'../../supabase/migrations');
  for(const file of fs.readdirSync(directory).filter(f=>f.endsWith('.sql')).sort()){
   try{await db.query(fs.readFileSync(path.join(directory,file),'utf8').replace(/^\uFEFF/,''));}catch(error){throw Error('Migration '+file+': '+error.message,{cause:error});}
  }
  return await run({db,pool,connectionString:url.href});
 }finally{await pool.end();await db.end();await admin.query('DROP DATABASE '+name);await admin.end();}
}
module.exports={withBackendDatabase};
