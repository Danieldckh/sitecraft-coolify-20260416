// Scope CSS by prefixing selectors with `#section-<id>`, while leaving
// @keyframes, @font-face, and :root rules at top level untouched.

const PASSTHROUGH_AT_RULES = /^@(keyframes|-webkit-keyframes|font-face|charset|import|namespace)/i;

export function scopeCss(css: string, sectionId: string): string {
  const prefix = `#section-${sectionId}`;
  const out: string[] = [];
  let i = 0;
  const src = css;

  while (i < src.length) {
    // Skip whitespace / comments
    while (i < src.length && /\s/.test(src[i])) i++;
    if (i >= src.length) break;

    if (src[i] === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end === -1) break;
      out.push(src.slice(i, end + 2));
      i = end + 2;
      continue;
    }

    // At-rule
    if (src[i] === '@') {
      const { block, end } = readBlockOrStatement(src, i);
      const head = block.slice(0, block.indexOf('{') === -1 ? block.length : block.indexOf('{'));
      if (PASSTHROUGH_AT_RULES.test(head.trim()) || /:root/.test(head)) {
        out.push(block);
      } else if (/^@media|^@supports|^@container|^@layer/i.test(head.trim())) {
        // Recurse into wrapper at-rules
        const openIdx = block.indexOf('{');
        const inner = block.slice(openIdx + 1, block.length - 1);
        out.push(block.slice(0, openIdx + 1) + scopeCss(inner, sectionId) + '}');
      } else {
        out.push(block);
      }
      i = end;
      continue;
    }

    // Regular rule
    const { block, end } = readBlockOrStatement(src, i);
    const openIdx = block.indexOf('{');
    if (openIdx === -1) { i = end; continue; }
    const selectors = block.slice(0, openIdx);
    const body = block.slice(openIdx);
    const scoped = selectors
      .split(',')
      .map((s) => {
        const t = s.trim();
        if (!t) return '';
        if (/^(html|body)\b/i.test(t)) return prefix;
        if (/^:root\b/i.test(t)) return prefix;
        return `${prefix} ${t}`;
      })
      .filter(Boolean)
      .join(', ');
    out.push(scoped + body);
    i = end;
  }

  return out.join('\n');
}

function readBlockOrStatement(src: string, start: number): { block: string; end: number } {
  let i = start;
  let depth = 0;
  let sawBrace = false;
  while (i < src.length) {
    const c = src[i];
    if (c === '{') { depth++; sawBrace = true; }
    else if (c === '}') {
      depth--;
      if (depth === 0) { i++; break; }
    } else if (c === ';' && !sawBrace && depth === 0) {
      i++;
      break;
    }
    i++;
  }
  return { block: src.slice(start, i), end: i };
}
