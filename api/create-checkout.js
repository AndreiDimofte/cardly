// api/create-checkout.js
// Creates a Stripe Checkout session for Cardly Pro
// Vercel env vars required:
//   STRIPE_SECRET_KEY      — from Stripe Dashboard → Developers → API Keys
//   STRIPE_PRICE_ID        — from Stripe Dashboard → Products → Cardly Pro → Price ID
//   NEXT_PUBLIC_APP_URL    — your live URL e.g. https://cardly.app

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // 1. Verify user session
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) return res.status(401).json({ error: 'Invalid session' });

  // 2. Check if already Pro
  const { data: profile } = await supabase
    .from('profiles')
    .select('is_pro, stripe_customer_id')
    .eq('id', user.id)
    .single();

  if (profile?.is_pro) {
    return res.status(400).json({ error: 'Already subscribed to Pro' });
  }

  // 3. Create Stripe checkout session
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://cardly.app';

  try {
    // Reuse existing Stripe customer if available
    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id }
      });
      customerId = customer.id;

      // Save customer ID to profile
      await supabase
        .from('profiles')
        .update({ stripe_customer_id: customerId })
        .eq('id', user.id);
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price: process.env.STRIPE_PRICE_ID,
        quantity: 1,
      }],
      success_url: `${appUrl}?checkout=success`,
      cancel_url: `${appUrl}?checkout=cancelled`,
      metadata: {
        supabase_user_id: user.id
      },
      subscription_data: {
        metadata: {
          supabase_user_id: user.id
        }
      }
    });

    return res.status(200).json({ url: session.url });
  } catch (e) {
    console.error('Stripe checkout error:', e);
    return res.status(500).json({ error: e.message || 'Failed to create checkout session' });
  }
}
