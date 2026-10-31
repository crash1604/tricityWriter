'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { type FormEvent, useEffect, useState } from 'react';
import { type AiKey, api, isAdmin, type Me, type Role } from '../lib/api';
import { authClient } from '../lib/auth-client';
import { timeAgo } from './status';
import { Badge, Button, Card, EmptyState, ErrorText, Field, Input, Loading, Select } from './ui';

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => api<Me>('/me') });
}

function useOrigin() {
  const [origin, setOrigin] = useState('');
  useEffect(() => setOrigin(window.location.origin), []);
  return origin;
}

function CopyField({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex gap-2">
      <Input readOnly value={value} className="font-mono text-xs" />
      <Button
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </div>
  );
}

interface FullOrganization {
  id: string;
  name: string;
  members: { id: string; role: Role; userId: string; user: { name: string; email: string } }[];
  invitations: { id: string; email: string; role: Role; status: string; expiresAt: string | Date }[];
}

export function WorkspaceSettings() {
  const me = useMe();
  const router = useRouter();
  const origin = useOrigin();
  const queryClient = useQueryClient();
  const admin = isAdmin(me.data);
  const org = useQuery({
    queryKey: ['organization', me.data?.organizationId],
    queryFn: async () => {
      const result = await authClient.organization.getFullOrganization();
      if (result.error) throw new Error(result.error.message ?? 'Could not load the workspace.');
      return result.data as unknown as FullOrganization;
    },
    enabled: !!me.data,
  });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['organization'] });
  const [error, setError] = useState<string | null>(null);
  const [lastInvite, setLastInvite] = useState<string | null>(null);

  async function run<T>(action: () => Promise<{ error: { message?: string } | null; data?: T }>) {
    setError(null);
    const result = await action();
    if (result.error) setError(result.error.message ?? 'Something went wrong.');
    else await refresh();
    return result;
  }

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // React clears event.currentTarget once the handler awaits.
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const result = await run(() =>
      authClient.organization.inviteMember({
        email: String(form.get('email')),
        role: String(form.get('role')) as 'member' | 'admin',
      }),
    );
    const id = (result.data as { id?: string } | undefined)?.id;
    if (id) {
      setLastInvite(`${origin}/accept-invite/${id}`);
      formElement.reset();
    }
  }

  async function createWorkspace(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = String(new FormData(event.currentTarget).get('name')).trim();
    if (!name) return;
    const result = await authClient.organization.create({
      name,
      slug: `${name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .slice(0, 30)}-${Math.random().toString(36).slice(2, 7)}`,
    });
    if (result.error) return setError(result.error.message ?? 'Could not create the workspace.');
    await authClient.organization.setActive({ organizationId: (result.data as { id: string }).id });
    await queryClient.invalidateQueries();
    router.push('/sites');
  }

  if (me.isPending || org.isPending)
    return (
      <Card title="Workspace">
        <Loading />
      </Card>
    );
  if (!org.data) return <ErrorText error={org.error} />;
  const pending = org.data.invitations.filter((i) => i.status === 'pending');

  return (
    <Card title={`Workspace: ${org.data.name}`}>
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">Members</h3>
          <ul className="divide-y divide-slate-100 text-sm">
            {org.data.members.map((m) => (
              <li key={m.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-medium">{m.user.name}</p>
                  <p className="truncate text-xs text-slate-500">{m.user.email}</p>
                </div>
                <div className="flex items-center gap-2">
                  {admin && m.role !== 'owner' && m.userId !== me.data?.user.id ? (
                    <>
                      <Select
                        value={m.role}
                        className="w-32"
                        onChange={(e) =>
                          run(() =>
                            authClient.organization.updateMemberRole({
                              memberId: m.id,
                              role: e.target.value as 'member' | 'admin',
                            }),
                          )
                        }
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </Select>
                      <Button
                        variant="danger"
                        onClick={() => run(() => authClient.organization.removeMember({ memberIdOrEmail: m.id }))}
                      >
                        Remove
                      </Button>
                    </>
                  ) : (
                    <Badge tone={m.role === 'owner' ? 'blue' : 'gray'}>{m.role}</Badge>
                  )}
                </div>
              </li>
            ))}
          </ul>
          <ErrorText error={error} />
          {me.data?.role !== 'owner' && (
            <Button
              variant="ghost"
              onClick={async () => {
                const result = await run(() => authClient.organization.leave({ organizationId: org.data.id }));
                if (!result.error) {
                  await queryClient.invalidateQueries();
                  router.push('/sites');
                }
              }}
            >
              Leave this workspace
            </Button>
          )}
        </div>

        <div className="space-y-4">
          {admin && (
            <>
              <h3 className="text-sm font-semibold text-slate-700">Invite a teammate</h3>
              <form onSubmit={invite} className="flex items-end gap-2">
                <div className="flex-1">
                  <Field label="Email">
                    <Input name="email" type="email" required />
                  </Field>
                </div>
                <Select name="role" className="w-32" defaultValue="member" aria-label="Role">
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                </Select>
                <Button type="submit">Invite</Button>
              </form>
              {lastInvite && (
                <div className="space-y-1.5 rounded-lg bg-emerald-50 p-3 text-sm">
                  <p className="text-emerald-800">
                    {me.data?.emailDelivery
                      ? 'Invitation emailed. You can also share this link:'
                      : 'Email is not set up on this server. Send this link to your teammate:'}
                  </p>
                  <CopyField value={lastInvite} />
                </div>
              )}
              {pending.length > 0 && (
                <ul className="divide-y divide-slate-100 text-sm">
                  {pending.map((i) => (
                    <li key={i.id} className="space-y-1.5 py-2">
                      <div className="flex items-center justify-between gap-2">
                        <span>
                          {i.email} <Badge>{i.role}</Badge>
                        </span>
                        <Button
                          variant="ghost"
                          onClick={() => run(() => authClient.organization.cancelInvitation({ invitationId: i.id }))}
                        >
                          Cancel
                        </Button>
                      </div>
                      <CopyField value={`${origin}/accept-invite/${i.id}`} />
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <h3 className="pt-2 text-sm font-semibold text-slate-700">New workspace</h3>
          <form onSubmit={createWorkspace} className="flex items-end gap-2">
            <div className="flex-1">
              <Field label="Name" hint="A separate space with its own sites, templates and keys.">
                <Input name="name" placeholder="e.g. Client: Acme" />
              </Field>
            </div>
            <Button type="submit" variant="secondary">
              Create
            </Button>
          </form>
        </div>
      </div>
    </Card>
  );
}

const PROVIDERS = [
  { id: 'anthropic', label: 'Anthropic (Claude)', placeholder: 'sk-ant-…' },
  { id: 'openai', label: 'OpenAI (GPT, images)', placeholder: 'sk-…' },
] as const;

export function AiKeysSettings() {
  const me = useMe();
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ['ai-keys'], queryFn: () => api<{ keys: AiKey[] }>('/ai-keys') });
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ['ai-keys'] });
    queryClient.invalidateQueries({ queryKey: ['models'] });
  };
  const save = useMutation({
    mutationFn: ({ provider, apiKey }: { provider: string; apiKey: string }) =>
      api(`/ai-keys/${provider}`, { method: 'PUT', body: { apiKey } }),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (provider: string) => api(`/ai-keys/${provider}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const admin = isAdmin(me.data);

  return (
    <Card title="AI keys">
      <p className="mb-4 text-sm text-slate-600">
        Use your own provider accounts for this workspace. Calls are billed by the provider directly; without a key, the
        platform's keys are used (if the server allows it). Keys are verified, then stored encrypted.
      </p>
      <div className="space-y-4">
        {PROVIDERS.map((p) => {
          const current = keys.data?.keys.find((k) => k.provider === p.id);
          return (
            <form
              key={p.id}
              className="flex flex-wrap items-end gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                const form = event.currentTarget;
                save.mutate(
                  { provider: p.id, apiKey: String(new FormData(form).get('apiKey')) },
                  { onSuccess: () => form.reset() },
                );
              }}
            >
              <div className="min-w-64 flex-1">
                <Field
                  label={p.label}
                  hint={
                    current
                      ? `Using your key ending in …${current.last4} (updated ${timeAgo(String(current.updatedAt))})`
                      : 'No key: platform key'
                  }
                >
                  <Input
                    name="apiKey"
                    type="password"
                    placeholder={current ? 'Replace key' : p.placeholder}
                    disabled={!admin}
                    required
                  />
                </Field>
              </div>
              <Button type="submit" busy={save.isPending && save.variables?.provider === p.id} disabled={!admin}>
                {current ? 'Replace' : 'Save'}
              </Button>
              {current && (
                <Button variant="danger" disabled={!admin} onClick={() => remove.mutate(p.id)}>
                  Remove
                </Button>
              )}
            </form>
          );
        })}
        {!admin && <p className="text-xs text-slate-500">Only workspace owners and admins can change keys.</p>}
        <ErrorText error={save.error ?? remove.error} />
      </div>
    </Card>
  );
}

export function ConnectedApps() {
  const queryClient = useQueryClient();
  const consents = useQuery({
    queryKey: ['oauth-consents'],
    queryFn: async () => {
      const result = await authClient.oauth2.getConsents();
      if (result.error) return [];
      const rows = (result.data ?? []) as unknown as {
        id: string;
        clientId: string;
        scopes: string[] | string;
        createdAt: string;
      }[];
      return Promise.all(
        rows.map(async (row) => {
          const client = await authClient.oauth2.publicClient({ query: { client_id: row.clientId } });
          return { ...row, name: (client.data as { client_name?: string } | null)?.client_name ?? row.clientId };
        }),
      );
    },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => authClient.oauth2.deleteConsent({ id }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['oauth-consents'] }),
  });

  return (
    <Card title="Connected apps">
      <p className="mb-3 text-sm text-slate-600">AI assistants you signed in to with your account (MCP sign-in).</p>
      {consents.isPending ? (
        <Loading />
      ) : (consents.data?.length ?? 0) === 0 ? (
        <EmptyState title="No connected apps" />
      ) : (
        <ul className="divide-y divide-slate-100 text-sm">
          {consents.data?.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-3 py-2">
              <div>
                <p className="font-medium">{c.name}</p>
                <p className="text-xs text-slate-500">Connected {timeAgo(String(c.createdAt))}</p>
              </div>
              <Button
                variant="danger"
                busy={revoke.isPending && revoke.variables === c.id}
                onClick={() => revoke.mutate(c.id)}
              >
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function AccountSettings() {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(null);
    setSaved(false);
    const result = await authClient.changePassword({
      currentPassword: String(data.get('current')),
      newPassword: String(data.get('next')),
      revokeOtherSessions: true,
    });
    setBusy(false);
    if (result.error) setError(result.error.message ?? 'Could not change the password.');
    else {
      setSaved(true);
      form.reset();
    }
  }

  return (
    <Card title="Account">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Current password">
          <Input name="current" type="password" required autoComplete="current-password" />
        </Field>
        <Field label="New password" hint="At least 8 characters. Signs you out on other devices.">
          <Input name="next" type="password" required minLength={8} autoComplete="new-password" />
        </Field>
        <ErrorText error={error} />
        {saved && <p className="text-sm text-emerald-700">Password changed.</p>}
        <Button type="submit" busy={busy}>
          Change password
        </Button>
      </form>
    </Card>
  );
}
