// api/webhook.js
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';

export const config = {
  api: { bodyParser: false },
};

async function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function sendProWelcomeEmail(email) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Cardly <hello@studywithcardly.com>',
        to: email,
        subject: 'Welcome to Cardly Pro',
        html: `<div style="max-width:480px;margin:0 auto;font-family:sans-serif;color:#1a1916;">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
    <img src="https://www.studywithcardly.com/logo.svg" alt="" width="36" height="30" style="display:block;">
    <span style="font-size:22px;font-weight:900;letter-spacing:-0.5px;color:#1a1916;">Cardly</span>
  </div>
  <h2 style="font-size:22px;font-weight:800;margin-bottom:8px;">You're now on Pro.</h2>
  <p style="color:#6b6760;font-size:14px;line-height:1.6;margin-bottom:24px;">
    Your Cardly Pro subscription is active. Here's what you now have access to:
  </p>
  <table style="margin-bottom:28px;border-collapse:collapse;">
    <tr><td style="padding:5px 0;font-size:14px;color:#1a1916;"><span style="color:#ff4d00;font-weight:700;margin-right:8px;">✓</span>Unlimited deck generations per month</td></tr>
    <tr><td style="padding:5px 0;font-size:14px;color:#1a1916;"><span style="color:#ff4d00;font-weight:700;margin-right:8px;">✓</span>Up to 30 cards per deck</td></tr>
    <tr><td style="padding:5px 0;font-size:14px;color:#1a1916;"><span style="color:#ff4d00;font-weight:700;margin-right:8px;">✓</span>Unlimited saved decks</td></tr>
    <tr><td style="padding:5px 0;font-size:14px;color:#1a1916;"><span style="color:#ff4d00;font-weight:700;margin-right:8px;">✓</span>Scanned PDF support</td></tr>
    <tr><td style="padding:5px 0;font-size:14px;color:#1a1916;"><span style="color:#ff4d00;font-weight:700;margin-right:8px;">✓</span>Deck folders, study stats and streaks</td></tr>
    <tr><td style="padding:5px 0;font-size:14px;color:#1a1916;"><span style="color:#ff4d00;font-weight:700;margin-right:8px;">✓</span>Shareable deck links</td></tr>
  </table>
  <a href="https://www.studywithcardly.com" style="display:inline-block;background:#ff4d00;color:white;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none;">
    Start studying
  </a>
  <p style="color:#a09d97;font-size:12px;margin-top:32px;line-height:1.6;">
    You can manage or cancel your subscription anytime from Account settings inside the app.<br>
    Questions? Reply to this email.<br>
    © 2026 Cardly
  </p>
</div>`
      }),
    });
    console.log(`Pro welcome email sent to ${email}`);
  } catch (e) {
    console.error('Failed to send Pro welcome email:', e.message);
  }
}

async function sendCancellationEmail(email) {
  try {
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'Cardly <hello@studywithcardly.com>',
        to: email,
        subject: 'Your Cardly Pro subscription has ended',
        html: `<div style="max-width:480px;margin:0 auto;font-family:sans-serif;color:#1a1916;">
  <div style="display:flex;align-items:center;gap:10px;margin-bottom:28px;">
    <img src="https://www.studywithcardly.com/logo.svg" alt="" width="36" height="30" style="display:block;">
    <span style="font-size:22px;font-weight:900;letter-spacing:-0.5px;color:#1a1916;">Cardly</span>
  </div>
  <h2 style="font-size:22px;font-weight:800;margin-bottom:8px;">Your Pro subscription has ended</h2>
  <p style="color:#6b6760;font-size:14px;line-height:1.6;margin-bottom:24px;">
    Your Cardly Pro subscription has been cancelled. You've been moved back to the free plan — your decks and data are still safe and accessible.
  </p>
  <p style="color:#6b6760;font-size:14px;line-height:1.6;margin-bottom:24px;">
    On the free plan you have 7 generations per month and up to 10 cards per deck. You can resubscribe anytime to get Pro back instantly.
  </p>
  <a href="https://www.studywithcardly.com" style="display:inline-block;background:#ff4d00;color:white;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;text-decoration:none;">
    Resubscribe to Pro
  </a>
  <p style="color:#a09d97;font-size:12px;margin-top:32px;line-height:1.6;">
    If you cancelled by mistake, just resubscribe above — it takes seconds.<br>
    © 2026 Cardly
  </p>
</div>`
      }),
    });
    console.log(`Cancellation email sent to ${email}`);
  } catch (e) {
    console.error('Failed to send cancellation email:', e.message);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('Webhook signature error:', e.message);
    return res.status(400).json({ error: `Webhook error: ${e.message}` });
  }

  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

  switch (event.type) {

    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.supabase_user_id;
      if (!userId) break;

      await supabase.from('profiles').update({
        is_pro: true,
        stripe_customer_id: session.customer,
        stripe_subscription_id: session.subscription
      }).eq('id', userId);

      // Get email and send Pro welcome
      const { data: { user } } = await supabase.auth.admin.getUserById(userId);
      if (user?.email) await sendProWelcomeEmail(user.email);

      console.log(`Pro granted to user ${userId}`);
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      if (invoice.billing_reason === 'subscription_cycle') {
        const { data: profile } = await supabase
          .from('profiles').select('id').eq('stripe_customer_id', invoice.customer).single();
        if (profile) {
          await supabase.from('profiles').update({ is_pro: true }).eq('id', profile.id);
          console.log(`Pro renewed for customer ${invoice.customer}`);
        }
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const prevAttr = event.data.previous_attributes;
      // Only act when cancel_at_period_end just switched to true (user just cancelled)
      if (subscription.cancel_at_period_end === true && prevAttr?.cancel_at_period_end === false) {
        const { data: profile } = await supabase
          .from('profiles').select('id').eq('stripe_customer_id', subscription.customer).single();
        if (profile) {
          const { data: { user } } = await supabase.auth.admin.getUserById(profile.id);
          if (user?.email) await sendCancellationEmail(user.email);
          console.log(`Cancellation scheduled for customer ${subscription.customer} — email sent`);
        }
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const { data: profile } = await supabase
        .from('profiles').select('id').eq('stripe_customer_id', subscription.customer).single();

      if (profile) {
        await supabase.from('profiles')
          .update({ is_pro: false, stripe_subscription_id: null }).eq('id', profile.id);

        // Get email and send cancellation
        const { data: { user } } = await supabase.auth.admin.getUserById(profile.id);
        if (user?.email) await sendCancellationEmail(user.email);

        console.log(`Pro revoked for customer ${subscription.customer}`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = event.data.object;
      console.log(`Payment failed for customer ${invoice.customer}`);
      break;
    }

    default:
      console.log(`Unhandled event: ${event.type}`);
  }

  return res.status(200).json({ received: true });
}
