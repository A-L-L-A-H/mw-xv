import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const SESSION_COOKIE = 'mw_board_session';
const SESSION_MAX_AGE_SECONDS = 14 * 24 * 60 * 60;

/** Returns the session JSON so the SDK can hydrate from an HttpOnly cookie. */
export async function GET() {
  const jar = await cookies();
  return NextResponse.json({ token: jar.get(SESSION_COOKIE)?.value ?? null });
}

/** Stores the session JSON in an HttpOnly, SameSite=Lax cookie. Secure only on HTTPS. */
export async function POST(request: Request) {
  let token: unknown;
  try {
    ({ token } = (await request.json()) as { token?: unknown });
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (typeof token !== 'string' || token.length === 0) {
    return NextResponse.json({ error: 'A non-empty token is required' }, { status: 400 });
  }
  const forwardedProto = request.headers
    .get('x-forwarded-proto')
    ?.split(',')[0]
    ?.trim()
    .toLowerCase();
  let urlIsHttps = false;
  try {
    urlIsHttps = new URL(request.url).protocol === 'https:';
  } catch {
    urlIsHttps = false;
  }
  const isHttps = forwardedProto === 'https' || urlIsHttps;
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isHttps,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS,
  });
  return NextResponse.json({ ok: true });
}

export async function DELETE() {
  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
