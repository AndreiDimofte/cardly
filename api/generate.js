// api/generate.js — Cardly serverless function
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  const { data: deleted } = await supabase
    .from('deleted_accounts').select('email').eq('email', user.email.toLowerCase()).single();
  if (deleted) return res.status(403).json({ error: 'This account is not eligible for free generations. Please upgrade to Pro.' });

  const { data: profile } = await supabase
    .from('profiles').select('is_pro, sets_this_month').eq('id', user.id).single();
  if (!profile?.is_pro && (profile?.sets_this_month || 0) >= 3) {
    return res.status(403).json({ error: 'Free limit reached. Upgrade to Cardly Pro for unlimited decks.' });
  }

  const { notes, images, count = 10 } = req.body;
  const isImageMode = Array.isArray(images) && images.length > 0;

  if (!isImageMode && (!notes || notes.trim().length < 50)) {
    return res.status(400).json({ error: 'Notes too short — paste at least a paragraph.' });
  }
  if (isImageMode && images.length > 20) {
    return res.status(400).json({ error: 'Too many pages — maximum 20 for image PDFs.' });
  }

  const maxCards = profile?.is_pro ? 25 : 10;
  const cardCount = Math.min(Math.max(parseInt(count) || 10, 3), maxCards);

  const instruction = `You are a study assistant. Generate exactly ${cardCount} flashcards from the provided study material.

Rules:
- Questions must be specific and testable
- Answers: 1-3 sentences max
- Cover key concepts, definitions, comparisons
- Do NOT number the cards

Return ONLY a raw JSON array, no markdown fences, no explanation:
[{"front": "question", "back": "answer"}]`;

  let messageContent;
  if (isImageMode) {
    messageContent = [
      { type: 'text', text: instruction + '\n\nThe following are pages from a PDF. Generate flashcards from the study material:' },
      ...images.map(base64 => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: base64 }
      })),
      { type: 'text', text: `Generate exactly ${cardCount} flashcards as a raw JSON array.` }
    ];
  } else {
    messageContent = `${instruction}\n\nNotes:\n${notes.substring(0, 6000)}`;
  }

  const model = isImageMode ? 'claude-sonnet-4-6' : 'claude-haiku-4-5-20251001';

  const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 2000,
      messages: [{ role: 'user', content: messageContent }],
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

  await supabase.from('profiles')
    .update({ sets_this_month: (profile?.sets_this_month || 0) + 1 })
    .eq('id', user.id);

  return res.status(200).json({ cards });
}
