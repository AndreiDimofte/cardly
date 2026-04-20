// api/cron/reset-usage.js
// Runs on the 1st of every month at midnight UTC
// Configured in vercel.json crons section

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // Verify this is called by Vercel cron (not a random request)
  const authHeader = req.headers.authorization;
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { error, count } = await supabase
    .from('profiles')
    .update({ sets_this_month: 0 })
    .neq('id', '00000000-0000-0000-0000-000000000000'); // update all rows

  if (error) {
    console.error('Reset usage error:', error);
    return res.status(500).json({ error: error.message });
  }

  console.log(`Reset usage for all users`);
  return res.status(200).json({ success: true, message: 'Monthly usage reset complete' });
}
