const API = 'https://xtj.onrender.com';

async function main() {
  // 1. Login
  const loginRes = await fetch(API + '/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'xxz', password: 'xxz123456' })
  });
  const loginData = await loginRes.json();
  const token = loginData.token;
  console.log('Login success:', !!token);
  
  // 2. Query /admin/data
  const dataRes = await fetch(API + '/admin/data', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const data = await dataRes.json();
  console.log('bans count:', data.bans?.length);
  console.log('mutes count:', data.mutes?.length);
  console.log('blacklist count:', data.blacklist?.length);
  if (data.bans?.length > 0) {
    console.log('bans sample:', JSON.stringify(data.bans.map(b => ({ name: b.user_name, active: b.is_active }))));
  }
  if (data.mutes?.length > 0) {
    console.log('mutes sample:', JSON.stringify(data.mutes.map(m => ({ name: m.user_name, active: m.is_active }))));
  }
  if (data.blacklist?.length > 0) {
    console.log('blacklist sample:', JSON.stringify(data.blacklist.map(b => ({ name: b.user_name, active: b.is_active }))));
  }
  
  // 3. Query /admin/bans
  const bansRes = await fetch(API + '/admin/bans', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const bansData = await bansRes.json();
  console.log('/admin/bans count:', bansData.data?.length);
  
  // 4. Query users
  const usersRes = await fetch(API + '/admin/users', {
    headers: { 'Authorization': 'Bearer ' + token }
  });
  const usersData = await usersRes.json();
  console.log('users count:', usersData.data?.length);
  if (usersData.data?.length > 0) {
    console.log('first 15 users:', JSON.stringify(usersData.data.slice(0, 15).map(u => u.user_name)));
  }
}

main().catch(e => console.error('Error:', e.message));
