import { NextResponse } from 'next/server';
import { Octokit } from '@octokit/rest';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  const tok = process.env.GITHUB_TOKEN ?? '';
  const info = {
    prefix: tok.slice(0, 8),
    len: tok.length,
    hasNewline: /\r|\n/.test(tok),
    hasSpace: /\s/.test(tok),
    charCodes: Array.from(tok.slice(-4)).map((c) => c.charCodeAt(0)),
  };
  try {
    const o = new Octokit({ auth: tok });
    const { data } = await o.rest.users.getAuthenticated();
    return NextResponse.json({ ok: true, login: data.login, info });
  } catch (e: unknown) {
    const err = e as { status?: number; message?: string };
    return NextResponse.json({ ok: false, status: err.status, message: err.message, info }, { status: 500 });
  }
}
