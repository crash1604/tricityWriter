'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useTemplates } from '../../../components/options';
import {
  Badge,
  Button,
  Card,
  ErrorText,
  Field,
  Input,
  Loading,
  PageHeader,
  Select,
  Textarea,
} from '../../../components/ui';
import { api, type Template } from '../../../lib/api';

type Editing = { id?: string; kind: Template['kind']; name: string; description: string; prompt: string };

export default function TemplatesPage() {
  const queryClient = useQueryClient();
  const templates = useTemplates();
  const [editing, setEditing] = useState<Editing | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['templates'] });

  const save = useMutation({
    mutationFn: (t: Editing) =>
      t.id
        ? api(`/templates/${t.id}`, {
            method: 'PATCH',
            body: { name: t.name, description: t.description, prompt: t.prompt },
          })
        : api('/templates', { method: 'POST', body: t }),
    onSuccess: () => {
      setEditing(null);
      refresh();
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api(`/templates/${id}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });

  if (templates.isPending) return <Loading />;
  if (templates.error) return <ErrorText error={templates.error} />;

  const groups: { kind: Template['kind']; title: string; description: string }[] = [
    { kind: 'content', title: 'Content templates', description: 'What to write: purpose, reader, structure and tone.' },
    {
      kind: 'design',
      title: 'Design templates',
      description: 'How the article looks: which boxes, cards, tables and colors to use.',
    },
  ];

  return (
    <>
      <PageHeader
        title="Templates"
        description="Templates capture your editorial judgment so every article, manual or automated, follows it."
        actions={
          <Button onClick={() => setEditing({ kind: 'content', name: '', description: '', prompt: '' })}>
            New template
          </Button>
        }
      />

      {editing && (
        <Card title={editing.id ? 'Edit template' : 'New template'} className="mb-6">
          <div className="grid gap-4 md:grid-cols-2">
            <Field label="Kind">
              <Select
                value={editing.kind}
                disabled={!!editing.id}
                onChange={(e) => setEditing({ ...editing, kind: e.target.value as Template['kind'] })}
              >
                <option value="content">Content</option>
                <option value="design">Design</option>
              </Select>
            </Field>
            <Field label="Name" hint="Name it by intent, e.g. “Product comparison”.">
              <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Description (optional)">
                <Input
                  value={editing.description}
                  onChange={(e) => setEditing({ ...editing, description: e.target.value })}
                />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field
                label="Instructions"
                hint="Start with when to use it and who the reader is, then the structure and tone. Keep optional sections optional."
              >
                <Textarea
                  rows={8}
                  value={editing.prompt}
                  onChange={(e) => setEditing({ ...editing, prompt: e.target.value })}
                />
              </Field>
            </div>
          </div>
          <ErrorText error={save.error} />
          <div className="mt-4 flex gap-2">
            <Button busy={save.isPending} onClick={() => save.mutate(editing)}>
              Save
            </Button>
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      <div className="space-y-8">
        {groups.map((group) => (
          <section key={group.kind}>
            <h2 className="text-sm font-semibold text-slate-800">{group.title}</h2>
            <p className="mb-3 text-sm text-slate-500">{group.description}</p>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {templates.data.templates
                .filter((t) => t.kind === group.kind)
                .map((t) => (
                  <div key={t.id} className="flex flex-col rounded-xl bg-white p-4 ring-1 ring-slate-200">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium">{t.name}</p>
                      {t.builtIn ? <Badge>Built-in</Badge> : <Badge tone="blue">Custom</Badge>}
                    </div>
                    {t.description && <p className="mt-1 text-sm text-slate-500">{t.description}</p>}
                    <p className="mt-3 line-clamp-4 text-xs text-slate-500">{t.prompt}</p>
                    <div className="mt-auto flex gap-2 pt-4">
                      {t.builtIn ? (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            setEditing({
                              kind: t.kind,
                              name: `${t.name} (copy)`,
                              description: t.description,
                              prompt: t.prompt,
                            })
                          }
                        >
                          Duplicate
                        </Button>
                      ) : (
                        <>
                          <Button variant="secondary" onClick={() => setEditing({ ...t })}>
                            Edit
                          </Button>
                          <Button
                            variant="danger"
                            busy={remove.isPending && remove.variables === t.id}
                            onClick={() => remove.mutate(t.id)}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
