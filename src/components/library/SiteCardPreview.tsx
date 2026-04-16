'use client';

// Small visual component used for site-card thumbnails when a deployed or
// cached preview is not available. Renders an elegant gradient mark derived
// from the site name — premium feel, no generic "AI" avatar.

export function SiteCardPreview({ name }: { name: string }) {
  const hue = hashHue(name);
  return (
    <div
      className="h-24 w-full rounded-lg overflow-hidden relative"
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 70% 62%), hsl(${(hue + 40) % 360} 65% 40%))`,
      }}
      aria-hidden
    >
      <div className="absolute inset-0 opacity-[0.18] mix-blend-overlay"
        style={{ backgroundImage: 'radial-gradient(circle at 30% 30%, white 0, transparent 45%)' }} />
      <div className="absolute bottom-2 left-3 text-white/90 text-xs font-medium tracking-wide">
        {name.slice(0, 2).toUpperCase()}
      </div>
    </div>
  );
}

function hashHue(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}
