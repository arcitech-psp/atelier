// Bottega, the gateway's own sign-in to the Atelier host.
//
// The host listens on this computer only and wants its launch token on the first visit. The gateway signs in once,
// on this computer, and keeps the resulting session cookie to itself: it attaches that cookie to what it forwards,
// so a paired device never holds the host's cookie or the launch token. Revoking a device is therefore complete:
// the device has nothing left that the host would accept.
import {readFileSync} from 'node:fs';

/** The name the gateway uses for the host, in the Host header and in cookies. It must be a loopback name. */
export const hostAuthority = port => `localhost:${port}`;

export class HostSession {
  /**
   * @param {{port: () => number, token: () => string | undefined, fetchImpl?: typeof fetch, now?: () => number}} options
   *   port: the host's port; token: where to read the launch token (read again on every sign-in, so a restarted host works).
   */
  constructor({port, token, fetchImpl = fetch, now = Date.now}) {
    this.port = port; this.token = token; this.fetch = fetchImpl; this.now = now;
    this.cached = null; this.pending = null; this.lastError = null;
  }

  /** "name=value" for the host's session cookie. Throws an Error with .code 'no-token', 'refused' or 'down'. */
  async cookie() {
    const token = this.token();
    if (this.cached && this.cached.token === token && this.now() < this.cached.until) return this.cached.cookie;
    this.pending ??= this.signIn(token).finally(() => { this.pending = null; });
    return this.pending;
  }

  invalidate() { this.cached = null; this.token.reset?.(); }

  async signIn(token) {
    const fail = (code, message) => { this.lastError = message; throw Object.assign(new Error(message), {code}); };
    if (!token) fail('no-token', 'The Atelier host has not published its sign-in. Start Atelier with the Atelier launcher.');
    let response;
    try {
      response = await this.fetch(`http://${hostAuthority(this.port())}/?token=${encodeURIComponent(token)}`,
        {redirect: 'manual', signal: AbortSignal.timeout(5000)});
    } catch { fail('down', 'The Atelier host is not answering on this computer.'); }
    const header = (response.headers.getSetCookie?.() ?? [response.headers.get('set-cookie')]).filter(Boolean)[0];
    if (response.status !== 303 || !header) fail('refused', 'The Atelier host did not accept the gateway\'s sign-in.');
    const maxAge = Number(/max-age=(\d+)/i.exec(header)?.[1] ?? 3600);
    // Renew well before the host would: at most a day, at least a minute.
    const until = this.now() + Math.min(Math.max(maxAge * 1000 - 600_000, 60_000), 86_400_000);
    this.cached = {token, cookie: header.split(';')[0], until};
    this.lastError = null;
    return this.cached.cookie;
  }
}

/**
 * Where to read the launch token: the process environment (set by launchers), else the file the launcher writes.
 * The file is re-read at most every few seconds (and at once after a failed sign-in), not on every request.
 */
export function tokenSource(file, env = process.env, {ttlMs = 3000, now = Date.now} = {}) {
  let cached;
  const read = () => {
    const fromEnv = env.DSH_BROWSER_LAUNCH_TOKEN?.trim();
    if (fromEnv) return fromEnv;
    if (cached && now() - cached.at < ttlMs) return cached.value;
    let value;
    try { value = readFileSync(file, 'utf8').trim() || undefined; } catch { value = undefined; }
    cached = {value, at: now()};
    return value;
  };
  read.reset = () => { cached = undefined; };
  return read;
}
