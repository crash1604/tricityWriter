import { and, asc, count, desc, eq, gte, isNull, sql, sum } from 'drizzle-orm';
import type { Db } from './client';
import {
  aiCredentials,
  autoblogProfiles,
  autoblogTopics,
  generationImages,
  generations,
  mcpKeys,
  type NewUsageEvent,
  sites,
  templates,
  usageEvents,
} from './schema';

type Insert<T extends { $inferInsert: unknown }> = Omit<T['$inferInsert'], 'id' | 'orgId' | 'createdAt' | 'updatedAt'>;
type Patch<T extends { $inferInsert: unknown }> = Partial<Insert<T>>;

function one<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) throw new Error('expected a row');
  return row;
}

// The only way application code reads or writes tenant data: every query is pinned to one org.
export function forOrg(db: Db, orgId: string) {
  return {
    orgId,

    sites: {
      list() {
        return db.select().from(sites).where(eq(sites.orgId, orgId)).orderBy(asc(sites.createdAt));
      },
      async get(id: string) {
        const [row] = await db
          .select()
          .from(sites)
          .where(and(eq(sites.orgId, orgId), eq(sites.id, id)));
        return row;
      },
      async findByUrl(url: string) {
        const [row] = await db
          .select()
          .from(sites)
          .where(and(eq(sites.orgId, orgId), eq(sites.url, url)));
        return row;
      },
      async create(input: Insert<typeof sites>) {
        return one(
          await db
            .insert(sites)
            .values({ ...input, orgId })
            .returning(),
        );
      },
      async update(id: string, patch: Patch<typeof sites>) {
        const [row] = await db
          .update(sites)
          .set(patch)
          .where(and(eq(sites.orgId, orgId), eq(sites.id, id)))
          .returning();
        return row;
      },
      async remove(id: string) {
        const rows = await db
          .delete(sites)
          .where(and(eq(sites.orgId, orgId), eq(sites.id, id)))
          .returning({ id: sites.id });
        return rows.length > 0;
      },
    },

    templates: {
      list(kind?: 'content' | 'design') {
        return db
          .select()
          .from(templates)
          .where(and(eq(templates.orgId, orgId), kind ? eq(templates.kind, kind) : undefined))
          .orderBy(asc(templates.name));
      },
      async get(id: string) {
        const [row] = await db
          .select()
          .from(templates)
          .where(and(eq(templates.orgId, orgId), eq(templates.id, id)));
        return row;
      },
      async create(input: Insert<typeof templates>) {
        return one(
          await db
            .insert(templates)
            .values({ ...input, orgId })
            .returning(),
        );
      },
      async update(id: string, patch: Patch<typeof templates>) {
        const [row] = await db
          .update(templates)
          .set(patch)
          .where(and(eq(templates.orgId, orgId), eq(templates.id, id)))
          .returning();
        return row;
      },
      async remove(id: string) {
        const rows = await db
          .delete(templates)
          .where(and(eq(templates.orgId, orgId), eq(templates.id, id)))
          .returning({ id: templates.id });
        return rows.length > 0;
      },
    },

    generations: {
      list(options: { siteId?: string; source?: 'wizard' | 'autoblog' | 'mcp'; limit?: number } = {}) {
        return db
          .select()
          .from(generations)
          .where(
            and(
              eq(generations.orgId, orgId),
              options.siteId ? eq(generations.siteId, options.siteId) : undefined,
              options.source ? eq(generations.source, options.source) : undefined,
            ),
          )
          .orderBy(desc(generations.createdAt))
          .limit(options.limit ?? 50);
      },
      async get(id: string) {
        const [row] = await db
          .select()
          .from(generations)
          .where(and(eq(generations.orgId, orgId), eq(generations.id, id)));
        return row;
      },
      async create(input: Insert<typeof generations>) {
        return one(
          await db
            .insert(generations)
            .values({ ...input, orgId })
            .returning(),
        );
      },
      async update(id: string, patch: Patch<typeof generations>) {
        const [row] = await db
          .update(generations)
          .set(patch)
          .where(and(eq(generations.orgId, orgId), eq(generations.id, id)))
          .returning();
        return row;
      },
    },

    images: {
      list(generationId: string) {
        return db
          .select()
          .from(generationImages)
          .where(and(eq(generationImages.orgId, orgId), eq(generationImages.generationId, generationId)))
          .orderBy(asc(generationImages.slot));
      },
      async get(generationId: string, slot: number) {
        const [row] = await db
          .select()
          .from(generationImages)
          .where(
            and(
              eq(generationImages.orgId, orgId),
              eq(generationImages.generationId, generationId),
              eq(generationImages.slot, slot),
            ),
          );
        return row;
      },
      async put(input: Insert<typeof generationImages>) {
        return one(
          await db
            .insert(generationImages)
            .values({ ...input, orgId })
            .onConflictDoUpdate({
              target: [generationImages.generationId, generationImages.slot],
              set: { ...input, wpMediaId: null, wpUrl: null },
            })
            .returning(),
        );
      },
      async update(id: string, patch: Patch<typeof generationImages>) {
        await db
          .update(generationImages)
          .set(patch)
          .where(and(eq(generationImages.orgId, orgId), eq(generationImages.id, id)));
      },
      async removeAll(generationId: string) {
        await db
          .delete(generationImages)
          .where(and(eq(generationImages.orgId, orgId), eq(generationImages.generationId, generationId)));
      },
    },

    autoblog: {
      async getProfile(siteId: string) {
        const [row] = await db
          .select()
          .from(autoblogProfiles)
          .where(and(eq(autoblogProfiles.orgId, orgId), eq(autoblogProfiles.siteId, siteId)));
        return row;
      },
      async upsertProfile(siteId: string, values: Patch<typeof autoblogProfiles> & { settings: unknown }) {
        return one(
          await db
            .insert(autoblogProfiles)
            .values({ ...values, siteId, orgId })
            .onConflictDoUpdate({ target: autoblogProfiles.siteId, set: values })
            .returning(),
        );
      },
      listTopics(siteId: string, status?: 'queued' | 'used' | 'failed') {
        return db
          .select()
          .from(autoblogTopics)
          .where(
            and(
              eq(autoblogTopics.orgId, orgId),
              eq(autoblogTopics.siteId, siteId),
              status ? eq(autoblogTopics.status, status) : undefined,
            ),
          )
          .orderBy(asc(autoblogTopics.createdAt))
          .limit(500);
      },
      async addTopics(siteId: string, topics: { topic: string; keywords?: string }[]) {
        if (topics.length === 0) return [];
        return db
          .insert(autoblogTopics)
          .values(topics.map((t) => ({ siteId, orgId, topic: t.topic, keywords: t.keywords ?? '' })))
          .returning();
      },
      async removeTopic(id: string) {
        const rows = await db
          .delete(autoblogTopics)
          .where(and(eq(autoblogTopics.orgId, orgId), eq(autoblogTopics.id, id), eq(autoblogTopics.status, 'queued')))
          .returning({ id: autoblogTopics.id });
        return rows.length > 0;
      },
      // Takes the oldest queued topic so concurrent runs never pick the same one.
      claimNextTopic(siteId: string) {
        return db.transaction(async (tx) => {
          const [next] = await tx
            .select()
            .from(autoblogTopics)
            .where(
              and(
                eq(autoblogTopics.orgId, orgId),
                eq(autoblogTopics.siteId, siteId),
                eq(autoblogTopics.status, 'queued'),
              ),
            )
            .orderBy(asc(autoblogTopics.createdAt))
            .limit(1)
            .for('update', { skipLocked: true });
          if (!next) return undefined;
          const [claimed] = await tx
            .update(autoblogTopics)
            .set({ status: 'used', usedAt: new Date() })
            .where(eq(autoblogTopics.id, next.id))
            .returning();
          return claimed;
        });
      },
      async updateTopic(id: string, patch: Patch<typeof autoblogTopics>) {
        await db
          .update(autoblogTopics)
          .set(patch)
          .where(and(eq(autoblogTopics.orgId, orgId), eq(autoblogTopics.id, id)));
      },
      async countQueued(siteId: string) {
        const [row] = await db
          .select({ n: count() })
          .from(autoblogTopics)
          .where(
            and(
              eq(autoblogTopics.orgId, orgId),
              eq(autoblogTopics.siteId, siteId),
              eq(autoblogTopics.status, 'queued'),
            ),
          );
        return row?.n ?? 0;
      },
    },

    mcpKeys: {
      list() {
        return db
          .select({
            id: mcpKeys.id,
            name: mcpKeys.name,
            prefix: mcpKeys.prefix,
            userId: mcpKeys.userId,
            lastUsedAt: mcpKeys.lastUsedAt,
            createdAt: mcpKeys.createdAt,
          })
          .from(mcpKeys)
          .where(and(eq(mcpKeys.orgId, orgId), isNull(mcpKeys.revokedAt)))
          .orderBy(desc(mcpKeys.createdAt));
      },
      async create(input: Insert<typeof mcpKeys>) {
        return one(
          await db
            .insert(mcpKeys)
            .values({ ...input, orgId })
            .returning(),
        );
      },
      async revoke(id: string) {
        const rows = await db
          .update(mcpKeys)
          .set({ revokedAt: new Date() })
          .where(and(eq(mcpKeys.orgId, orgId), eq(mcpKeys.id, id), isNull(mcpKeys.revokedAt)))
          .returning({ id: mcpKeys.id });
        return rows.length > 0;
      },
    },

    aiCredentials: {
      list() {
        return db
          .select()
          .from(aiCredentials)
          .where(eq(aiCredentials.orgId, orgId))
          .orderBy(asc(aiCredentials.provider));
      },
      async upsert(
        provider: 'anthropic' | 'openai',
        values: { keyCiphertext: string; keyLast4: string; createdBy?: string },
      ) {
        return one(
          await db
            .insert(aiCredentials)
            .values({ ...values, provider, orgId })
            .onConflictDoUpdate({ target: [aiCredentials.orgId, aiCredentials.provider], set: values })
            .returning(),
        );
      },
      async remove(provider: 'anthropic' | 'openai') {
        const rows = await db
          .delete(aiCredentials)
          .where(and(eq(aiCredentials.orgId, orgId), eq(aiCredentials.provider, provider)))
          .returning({ id: aiCredentials.id });
        return rows.length > 0;
      },
    },

    usage: {
      async record(event: Omit<NewUsageEvent, 'id' | 'orgId' | 'createdAt'>) {
        await db.insert(usageEvents).values({ ...event, orgId });
      },
      recent(limit = 50) {
        return db
          .select()
          .from(usageEvents)
          .where(eq(usageEvents.orgId, orgId))
          .orderBy(desc(usageEvents.createdAt))
          .limit(limit);
      },
      summary(since: Date) {
        return db
          .select({
            kind: usageEvents.kind,
            provider: usageEvents.provider,
            model: usageEvents.model,
            calls: count(),
            inputTokens: sql<number>`coalesce(${sum(usageEvents.inputTokens)}, 0)::int`,
            outputTokens: sql<number>`coalesce(${sum(usageEvents.outputTokens)}, 0)::int`,
            images: sql<number>`coalesce(${sum(usageEvents.images)}, 0)::int`,
            costMicroUsd: sql<number>`coalesce(${sum(usageEvents.costMicroUsd)}, 0)::bigint`,
          })
          .from(usageEvents)
          .where(and(eq(usageEvents.orgId, orgId), gte(usageEvents.createdAt, since)))
          .groupBy(usageEvents.kind, usageEvents.provider, usageEvents.model);
      },
      async generationsSince(since: Date) {
        const [row] = await db
          .select({ n: count() })
          .from(generations)
          .where(and(eq(generations.orgId, orgId), gte(generations.createdAt, since)));
        return row?.n ?? 0;
      },
    },
  };
}

export type OrgScope = ReturnType<typeof forOrg>;

// Lookups that must cross tenants by design. Keep this list short and say why for each.
export const system = {
  // An MCP bearer key identifies its org; we cannot scope before we know which org it is.
  async findMcpKeyByHash(db: Db, keyHash: string) {
    const [row] = await db
      .select()
      .from(mcpKeys)
      .where(and(eq(mcpKeys.keyHash, keyHash), isNull(mcpKeys.revokedAt)));
    return row;
  },
  async touchMcpKey(db: Db, id: string) {
    await db.update(mcpKeys).set({ lastUsedAt: new Date() }).where(eq(mcpKeys.id, id));
  },
  // The worker re-registers every enabled schedule on startup.
  listEnabledAutoblogProfiles(db: Db) {
    return db
      .select({
        orgId: autoblogProfiles.orgId,
        siteId: autoblogProfiles.siteId,
        schedule: autoblogProfiles.schedule,
        timezone: autoblogProfiles.timezone,
      })
      .from(autoblogProfiles)
      .where(eq(autoblogProfiles.enabled, true));
  },
};
