import type { PageDTO, ThemeDTO } from '@/types/models';
import { themeToCssVars } from './themeCss';

function escapeForScriptTag(js: string): string {
  // Prevent a stray `</script>` inside user JS from terminating the host tag.
  return js.replace(/<\/script/gi, '<\\/script');
}

export interface BuildPreviewDocOptions {
  page: Pick<PageDTO, 'name' | 'pageHtml' | 'pageCss' | 'pageJs'>;
  theme: ThemeDTO;
}

export function buildPreviewDoc({ page, theme }: BuildPreviewDocOptions): string {
  const rootVars = themeToCssVars(theme);
  const headerCss = theme.library?.Header?.css ?? '';
  const footerCss = theme.library?.Footer?.css ?? '';
  const buttonCss = theme.library?.Button?.css ?? '';
  const cardCss = theme.library?.Card?.css ?? '';
  const headerHtml = theme.library?.Header?.html ?? '';
  const footerHtml = theme.library?.Footer?.html ?? '';
  const js = (page.pageJs ?? '').trim();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(page.name)} — Preview</title>
<style>
${rootVars}
html, body { margin: 0; padding: 0; background: var(--color-surface, #fff); color: var(--color-ink, #111); font-family: var(--font-body, system-ui); }
img, svg, video { max-width: 100%; height: auto; }
${headerCss}
${footerCss}
${buttonCss}
${cardCss}
${page.pageCss ?? ''}
</style>
</head>
<body>
${headerHtml}
${page.pageHtml ?? ''}
${footerHtml}
${js ? `<script>\ntry {\n${escapeForScriptTag(js)}\n} catch (err) { console.error('[preview] page script error', err); }\n</script>` : ''}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
