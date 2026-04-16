import { NextResponse } from 'next/server';
import { STYLE_PRESETS } from '@/server/ai/stylePresets';

export async function GET() {
  return NextResponse.json({ stylePresets: STYLE_PRESETS });
}
