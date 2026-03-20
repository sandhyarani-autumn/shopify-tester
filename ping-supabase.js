const { createClient } = require('@supabase/supabase-js');

async function ping() {
  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_ANON_KEY
  );

  // Simple query to keep database active
  const { error } = await supabase
    .from('stores')
    .select('id')
    .limit(1);

  if (error) {
    console.error('Ping failed:', error.message);
    process.exit(1);
  } else {
    console.log('Supabase is active and responding!');
  }
}

ping();