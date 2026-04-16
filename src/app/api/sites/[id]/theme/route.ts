import { NextResponse } from 'next/server';
import { z } from 'zod';
import { handleError, notFound, parseJson } from '@/server/http';
import { getThemeForSite, patchTheme } from '@/server/services/themeService';

export const runtime = 'nodejs';

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const theme = await getThemeForSite(id);
    if (!theme) return notFound('Theme not found (generate it first)');
    return NextResponse.json({ theme });
  } catch (err) {
    return handleError(err);
  }
}

const PatchBody = z.object({
  primaryFont: z.string().optional(),
  secondaryFont: z.string().optional(),
  signatureMotif: z.string().optional(),
  stylePresetId: z.string().optional(),
  palette: z.record(z.string()).optional(),
  tokens: z.unknown().optional(),
});

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = PatchBody.parse(await parseJson(req));
    const theme = await patchTheme(id, body);
    return NextResponse.json({ theme });
  } catch (err) {
    return handleError(err);
  }
}
