'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type FormEvent, useEffect, useState } from 'react';
import { useModels } from '../../../components/options';
import { AccountSettings, AiKeysSettings, ConnectedApps, WorkspaceSettings } from '../../../components/settings';
import { timeAgo } from '../../../components/status';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Loading, PageHeader } from '../../../components/ui';
import { api, type McpKey, type UsageSummary } from '../../../lib/api';

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <WorkspaceSettings />
        <AiKeysSettings />
        <McpSettings />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ConnectedApps />
          <AccountSettings />
        </div>
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <Models />
          <Usage />
        </div>
      </div>
    </>
  );
}

function McpSettings() {
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ['mcp-keys'], queryFn: () => api<{ keys: McpKey[] }>('/mcp-keys') });
  const [created, setCreated] = useState<string | null>(null);
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  const url = `${origin}/mcp`;

  const create = useMutation({
    mutationFn: (name: string) => api<{ key: string }>('/mcp-keys', { method: 'POST', body: { name } }),
    onSuccess: (data) => {
      setCreated(data.key);
      queryClient.invalidateQueries({ queryKey: ['mcp-keys'] });
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api(`/mcp-keys/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mcp-keys'] }),
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    create.mutate(String(new FormData(form).get('name')));
    form.reset();
  }

  const key = created ?? '<your key>';
  const json = JSON.stringify(
    { mcpServers: { 'tricity-writer': { url, headers: { Authorization: `Bearer ${key}` } } } },
    null,
    2,
  );

  return (
    <Card title="AI assistants (MCP)">
      <p className="mb-4 text-sm text-slate-600">
        Connect Claude, ChatGPT, Cursor or any MCP client to manage your sites by conversation. Each key acts for this
        workspace.
      </p>
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          <form onSubmit={submit} className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="New key">
                <Input name="name" placeholder="e.g. Claude Desktop" required />
              </Field>
            </div>
            <Button type="submit" busy={create.isPending}>
              Create
            </Button>
          </form>
          <ErrorText error={create.error ?? revoke.error} />
          {created && (
            <div className="rounded-lg bg-emerald-50 p-3 text-sm">
              <p className="mb-1 font-medium text-emerald-800">Copy this key now. It won't be shown again.</p>
              <code className="block break-all rounded bg-white px-2 py-1 font-mono text-xs">{created}</code>
            </div>
          )}
          {keys.isPending ? (
            <Loading />
          ) : (keys.data?.keys.length ?? 0) === 0 ? (
            <EmptyState title="No keys yet" />
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {keys.data?.keys.map((k) => (
                <li key={k.id} className="flex items-center justify-between gap-3 py-2">
                  <div>
                    <p className="font-medium">{k.name}</p>
                    <p className="text-xs text-slate-500">
                      <code>{k.prefix}…</code> · last used {timeAgo(k.lastUsedAt)}
                    </p>
                  </div>
                  <Button variant="danger" onClick={() => revoke.mutate(k.id)}>
                    Revoke
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-3 text-sm">
          <Field label="Server URL (Streamable HTTP)">
            <Input readOnly value={url} className="font-mono" />
          </Field>
          <p className="font-medium text-slate-700">Claude Code</p>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">
            {`claude mcp add --transport http tricity-writer ${url} \\\n  --header "Authorization: Bearer ${key}"`}
          </pre>
          <p className="font-medium text-slate-700">Claude Desktop, Cursor and other JSON configs</p>
          <pre className="overflow-x-auto rounded-lg bg-slate-900 p-3 text-xs text-slate-100">{json}</pre>
        </div>
      </div>
    </Card>
  );
}

function Models() {
  const models = useModels();
  return (
    <Card title="AI models">
      {models.isPending ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {models.data?.models.map((m) => (
            <li key={m.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="font-medium">
                  {m.label} <span className="text-xs font-normal text-slate-400">{m.kind}</span>
                </p>
                <p className="text-xs text-slate-500">{m.description}</p>
              </div>
              {m.available ? <Badge tone="green">Available</Badge> : <Badge>No {m.provider} key</Badge>}
            </li>
          ))}
        </ul>
      )}
      {models.data?.fake && (
        <p className="mt-3 text-xs text-amber-700">Fake mode is on: models report available, output is placeholder.</p>
      )}
    </Card>
  );
}

// The included monthly AI usage on the platform's keys, shared by every workspace with the same owner.
// The workspace's own keys don't count.
function Allowance({ used, budget }: { used: number; budget: number }) {
  const share = budget > 0 ? Math.min(1, used / budget) : 1;
  const spent = share >= 1;
  return (
    <div className="mb-4 rounded-lg bg-slate-50 p-3 text-sm">
      <div className="mb-1.5 flex justify-between">
        <span className="font-medium text-slate-700">Included AI usage</span>
        <span className="text-slate-500">
          ${Math.min(used, budget).toFixed(2)} of ${budget.toFixed(2)}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(share * 100)}
        aria-label="Included AI usage this month"
      >
        <div
          className={spent ? 'h-full bg-red-500' : share > 0.8 ? 'h-full bg-amber-500' : 'h-full bg-brand-600'}
          style={{ width: `${share * 100}%` }}
        />
      </div>
      <p className="mt-1.5 text-xs text-slate-500">
        {spent
          ? 'Used up for this month. Add your own keys under AI keys to keep writing.'
          : 'Shared by every workspace with the same owner, and resets on the 1st (UTC). Articles written with your own AI keys never count.'}
      </p>
    </div>
  );
}

function Usage() {
  const usage = useQuery({ queryKey: ['usage'], queryFn: () => api<UsageSummary>('/usage') });
  if (usage.isPending)
    return (
      <Card title="Usage this month">
        <Loading />
      </Card>
    );
  if (usage.error) return <ErrorText error={usage.error} />;
  const u = usage.data;
  return (
    <Card title="Usage this month">
      <dl className="mb-4 grid grid-cols-3 gap-4 text-center">
        <Stat label="Articles" value={u.articles} />
        <Stat label="Images" value={u.totals.images} />
        <Stat label="Est. AI cost" value={`$${u.totals.costUsd.toFixed(2)}`} />
      </dl>
      {u.platform.budgetUsd !== null && <Allowance used={u.platform.usedUsd} budget={u.platform.budgetUsd} />}
      {u.byModel.length === 0 ? (
        <EmptyState title="No AI calls yet" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-slate-500">
              <tr>
                <th className="pb-2 font-medium">Model</th>
                <th className="pb-2 font-medium">Calls</th>
                <th className="pb-2 font-medium">Tokens in / out</th>
                <th className="pb-2 font-medium">Cost</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {u.byModel.map((r) => (
                <tr key={`${r.provider}-${r.model}`}>
                  <td className="py-1.5">
                    {r.model}
                    {r.provider === 'fake' && <span className="text-xs text-slate-400"> (fake)</span>}
                  </td>
                  <td className="py-1.5">{r.calls}</td>
                  <td className="py-1.5">
                    {r.kind === 'image'
                      ? `${r.images} images`
                      : `${r.inputTokens.toLocaleString()} / ${r.outputTokens.toLocaleString()}`}
                  </td>
                  <td className="py-1.5">${(r.costMicroUsd / 1_000_000).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-slate-50 py-3">
      <dd className="text-lg font-semibold">{value}</dd>
      <dt className="text-xs text-slate-500">{label}</dt>
    </div>
  );
}
