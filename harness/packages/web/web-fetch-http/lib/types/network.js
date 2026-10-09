/**
 * Public-network resolution and address-pinned HTTP transport for `web-fetch-http`.
 * One DNS answer set is validated before Undici receives it through a custom lookup,
 * so the connection cannot resolve the hostname again to a private address.
 *
 * @module @deepseek-ai/dsh-web-fetch-http/network
 */
import { lookup as systemLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import ipaddr from 'ipaddr.js';
import { WebError } from '@deepseek-ai/dsh-web';
/** RFC 6052 prefix lengths that may carry an IPv4 destination through NAT64. */
const RFC6052_PREFIX_LENGTHS = [32, 40, 48, 56, 64, 96];
const IPV4ONLY_DISCOVERY_HOST = 'ipv4only.arpa';
const isIpv4onlySentinel = address => { const octets = address.split('.').map(Number); return octets.length === 4 && octets[0] === 192 && octets[1] === 0 && octets[2] === 0 && (octets[3] === 170 || octets[3] === 171); };
/**
 * Return whether an address is globally reachable unicast. IPv4-mapped IPv6 is
 * classified by its embedded IPv4 address; transition and translation prefixes
 * remain blocked because their eventual IPv4 destination cannot be pinned here.
 *
 * @param input - textual IPv4 or IPv6 address.
 * @returns true only for a public unicast destination.
 */
export function isPublicIpAddress(input) {
    let parsed;
    try {
        parsed = ipaddr.parse(stripIpv6Brackets(input));
    }
    catch {
        return false;
    }
    if (parsed instanceof ipaddr.IPv4)
        return parsed.range() === 'unicast';
    if (parsed.isIPv4MappedAddress())
        return parsed.toIPv4Address().range() === 'unicast';
    return parsed.range() === 'unicast';
}
/**
 * Resolve a hostname once and reject the complete answer set if any destination
 * is not public. The returned addresses are the only ones the transport may use.
 *
 * @param hostname - URL hostname, including brackets when it is an IPv6 literal.
 * @param signal - aborts the wait for system resolution; an in-flight OS lookup may finish unused.
 * @param resolver - lookup implementation, overridden only by focused tests.
 * @returns the validated, non-empty address set.
 */
export async function resolvePublicAddresses(hostname, signal, resolver = systemLookup) {
    const unbracketed = stripIpv6Brackets(hostname);
    const literalFamily = isIP(unbracketed);
    const resolved = literalFamily === 0
        ? await raceWithSignal(resolver(unbracketed, { all: true, order: 'verbatim' }), signal)
        : [{ address: unbracketed, family: literalFamily }];
    if (resolved.length === 0) {
        throw new WebError(`hostname "${hostname}" resolved to no addresses`, 'WEB_PROVIDER_ERROR');
    }
    const hasIpv6 = resolved.some(entry => entry.family === 6 && isIP(entry.address) === 6);
    const nat64Prefixes = hasIpv6
        ? await discoverNat64Prefixes(signal, resolver)
        : [];
    const addresses = [];
    for (const entry of resolved) {
        if ((entry.family !== 4 && entry.family !== 6) || isIP(entry.address) !== entry.family) {
            throw new WebError(`hostname "${hostname}" resolved to an invalid IP address`, 'WEB_PROVIDER_ERROR');
        }
        if (!isPublicIpAddress(entry.address)) {
            throw new WebError(`URL hostname "${hostname}" resolves to a non-public IP address`, 'WEB_BLOCKED_URL');
        }
        const translatedIpv4 = translatedIpv4Address(entry.address, nat64Prefixes);
        if (translatedIpv4 !== undefined && !isPublicIpAddress(translatedIpv4)) {
            throw new WebError(`URL hostname "${hostname}" resolves through NAT64 to a non-public IPv4 address`, 'WEB_BLOCKED_URL');
        }
        addresses.push({ address: entry.address, family: entry.family });
    }
    return addresses;
}
/** Discover the active DNS64 prefix set using RFC 7050's reserved hostname. */
async function discoverNat64Prefixes(signal, resolver) {
    const discovered = await raceWithSignal(resolver(IPV4ONLY_DISCOVERY_HOST, { all: true, order: 'verbatim' }), signal);
    const prefixes = [];
    const seen = new Set();
    for (const entry of discovered) {
        if (entry.family !== 6 || isIP(entry.address) !== 6)
            continue;
        const bytes = ipaddr.parse(entry.address).toByteArray();
        for (const length of RFC6052_PREFIX_LENGTHS) {
            const embedded = embeddedIpv4Address(bytes, length);
            if (embedded === undefined || !isIpv4onlySentinel(embedded))
                continue;
            const prefixBytes = bytes.slice(0, length / 8);
            const key = `${String(length)}:${prefixBytes.join('.')}`;
            if (seen.has(key))
                continue;
            seen.add(key);
            prefixes.push({ bytes: prefixBytes, length });
        }
    }
    return prefixes;
}
/** Return the RFC 6052-embedded IPv4 address when an IPv6 address matches a discovered prefix. */
function translatedIpv4Address(input, prefixes) {
    if (isIP(input) !== 6)
        return undefined;
    const bytes = ipaddr.parse(input).toByteArray();
    for (const prefix of prefixes) {
        if (!prefix.bytes.every((byte, index) => bytes[index] === byte))
            continue;
        const embedded = embeddedIpv4Address(bytes, prefix.length);
        if (embedded !== undefined)
            return embedded;
    }
    return undefined;
}
/** Extract one IPv4 address from an RFC 6052 IPv6 layout. */
function embeddedIpv4Address(bytes, prefixLength) {
    if (prefixLength === 96)
        return bytes.slice(12, 16).join('.');
    if (bytes[8] !== 0)
        return undefined;
    const prefixBytes = prefixLength / 8;
    const beforeReservedOctet = 8 - prefixBytes;
    const ipv4 = [
        ...bytes.slice(prefixBytes, prefixBytes + beforeReservedOctet),
        ...bytes.slice(9, 9 + 4 - beforeReservedOctet),
    ];
    return ipv4.join('.');
}
/**
 * Fetch through an Undici agent whose lookup callback returns only the already
 * validated address set. The URL hostname remains intact for HTTP Host and TLS SNI.
 *
 * @param url - validated HTTP(S) URL.
 * @param addresses - public addresses returned by {@link resolvePublicAddresses}.
 * @param headers - request headers.
 * @param signal - request and body-read cancellation signal.
 * @returns a response plus the dispatcher disposer its consumer must call.
 */
export async function requestPinned(url, addresses, headers, signal) {
    // Keep the Node-only transport out of browser-worker startup. The preview
    // can load the provider and fail loud at its DNS stub without evaluating
    // Undici; a real request on Node resolves this maintained dependency here.
    const { Agent, fetch } = await import('undici');
    const dispatcher = new Agent({
        autoSelectFamily: true,
        connect: { lookup: createPinnedLookup(addresses) },
    });
    try {
        const response = await fetch(url, { method: 'GET', redirect: 'manual', headers, signal, dispatcher });
        return { response, close: async () => { await dispatcher.close(); } };
    }
    catch (error) {
        await dispatcher.close();
        throw error;
    }
}
/** Production network operations kept as an object so provider tests can replace resolution only. */
export const publicHttpNetwork = {
    resolve: resolvePublicAddresses,
    request: requestPinned,
};
/**
 * Build the connector lookup that serves a fixed validated answer set.
 *
 * @param addresses - public addresses retained from the preceding resolution.
 * @returns a Node-compatible lookup callback that performs no network resolution.
 */
export function createPinnedLookup(addresses) {
    return (hostname, options, callback) => {
        const family = typeof options.family === 'number'
            ? options.family
            : options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : 0;
        const eligible = family === 0 ? addresses : addresses.filter(address => address.family === family);
        const selected = eligible[0];
        if (selected === undefined) {
            const error = Object.assign(new Error(`no validated address for ${hostname} in family ${family}`), {
                code: 'ENOTFOUND',
                hostname,
            });
            callback(error, options.all === true ? [] : '', family);
            return;
        }
        if (options.all === true) {
            callback(null, eligible.map(address => ({ ...address })));
            return;
        }
        callback(null, selected.address, selected.family);
    };
}
/** Race a non-cancellable OS lookup without letting it delay tool cancellation. */
function raceWithSignal(promise, signal) {
    const abortError = () => new Error('web fetch aborted during hostname resolution', { cause: signal.reason });
    if (signal.aborted)
        return Promise.reject(abortError());
    return new Promise((resolve, reject) => {
        const abort = () => { reject(abortError()); };
        signal.addEventListener('abort', abort, { once: true });
        promise.then(resolve, reject).finally(() => { signal.removeEventListener('abort', abort); });
    });
}
/** WHATWG URL retains brackets around IPv6 hostnames; IP parsers do not. */
function stripIpv6Brackets(hostname) {
    return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;
}
