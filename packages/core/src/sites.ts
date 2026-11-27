import { forOrg, type Site } from '@tricity/db';
import type { StatusResponse } from '@tricity/shared';
import { ConnectorClient, ConnectorError } from '@tricity/wp-client';
import { requireAdmin } from './access';
import { decryptSecret, encryptSecret } from './crypto';
import type { Actor, CoreDeps } from './deps';
import { AppError, notFound, toAppError } from './errors';
import { isUuid } from './ids';
import { normalizeSiteUrl } from './urls';

// A site as returned to API/MCP callers; the encrypted token never leaves core.
export type PublicSite = Omit<Site, 'tokenCiphertext'>;

export function toPublicSite(site: Site): PublicSite {
  const { tokenCiphertext: _token, ...rest } = site;
  return rest;
}

export async function listSites(deps: CoreDeps, actor: Actor): Promise<PublicSite[]> {
  return (await forOrg(deps.db, actor.orgId).sites.list()).map(toPublicSite);
}

export async function getSite(deps: CoreDeps, actor: Actor, siteId: string): Promise<Site> {
  if (!isUuid(siteId)) throw notFound('Site');
  const site = await forOrg(deps.db, actor.orgId).sites.get(siteId);
  if (!site) throw notFound('Site');
  return site;
}

// Connects a WordPress site using a pairing code generated in its admin. Re-pairing an existing
// address replaces its token.
export async function pairSite(
  deps: CoreDeps,
  actor: Actor,
  input: { url: string; code: string },
): Promise<PublicSite> {
  const url = normalizeSiteUrl(input.url);
  const client = new ConnectorClient({ siteUrl: url, userAgent: deps.userAgent, fetch: deps.fetch });

  try {
    await client.ping();
  } catch (error) {
    if (error instanceof ConnectorError && error.code === 'tcw_blocked_address') {
      throw new AppError('invalid', `${error.message}.`);
    }
    if (error instanceof ConnectorError && error.code === 'rest_no_route') {
      throw new AppError('site_error', 'The TriCity Writer Connector plugin is not active on this site.');
    }
    if (
      error instanceof ConnectorError &&
      (error.code === 'tcw_rest_unreachable' || error.code === 'tcw_unreachable')
    ) {
      throw new AppError('site_error', `No WordPress site answered at ${url}. Check the address.`);
    }
    throw toAppError(error);
  }

  let paired: Awaited<ReturnType<ConnectorClient['pair']>>;
  try {
    paired = await client.pair(input.code.trim(), deps.platformUrl);
  } catch (error) {
    if (error instanceof ConnectorError && error.code === 'tcw_invalid_code') {
      throw new AppError('invalid', 'That pairing code is invalid or has expired. Generate a new one in WordPress.');
    }
    throw toAppError(error);
  }

  const scope = forOrg(deps.db, actor.orgId);
  const values = {
    name: paired.site.name || new URL(url).host,
    url,
    homeUrl: paired.site.url,
    status: 'connected' as const,
    statusMessage: null,
    lastCheckedAt: new Date(),
    routeStyle: client.routeStyle ?? null,
    connectionId: paired.connection_id,
    tokenCiphertext: encryptSecret(paired.token, deps.encryptionKey),
    wpVersion: paired.site.wp_version,
    pluginVersion: paired.site.plugin_version,
    seoPlugin: paired.site.seo_plugin,
  };
  const existing = await scope.sites.findByUrl(url);
  const site = existing ? await scope.sites.update(existing.id, values) : await scope.sites.create(values);
  if (!site) throw notFound('Site');
  return toPublicSite(site);
}

export function siteClient(deps: CoreDeps, site: Site): ConnectorClient {
  if (!site.tokenCiphertext) {
    throw new AppError('site_disconnected', `${site.name} is not connected. Pair it again from WordPress.`);
  }
  return new ConnectorClient({
    siteUrl: site.url,
    token: decryptSecret(site.tokenCiphertext, deps.encryptionKey),
    routeStyle: site.routeStyle ?? undefined,
    userAgent: deps.userAgent,
    fetch: deps.fetch,
  });
}

// Runs a connector call for a site, recording connection loss on the site when the token is rejected.
export async function withSite<T>(
  deps: CoreDeps,
  actor: Actor,
  siteId: string,
  fn: (client: ConnectorClient, site: Site) => Promise<T>,
): Promise<T> {
  const site = await getSite(deps, actor, siteId);
  try {
    return await fn(siteClient(deps, site), site);
  } catch (error) {
    if (error instanceof ConnectorError && error.status === 401) {
      await forOrg(deps.db, actor.orgId).sites.update(site.id, {
        status: 'disconnected',
        statusMessage: error.message,
        lastCheckedAt: new Date(),
      });
    }
    throw toAppError(error);
  }
}

export interface SiteHealth {
  site: PublicSite;
  status: StatusResponse | null;
}

// Calls the connector's status endpoint and records the outcome on the site.
export async function refreshSite(deps: CoreDeps, actor: Actor, siteId: string): Promise<SiteHealth> {
  const scope = forOrg(deps.db, actor.orgId);
  const site = await getSite(deps, actor, siteId);
  try {
    const client = siteClient(deps, site);
    const status = await client.status(deps.platformUrl);
    const updated = await scope.sites.update(site.id, {
      status: 'connected',
      statusMessage: null,
      lastCheckedAt: new Date(),
      homeUrl: status.site.url,
      routeStyle: client.routeStyle ?? site.routeStyle,
      wpVersion: status.site.wp_version,
      pluginVersion: status.site.plugin_version,
      seoPlugin: status.site.seo_plugin,
    });
    return { site: toPublicSite(updated ?? site), status };
  } catch (error) {
    const disconnected = (error instanceof ConnectorError && error.status === 401) || error instanceof AppError;
    const message = error instanceof Error ? error.message : String(error);
    const updated = await scope.sites.update(site.id, {
      status: disconnected ? 'disconnected' : 'error',
      statusMessage: message,
      lastCheckedAt: new Date(),
    });
    return { site: toPublicSite(updated ?? site), status: null };
  }
}

export async function updateSite(
  deps: CoreDeps,
  actor: Actor,
  siteId: string,
  patch: { name?: string; contentPrompt?: string; designPrompt?: string },
): Promise<PublicSite> {
  if (!isUuid(siteId)) throw notFound('Site');
  const site = await forOrg(deps.db, actor.orgId).sites.update(siteId, patch);
  if (!site) throw notFound('Site');
  return toPublicSite(site);
}

// Removes the site here and, best effort, revokes our connection on the WordPress side.
export async function removeSite(deps: CoreDeps, actor: Actor, siteId: string): Promise<void> {
  requireAdmin(actor);
  const site = await getSite(deps, actor, siteId);
  if (site.tokenCiphertext) {
    await siteClient(deps, site)
      .disconnect()
      .catch(() => undefined);
  }
  await deps.jobs.scheduleAutoblog({
    orgId: actor.orgId,
    siteId,
    enabled: false,
    schedule: '',
    timezone: 'UTC',
  });
  await forOrg(deps.db, actor.orgId).sites.remove(siteId);
}
