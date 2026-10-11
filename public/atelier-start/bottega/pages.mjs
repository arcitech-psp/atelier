// Bottega, the pages the gateway itself serves (everything else is Atelier, forwarded). Plain HTML, no scripts,
// light and dark by the device's own setting. Every string put into a page is a constant of this file or is escaped.
const escape = text => String(text).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));

const STYLE = `
:root{color-scheme:light dark;--bg:#f6f4f0;--card:#fff;--ink:#1d1b18;--ink2:#5e5a54;--rule:#d9d5ce;--accent:#a8683a;--on-accent:#fff;--bad:#a02b1f}
@media (prefers-color-scheme:dark){:root{--bg:#171614;--card:#201f1c;--ink:#eceae6;--ink2:#b3aea6;--rule:#38352f;--accent:#d39a66;--on-accent:#1d1b18;--bad:#f08a7c}}
*{box-sizing:border-box}
body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--ink);font:16px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{width:100%;max-width:400px;display:grid;gap:14px;padding:28px 24px;border:1px solid var(--rule);border-radius:14px;background:var(--card)}
h1{margin:0;font-size:22px;line-height:28px;letter-spacing:-.01em}
p{margin:0;color:var(--ink2);font-size:15px}
.kicker{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--accent);font-weight:600}
label{display:grid;gap:6px;font-size:14px;color:var(--ink2)}
input{width:100%;min-width:0;font:inherit;padding:12px;border-radius:10px;border:1px solid var(--rule);background:var(--bg);color:var(--ink)}
input[name=code]{font:600 30px ui-monospace,SFMono-Regular,Consolas,monospace;letter-spacing:.3em;text-indent:.3em;text-align:center;padding:12px 0}
button{width:100%;min-height:48px;border:0;border-radius:10px;background:var(--accent);color:var(--on-accent);font:600 16px system-ui,sans-serif;cursor:pointer}
button:focus-visible,input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.msg{color:var(--bad);font-weight:500}
small{color:var(--ink2);font-size:13px}`;

/** The page a device sees until it is paired. `message` is one of the fixed sentences below. */
export function pairPage({message = '', retryAfterSeconds = 0} = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>Pair with Atelier Bottega</title><style>${STYLE}</style></head><body><main>
<span class="kicker">Atelier Bottega</span>
<h1>Pair this device</h1>
<p>This computer shares its Atelier on your network. Enter the six-digit code shown on its Atelier start screen under Bottega.</p>
${message ? `<p class="msg" role="alert">${escape(message)}${retryAfterSeconds ? ` Try again in ${Math.ceil(retryAfterSeconds / 60)} min.` : ''}</p>` : ''}
<form method="post" action="/__bottega/pair" autocomplete="off" style="display:grid;gap:14px">
<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9 ]{6,7}" maxlength="7" required autofocus aria-label="Six-digit pairing code">
<label>Name for this device (optional)<input name="name" maxlength="40" placeholder="Tablet, Anna's phone"></label>
<button type="submit">Pair</button></form>
<small>Pairing lasts until the owner of this computer removes the device, or the device is unused for 30 days.</small>
</main></body></html>`;
}

/** Shown when a page is opened from another site and must be reloaded once from this one (see the gateway). */
export function hopPage(url) {
  const target = JSON.stringify(String(url).startsWith('/') && !String(url).startsWith('//') ? url : '/');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Atelier</title>`
    + `<script>location.replace(${target.replace(/</g, '\\u003c')})</script><noscript><a href="/">Open Atelier</a></noscript>`;
}

export const PAIR_MESSAGES = {
  none: 'No pairing code is active. On the host computer, open the Atelier start screen and choose New code under Bottega.',
  expired: 'That code has expired. On the host computer, choose New code under Bottega.',
  locked: 'Too many wrong tries. On the host computer, choose New code under Bottega.',
  wrong: 'That code is not right. Check it and try again.',
  cross: 'Refused: this request did not come from this page.',
  throttled: 'Too many wrong tries from this device.',
  big: 'Too much input.',
  method: 'Use the form.',
};
