import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { publicEnv, supabaseConfigStatus } from '@/lib/env';

const PUBLIC_PATHS = ['/login', '/signup', '/reset-password', '/update-password', '/auth', '/setup'];

/**
 * Refreshes the Supabase session cookie on every request and keeps
 * unauthenticated traffic out of the application shell. Authorization itself
 * is still enforced per-query by RLS.
 */
export async function proxy(request: NextRequest) {
  // Without Supabase credentials nothing can work, so send the visitor to a
  // page that says what is missing instead of throwing a 500 at them.
  const config = supabaseConfigStatus();
  if (!config.ok) {
    if (request.nextUrl.pathname === '/setup') return NextResponse.next();
    const setupUrl = request.nextUrl.clone();
    setupUrl.pathname = '/setup';
    setupUrl.search = '';
    return NextResponse.redirect(setupUrl);
  }

  let response = NextResponse.next({ request });
  const env = publicEnv();

  const supabase = createServerClient(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    return NextResponse.redirect(url);
  }

  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Everything except static assets and the WhatsApp webhook, which
     * authenticates via Meta's signature rather than a user session.
     */
    '/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
