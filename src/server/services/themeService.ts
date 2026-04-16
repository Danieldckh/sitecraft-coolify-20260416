import { prisma } from '@/server/db/client';
import { generateTheme } from '@/server/ai/themeGen';
import { appendMemory, buildSiteContext } from '@/server/ai/memory';
import { getStylePreset } from '@/server/ai/stylePresets';
import { logChange } from './changelog';
import { withSiteLock } from './mutex';
import { toThemeDTO } from '@/server/db/mappers';
import type { ThemeDTO } from '@/types/models';

export async function generateThemeForSite(siteId: string): Promise<ThemeDTO> {
  return withSiteLock(siteId, async () => {
    const site = await prisma.site.findUnique({ where: { id: siteId } });
    if (!site) throw new Error(`Site ${siteId} not found`);

    const ctx = await buildSiteContext(siteId);
    const presetId = site.stylePresetId ?? 'corporate-clean';
    const preset = getStylePreset(presetId);

    const gen = await generateTheme({
      sitePrompt: site.sitePrompt,
      stylePresetId: preset.id,
      memorySummary: ctx.memorySummary,
    });

    const existing = await prisma.theme.findUnique({ where: { siteId } });
    const data = {
      siteId,
      stylePresetId: preset.id,
      tokensJson: JSON.stringify(gen.tokens),
      signatureMotif: gen.signatureMotif,
      libraryJson: JSON.stringify(gen.library),
      primaryFont: gen.primaryFont,
      secondaryFont: gen.secondaryFont,
      paletteJson: JSON.stringify(gen.palette),
      lastGeneratedAt: new Date(),
    };
    const saved = existing
      ? await prisma.theme.update({ where: { siteId }, data })
      : await prisma.theme.create({ data });

    await logChange({
      siteId,
      scope: 'theme',
      targetId: saved.id,
      summary: `Generated theme (${preset.id}), motif: ${gen.signatureMotif.slice(0, 80)}`,
      after: { preset: preset.id, signature: gen.signatureMotif, palette: gen.palette },
    });
    await appendMemory(siteId, {
      role: 'ai',
      kind: 'theme',
      content: `Theme generated (${preset.id}). Signature: ${gen.signatureMotif}`,
    });

    return toThemeDTO(saved);
  });
}

export async function getThemeForSite(siteId: string): Promise<ThemeDTO | null> {
  const t = await prisma.theme.findUnique({ where: { siteId } });
  return t ? toThemeDTO(t) : null;
}

export async function patchTheme(
  siteId: string,
  patch: Partial<{ primaryFont: string; secondaryFont: string; palette: unknown; tokens: unknown; signatureMotif: string; stylePresetId: string }>,
): Promise<ThemeDTO> {
  return withSiteLock(siteId, async () => {
    const t = await prisma.theme.findUnique({ where: { siteId } });
    if (!t) throw new Error(`Theme for site ${siteId} not found`);
    const updated = await prisma.theme.update({
      where: { siteId },
      data: {
        ...(patch.primaryFont !== undefined ? { primaryFont: patch.primaryFont } : {}),
        ...(patch.secondaryFont !== undefined ? { secondaryFont: patch.secondaryFont } : {}),
        ...(patch.palette !== undefined ? { paletteJson: JSON.stringify(patch.palette) } : {}),
        ...(patch.tokens !== undefined ? { tokensJson: JSON.stringify(patch.tokens) } : {}),
        ...(patch.signatureMotif !== undefined ? { signatureMotif: patch.signatureMotif } : {}),
        ...(patch.stylePresetId !== undefined ? { stylePresetId: patch.stylePresetId } : {}),
      },
    });
    await logChange({
      siteId,
      scope: 'theme',
      targetId: updated.id,
      summary: 'Theme manually patched',
      before: t,
      after: updated,
    });
    return toThemeDTO(updated);
  });
}
