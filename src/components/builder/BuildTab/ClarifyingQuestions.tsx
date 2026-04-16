'use client';

import { useState } from 'react';
import { ChevronDown, MessageCircleQuestion, SkipForward } from 'lucide-react';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { FileDrop } from '@/components/common/FileDrop';
import { StreamingIndicator } from '@/components/common/StreamingIndicator';
import { cn } from '@/lib/cn';
import { useConversation, useUploadAsset } from '@/hooks/use-site';
import type { ConversationDTO, QuestionDTO } from '@/types/models';

type AnswerMap = Record<string, { response?: string; responseAssetId?: string; skipped?: boolean }>;

export function ClarifyingQuestions({
  siteId,
  pageId,
  pagePrompt,
}: {
  siteId: string;
  pageId: string;
  pagePrompt: string;
}) {
  const { ask, answer } = useConversation(siteId);
  const [conversation, setConversation] = useState<ConversationDTO | null>(null);
  const [answers, setAnswers] = useState<AnswerMap>({});
  const [submitted, setSubmitted] = useState(false);
  const [expanded, setExpanded] = useState(true);

  const handleAsk = async () => {
    setConversation(null);
    setAnswers({});
    setSubmitted(false);
    const convo = await ask.mutateAsync({
      scope: 'page',
      targetId: pageId,
      scopeBrief: pagePrompt,
    });
    setConversation(convo);
    setExpanded(true);
  };

  const answeredCount = conversation
    ? conversation.questions.filter((q) => {
        const a = answers[q.id];
        return !!(a && !a.skipped && (a.response || a.responseAssetId));
      }).length
    : 0;

  const handleSubmit = async () => {
    if (!conversation) return;
    const payload = Object.entries(answers)
      .filter(([, a]) => !a.skipped && (a.response || a.responseAssetId))
      .map(([questionId, a]) => ({
        questionId,
        response: a.response,
        responseAssetId: a.responseAssetId,
      }));
    if (payload.length === 0) {
      setSubmitted(true);
      setExpanded(false);
      return;
    }
    await answer.mutateAsync({ cid: conversation.id, answers: payload });
    setSubmitted(true);
    setExpanded(false);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-[var(--ls-wide)] text-[var(--text-muted)]">
            Clarifying questions
          </div>
          <p className="text-xs text-[var(--text-secondary)]">
            Let the AI ask only what it can&rsquo;t answer itself.
          </p>
        </div>
        {!conversation ? (
          <Button
            variant="secondary"
            size="sm"
            loading={ask.isPending}
            onClick={handleAsk}
            leftIcon={<MessageCircleQuestion className="h-3.5 w-3.5" aria-hidden />}
          >
            Ask AI what to clarify
          </Button>
        ) : submitted ? (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1.5 text-xs text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            aria-expanded={expanded}
          >
            <Badge variant="success">Answered — {answeredCount} input{answeredCount === 1 ? '' : 's'}</Badge>
            <ChevronDown className={cn('h-3 w-3 transition-transform', expanded && 'rotate-180')} aria-hidden />
          </button>
        ) : (
          <Button variant="ghost" size="sm" onClick={handleAsk} loading={ask.isPending}>
            Re-ask
          </Button>
        )}
      </div>

      {ask.isPending ? <StreamingIndicator label="Picking the right questions" /> : null}

      {conversation && expanded ? (
        <div className="space-y-2">
          {conversation.questions.length === 0 ? (
            <Card>
              <CardBody>
                <p className="text-sm text-[var(--text-secondary)]">
                  The AI doesn&rsquo;t need anything else. You can generate this page now.
                </p>
              </CardBody>
            </Card>
          ) : (
            conversation.questions
              .sort((a, b) => a.orderIdx - b.orderIdx)
              .map((q) => (
                <QuestionCard
                  key={q.id}
                  siteId={siteId}
                  question={q}
                  answer={answers[q.id]}
                  readonly={submitted}
                  onChange={(next) =>
                    setAnswers((prev) => ({ ...prev, [q.id]: { ...prev[q.id], ...next } }))
                  }
                />
              ))
          )}

          {!submitted && conversation.questions.length > 0 ? (
            <div className="flex justify-end">
              <Button onClick={handleSubmit} loading={answer.isPending}>
                Save answers
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function QuestionCard({
  siteId,
  question,
  answer,
  readonly,
  onChange,
}: {
  siteId: string;
  question: QuestionDTO;
  answer: AnswerMap[string] | undefined;
  readonly: boolean;
  onChange: (next: AnswerMap[string]) => void;
}) {
  const upload = useUploadAsset(siteId);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <CardTitle className="text-sm">{question.question}</CardTitle>
          <Badge variant="neutral" className="shrink-0 capitalize">
            {question.kind}
          </Badge>
        </div>
      </CardHeader>
      <CardBody className="pt-0">
        {answer?.skipped ? (
          <p className="text-xs text-[var(--text-muted)]">Skipped</p>
        ) : question.kind === 'text' ? (
          question.question.length > 80 ? (
            <Textarea
              disabled={readonly}
              value={answer?.response ?? question.response ?? ''}
              onChange={(e) => onChange({ response: e.target.value })}
              placeholder="Your answer"
              rows={2}
            />
          ) : (
            <Input
              disabled={readonly}
              value={answer?.response ?? question.response ?? ''}
              onChange={(e) => onChange({ response: e.target.value })}
              placeholder="Your answer"
            />
          )
        ) : question.kind === 'choice' ? (
          <div className="flex flex-wrap gap-1.5">
            {(question.choices ?? []).map((c) => {
              const selected = (answer?.response ?? question.response) === c;
              return (
                <button
                  key={c}
                  type="button"
                  disabled={readonly}
                  onClick={() => onChange({ response: c })}
                  className={cn(
                    'rounded-full border px-2.5 py-0.5 text-xs',
                    'transition-colors duration-150 ease-out',
                    selected
                      ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
                      : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--state-hover)]',
                  )}
                >
                  {c}
                </button>
              );
            })}
          </div>
        ) : question.kind === 'boolean' ? (
          <div className="flex gap-1.5">
            {(['Yes', 'No'] as const).map((v) => {
              const selected = (answer?.response ?? question.response) === v;
              return (
                <button
                  key={v}
                  type="button"
                  disabled={readonly}
                  onClick={() => onChange({ response: v })}
                  className={cn(
                    'rounded-full border px-3 py-0.5 text-xs',
                    selected
                      ? 'border-[var(--color-brand-600)] bg-[var(--color-brand-50)] text-[var(--color-brand-700)]'
                      : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--state-hover)]',
                  )}
                >
                  {v}
                </button>
              );
            })}
          </div>
        ) : question.kind === 'upload' ? (
          <FileDrop
            accept="image/*"
            disabled={readonly || upload.isPending}
            label={answer?.responseAssetId ? 'Replace file' : 'Upload file'}
            hint={answer?.responseAssetId ? `Attached: ${answer.responseAssetId.slice(0, 8)}…` : undefined}
            onFiles={async (files) => {
              if (!files[0]) return;
              const asset = await upload.mutateAsync({ file: files[0], kind: 'image' });
              onChange({ responseAssetId: asset.id, response: asset.url });
            }}
          />
        ) : null}

        {!readonly ? (
          <div className="mt-2 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => onChange({ skipped: !answer?.skipped })}
              leftIcon={<SkipForward className="h-3 w-3" aria-hidden />}
            >
              {answer?.skipped ? 'Unskip' : 'Skip'}
            </Button>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
