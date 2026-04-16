'use client';

import { useRef, useState } from 'react';
import { ImageIcon, Upload, X } from 'lucide-react';

export function ImageUpload({
  value,
  onChange,
  onAnalyze,
}: {
  value: string | null;
  onChange: (url: string | null) => void;
  onAnalyze?: (url: string) => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setErr(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await fetch('/api/upload', { method: 'POST', body: fd });
      if (!r.ok) throw new Error(await r.text());
      const { url } = (await r.json()) as { url: string };
      onChange(url);
      await onAnalyze?.(url);
    } catch (e: any) {
      setErr(e?.message ?? 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {value ? (
        <div className="relative overflow-hidden rounded-lg border border-black/10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="reference" className="block h-40 w-full object-cover" />
          <button
            type="button"
            onClick={() => onChange(null)}
            className="absolute right-2 top-2 rounded-full bg-ink/70 p-1 text-white hover:bg-ink"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) upload(f);
          }}
          className={`flex h-32 w-full flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed text-sm transition ${
            drag ? 'border-accent bg-accent/5 text-accent' : 'border-black/15 text-ink/50 hover:border-ink/30'
          }`}
        >
          {busy ? (
            <>
              <Upload className="h-5 w-5 animate-pulse" />
              <span>Uploading…</span>
            </>
          ) : (
            <>
              <ImageIcon className="h-5 w-5" />
              <span>Drop image or click to upload</span>
            </>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) upload(f);
          e.target.value = '';
        }}
      />
      {err && <div className="mt-1 text-xs text-red-600">{err}</div>}
    </div>
  );
}
