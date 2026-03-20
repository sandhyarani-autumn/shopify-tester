const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

async function checkStores() {

  // Connect to Supabase
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  // Get current IST time
  const now = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    hour:     '2-digit',
    minute:   '2-digit',
    hour12:   false
  });

  const currentHour = now.split(':')[0];
  console.log(`Current IST Time: ${now}`);
  console.log(`Checking stores scheduled for hour: ${currentHour}`);

  // Fetch stores scheduled for this hour
  const { data: stores, error } = await supabase
    .from('stores')
    .select('*')
    .eq('active', true)
    .like('run_time', `${currentHour}:%`);

  if (error) {
    console.error('Database error:', error.message);
    fs.writeFileSync('stores-to-run.json', '[]');
    return;
  }

  console.log(`${stores.length} store(s) scheduled to test now`);
  stores.forEach((s, i) =>
    console.log(`  ${i + 1}. ${s.client_name} — ${s.store_url}`)
  );

  // Save to file — test script reads from here
  fs.writeFileSync('stores-to-run.json', JSON.stringify(stores, null, 2));
}

checkStores();