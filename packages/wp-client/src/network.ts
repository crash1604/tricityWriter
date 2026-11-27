// Outbound requests to WordPress sites go to addresses users type in. On a server that would let a
// user point the API at internal services (Postgres, Redis, the cloud metadata endpoint at
// 169.254.169.254, other containers), so by default every connection must resolve to a public address.
// The check runs at connect time, on the address actually dialled, which also defeats DNS rebinding.
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Agent, fetch as undiciFetch } from 'undici';

const blocked = new BlockList();
// IPv4: "this network", private, carrier-grade NAT, loopback, link-local, IETF protocol assignments,
// documentation, 6to4 relay, benchmarking, multicast and reserved (incl. broadcast).
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv4');
}
// IPv6: unspecified/loopback/IPv4-compatible, NAT64, discard, IETF special (Teredo etc.), documentation,
// 6to4, unique local, link-local, site-local and multicast. IPv4-mapped addresses (::ffff:a.b.c.d) are
// checked against the IPv4 ranges by BlockList itself.
for (const [network, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8],
] as const) {
  blocked.addSubnet(network, prefix, 'ipv6');
}

export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 0) return false;
  return !blocked.check(address, family === 6 ? 'ipv6' : 'ipv4');
}

export class BlockedAddressError extends Error {
  readonly host: string;

  constructor(host: string) {
    super(`${host} points to a private or reserved network address`);
    this.name = 'BlockedAddressError';
    this.host = host;
  }
}

// dns.lookup that refuses to hand back any non-public address. With happy-eyeballs (`all: true`) Node
// expects the array form; otherwise the single-address form.
type LookupCallback = (error: Error | null, address?: string | LookupAddress[], family?: number) => void;

const publicOnlyLookup = ((hostname: string, options: { all?: boolean }, callback: LookupCallback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
    if (error) return callback(error);
    if (addresses.length === 0 || addresses.some((a) => !isPublicAddress(a.address))) {
      return callback(new BlockedAddressError(hostname));
    }
    if (options.all) return callback(null, addresses);
    const [first] = addresses as [LookupAddress];
    return callback(null, first.address, first.family);
  });
}) as unknown as LookupFunction;

export interface SiteFetchOptions {
  // Local development only: WordPress Playground listens on 127.0.0.1.
  allowPrivateNetworks?: boolean;
}

// The fetch used for every connector call. IP literals are checked up front (Node skips the lookup for
// them); hostnames are checked by the lookup above when the socket connects.
export function createSiteFetch(options: SiteFetchOptions = {}): typeof fetch {
  if (options.allowPrivateNetworks) return (input, init) => fetch(input, init);
  const dispatcher = new Agent({ connect: { lookup: publicOnlyLookup } });
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (isIP(host) !== 0 && !isPublicAddress(host)) throw new BlockedAddressError(url.hostname);
    return undiciFetch(url, { ...(init as object), dispatcher } as Parameters<typeof undiciFetch>[1]);
  }) as unknown as typeof fetch;
}

// fetch rejects with TypeError('fetch failed', { cause }) when the connection fails.
export function blockedAddressIn(error: unknown): BlockedAddressError | undefined {
  for (let current = error, depth = 0; current && depth < 4; depth++) {
    if (current instanceof BlockedAddressError) return current;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}
