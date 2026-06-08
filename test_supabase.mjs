const headers = {
  'apikey': 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA'
};
const base = 'https://ithowxqignlhkwaykglt.supabase.co/rest/v1';

async function query(table) {
  const r = await fetch(`${base}/${table}?select=*&limit=20`, { headers });
  return r.json();
}

async function main() {
  console.log('=== BANS ===');
  const bans = await query('bans');
  bans.forEach(b => console.log(`  user=${b.user_name} active=${b.is_active} banned_at=${b.banned_at?.slice(0,19)}`));

  console.log('\n=== MUTES ===');
  const mutes = await query('mutes');
  mutes.forEach(m => console.log(`  user=${m.user_name} active=${m.is_active} created_at=${m.created_at?.slice(0,19)} expires=${m.expires_at?.slice(0,19)||'永久'}`));

  console.log('\n=== BLACKLIST ===');
  const bl = await query('blacklist');
  bl.forEach(b => console.log(`  user=${b.user_name} active=${b.is_active} created_at=${b.created_at?.slice(0,19)}`));
}

main().catch(e => console.error('Error:', e.message));
