import { NextResponse } from 'next/server';
import { prisma } from '@/server/db/client';
import { handleError, HttpError, notFound } from '@/server/http';
import { analyzeImage, buildSiteContext } from '@/server/ai';
import { storage } from '@/server/storage';
import { logChange } from '@/server/services/changelog';
import { toSectionDTO } from '@/server/db/mappers';

export const runtime = 'nodejs';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const section = await prisma.section.findUnique({
      where: { id },
      include: { page: { include: { site: true } } },
    });
    if (!section) return notFound('Section not found');

    const form = await req.formData();
    const file = form.get('image');
    if (!(file instanceof File)) throw new HttpError(400, 'Missing "image" field');
    if (!ALLOWED.has(file.type)) throw new HttpError(400, `Unsupported MIME: ${file.type}`);
    if (file.size > MAX_BYTES) throw new HttpError(413, 'Image exceeds 8MB');

    const bytes = Buffer.from(await file.arrayBuffer());
    const siteId = section.page.siteId;
    const { url } = await storage.put({
      siteId,
      mime: file.type,
      bytes,
      originalName: file.name,
    });

    await prisma.asset.create({
      data: { siteId, kind: 'image', url, mime: file.type, sizeBytes: bytes.byteLength },
    });

    const ctx = await buildSiteContext(siteId);
    const result = await analyzeImage({
      imageUrl: url,
      sectionPrompt: section.sectionPrompt,
      siteContext: `${ctx.memorySummary}\nSite: ${section.page.site.sitePrompt}\nPage: ${section.page.pagePrompt}`,
    });

    const before = { html: section.html, css: section.css, js: section.js, referenceImageUrl: section.referenceImageUrl };
    const updated = await prisma.section.update({
      where: { id },
      data: {
        html: result.html,
        css: result.css,
        js: result.js,
        referenceImageUrl: url,
        lastGeneratedAt: new Date(),
      },
    });

    await logChange({
      siteId,
      scope: 'section',
      targetId: id,
      summary: `Analyzed reference image for ${section.type} section`,
      before,
      after: { ...result, referenceImageUrl: url },
    });

    return NextResponse.json({ section: toSectionDTO(updated) });
  } catch (err) {
    return handleError(err);
  }
}
