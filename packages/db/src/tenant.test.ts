import { randomUUID } from 'node:crypto';
import { loadRootEnv } from '@tricity/shared/env';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, migrateDatabase } from './client';
import { forOrg } from './tenant';

loadRootEnv();
const url = process.env.TEST_DATABASE_URL;

// Suites share the test database and may run in parallel, so each uses its own org ids.
describe.skipIf(!url)('forOrg (integration)', () => {
  const { db, close } = createDb(url ?? '');
  const orgA = `org_${randomUUID()}`;
  const orgB = `org_${randomUUID()}`;

  beforeAll(() => migrateDatabase(url ?? ''));
  afterAll(() => close());

  it('never returns another org’s rows', async () => {
    const a = forOrg(db, orgA);
    const b = forOrg(db, orgB);
    const siteA = await a.sites.create({ name: 'A', url: 'https://a.example' });
    await b.sites.create({ name: 'B', url: 'https://b.example' });

    expect((await a.sites.list()).map((s) => s.name)).toEqual(['A']);
    expect(await b.sites.get(siteA.id)).toBeUndefined();
    expect(await b.sites.update(siteA.id, { name: 'hijacked' })).toBeUndefined();
    expect(await b.sites.remove(siteA.id)).toBe(false);
  });

  it('records usage against the scoped org', async () => {
    const a = forOrg(db, orgA);
    await a.usage.record({
      kind: 'text',
      provider: 'anthropic',
      model: 'test-model',
      credentialOwner: 'platform',
      inputTokens: 10,
      outputTokens: 20,
      costMicroUsd: 500,
    });

    expect(await a.usage.recent()).toHaveLength(1);
    expect(await forOrg(db, orgB).usage.recent()).toHaveLength(0);
    const [summary] = await a.usage.summary(new Date(0));
    expect(summary).toMatchObject({ model: 'test-model', calls: 1, inputTokens: 10, outputTokens: 20 });
    expect(Number(summary?.costMicroUsd)).toBe(500);
  });

  it('claims each queued topic once, oldest first', async () => {
    const a = forOrg(db, orgA);
    const site = await a.sites.create({ name: 'Topics', url: 'https://topics.example' });
    await a.autoblog.addTopics(site.id, [{ topic: 'first' }]);
    await a.autoblog.addTopics(site.id, [{ topic: 'second' }]);

    const claims = await Promise.all([a.autoblog.claimNextTopic(site.id), a.autoblog.claimNextTopic(site.id)]);
    expect(claims.map((c) => c?.topic).sort()).toEqual(['first', 'second']);
    expect(await a.autoblog.claimNextTopic(site.id)).toBeUndefined();
  });
});
