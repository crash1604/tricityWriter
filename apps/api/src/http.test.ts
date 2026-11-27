import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { toFetchRequest } from './http';

describe('toFetchRequest', () => {
  it('passes Better Auth a single client address, as resolved behind the proxy', async () => {
    const app = Fastify({ trustProxy: true });
    app.get('/ip', async (request) => ({ forwarded: toFetchRequest(request).headers.get('x-forwarded-for') }));

    const proxied = await app.inject({
      method: 'GET',
      url: '/ip',
      headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.2' },
    });
    expect(proxied.json()).toEqual({ forwarded: '203.0.113.9' });

    const direct = await app.inject({ method: 'GET', url: '/ip' });
    expect(direct.json()).toEqual({ forwarded: '127.0.0.1' });
    await app.close();
  });
});
