'use client';

import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/Label';
import type { StyleDraft } from './StyleTab';

interface Props {
  draft: StyleDraft;
  onChange: (signatureMotif: string) => void;
}

export function SignaturePanel({ draft, onChange }: Props) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Signature motif</CardTitle>
      </CardHeader>
      <CardBody className="space-y-2">
        <Label htmlFor="signature-motif">Per-site visual signature</Label>
        <Textarea
          id="signature-motif"
          value={draft.signatureMotif}
          onChange={(e) => onChange(e.target.value)}
          placeholder="e.g. oversized outline numerals before each H2"
          aria-label="Signature motif description"
          maxRows={8}
        />
        <p className="text-[11px] text-[var(--text-muted)]">
          Applies to newly generated pages. Existing pages keep their current style unless
          regenerated.
        </p>
      </CardBody>
    </Card>
  );
}
