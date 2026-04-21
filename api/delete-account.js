// api/delete-account.js
// Deletes the authenticated user's account and records their email to prevent re-signup abuse

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  try {
    // Record email BEFORE deleting so we can block re-signup
    await supabase.from('deleted_accounts').upsert({
      email: user.email.toLowerCase(),
      deleted_at: new Date().toISOString()
    });

    // Delete all user decks
    await supabase.from('decks').delete().eq('user_id', user.id);

    // Delete profile
    await supabase.from('profiles').delete().eq('id', user.id);

    // Delete the auth user entirely (requires service role key)
    const { error: deleteError } = await supabase.auth.admin.deleteUser(user.id);
    if (deleteError) throw deleteError;

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('Delete account error:', e);
    return res.status(500).json({ error: e.message || 'Failed to delete account' });
  }
}
