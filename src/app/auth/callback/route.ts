import { NextResponse, type NextRequest } from 'next/server';
import { createServerSupabase } from '@/lib/db/server-client';

/**
 * Exchanges a Supabase auth code (email confirmation, password reset) for a
 * session cookie, then sends the user on to the requested page.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get('code');
  const nextParam = searchParams.get('next') ?? '/dashboard';
  // Only same-origin relative paths, so the callback cannot be used as an open redirect.
  const next = nextParam.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/dashboard';

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=missing_code`);
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${origin}/login?error=invalid_link`);
  }

  return NextResponse.redirect(`${origin}${next}`);
}
