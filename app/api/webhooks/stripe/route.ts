import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

// Initialize clients inside the handler instead of at module load — Next.js
// can re-instantiate the module on cold starts, redeploys, and across serverless
// instances, so env vars may not be set when this file is first evaluated.
function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not set');
  return new Stripe(key);
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set');
  }
  return createClient(url, serviceKey);
}

export const runtime = 'nodejs';
// We need the raw request body to verify the Stripe signature — disable any
// caching/body parsing the framework might do.
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const stripe = getStripe();
  const supabase = getSupabase();

  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error('STRIPE_WEBHOOK_SECRET is not set');
    return NextResponse.json({ error: 'Webhook misconfigured' }, { status: 500 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) {
    return NextResponse.json({ error: 'Missing stripe-signature header' }, { status: 400 });
  }

  // Stripe verifies against the raw body, not parsed JSON.
  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error(`Webhook signature verification failed: ${message}`);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session;
    const customerEmail = session.customer_details?.email;
    const customerId = typeof session.customer === 'string' ? session.customer : null;

    if (!customerEmail) {
      // Without an email we can't create a client row. Tell Stripe to retry
      // — this is almost always a Stripe-side data issue worth surfacing.
      console.error('checkout.session.completed missing customer email', { eventId: event.id });
      return NextResponse.json({ error: 'Missing customer email' }, { status: 400 });
    }

    try {
      // Upsert on email to make this handler safe against Stripe retries
      // (Stripe retries any 5xx for up to 3 days). Requires a UNIQUE
      // constraint on clients.email — add one in Supabase if you haven't.
      const { error } = await supabase
        .from('clients')
        .upsert(
          {
            email: customerEmail,
            stripe_customer_id: customerId,
            status: 'PENDING_ONBOARDING',
          },
          { onConflict: 'email', ignoreDuplicates: false },
        );

      if (error) {
        // Surface to logs AND fail the request so Stripe retries instead of
        // silently losing the data.
        console.error('Supabase upsert failed:', error);
        return NextResponse.json({ error: 'Database write failed' }, { status: 500 });
      }
    } catch (err) {
      console.error('Unexpected error during DB write:', err);
      return NextResponse.json({ error: 'Database write failed' }, { status: 500 });
    }
  }

  return NextResponse.json({ received: true });
}
