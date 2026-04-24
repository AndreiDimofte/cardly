// api/cron/reset-usage.js
// Runs on the 1st of every month at midnight UTC

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  // On Vercel Hobby, cron auth header isn't sent - check CRON_SECRET if present, otherwise allow Vercel cron user-agent
  const authHeader = req.headers.authorization;
  const userAgent = req.headers['user-agent'] || '';
  const cronSecret = process.env.CRON_SECRET;

  const validSecret = cronSecret && authHeader === `Bearer ${cronSecret}`;
  const isVercelCron = userAgent.includes('vercel-cron');

  if (!validSecret && !isVercelCron) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { error } = await supabase
    .from('profiles')
    .update({ sets_this_month: 0 })
    .neq('id', '00000000-0000-0000-0000-000000000000');

  if (error) {
    console.error('Reset usage error:', error);
    return res.status(500).json({ error: error.message });
  }

  console.log('Monthly usage reset complete');
  return res.status(200).json({ success: true, message: 'Monthly usage reset complete' });
}
