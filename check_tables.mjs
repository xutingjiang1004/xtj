const SUPABASE_URL = 'https://ithowxqignlhkwaykglt.supabase.co';
const ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml0aG93eHFpZ25saGt3YXlrZ2x0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxNzE1MTEsImV4cCI6MjA5Mjc0NzUxMX0.fNmh0HjNuIZaJTa56gMITwKpJMQfJ8mBN41HMhvyDDA';

async function queryTable(name, limit = 5) {
    try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${name}?select=*&limit=${limit}`, {
            headers: {
                'apikey': ANON_KEY,
                'Authorization': `Bearer ${ANON_KEY}`,
                'Accept': 'application/json'
            }
        });
        if (res.ok) {
            const data = await res.json();
            console.log(`\n=== ${name} 数据 (${data.length} 条) ===`);
            if (data.length > 0) {
                console.log('字段:', Object.keys(data[0]).join(', '));
                data.forEach((row, i) => {
                    console