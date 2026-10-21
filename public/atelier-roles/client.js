// Atelier model roles, browser side: the "Model roles" settings page (one card per role, Set me up), the first-run
// route (#model-roles), the dictation button and the "Read aloud" action. Keys are typed here and sent once to the
// local Atelier host, which stores them; they are never read back into the page.
window.__ModuleLoader__.load({id: '@arcitech/atelier-roles', factory: require => {
  const {createElement: h, Fragment, useState, useEffect, useRef, useCallback} = require('react');
  const exports = {};
  exports.inject = ['slots', 'connection'];

  const CSS = `
.atr{display:flex;flex-direction:column;gap:14px;max-width:820px;color:var(--dsw-alias-label-primary)}
.atr h2{margin:0;font-size:16px;line-height:24px;font-weight:500}
.atr h3{margin:0;font-size:14px;line-height:20px;font-weight:600}
.atr p{margin:0}
.atr .muted{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
.atr .small{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.atr .card{border:1px solid var(--dsw-alias-border-l2);border-radius:12px;padding:12px 14px;display:flex;flex-direction:column;gap:8px;background:var(--dsw-alias-bg-layer-1, transparent)}
.atr .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:10px}
.atr .row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.atr .spread{justify-content:space-between}
.atr .pill{font-size:12px;line-height:18px;padding:1px 8px;border-radius:999px;border:1px solid currentColor;white-space:nowrap}
.atr .ok{color:var(--dsw-alias-state-success-primary)}
.atr .bad{color:var(--dsw-alias-state-error-primary)}
.atr .warn{color:var(--dsw-alias-state-warn-label)}
.atr .off{color:var(--dsw-alias-label-tertiary)}
.atr .kv{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);font-family:var(--ds-font-family-code, monospace);overflow-wrap:anywhere}
.atr label{display:flex;flex-direction:column;gap:3px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.atr label.inline{flex-direction:row;align-items:center;gap:6px}
.atr input[type=text],.atr input[type=password],.atr input[type=number],.atr select{font:inherit;font-size:13px;padding:6px 8px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);min-width:0}
.atr select option{color:#111}
.atr .fields{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.atr .fields .wide{grid-column:1 / -1}
.atr button{font:inherit;font-size:13px;padding:5px 12px;border-radius:8px;border:1px solid var(--dsw-alias-border-l3);background:transparent;color:var(--dsw-alias-label-primary);cursor:pointer}
.atr button:hover{background:var(--dsw-alias-interactive-bg-hover)}
.atr button.primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground);border-color:transparent}
.atr button.link{border:none;padding:0;color:var(--dsw-alias-brand-primary);background:none}
.atr button:disabled{opacity:.5;cursor:default}
.atr .bar{height:6px;border-radius:3px;background:var(--dsw-alias-border-l2);overflow:hidden}
.atr .bar>div{height:100%;background:var(--dsw-alias-brand-primary);transition:width .4s}
.atr table{border-collapse:collapse;font-size:12px;width:100%}
.atr td,.atr th{text-align:left;padding:5px 6px;border-top:1px solid var(--dsw-alias-border-l2);vertical-align:top}
.atr a{color:var(--dsw-alias-brand-primary)}
.atr-mic{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;border-radius:8px;border:none;background:transparent;color:inherit;cursor:pointer;opacity:.8}
.atr-mic:hover{background:var(--dsw-alias-interactive-bg-hover);opacity:1}
.atr-mic[data-state=recording]{color:var(--dsw-alias-state-error-primary);opacity:1}
.atr-say{display:inline-flex;align-items:center;justify-content:center;height:24px;padding:0 6px;border-radius:6px;border:none;background:transparent;color:inherit;cursor:pointer;font-size:12px;opacity:.75}
.atr-say:hover{background:var(--dsw-alias-interactive-bg-hover);opacity:1}
`;

  const gb = n => n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.max(0.1, n / 1e6).toFixed(n >= 1e8 ? 0 : 1)} MB`;
  const toB64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const SOURCE = {kit: 'Installed by Set me up', roles: 'Your setting', environment: 'From the environment (ATELIER_IMAGE_ENDPOINT)', models: 'From the Models settings'};
  const STATE = {connected: ['Connected', 'ok'], failing: ['Failing', 'bad'], 'not-set': ['Not set', 'off'], checking: ['Checking…', 'off']};

  /** Record → 16 kHz mono WAV, which every speech-to-text server accepts. */
  async function toWav(blob) {
    const ac = new AudioContext(); const audio = await ac.decodeAudioData(await blob.arrayBuffer()); void ac.close();
    const rate = 16000, off = new OfflineAudioContext(1, Math.max(1, Math.ceil(audio.duration * rate)), rate);
    const src = off.createBufferSource(); src.buffer = audio; src.connect(off.destination); src.start();
    const pcm = (await off.startRendering()).getChannelData(0);
    const view = new DataView(new ArrayBuffer(44 + pcm.length * 2)), w = (o, s) => [...s].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
    w(0, 'RIFF'); view.setUint32(4, 36 + pcm.length * 2, true); w(8, 'WAVEfmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); w(36, 'data'); view.setUint32(40, pcm.length * 2, true);
    pcm.forEach((v, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, v)) * 0x7fff, true));
    return new Uint8Array(view.buffer);
  }

  exports.apply = ctx => {
    if (typeof document !== 'undefined' && !document.getElementById('atelier-roles-style')) {
      const style = document.createElement('style'); style.id = 'atelier-roles-style'; style.textContent = CSS;
      document.head.appendChild(style); ctx.on?.('dispose', () => style.remove());
    }
    const call = async (endpoint, payload = {}) => {
      const result = await ctx.connection.rpc.call('/atelier-roles', endpoint, payload);
      if (!result?.ok) throw Error(result?.error?.message ?? 'Atelier did not answer.');
      return result.value;
    };
    // Which optional roles are connected, shared by the chat buttons; refreshed after every change on the page.
    let available = {}, listeners = new Set();
    const refreshAvailable = async () => { try { available = await call('available'); listeners.forEach(f => f()); } catch {} };
    const useAvailable = () => { const [, tick] = useState(0); useEffect(() => { const f = () => tick(n => n + 1); listeners.add(f); return () => listeners.delete(f); }, []); return available; };
    void refreshAvailable();
    const timer = setInterval(refreshAvailable, 60_000); ctx.on?.('dispose', () => clearInterval(timer));

    // ---------------- one role card ----------------
    const RoleCard = ({role, data, onChanged}) => {
      const cfg = role.config ?? {};
      const [open, setOpen] = useState(role.required && !role.config);
      const [draft, setDraft] = useState({baseURL: cfg.baseURL ?? '', model: cfg.model ?? '', preset: cfg.preset ?? '', voice: cfg.voice ?? '', vision: cfg.vision === true, contextWindow: cfg.contextWindow ?? 32768, key: ''});
      const [note, setNote] = useState(''), [busy, setBusy] = useState(''), [result, setResult] = useState(null);
      useEffect(() => { setDraft(d => ({...d, baseURL: cfg.baseURL ?? '', model: cfg.model ?? '', preset: cfg.preset ?? '', voice: cfg.voice ?? '', vision: cfg.vision === true, contextWindow: cfg.contextWindow ?? 32768, key: ''})); }, [cfg.baseURL, cfg.model, cfg.voice, cfg.vision, cfg.contextWindow]);
      const presets = data.presets.filter(p => p.roles.includes(role.id));
      const rec = data.recommended[role.id];
      const status = role.coveredByBrain ? {state: 'connected', message: 'The brain reads images itself, so this role is not needed.'} : (result ?? role.status);
      const [label, tone] = role.coveredByBrain ? ['Covered by the brain', 'ok'] : STATE[status?.state] ?? STATE.checking;
      const set = patch => setDraft(d => ({...d, ...patch}));
      const pick = id => { const p = presets.find(x => x.id === id); set({preset: id, ...(p?.baseURL ? {baseURL: p.baseURL} : {}), ...(p?.model ? {model: p.model} : {}), ...(p?.voice ? {voice: p.voice} : {})}); setNote(p?.note ?? ''); };
      const act = async (what, fn) => { setBusy(what); try { await fn(); } catch (e) { setResult({state: 'failing', message: e.message}); } finally { setBusy(''); } };
      const payload = () => ({role: role.id, baseURL: draft.baseURL, model: draft.model, preset: draft.preset, voice: draft.voice, vision: draft.vision,
        contextWindow: Number(draft.contextWindow) || undefined, ...(draft.key ? {key: draft.key} : {})});
      const test = () => act('test', async () => setResult(await call('test', {role: role.id, draft: {baseURL: draft.baseURL, model: draft.model, voice: draft.voice, key: draft.key || undefined}})));
      const save = () => act('save', async () => { onChanged(await call('save', payload())); setResult(null); set({key: ''}); setOpen(false); void refreshAvailable(); });
      const reset = () => act('reset', async () => { onChanged(await call('reset', {role: role.id})); setResult(null); void refreshAvailable(); });
      const removeKey = () => act('save', async () => { onChanged(await call('save', {...payload(), key: ''})); void refreshAvailable(); });
      const models = status?.models ?? [];
      return h('article', {className: 'card', 'data-role': role.id},
        h('div', {className: 'row spread'}, h('h3', null, role.name, role.required ? '' : h('span', {className: 'small'}, '  optional')),
          h('span', {className: `pill ${tone}`, title: status?.message ?? ''}, label)),
        h('p', {className: 'muted'}, role.purpose),
        role.config ? h('div', {className: 'kv'}, `${cfg.model || '(no model name)'}  ·  ${cfg.baseURL || 'Models settings'}`) : null,
        h('p', {className: `small ${tone === 'bad' ? 'bad' : ''}`}, status?.message ?? ''),
        role.config?.source ? h('p', {className: 'small'}, SOURCE[role.config.source] ?? '', role.key.stored ? ' · key stored' : '') : null,
        h('div', {className: 'row'},
          h('button', {type: 'button', onClick: () => setOpen(o => !o), 'aria-expanded': open}, open ? 'Close' : role.config ? 'Change' : 'Connect'),
          h('button', {type: 'button', onClick: test, disabled: !!busy || !(draft.baseURL || cfg.baseURL)}, busy === 'test' ? 'Testing…' : 'Test'),
          h('button', {type: 'button', onClick: reset, disabled: !!busy, title: role.kitHas ? 'Use the local server installed by Set me up' : role.id === 'brain' ? 'Go back to the endpoint chosen at first start' : 'Turn this role off'}, busy === 'reset' ? '…' : 'Use default')),
        open ? h('div', {className: 'fields'},
          h('label', null, 'Server type', h('select', {value: draft.preset, onChange: e => pick(e.target.value)},
            h('option', {value: ''}, 'Choose…'), ...presets.map(p => h('option', {key: p.id, value: p.id}, p.label)))),
          h('label', null, role.id === 'image' ? 'Image model (optional)' : role.kind === 'chat' || role.kind === 'embeddings' ? 'Model name' : 'Model name (optional)',
            h('input', {type: 'text', value: draft.model, list: `atr-models-${role.id}`, onChange: e => set({model: e.target.value}), placeholder: role.id === 'stt' ? 'whisper-1' : 'as the server names it'}),
            h('datalist', {id: `atr-models-${role.id}`}, ...models.map(m => h('option', {key: m, value: m})))),
          h('label', {className: 'wide'}, role.id === 'image' ? 'Address (the full image generation URL)' : 'Address (OpenAI-compatible, usually ending in /v1)',
            h('input', {type: 'text', value: draft.baseURL, onChange: e => set({baseURL: e.target.value}), placeholder: 'http://localhost:8080/v1', spellCheck: false})),
          h('label', {className: 'wide'}, 'API key',
            h('input', {type: 'password', value: draft.key, autoComplete: 'off', onChange: e => set({key: e.target.value}),
              placeholder: role.key.fromEnvironment ? 'set in the environment' : role.key.stored ? '•••••••• stored (type to replace)' : 'leave empty for local servers'})),
          role.id === 'brain' ? h(Fragment, null,
            h('label', {className: 'inline'}, h('input', {type: 'checkbox', checked: draft.vision, onChange: e => set({vision: e.target.checked})}), 'This model reads images'),
            h('label', null, 'Context window (tokens)', h('input', {type: 'number', min: 2048, step: 1024, value: draft.contextWindow, onChange: e => set({contextWindow: e.target.value})}))) : null,
          role.id === 'tts' ? h('label', null, 'Voice', h('input', {type: 'text', value: draft.voice, onChange: e => set({voice: e.target.value}), placeholder: 'af_bella'})) : null,
          note ? h('p', {className: 'small wide'}, note) : null,
          rec ? h('p', {className: 'small wide'}, h('strong', null, 'ARCITECH recommended: '), h('a', {href: rec.source, target: '_blank', rel: 'noreferrer'}, rec.label), ' — ', rec.note) : null,
          h('div', {className: 'row wide'},
            h('button', {type: 'button', className: 'primary', onClick: save, disabled: !!busy || !draft.baseURL}, busy === 'save' ? 'Saving…' : 'Save'),
            role.key.stored && !role.key.fromEnvironment ? h('button', {type: 'button', className: 'link', onClick: removeKey, disabled: !!busy}, 'Remove stored key') : null)) : null);
    };

    // ---------------- Set me up ----------------
    const SetMeUp = ({data, onChanged}) => {
      const [tier, setTier] = useState('8gb'), [folder, setFolder] = useState(data.kit?.folder || data.defaultKitFolder);
      const [speech, setSpeech] = useState(false), [plan, setPlan] = useState(null), [err, setErr] = useState(''), [kit, setKit] = useState(data.kit);
      const running = ['downloading', 'verifying', 'unpacking', 'starting'].includes(kit?.job?.state);
      useEffect(() => {
        if (!running) return;
        const t = setInterval(async () => { try { const k = await call('kit-status'); setKit(k); if (!['downloading', 'verifying', 'unpacking', 'starting'].includes(k.job?.state)) { onChanged(await call('list', {force: true})); void check(); } } catch {} }, 1000);
        return () => clearInterval(t);
      }, [running]);
      const check = async () => { setErr(''); try { setPlan(await call('kit-plan', {tier, folder, speech})); } catch (e) { setErr(e.message); setPlan(null); } };
      useEffect(() => { setPlan(null); }, [tier, folder, speech]);
      const start = async () => { setErr(''); try { setKit(await call('kit-start', {tier, folder, speech})); } catch (e) { setErr(e.message); } };
      const tierInfo = data.tiers.find(t => t.id === tier);
      const job = kit?.job ?? {};
      const pct = job.total ? Math.min(100, Math.round(100 * job.done / job.total)) : 0;
      return h('section', {className: 'card', 'data-atelier-setup': ''},
        h('div', {className: 'row spread'}, h('h3', null, 'Set me up'), kit?.installed ? h('span', {className: 'pill ok'}, `Installed (${kit.installed.roles.join(', ')})`) : null),
        h('p', {className: 'muted'}, 'Downloads the smallest working set into a folder you choose, starts a local server for each role and connects it. Official llama.cpp servers and open models (Apache-2.0 / MIT). Nothing is downloaded until you press Download.'),
        h('div', {className: 'fields'},
          h('label', null, 'Your computer', h('select', {value: tier, onChange: e => setTier(e.target.value), disabled: running}, ...data.tiers.map(t => h('option', {key: t.id, value: t.id}, t.label)))),
          h('label', {className: 'inline', style: {alignSelf: 'end'}}, h('input', {type: 'checkbox', checked: speech, onChange: e => setSpeech(e.target.checked), disabled: running}), 'Also install speech to text (82 MB)'),
          h('label', {className: 'wide'}, 'Folder', h('input', {type: 'text', value: folder, onChange: e => setFolder(e.target.value), disabled: running, spellCheck: false})),
          tierInfo ? h('p', {className: 'small wide'}, h('strong', null, `Brain: ${tierInfo.brain}. `), tierInfo.advice) : null),
        plan ? h('div', null,
          h('table', null, h('tbody', null, ...plan.files.map(f => h('tr', {key: f.id}, h('td', null, f.name), h('td', null, f.source), h('td', null, f.licence),
            h('td', null, gb(f.size), f.have ? h('span', {className: 'small'}, f.have === f.size ? ' · already here' : ` · ${gb(f.have)} done`) : null))))),
          h('p', {className: `small ${plan.enough ? '' : 'bad'}`, style: {marginTop: 6}},
            `Download: ${gb(plan.remaining)} of ${gb(plan.total)}. Space needed: ${gb(plan.needed)}. Free in this folder: ${plan.free === undefined ? 'unknown' : gb(plan.free)}. ${plan.enough ? '' : 'Not enough space; choose another folder.'}`),
          h('p', {className: 'small'}, `${plan.platform}, ${plan.gpu ? 'graphics card (Vulkan) build' : 'processor-only build'}.`)) : null,
        running || job.state && job.state !== 'idle' ? h('div', null,
          h('div', {className: 'bar', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100}, h('div', {style: {width: pct + '%'}})),
          h('p', {className: `small ${job.state === 'failed' ? 'bad' : ''}`, style: {marginTop: 4}}, `${job.message ?? ''}${job.total ? `  ·  ${gb(job.done)} of ${gb(job.total)} (${pct}%)` : ''}`)) : null,
        kit?.servers && Object.keys(kit.servers).length ? h('p', {className: 'small'}, 'Local servers: ', Object.entries(kit.servers).map(([id, s]) => `${id} ${s.state} (port ${s.port})`).join(' · ')) : null,
        err ? h('p', {className: 'small bad'}, err) : null,
        h('div', {className: 'row'},
          h('button', {type: 'button', onClick: check, disabled: running}, 'Check space'),
          h('button', {type: 'button', className: 'primary', onClick: start, disabled: running || !plan || !plan.enough}, plan && plan.remaining < plan.total && plan.remaining > 0 ? 'Resume download' : 'Download and connect'),
          running ? h('button', {type: 'button', onClick: async () => setKit(await call('kit-cancel'))}, 'Cancel') : null,
          kit?.installed && !running ? h('button', {type: 'button', onClick: async () => { setKit(await call('kit-stop')); onChanged(await call('list', {force: true})); }}, 'Stop local servers') : null,
          kit?.installed && !running ? h('button', {type: 'button', onClick: async () => { setKit(await call('kit-run')); onChanged(await call('list', {force: true})); }}, 'Start local servers') : null));
    };

    const WebSearch = ({data, onChanged}) => {
      const [draft, setDraft] = useState({baseUrl: data.search.baseUrl, fallbackUrl: data.search.fallbackUrl});
      const [busy, setBusy] = useState(false), [error, setError] = useState('');
      useEffect(() => setDraft({baseUrl: data.search.baseUrl, fallbackUrl: data.search.fallbackUrl}), [data.search.baseUrl, data.search.fallbackUrl]);
      const save = async () => {
        setBusy(true); setError('');
        try { onChanged(await call('search-save', draft)); }
        catch (e) { setError(e.message); }
        finally { setBusy(false); }
      };
      return h('section', {className: 'card', 'data-atelier-search': ''},
        h('div', {className: 'row spread'}, h('h3', null, 'Web search'),
          h('span', {className: `pill ${data.search.configured ? 'ok' : 'off'}`}, data.search.configured ? 'Configured' : 'Not configured')),
        h('p', {className: 'muted'}, 'Connect your own SearXNG instance. Search uses only the address you set here.'),
        h('div', {className: 'fields'},
          h('label', {className: 'wide'}, 'SearXNG URL', h('input', {type: 'text', value: draft.baseUrl, disabled: data.search.fromEnvironment,
            onChange: e => setDraft(d => ({...d, baseUrl: e.target.value})), placeholder: 'http://localhost:8080', spellCheck: false})),
          h('label', {className: 'wide'}, 'Fallback URL (optional)', h('input', {type: 'text', value: draft.fallbackUrl, disabled: data.search.fromEnvironment,
            onChange: e => setDraft(d => ({...d, fallbackUrl: e.target.value})), placeholder: 'http://localhost:8081', spellCheck: false}))),
        data.search.fromEnvironment ? h('p', {className: 'small'}, 'Configured by ATELIER_SEARCH_URL in the environment.') : null,
        error ? h('p', {className: 'small bad'}, error) : null,
        !data.search.fromEnvironment ? h('div', {className: 'row'}, h('button', {type: 'button', className: 'primary', onClick: save, disabled: busy}, busy ? 'Saving…' : 'Save')) : null);
    };

    // ---------------- the settings page ----------------
    const RolesSection = () => {
      const [data, setData] = useState(null), [error, setError] = useState('');
      const load = useCallback(async force => { try { setData(await call('list', {force})); setError(''); } catch (e) { setError(e.message); } }, []);
      useEffect(() => { void load(false); }, [load]);
      if (!data) return h('section', {className: 'atr'}, h('h2', null, 'Model roles'), h('p', {className: 'muted'}, error || 'Checking your models…'));
      return h('section', {className: 'atr', 'data-atelier-roles': ''},
        h('div', {className: 'row spread'}, h('h2', null, 'Model roles'), h('button', {type: 'button', onClick: () => load(true)}, 'Check all again')),
        h('p', {className: 'muted'}, 'Atelier uses a few models, each for one job. Bring your own: any OpenAI-compatible server works, on your computer or hosted. Roles you leave empty simply switch their feature off. Keys stay on this computer.'),
        h(SetMeUp, {data, onChanged: setData}),
        h(WebSearch, {data, onChanged: setData}),
        h('div', {className: 'grid'}, ...data.roles.map(role => h(RoleCard, {key: role.id + (role.config?.baseURL ?? '') + (role.config?.model ?? ''), role, data, onChanged: setData}))),
        h('details', {className: 'card'}, h('summary', null, h('strong', null, 'Which brain for my graphics card?')),
          h('table', null, h('tbody', null, ...data.tiers.map(t => h('tr', {key: t.id}, h('td', null, t.label), h('td', null, t.brain), h('td', null, t.advice))))),
          h('p', {className: 'small'}, 'Starts on as little as one 16 GB graphics card. On one card the models take turns: each loads when its job comes up, and Atelier waits for it and shows what is loading. More cards, a bigger card or a model server keep them loaded side by side, so everything is faster. No GPU? Point the roles at a cloud endpoint.'),
          h('p', {className: 'small'}, 'Rough guidance; speed depends on the card and the length of the chat. The ARCITECH recommended brain is at ',
            h('a', {href: `https://huggingface.co/${data.brainRepo}`, target: '_blank', rel: 'noreferrer'}, data.brainRepo), '. Any model works.')));
    };
    ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: 'model-roles', order: 12, label: () => 'Model roles'}, RolesSection));

    // First run: the installer opens http://localhost:<port>/#model-roles. Without that, the page opens once by itself
    // while no brain is connected.
    const Onboarding = props => {
      useEffect(() => {
        let done = false;
        (async () => {
          let open = /model-roles/.test(location.hash);
          if (!open) {
            let seen = false; try { seen = sessionStorage.getItem('atelier-roles-opened') === '1'; } catch {}
            if (!seen) { try { open = (await call('available')).brain === false; } catch {} }
          }
          if (done) return;
          if (open) {
            try { sessionStorage.setItem('atelier-roles-opened', '1'); } catch {}
            if (/model-roles/.test(location.hash)) history.replaceState(null, '', location.pathname + location.search);
            props.openSection('model-roles');
          }
          props.complete();
        })();
        return () => { done = true; };
      }, []);
      return null;
    };
    ctx.slots.inject('settings.onboarding', () => ctx.slots.register({name: 'settings.onboarding', id: 'atelier-model-roles', order: -150}, Onboarding));

    // ---------------- dictation (Speech to text) ----------------
    const Dictate = props => {
      const roles = useAvailable();
      const [state, setState] = useState('idle'), rec = useRef(null);
      if (!roles.stt) return null;
      const toggle = async () => {
        if (state === 'recording') { rec.current?.stop(); return; }
        if (state !== 'idle') return;
        try {
          const stream = await navigator.mediaDevices.getUserMedia({audio: true});
          const parts = [], recorder = new MediaRecorder(stream); rec.current = recorder;
          recorder.ondataavailable = e => parts.push(e.data);
          recorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop()); setState('working');
            try {
              const wav = await toWav(new Blob(parts, {type: recorder.mimeType}));
              const {text} = await call('transcribe', {audio: toB64(wav), mime: 'audio/wav'});
              if (text) { const draft = props.input?.draft ?? ''; props.inputActions?.setDraft(draft ? `${draft.replace(/\s+$/, '')} ${text}` : text); }
            } catch (e) { window.alert(`Dictation failed: ${e.message}`); }
            setState('idle');
          };
          recorder.start(); setState('recording');
        } catch (e) { window.alert(`The microphone is not available: ${e.message}`); setState('idle'); }
      };
      const title = state === 'recording' ? 'Stop and type what I said' : state === 'working' ? 'Turning speech into text…' : 'Dictate (speech to text)';
      return h('button', {type: 'button', className: 'atr-mic', 'data-state': state, onClick: toggle, title, 'aria-label': title, disabled: state === 'working'},
        h('svg', {width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', 'aria-hidden': true},
          state === 'recording' ? h('rect', {x: 7, y: 7, width: 10, height: 10, rx: 2, fill: 'currentColor'})
            : h(Fragment, null, h('rect', {x: 9, y: 3, width: 6, height: 11, rx: 3}), h('path', {d: 'M5 11a7 7 0 0 0 14 0M12 18v3'}))));
    };
    ctx.slots.inject('conversation.input.right', () => ctx.slots.register({name: 'conversation.input.right', id: 'atelier-dictate', order: 50}, Dictate));

    // ---------------- read aloud (Text to speech) ----------------
    const replyText = button => {
      // The reply is this turn's assistant steps in the chat flow (the footer with this button closes the turn).
      const tail = button.closest('[data-chat-flow-kind="turn-tail"]'); if (!tail) return '';
      const turn = tail.getAttribute('data-chat-turn'), column = tail.parentElement;
      return [...column.querySelectorAll(`[data-chat-flow-kind="assistant-step"][data-chat-turn="${String(turn).replace(/[^\w-]/g, '')}"]`)]
        .map(step => step.innerText.trim()).filter(Boolean).join('\n\n');
    };
    let playing;
    const ReadAloud = () => {
      const roles = useAvailable();
      const [state, setState] = useState('idle'), ref = useRef(null);
      if (!roles.tts) return null;
      const click = async () => {
        if (state === 'playing') { playing?.pause(); playing = undefined; setState('idle'); return; }
        const text = replyText(ref.current).slice(0, 4000);
        if (!text) return;
        setState('working');
        try {
          const {audio, mime} = await call('speak', {text});
          playing?.pause(); playing = new Audio(`data:${mime};base64,${audio}`);
          playing.onended = () => setState('idle'); await playing.play(); setState('playing');
        } catch (e) { window.alert(`Read aloud failed: ${e.message}`); setState('idle'); }
      };
      return h('button', {type: 'button', ref, className: 'atr-say', onClick: click, title: 'Read this reply aloud', 'aria-label': 'Read this reply aloud', disabled: state === 'working'},
        state === 'playing' ? 'Stop' : state === 'working' ? '…' : 'Read aloud');
    };
    ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({name: 'conversation.chat.assistant-actions', id: 'atelier-read-aloud', order: 50}, ReadAloud));
  };
  return exports;
}});
