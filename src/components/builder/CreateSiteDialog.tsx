'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/Dialog';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Label } from '@/components/ui/Label';
import { StylePresetPicker } from '@/components/common/StylePresetPicker';
import { useCreateSite, useStylePresets } from '@/hooks/use-site';
import { cn } from '@/lib/cn';

export interface CreateSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type Step = 'details' | 'style';

const NAME_MAX = 80;
const PROMPT_MIN = 10;
const PROMPT_MAX = 2000;

export function CreateSiteDialog({ open, onOpenChange }: CreateSiteDialogProps) {
  const router = useRouter();
  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const nameId = useId();
  const promptId = useId();

  const [step, setStep] = useState<Step>('details');
  const [name, setName] = useState('');
  const [sitePrompt, setSitePrompt] = useState('');
  const [stylePresetId, setStylePresetId] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const create = useCreateSite();
  const presets = useStylePresets();

  // Reset when closing.
  useEffect(() => {
    if (!open) {
      const t = setTimeout(() => {
        setStep('details');
        setName('');
        setSitePrompt('');
        setStylePresetId(null);
        setSubmitted(false);
        create.reset();
      }, 200);
      return () => clearTimeout(t);
    }
  }, [open, create]);

  const trimmedName = name.trim();
  const trimmedPrompt = sitePrompt.trim();
  const nameError =
    submitted && (trimmedName.length < 1 || trimmedName.length > NAME_MAX)
      ? trimmedName.length > NAME_MAX
        ? `Max ${NAME_MAX} characters.`
        : 'Give your site a name.'
      : null;
  const promptError =
    submitted && (trimmedPrompt.length < PROMPT_MIN || trimmedPrompt.length > PROMPT_MAX)
      ? trimmedPrompt.length < PROMPT_MIN
        ? `At least ${PROMPT_MIN} characters.`
        : `Max ${PROMPT_MAX} characters.`
      : null;

  const detailsValid =
    trimmedName.length >= 1 &&
    trimmedName.length <= NAME_MAX &&
    trimmedPrompt.length >= PROMPT_MIN &&
    trimmedPrompt.length <= PROMPT_MAX;

  const canCreate = detailsValid && !!stylePresetId;

  const handleNext = () => {
    setSubmitted(true);
    if (detailsValid) setStep('style');
  };

  const handleCreate = async () => {
    if (!canCreate || !stylePresetId) return;
    try {
      const site = await create.mutateAsync({
        name: trimmedName,
        sitePrompt: trimmedPrompt,
        stylePresetId,
      });
      onOpenChange(false);
      router.push(`/sites/${site.id}?tab=build`);
    } catch {
      /* error surfaced via create.error below */
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          if (step === 'details') {
            e.preventDefault();
            nameInputRef.current?.focus();
          }
        }}
        className="max-w-2xl p-0 overflow-hidden"
      >
        <div className="flex items-center gap-2 border-b border-[var(--border-subtle)] px-6 py-4">
          <Sparkles className="h-4 w-4 text-[var(--text-secondary)]" aria-hidden />
          <div className="text-xs uppercase tracking-[var(--ls-wide)] text-[var(--text-secondary)]">
            New site
          </div>
          <div className="ml-auto flex items-center gap-1.5" aria-hidden>
            <StepDot active={step === 'details'} done={step === 'style'} />
            <StepDot active={step === 'style'} done={false} />
          </div>
        </div>

        <div className="px-6 pt-5 pb-6">
          {step === 'details' ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleNext();
              }}
            >
              <DialogHeader>
                <DialogTitle>Tell us about the site</DialogTitle>
                <DialogDescription>
                  A short description is enough — Sitecraft will ask follow-up questions
                  only for things it genuinely cannot decide on its own.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-5 space-y-5">
                <div className="space-y-1.5">
                  <Label htmlFor={nameId} required>
                    Site name
                  </Label>
                  <Input
                    id={nameId}
                    ref={nameInputRef}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Acme Farms"
                    maxLength={NAME_MAX + 20}
                    error={!!nameError}
                    aria-describedby={nameError ? `${nameId}-err` : undefined}
                  />
                  {nameError ? (
                    <p id={`${nameId}-err`} className="text-xs text-[var(--color-danger-600)]">
                      {nameError}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor={promptId} required>
                    What is the site about?
                  </Label>
                  <Textarea
                    id={promptId}
                    value={sitePrompt}
                    onChange={(e) => setSitePrompt(e.target.value)}
                    placeholder="Describe your site in one sentence or paragraph — product, audience, tone."
                    rows={4}
                    maxLength={PROMPT_MAX + 200}
                    error={!!promptError}
                    aria-describedby={`${promptId}-hint ${promptError ? `${promptId}-err` : ''}`}
                  />
                  <div className="flex items-center justify-between gap-2">
                    {promptError ? (
                      <p id={`${promptId}-err`} className="text-xs text-[var(--color-danger-600)]">
                        {promptError}
                      </p>
                    ) : (
                      <span id={`${promptId}-hint`} className="text-xs text-[var(--text-muted)]">
                        Minimum {PROMPT_MIN} characters.
                      </span>
                    )}
                    <span
                      className={cn(
                        'text-xs tabular-nums',
                        trimmedPrompt.length > PROMPT_MAX
                          ? 'text-[var(--color-danger-600)]'
                          : 'text-[var(--text-muted)]',
                      )}
                    >
                      {trimmedPrompt.length}/{PROMPT_MAX}
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button type="submit" rightIcon={<ArrowRight className="h-3.5 w-3.5" />}>
                  Continue
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <DialogHeader>
                <DialogTitle>Pick a style preset</DialogTitle>
                <DialogDescription>
                  Defines the aesthetic baseline — typography, palette, and layout personality.
                  You can change this later.
                </DialogDescription>
              </DialogHeader>

              <div className="mt-5 max-h-[46vh] overflow-y-auto pr-1 -mr-1">
                {presets.isLoading ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div
                        key={i}
                        className="sc-shimmer h-40 rounded-xl border border-[var(--card-border)]"
                      />
                    ))}
                  </div>
                ) : presets.isError ? (
                  <div className="rounded-lg border border-[var(--color-danger-500)]/30 bg-[var(--color-danger-50)] p-4 text-sm text-[var(--color-danger-700)]">
                    Failed to load style presets.
                    <Button
                      variant="link"
                      size="sm"
                      className="ml-2"
                      onClick={() => presets.refetch()}
                    >
                      Retry
                    </Button>
                  </div>
                ) : (
                  <StylePresetPicker
                    presets={presets.data?.stylePresets ?? []}
                    value={stylePresetId}
                    onChange={setStylePresetId}
                  />
                )}
              </div>

              {create.isError ? (
                <p
                  role="alert"
                  className="mt-4 rounded-md border border-[var(--color-danger-500)]/30 bg-[var(--color-danger-50)] px-3 py-2 text-xs text-[var(--color-danger-700)]"
                >
                  {create.error instanceof Error ? create.error.message : 'Failed to create site.'}
                </p>
              ) : null}

              <div className="mt-6 flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
                  onClick={() => setStep('details')}
                  disabled={create.isPending}
                >
                  Back
                </Button>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => onOpenChange(false)}
                    disabled={create.isPending}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    onClick={handleCreate}
                    loading={create.isPending}
                    disabled={!canCreate}
                  >
                    {create.isPending ? 'Creating…' : 'Create site'}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StepDot({ active, done }: { active: boolean; done: boolean }) {
  return (
    <span
      className={cn(
        'h-1.5 rounded-full transition-all duration-200',
        active ? 'w-5 bg-[var(--text-primary)]' : 'w-1.5',
        !active && done ? 'bg-[var(--text-secondary)]' : '',
        !active && !done ? 'bg-[var(--border-default)]' : '',
      )}
    />
  );
}
