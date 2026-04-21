// api/generate.js — Cardly serverless function
// Vercel env vars required:
//   ANTHROPIC_API_KEY    — your Anthropic key
//   SUPABASE_URL         — from Supabase project settings
//   SUPABASE_SERVICE_KEY — service_role key (not anon key)

import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Verify Supabase session
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  // 2. Check usage limit for free users
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_pro, sets_this_month')
    .eq('id', user.id)
    .single();

  if (!profile?.is_pro && (profile?.sets_this_month || 0) >= 3) {
    return res.status(403).json({ error: 'Free limit reached. Upgrade to Cardly Pro for unlimited decks.' });
  }

  // 3. Validate input
  const { notes, count = 10 } = req.body;
  if (!notes || notes.trim().length < 50) {
    return res.status(400).json({ error: 'Notes too short — paste at least a paragraph.' });
  }

  // Enforce card count limits (free = max 10, pro = max 25)
  const maxCards = profile?.is_pro ? 25 : 10;
  const cardCount = Math.min(Math.max(parseInt(count) || 10, 3), maxCards);

  // 4. Call Anthropic
  const prompt = `You are a study assistant. Given the following notes, generate exactly ${cardCount} flashcards.

Rules:
- Questions must be specific and testable
- Answers: 1-3 sentences max
- Cover key concepts, definitions, comparisons
- Do NOT number the cards

Return ONLY a raw JSON array, no markdown fences, no explanation:
[{"front": "question", "back": "answer"}]

Notes:
${notes.substring(0, 6000)}`;

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!anthropicRes.ok) {
    const err = await anthropicRes.json();
    return res.status(500).json({ error: err.error?.message || 'Anthropic error' });
  }

  const data = await anthropicRes.json();
  const text = data.content?.[0]?.text || '';
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return res.status(500).json({ error: 'Could not parse cards from response.' });

  let cards;
  try { cards = JSON.parse(match[0]); }
  catch { return res.status(500).json({ error: 'Invalid JSON from model.' }); }

  // 5. Increment usage counter
  await supabase
    .from('profiles')
    .update({ sets_this_month: (profile?.sets_this_month || 0) + 1 })
    .eq('id', user.id);

  return res.status(200).json({ cards });
}
