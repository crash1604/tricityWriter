'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  DEFAULT_OPTIONS,
  OptionsFields,
  TemplateSelect,
  useModels,
  useTemplates,
} from '../../../../../components/options';
import {
  Button,
  Card,
  cx,
  ErrorText,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Textarea,
} from '../../../../../components/ui';
import { api, type Generation, type GenerationOptions, type Site } from '../../../../../lib/api';

const STEPS = ['Content', 'Design', 'Media', 'Generate'] as const;

export default function WritePage() {
  const { siteId } = useParams<{ siteId: string }>();
  const router = useRouter();
  const site = useQuery({ queryKey: ['site', siteId], queryFn: () => api<{ site: Site }>(`/sites/${siteId}`) });
  const templates = useTemplates();
  const models = useModels();

  const [step, setStep] = useState(0);
  const [topic, setTopic] = useState('');
  const [keywords, setKeywords] = useState('');
  const [options, setOptions] = useState<GenerationOptions>(DEFAULT_OPTIONS);
  const [delivery, setDelivery] = useState<'review' | 'draft'>('review');

  const create = useMutation({
    mutationFn: () =>
      api<{ generation: Generation }>('/generations', {
        method: 'POST',
        body: {
          ...options,
          siteId,
          topic,
          keywords,
          delivery: delivery === 'review' ? { mode: 'review' } : { mode: 'publish', status: 'draft' },
        },
      }),
    onSuccess: ({ generation }) => router.push(`/articles/${generation.id}`),
  });

  if (site.isPending || templates.isPending || models.isPending) return <Loading />;
  if (site.error) return <ErrorText error={site.error} />;

  const set = <K extends keyof GenerationOptions>(key: K, value: GenerationOptions[K]) =>
    setOptions({ ...options, [key]: value });
  const template = (id?: string) => templates.data?.templates.find((t) => t.id === id);
  const canContinue = step > 0 || topic.trim().length >= 3;
  const noTextModel = !models.data?.defaults.text && !options.textModel;

  return (
    <>
      <PageHeader title="Write an article" description={`For ${site.data.site.name}`} />
      <ol className="mb-6 flex gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex-1">
            <button
              type="button"
              disabled={i > step && !canContinue}
              onClick={() => setStep(i)}
              className={cx(
                'w-full rounded-lg border-t-4 px-3 pt-2 text-left text-sm',
                i <= step ? 'border-brand-600 font-medium text-brand-700' : 'border-slate-200 text-slate-500',
              )}
            >
              <span className="block text-xs">Step {i + 1}</span>
              {label}
            </button>
          </li>
        ))}
      </ol>

      <Card>
        {step === 0 && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <div className="md:col-span-2">
              <Field label="Topic or working title">
                <Input
                  autoFocus
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="How to start a vegetable garden on a balcony"
                />
              </Field>
            </div>
            <Field label="Keywords" hint="Comma-separated. The first one is the focus keyword.">
              <Input
                value={keywords}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="balcony vegetable garden, container vegetables"
              />
            </Field>
            <Field label="Type">
              <Select value={options.postType} onChange={(e) => set('postType', e.target.value as 'post' | 'page')}>
                <option value="post">Blog post</option>
                <option value="page">Page</option>
              </Select>
            </Field>
            <OptionsFields value={options} onChange={setOptions} sections={['content']} />
            <div className="md:col-span-2">
              <Field
                label="Extra instructions"
                hint="Anything specific for this article: angle, points to cover, links to use, things to avoid."
              >
                <Textarea value={options.instructions} onChange={(e) => set('instructions', e.target.value)} />
              </Field>
            </div>
            {template(options.contentTemplateId) && (
              <TemplateNote prompt={template(options.contentTemplateId)?.prompt ?? ''} />
            )}
          </div>
        )}

        {step === 1 && (
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <Field
              label="Design template"
              hint="How the HTML should look. Works with any theme: fonts and widths stay the theme's."
            >
              <TemplateSelect
                kind="design"
                value={options.designTemplateId}
                onChange={(v) => set('designTemplateId', v)}
              />
            </Field>
            <div className="md:col-span-2">
              <Field
                label="Design instructions"
                hint='e.g. "Use orange (#ea580c) as the accent. No call-to-action box."'
              >
                <Textarea
                  value={options.designInstructions}
                  onChange={(e) => set('designInstructions', e.target.value)}
                />
              </Field>
            </div>
            {template(options.designTemplateId) && (
              <TemplateNote prompt={template(options.designTemplateId)?.prompt ?? ''} />
            )}
          </div>
        )}

        {step === 2 && <OptionsFields value={options} onChange={setOptions} sections={['media']} />}

        {step === 3 && (
          <div className="space-y-6">
            <OptionsFields value={options} onChange={setOptions} sections={['model']} />
            <Field label="When it's done">
              <Select value={delivery} onChange={(e) => setDelivery(e.target.value as 'review' | 'draft')}>
                <option value="review">Let me review it first (recommended)</option>
                <option value="draft">Send it straight to WordPress as a draft</option>
              </Select>
            </Field>
            <dl className="grid gap-x-6 gap-y-2 rounded-lg bg-slate-50 p-4 text-sm md:grid-cols-2">
              <Summary label="Topic">{topic}</Summary>
              <Summary label="Keywords">{keywords || '—'}</Summary>
              <Summary label="Length">{options.words} words</Summary>
              <Summary label="Content template">{template(options.contentTemplateId)?.name ?? 'None'}</Summary>
              <Summary label="Design template">{template(options.designTemplateId)?.name ?? 'None'}</Summary>
              <Summary label="Images">
                {options.featuredImage ? 'Featured' : 'No featured'} + {options.inlineImages} inline
              </Summary>
            </dl>
            {noTextModel && (
              <ErrorText error="No writing model is available: add an Anthropic or OpenAI API key to the server." />
            )}
            <ErrorText error={create.error} />
          </div>
        )}

        <div className="mt-8 flex justify-between">
          <Button variant="ghost" disabled={step === 0} onClick={() => setStep(step - 1)}>
            Back
          </Button>
          {step < STEPS.length - 1 ? (
            <Button disabled={!canContinue} onClick={() => setStep(step + 1)}>
              Continue
            </Button>
          ) : (
            <Button busy={create.isPending} disabled={noTextModel} onClick={() => create.mutate()}>
              Generate article
            </Button>
          )}
        </div>
      </Card>
    </>
  );
}

function TemplateNote({ prompt }: { prompt: string }) {
  return <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600 md:col-span-2">{prompt}</p>;
}

function Summary({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-slate-500">{label}</dt>
      <dd className="truncate text-right font-medium">{children}</dd>
    </div>
  );
}
