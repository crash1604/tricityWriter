import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorClient, ConnectorError } from './index';
import { BlockedAddressError, blockedAddressIn, createSiteFetch, isPublicAddress } from './network';

describe('isPublicAddress', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.18.0.4',
    '192.168.1.10',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.0.0.1',
    '255.255.255.255',
    '::1',
    '::',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
    'fd00::1',
    'fe80::1',
    '64:ff9b::a00:1',
    'not-an-ip',
  ])('rejects %s', (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(['8.8.8.8', '93.184.216.34', '1.1.1.1', '2606:4700:4700::1111', '::ffff:8.8.8.8'])(
    'accepts %s',
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    },
  );
});

describe('createSiteFetch', () => {
  let server: Server;
  let port = 0;

  beforeAll(async () => {
    server = createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

  const guarded = createSiteFetch();

  it.each([
    'http://127.0.0.1:PORT/',
    'http://[::1]:PORT/',
    'http://169.254.169.254/latest/meta-data/',
    'http://2130706433:PORT/',
    'http://0x7f.0.0.1:PORT/',
  ])('blocks the IP literal in %s', async (url) => {
    await expect(guarded(url.replace('PORT', String(port)))).rejects.toBeInstanceOf(BlockedAddressError);
  });

  it('blocks hostnames that resolve to private addresses when connecting', async () => {
    const error = await guarded(`http://localhost:${port}/`).catch((e: unknown) => e);
    expect(blockedAddressIn(error)).toBeInstanceOf(BlockedAddressError);
  });

  it('allows private addresses only when asked to', async () => {
    const open = createSiteFetch({ allowPrivateNetworks: true });
    const response = await open(`http://localhost:${port}/`);
    expect(await response.json()).toEqual({ ok: true });
  });

  it('reports a blocked site as a ConnectorError', async () => {
    const client = new ConnectorClient({ siteUrl: `http://localhost:${port}` });
    const error = await client.ping().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConnectorError);
    expect((error as ConnectorError).code).toBe('tcw_blocked_address');
    expect((error as ConnectorError).message).toContain('private or reserved network address');
  });
});
