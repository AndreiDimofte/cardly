// api/webhook.js
// Stripe webhook — called by Stripe after payment events
// Vercel env vars required:
//   STRIPE_SECRET_KEY         — Stripe secret key
//   STRIPE_WEBHOOK_SECRET     — from Stripe Dashboard → Webhooks → signing secret

import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export const config = {
  api: {
    bodyParser: false, // Required — Stripe needs raw body for signature verification
  },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(
      rawBody,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).json({ error: `Webhook error: ${e.message}` });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
  );

  const getUserId = (obj) =>
    obj?.metadata?.supabase_user_id ||
    obj?.subscription_data?.metadata?.supabase_user_id;

  switch (event.type) {

    // ── Payment successful → grant Pro ──
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.supabase_user_id;
      if (!userId) break;

      await supabase
        .from('profiles')
        .update({
          is_pro: true,
          stripe_customer_id: session.customer,
          stripe_subscription_id: session.subscription
        })
        .eq('id', userId);

      console.log(`Pro granted to user ${userId}`);
      break;
    }

    // ── Subscription renewed → keep Pro active ──
    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      if (invoice.billing_reason === 'subscription_cycle') {
        // Find user by stripe customer id
        const { data: profile } = await supabase
          .from('profiles')
          .select('id')
          .eq('stripe_customer_id', invoice.customer)
          .single();

        if (profile) {
          await supabase
            .from('profiles')
            .update({ is_pro: true })
            .eq('id', profile.id);
          console.log(`Pro renewed for customer ${invoice.customer}`);
        }
      }
      break;
    }

    // ── Subscription cancelled → revoke Pro ──
    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('stripe_customer_id', subscription.customer)
        .single();

      if (profile) {
        await supabase
          .from('profiles')
          .update({ is_pro: false, stripe_subscription_id: null })
          .eq('id', profile.id);
        console.log(`Pro revoked for customer ${subscription.customer}`);
      }
      break;
    }

    // ── Payment failed → optionally revoke Pro ──
    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`Payment failed for customer ${invoice.customer}`);
      // Stripe will retry automatically — don't revoke yet
      // Stripe will fire customer.subscription.deleted if retries are exhausted
      break;
    }

    default:
      console.log(`Unhandled event: ${event.type}`);
  }

  return res.status(200).json({ received: true });
}
