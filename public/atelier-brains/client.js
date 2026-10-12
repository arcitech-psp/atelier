// Atelier Brains, browser side: Settings > General > Brains. One collapsible section with a compact row per computer
// (dot, computer, the brain that is REALLY loaded now, speed, one Change button). Change opens the choices with
// Load / Unload / Reload and an inline confirm step. Everything shown is read live from the host, which asks the real
// servers; nothing here is a stored label. Works on desktop, tablet and phone (safe-area padding, 44 px touch targets).
window.__ModuleLoader__.load({id: '@arcitech/atelier-brains', factory: require => {
  const {createElement: h, useState, useEffect, useRef, useCallback} = require('react');
  const exports = {};
  exports.inject = ['slots'];

  const API = '/api/atelier-brains';
  const OPEN_KEY = 'atelier-brains.open';

  const CSS = `
.ab{--ab-pad:max(6px,env(safe-area-inset-left,0px));display:flex;flex-direction:column;gap:6px;color:var(--dsw-alias-label-primary);padding:12px max(6px,env(safe-area-inset-right,0px)) max(12px,env(safe-area-inset-bottom,0px)) var(--ab-pad);box-sizing:border-box;max-width:100%;border-bottom:1px solid var(--dsw-alias-border-l2)}
.ab *{box-sizing:border-box}
.ab-head{display:flex;align-items:center;gap:8px;min-height:44px;width:100%;padding:6px 4px;margin:0;border:none;background:transparent;color:inherit;font:inherit;font-size:15px;font-weight:600;text-align:left;cursor:pointer;border-radius:8px}
.ab-head:hover{background:var(--dsw-alias-interactive-bg-hover)}
.ab-chev{display:inline-block;transition:transform .15s;opacity:.7;font-size:12px;width:12px}
.ab[data-open=true] .ab-chev{transform:rotate(90deg)}
.ab-sum{margin-left:auto;display:flex;gap:10px;align-items:center;font-size:12px;font-weight:400;color:var(--dsw-alias-label-secondary);min-width:0;overflow:hidden}
.ab-sum span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:34vw}
.ab-help{margin:0 4px 2px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.ab-list{display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);border-radius:12px;overflow:hidden}
.ab-row{display:flex;flex-direction:column;gap:6px;padding:10px 12px;border-top:1px solid var(--dsw-alias-border-l2)}
.ab-row:first-child{border-top:none}
.ab-main{display:grid;grid-template-columns:auto minmax(110px,150px) minmax(0,1fr) auto auto;grid-template-areas:'dot who what speed btn';align-items:center;gap:6px 10px;min-width:0}
.ab-main>.ab-dot{grid-area:dot}.ab-main>.ab-who{grid-area:who}.ab-main>.ab-what{grid-area:what}.ab-main>.ab-speed{grid-area:speed}.ab-main>.ab-btn,.ab-main>.ab-pill{grid-area:btn;justify-self:end}
.ab-dot{flex:none;width:10px;height:10px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
.ab-dot[data-tone=ok]{background:var(--dsw-alias-state-success-primary,#2eb872);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-success-primary,#2eb872) 25%,transparent)}
.ab-dot[data-tone=warn]{background:var(--dsw-alias-state-warn-label,#d9a13b);animation:ab-pulse 1.2s ease-in-out infinite}
.ab-dot[data-tone=bad]{background:var(--dsw-alias-state-error-primary,#d9534f)}
@keyframes ab-pulse{50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){.ab-dot[data-tone=warn]{animation:none}.ab-bar i{animation:none}}
.ab-who{display:flex;flex-direction:column;min-width:0}
.ab-who strong{font-size:14px;line-height:20px;font-weight:600}
.ab-gpu{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary)}
.ab-what{display:flex;flex-direction:column;min-width:0}
.ab-what b{font-size:14px;line-height:20px;font-weight:500;overflow-wrap:anywhere}
.ab-what small{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere}
.ab-speed{font-size:12px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.ab-pill{font-size:11px;line-height:16px;padding:1px 8px;border-radius:999px;border:1px solid var(--dsw-alias-border-l3);color:var(--dsw-alias-label-tertiary);white-space:nowrap}
.ab button.ab-btn{font:inherit;font-size:13px;min-height:36px;padding:4px 14px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer;white-space:nowrap}
.ab button.ab-btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.ab button.ab-btn:disabled{opacity:.45;cursor:default}
.ab button.ab-btn.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.ab button.ab-btn.danger{border-color:var(--dsw-alias-state-error-primary,#d9534f);color:var(--dsw-alias-state-error-primary,#d9534f)}

.ab-panel{display:flex;flex-direction:column;gap:10px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08))}
.ab-panel label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.ab-panel select{font:inherit;font-size:14px;min-height:40px;padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);width:100%;min-width:0}
.ab-panel select option{color:#111}
.ab-actions{display:flex;gap:8px;flex-wrap:wrap}
.ab-confirm{display:flex;flex-direction:column;gap:8px;font-size:13px;line-height:19px}
.ab-note{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.ab-bad{color:var(--dsw-alias-state-error-primary,#d9534f);font-size:13px;line-height:19px}
.ab-ok{color:var(--dsw-alias-state-success-primary,#2eb872);font-size:13px;line-height:19px}
.ab-bar{height:4px;border-radius:2px;background:var(--dsw-alias-border-l2);overflow:hidden;position:relative}
.ab-bar i{position:absolute;top:0;bottom:0;width:35%;border-radius:2px;background:var(--dsw-alias-brand-primary,#d39a66);animation:ab-slide 1.3s ease-in-out infinite}
@keyframes ab-slide{0%{left:-35%}100%{left:100%}}
.ab pre{margin:0;max-height:140px;overflow:auto;font-size:11px;line-height:16px;white-space:pre-wrap;overflow-wrap:anywhere;padding:8px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,rgba(127,127,127,.08))}
.ab details summary{cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary);min-height:32px;display:flex;align-items:center}
@media (max-width:640px){.ab-main{grid-template-columns:auto minmax(0,1fr) auto;grid-template-areas:'dot who btn' '. what what' '. speed speed'}.ab-actions .ab-btn{flex:1 1 30%}.ab-sum{display:none}.ab-speed{margin-top:-2px}}
@media (pointer:coarse){.ab button.ab-btn{min-height:44px;padding:8px 16px}.ab-panel select{min-height:44px}}
`;

  const tone = m => m.state === 'loaded' ? 'ok' : m.state === 'loading' || m.state === 'unloading' ? 'warn' : m.state === 'failed' || m.state === 'unknown' ? 'bad' : 'off';
  const minutes = s => s <= 90 ? `${s} seconds` : `${Math.ceil(s / 60)} minutes`;
  const tps = v => v ? `${v >= 100 ? Math.round(v) : v.toFixed(1)} tokens/s` : '';
  const sameName = (a, b) => !a || !b || String(a).toLowerCase().includes(String(b).toLowerCase()) || String(b).toLowerCase().includes(String(a).toLowerCase());

  function whatText(m) {
    if (m.state === 'loading' || m.state === 'unloading') return {main: m.op?.message ?? 'Working\u2026', sub: ''};
    if (m.loaded && m.control !== 'full' && m.loaded.modelName) return {main: m.loaded.modelName, sub: m.loaded.blurb ?? ''};
    if (m.loaded) return {main: m.loaded.name, sub: [m.loaded.blurb, m.loaded.modelName && !sameName(m.loaded.modelName, m.loaded.name) ? `Server says: ${m.loaded.modelName}` : ''].filter(Boolean).join(' \u00b7 ')};
    if (m.state === 'checking') return {main: 'Checking what is loaded\u2026', sub: ''};
    if (m.state === 'unknown') return {main: `Cannot reach ${m.name} right now`, sub: m.error ?? ''};
    if (m.state === 'failed') return {main: 'Nothing is loaded', sub: 'The last try did not work. See below.'};
    return {main: 'Nothing is loaded', sub: m.control === 'full' ? 'The graphics card is free.' : ''};
  }

  function confirmText(m, kind, chosen) {
    const now = m.loaded, wait = minutes(chosen?.loadSeconds ?? 180);
    if (kind === 'load') return now ? `Switch ${m.name} to ${chosen.name}? ${now.name} is unloaded first, so anything using it stops. This can take up to ${wait}.` : `Load ${chosen.name} on ${m.name}? This can take up to ${wait}.`;
    if (kind === 'unload') return `Unload ${now?.name} from ${m.name}? Anything using it stops until a brain is loaded again.`;
    return `Restart ${now?.name ?? chosen.name} on ${m.name}? It is not available for a short while.`;
  }
  const CONFIRM_BUTTON = {load: 'Yes, load it', unload: 'Yes, unload it', reload: 'Yes, restart it'};

  async function call(path, body) {
    const res = await fetch(API + path, {method: body ? 'POST' : 'GET', credentials: 'same-origin', cache: 'no-store',
      headers: body ? {'content-type': 'application/json', 'x-atelier-brains': '1'} : undefined, body: body ? JSON.stringify(body) : undefined});
    let json = null;
    try { json = await res.json(); } catch { /* handled below */ }
    if (!json) throw Error('The host did not answer.');
    return json;
  }

  function Row({m, onData}) {
    const [editing, setEditing] = useState(false);
    const [pick, setPick] = useState(m.loaded?.brainId ?? m.brains[0]?.id ?? '');
    const [confirm, setConfirm] = useState(null);
    const [sending, setSending] = useState(false);
    const [problem, setProblem] = useState('');
    const op = m.op, running = op?.running === true;
    const chosen = m.brains.find(b => b.id === pick) ?? m.brains[0];
    useEffect(() => { if (!m.brains.some(b => b.id === pick)) setPick(m.loaded?.brainId ?? m.brains[0]?.id ?? ''); }, [m.brains.length]);
    const what = whatText(m);
    const full = m.control === 'full';

    const go = async kind => {
      setSending(true); setProblem('');
      const target = kind === 'load' ? chosen.id : (m.loaded?.brainId ?? chosen.id);
      try {
        const json = await call(`/${kind}`, {machine: m.id, brainId: target});
        if (!json.ok) setProblem(json.error ?? 'That did not work.'); else { onData(json); setConfirm(null); }
      } catch (e) { setProblem(e.message); }
      setSending(false);
    };
    const freshOk = op && op.ok === true && op.finishedAt && Date.now() - op.finishedAt < 20_000;
    const loadedChosen = m.loaded?.brainId === chosen?.id;

    return h('div', {className: 'ab-row', 'data-machine': m.id, 'data-state': m.state},
      h('div', {className: 'ab-main'},
        h('span', {className: 'ab-dot', 'data-tone': tone(m), 'aria-hidden': 'true'}),
        h('div', {className: 'ab-who'}, h('strong', null, m.name), h('span', {className: 'ab-gpu'}, `${m.gpu} \u00b7 ${m.vramGb} GB`)),
        h('div', {className: 'ab-what'}, h('b', {role: 'status'}, what.main), what.sub ? h('small', null, what.sub) : null),
        m.loaded?.tps ? h('span', {className: 'ab-speed', title: 'How fast the latest replies were written'}, tps(m.loaded.tps)) : null,
        full ? h('button', {type: 'button', className: 'ab-btn ab-change', 'aria-expanded': editing, onClick: () => { setEditing(!editing); setConfirm(null); setProblem(''); }}, editing ? 'Close' : 'Change')
          : h('span', {className: 'ab-pill', title: 'This brain is managed elsewhere, so Atelier only shows it.'}, 'View only')),
      running ? h('div', {className: 'ab-bar', role: 'progressbar', 'aria-label': 'Working'}, h('i')) : null,
      !running && op && op.ok === false ? h('div', null, h('div', {className: 'ab-bad', role: 'alert'}, op.message),
        op.logTail ? h('details', null, h('summary', null, 'Show the last lines of the log'), h('pre', null, op.logTail)) : null) : null,
      !running && freshOk ? h('div', {className: 'ab-ok'}, op.message) : null,
      m.conflict ? h('div', {className: 'ab-bad'}, 'Two brains are answering on this card. Unload one of them.') : null,
      editing && full ? h('div', {className: 'ab-panel'},
        h('label', null, 'Choose a brain',
          h('select', {value: pick, disabled: running || sending, onChange: e => { setPick(e.target.value); setConfirm(null); }},
            m.brains.map(b => h('option', {key: b.id, value: b.id}, `${b.name}${b.blurb ? ` \u00b7 ${b.blurb}` : ''} \u00b7 ${b.vramGb} GB${b.loaded ? ' (loaded now)' : ''}`)))),
        confirm ? h('div', {className: 'ab-confirm', role: 'alertdialog', 'aria-label': 'Please confirm'},
          h('span', null, confirmText(m, confirm, chosen)),
          h('div', {className: 'ab-actions'},
            h('button', {type: 'button', className: `ab-btn primary${confirm === 'unload' ? ' danger' : ''}`, disabled: sending, onClick: () => go(confirm)}, sending ? 'Starting\u2026' : CONFIRM_BUTTON[confirm]),
            h('button', {type: 'button', className: 'ab-btn', disabled: sending, onClick: () => setConfirm(null)}, 'Cancel')))
          : h('div', {className: 'ab-actions'},
            h('button', {type: 'button', className: 'ab-btn primary', disabled: running || sending || loadedChosen, onClick: () => setConfirm('load')}, 'Load'),
            h('button', {type: 'button', className: 'ab-btn', disabled: running || sending || !m.loaded, onClick: () => setConfirm('unload')}, 'Unload'),
            h('button', {type: 'button', className: 'ab-btn', disabled: running || sending || !m.loaded, onClick: () => setConfirm('reload')}, 'Reload')),
        running ? h('div', {className: 'ab-note'}, 'Working on it. This page updates by itself.') : null,
        problem ? h('div', {className: 'ab-bad', role: 'alert'}, problem) : null) : null);
  }

  function Brains() {
    const [open, setOpen] = useState(() => { try { return localStorage.getItem(OPEN_KEY) !== '0'; } catch { return true; } });
    const [data, setData] = useState(null);
    const [error, setError] = useState('');
    const alive = useRef(true);
    const busy = !!data?.machines?.some(m => m.op?.running);
    const refresh = useCallback(async () => {
      try { const json = await call(''); if (alive.current) { setData(json); setError(''); } }
      catch (e) { if (alive.current) setError(e.message); }
    }, []);
    useEffect(() => { alive.current = true; void refresh(); return () => { alive.current = false; }; }, [refresh]);
    useEffect(() => {
      const every = busy ? 1500 : open ? 4000 : 12000;
      const timer = setInterval(() => { if (!document.hidden) void refresh(); }, every);
      return () => clearInterval(timer);
    }, [busy, open, refresh]);
    const toggle = () => { const next = !open; setOpen(next); try { localStorage.setItem(OPEN_KEY, next ? '1' : '0'); } catch { /* optional */ } };
    const machines = data?.machines ?? [];

    return h('section', {className: 'ab', 'data-open': open, 'aria-label': 'Brains'},
      h('button', {type: 'button', className: 'ab-head', 'aria-expanded': open, onClick: toggle},
        h('span', {className: 'ab-chev', 'aria-hidden': 'true'}, '\u25b6'), 'Brains',
        !open ? h('span', {className: 'ab-sum'}, machines.map(m => h('span', {key: m.id}, h('span', {className: 'ab-dot', 'data-tone': tone(m), style: {display: 'inline-block', width: 8, height: 8, marginRight: 5}}), `${m.name}: ${m.loaded?.name ?? (m.state === 'loading' ? 'loading\u2026' : 'none')}`))) : null),
      open ? h('p', {className: 'ab-help'}, 'The model each computer is running right now, read live from the computer itself. Press Change to load a different one.') : null,
      open && error && !data ? h('p', {className: 'ab-bad'}, `Could not read the brains: ${error}`) : null,
      open && data && data.configured === false ? h('div', {className: 'ab-note'},
        h('p', null, data.missing ? 'No brains are set up yet.' : 'The brains file has a problem.'),
        data.errors?.length ? h('ul', null, data.errors.slice(0, 5).map((e, i) => h('li', {key: i}, e))) : null,
        h('p', null, `Copy brains.example.json to brains.json${data.where ? ` (in ${data.where.replace(/[\\/][^\\/]*$/u, '')})` : ''}, list the model servers you run, then reopen this page. docs/brains.md explains each line.`)) : null,
      open && data?.errors?.length && data.configured !== false ? h('p', {className: 'ab-bad'}, `The brains file has a problem, so the last good list is shown: ${data.errors[0]}`) : null,
      open && machines.length ? h('div', {className: 'ab-list'}, machines.map(m => h(Row, {key: m.id, m, onData: setData}))) : null);
  }

  exports.apply = ctx => {
    if (typeof document !== 'undefined' && !document.getElementById('atelier-brains-style')) {
      const style = document.createElement('style'); style.id = 'atelier-brains-style'; style.textContent = CSS;
      document.head.appendChild(style); ctx.on?.('dispose', () => style.remove());
    }
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({name: 'settings.general.item', id: 'atelier-brains', order: 14}, Brains));
  };
  return exports;
}});
