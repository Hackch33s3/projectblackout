import { NextResponse } from 'next/server';
import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const engineUrl = process.env.ENGINE_URL;
  const engineApiKey = process.env.ENGINE_API_KEY;

  if (!stripeKey || !supabaseUrl || !supabaseKey || !engineUrl || !engineApiKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  const stripe = new Stripe(stripeKey);
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { sessionId, fullName, pastCity } = await req.json();

  if (!sessionId || !fullName || !pastCity) {
    return NextResponse.json({ error: 'Missing data' }, { status: 400 });
  }

  try {
    // 1. Get customer details from Stripe
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    const customerId = session.customer as string;

    // 2. Update client in Supabase
    const { data: client, error: updateError } = await supabase
      .from('clients')
      .update({ 
        full_name: fullName, 
        past_city: pastCity, 
        status: 'ACTIVE_MONITORING' 
      })
      .eq('stripe_customer_id', customerId)
      .select()
      .single();

    if (updateError || !client) {
      console.error('Supabase update error:', updateError);
      return NextResponse.json({ error: 'Database update failed' }, { status: 500 });
    }

    // 3. Trigger the Python Engine
    const engineRes = await fetch(`${engineUrl}/start-scan`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${engineApiKey}`
      },
      body: JSON.stringify({ 
        clientId: client.id,
        full_name: fullName,
        past_city: pastCity
      })
    });

    if (!engineRes.ok) {
      console.error('Engine trigger failed:', await engineRes.text());
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Onboard error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}