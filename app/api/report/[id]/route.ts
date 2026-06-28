import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Update the type signature to support Next.js 15 (where params is a Promise)
// This syntax is backward compatible with Next.js 14
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  // Await params to resolve the ID
  const { id } = await params;

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return NextResponse.json({ error: 'Server config error' }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // 1. Fetch client status
    const { data: client, error: clientError } = await supabase
      .from('clients')
      .select('status, full_name, email')
      .eq('id', id)
      .single();

    if (clientError || !client) {
      return NextResponse.json({ error: 'Client not found' }, { status: 404 });
    }

    // 2. Fetch targets associated with this client
    const { data: targets, error: targetsError } = await supabase
      .from('targets')
      .select('broker_name, profile_url, status')
      .eq('client_id', id);

    if (targetsError) {
      return NextResponse.json({ error: 'Targets fetch failed' }, { status: 500 });
    }

    // 3. Return the report data
    return NextResponse.json({ 
      status: client.status, 
      fullName: client.full_name,
      targets: targets || [] 
    });
  } catch (err) {
    console.error('Report fetch error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}