// Bottega, network rules. Pure given the interface table, so they are unit-tested without a network.
//
// Bottega only ever listens on private LAN addresses of this computer (10.x, 172.16-31.x, 192.168.x) and only
// answers clients that are themselves on a private address. Loopback, link-local, carrier-grade NAT (100.64/10,
// which VPN overlay networks use) and public addresses are never served.
import os from 'node:os';

/** 'a.b.c.d' -> [a, b, c, d]; null for anything else. */
export function parseIPv4(address) {
  const m = String(address ?? '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  return parts.some(n => n > 255) ? null : parts;
}

/** An IPv4-mapped IPv6 address ('::ffff:a.b.c.d') is the IPv4 address. */
export const normalizeAddress = address => String(address ?? '').replace(/^::ffff:/i, '');

/** RFC 1918 private ranges only. */
export function isPrivateLan(address) {
  const p = parseIPv4(normalizeAddress(address));
  return p !== null && (p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168));
}

export function isLoopback(address) {
  const n = normalizeAddress(address);
  return n === '::1' || parseIPv4(n)?.[0] === 127;
}

/** Adapters that are not a real LAN: VPNs and overlay networks, virtual switches, containers, tunnels. */
const NOT_A_LAN = /tailscale|zerotier|vpn|wsl|vethernet|virtual|hyper-v|vmware|virtualbox|loopback|docker|vboxnet|virbr|veth|^br-|^utun|^tun\d|^tap\d|wintun|wireguard|^wg\d|^ppp|^awdl|^llw|^bridge\d/i;

/** Private IPv4 addresses of this computer's real LAN adapters: [{name, address}]. */
export function lanInterfaces(ifaces = os.networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    if (NOT_A_LAN.test(name)) continue;
    for (const a of list ?? []) {
      if ((a.family !== 'IPv4' && a.family !== 4) || a.internal) continue;
      if (isPrivateLan(a.address)) out.push({name, address: a.address});
    }
  }
  return out;
}

/** May this client address talk to a Bottega listener? Loopback only when a listener on loopback was asked for. */
export function clientAllowed(remote, {allowLoopback = false} = {}) {
  return isPrivateLan(remote) || (allowLoopback === true && isLoopback(remote));
}

/**
 * The Host header values a listener answers to: its own address and this computer's name. Anything else (an
 * attacker's domain that points at this address) is refused, which closes DNS rebinding.
 */
export function allowedHosts(address, port, hostname = os.hostname()) {
  const names = new Set([address]);
  const h = String(hostname ?? '').toLowerCase().trim();
  if (/^[a-z0-9][a-z0-9-]*$/.test(h)) { names.add(h); names.add(`${h}.local`); }
  return new Set([...names].map(n => `${n}:${port}`));
}
