import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST(req: Request) {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const engineUrl = process.env.ENGINE_URL;
  const engineApiKey = process.env.ENGINE_API_KEY;

  if (!supabaseUrl || !supabaseKey || !engineUrl || !engineApiKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);
  const { fullName, pastCity, email } = await req.json();

  if (!fullName || !pastCity || !email) {
    return NextResponse.json({ error: 'Missing data' }, { status: 400 });
  }

  try {
    // 1. Create lead in Supabase
    const { data: client, error } = await supabase
      .from('clients')
      .insert([{ 
        email, 
        full_name: fullName, 
        past_city: pastCity, 
        status: 'PENDING_AUDIT' 
      }])
      .select()
      .single();

    if (error || !client) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({ error: 'Database error' }, { status: 500 });
    }

    // 2. Trigger the Python Engine
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

    // 3. Return the client ID so we can route to the live report page
    return NextResponse.json({ success: true, clientId: client.id });
  } catch (err) {
    console.error('Audit error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}