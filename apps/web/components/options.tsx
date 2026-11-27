'use client';

import { useQuery } from '@tanstack/react-query';
import { api, type GenerationOptions, type ModelsResponse, type Template } from '../lib/api';
import { Field, Input, Select } from './ui';

export const DEFAULT_OPTIONS: GenerationOptions = {
  words: 1200,
  instructions: '',
  designInstructions: '',
  featuredImage: true,
  inlineImages: 2,
  imageStyle: '',
  postType: 'post',
};

export function useTemplates() {
  return useQuery({ queryKey: ['templates'], queryFn: () => api<{ templates: Template[] }>('/templates') });
}

export function useModels() {
  return useQuery({ queryKey: ['models'], queryFn: () => api<ModelsResponse>('/models') });
}

export function TemplateSelect({
  kind,
  value,
  onChange,
}: {
  kind: Template['kind'];
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const templates = useTemplates().data?.templates.filter((t) => t.kind === kind) ?? [];
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">{kind === 'content' ? 'No template (general article)' : 'No template (clean default)'}</option>
      {templates.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
          {t.builtIn ? '' : ' (custom)'}
        </option>
      ))}
    </Select>
  );
}

export function ModelSelect({
  kind,
  value,
  onChange,
}: {
  kind: 'text' | 'image';
  value: string | undefined;
  onChange: (id: string | undefined) => void;
}) {
  const data = useModels().data;
  const models = data?.models.filter((m) => m.kind === kind) ?? [];
  const fallback = data?.defaults[kind];
  return (
    <Select value={value ?? ''} onChange={(e) => onChange(e.target.value || undefined)}>
      <option value="">
        Default{fallback ? ` (${models.find((m) => m.id === fallback)?.label ?? fallback})` : ' (none available)'}
      </option>
      {models.map((m) => (
        <option key={m.id} value={m.id} disabled={!m.available}>
          {m.label}
          {m.available ? '' : ' — API key missing'}
        </option>
      ))}
    </Select>
  );
}

// The settings shared by the wizard's later steps and auto-blogging profiles.
export function OptionsFields({
  value,
  onChange,
  sections = ['content', 'design', 'media', 'model'],
}: {
  value: GenerationOptions;
  onChange: (next: GenerationOptions) => void;
  sections?: ('content' | 'design' | 'media' | 'model')[];
}) {
  const set = <K extends keyof GenerationOptions>(key: K, v: GenerationOptions[K]) => onChange({ ...value, [key]: v });
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {sections.includes('content') && (
        <>
          <Field label="Content template" hint="What to write: structure, angle and tone.">
            <TemplateSelect
              kind="content"
              value={value.contentTemplateId}
              onChange={(v) => set('contentTemplateId', v)}
            />
          </Field>
          <Field label="Length (words)">
            <Input
              type="number"
              min={300}
              max={5000}
              step={100}
              value={value.words}
              onChange={(e) => set('words', Number(e.target.value))}
            />
          </Field>
        </>
      )}
      {sections.includes('design') && (
        <Field label="Design template" hint="How it looks: boxes, cards, tables, call to action.">
          <TemplateSelect kind="design" value={value.designTemplateId} onChange={(v) => set('designTemplateId', v)} />
        </Field>
      )}
      {sections.includes('media') && (
        <>
          <Field label="Featured image">
            <Select
              value={value.featuredImage ? 'yes' : 'no'}
              onChange={(e) => set('featuredImage', e.target.value === 'yes')}
            >
              <option value="yes">Generate one</option>
              <option value="no">None</option>
            </Select>
          </Field>
          <Field label="Images inside the article">
            <Select value={value.inlineImages} onChange={(e) => set('inlineImages', Number(e.target.value))}>
              {[0, 1, 2, 3, 4, 5, 6].map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'None' : n}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Image style" hint='e.g. "bright natural-light photography" or "flat vector illustration"'>
            <Input value={value.imageStyle} onChange={(e) => set('imageStyle', e.target.value)} />
          </Field>
        </>
      )}
      {sections.includes('model') && (
        <>
          <Field label="Writing model">
            <ModelSelect kind="text" value={value.textModel} onChange={(v) => set('textModel', v)} />
          </Field>
          <Field label="Image model">
            <ModelSelect kind="image" value={value.imageModel} onChange={(v) => set('imageModel', v)} />
          </Field>
        </>
      )}
    </div>
  );
}
