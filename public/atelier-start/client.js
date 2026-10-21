// Atelier new-chat page, browser half. Replaces the stock DSH hero ("What are we designing today?" over a blue glow)
// with a studio start sheet: a plain heading and orienting line, the project and profile chips the core already owns,
// a generous composer, four starting routes mapped to the skills this release ships, recent sessions, and one quiet
// line of model status. Everything here is scoped to the blank-session hero; the chat itself is untouched.
// Slots used: conversation.hero.brand.mark (heading, root scope, so it shows before a workspace exists) and
// conversation.input.dock (routes, recents, status; portalled below the composer so focus order follows the page).
// Also the Atelier guardrails switch: settings.section "Safety" (with the confirmation before turning them off) and,
// while they are off, a "Guardrails off" chip in conversation.session.header.utilities.
window.__ModuleLoader__.load({id: '@arcitech/atelier-start', factory: require => {
  const React = require('react');
  const {createElement: h, Fragment, useEffect, useRef, useState, useSyncExternalStore} = React;
  const {createPortal} = require('react-dom');
  const exports = {};
  exports.inject = ['slots', 'sessions', 'connection'];

  /** The same words as WARNING in guardrails.mjs (a test keeps them identical). */
  const GUARDRAILS_WARNING = 'Turning off Atelier guardrails unlocks the full potential of the AI model: it can read, change and delete '
    + 'files anywhere on this computer and run any command without asking you. This could damage your computer or your '
    + 'work. Only turn this off if you understand the risk and trust the model you connected.';

  /** Starting routes. Each one fills the message box (never sends) and maps to a shipped skill or to Vitruvius itself. */
  const ROUTES = [
    {id: 'brief', title: 'Start from a brief', cmd: null,
      desc: 'Paste the brief. Vitruvius restates it, lists what is missing and proposes three ways to plan it.',
      prefix: 'Restate this brief, list what is missing, and propose three planning strategies. Brief: '},
    {id: 'plan', title: 'Concept plan and moodboard', cmd: '/canvas-moodboard',
      desc: 'A scaled concept plan on the canvas, then a colour and material board.',
      prefix: '/canvas-moodboard Concept plan and moodboard for '},
    {id: 'model', title: 'Model in IngeTrazo', cmd: '/ingetrazo-live',
      desc: 'Build and measure real geometry, with a measured top view. Needs IngeTrazo running.',
      prefix: '/ingetrazo-live Model and measure '},
    {id: 'review', title: 'Review a design', cmd: '/design-review',
      desc: 'Venustas, Firmitas, Utilitas, with every clearance marked measured or unverified.',
      visionDesc: 'Attach a plan or describe it. Venustas, Firmitas, Utilitas, with clearances measured or unverified.',
      prefix: '/design-review Review this layout: '},
  ];

  /** Keep what the user already typed: swap a previous route's opening for the new one, append the rest. */
  const mergeDraft = (draft, prefix) => {
    let rest = String(draft ?? '').trim();
    for (const route of ROUTES) {
      const head = route.prefix.trim();
      if (rest.startsWith(head)) { rest = rest.slice(head.length).trim(); break; }
    }
    return prefix + rest;
  };

  /** Put the caret at the end of the composer once the editor has taken the new draft. */
  const focusComposer = from => {
    const run = () => {
      const scope = from?.closest?.('[class*="_composerStack"]') ?? document;
      const editor = scope.querySelector('[data-input-scroll] [contenteditable="true"]') ?? document.querySelector('[data-input-scroll] [contenteditable="true"]');
      if (!editor) return;
      editor.focus();
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.collapse(false);
      const selection = window.getSelection();
      selection?.removeAllRanges();
      selection?.addRange(range);
    };
    requestAnimationFrame(() => requestAnimationFrame(run));
  };

  function UndoTurnAction({messageId, sessionId}) {
    const [busy, setBusy] = useState(false), [notice, setNotice] = useState('');
    async function undo() {
      if (busy) return;
      setBusy(true); setNotice('');
      try {
        const response = await fetch('/api/turn-undo', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({sessionId, messageId})});
        const result = await response.json();
        setNotice(result.ok ? 'Turn undone.' : result.message ?? 'Undo failed.');
      } catch { setNotice('Undo service unavailable.'); }
      finally { setBusy(false); }
    }
    return h('span', {style: {display: 'inline-flex', alignItems: 'center'}},
      h('button', {type: 'button', title: busy ? 'Undoing…' : 'Undo turn', disabled: busy, 'aria-busy': busy || undefined, 'aria-label': 'Undo turn', 'data-turn-undo': '', onClick: () => void undo(), style: {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28, padding: 6,
        border: 0, borderRadius: 28, background: 'transparent', color: 'var(--dsw-alias-label-tertiary)', cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.4 : 1,
      }}, h('svg', {width: 16, height: 16, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true},
        h('path', {d: 'M5 2.6 1.8 5.8 5 9'}), h('path', {d: 'M2.2 5.8h7.6a4.1 4.1 0 0 1 0 8.2H6.2'}))),
      notice ? h('span', {role: 'status', style: {paddingLeft: 4, color: 'var(--dsw-alias-label-tertiary)', fontSize: 13, whiteSpace: 'nowrap'}}, notice) : null);
  }

  const ago = time => {
    if (!Number.isFinite(time)) return '';
    const seconds = (Date.now() - time) / 1000;
    if (seconds < 60) return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ago`;
    if (seconds < 172800) return 'Yesterday';
    return new Date(time).toLocaleDateString('en-GB', {day: 'numeric', month: 'short'});
  };
  const folderOf = cwd => String(cwd ?? '').replace(/[\\/]+$/, '').split(/[\\/]/).pop() || '';

  // Drawn icons, one 16px family: 1.4 stroke, round joins, currentColor.
  const icon = (...children) => h('svg', {className: 'ats-icon', viewBox: '0 0 16 16', width: 16, height: 16, 'aria-hidden': true, focusable: 'false',
    fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round'}, ...children);
  const ICONS = {
    // Sheet with a folded corner: the brief.
    brief: () => icon(h('path', {d: 'M3.75 1.75h5.5l3 3v9.5h-8.5z'}), h('path', {d: 'M9.25 1.75v3h3'}), h('path', {d: 'M6 8.25h4M6 10.75h4'})),
    // Plan with two partitions and a door gap.
    plan: () => icon(h('path', {d: 'M2.25 2.25h11.5v11.5H2.25z'}), h('path', {d: 'M8 2.25v4.5M8 9.5v4.25M2.25 8.75H5.5'})),
    // Axonometric block: real geometry.
    model: () => icon(h('path', {d: 'M8 1.75l5.5 3.1v6.3L8 14.25l-5.5-3.1v-6.3z'}), h('path', {d: 'M2.5 4.85L8 8l5.5-3.15M8 8v6.25'})),
    // The triad: three points of a triangle.
    review: () => icon(h('path', {d: 'M8 3.25l4.9 8.5H3.1z'}), h('circle', {cx: 8, cy: 3.25, r: 1.35, fill: 'currentColor', stroke: 'none'}),
      h('circle', {cx: 12.9, cy: 11.75, r: 1.35, fill: 'currentColor', stroke: 'none'}), h('circle', {cx: 3.1, cy: 11.75, r: 1.35, fill: 'currentColor', stroke: 'none'})),
  };

  /** The AIT mark, small-size cut (ARCITECH: Architecture · Interactive · Technology). Walls take the brand tan
   *  (currentColor), ink follows the theme's text colour. Decorative here: the heading carries the meaning. */
  const ink = {stroke: 'var(--dsw-alias-label-primary, #eceae6)', fill: 'none'};
  const Mark = () => h('svg', {className: 'ats-mark', viewBox: '0 0 100 100', width: 22, height: 22, 'aria-hidden': true, focusable: 'false'},
    h('g', {transform: 'translate(10.25 6.34) scale(0.83)'},
      h('path', {d: 'M14.94 25.37 L47.37 82.86 L54.86 78.63 L22.43 21.14Z', fill: 'currentColor'}),
      h('circle', {cx: 18.69, cy: 76, r: 8, strokeWidth: 4.6, ...ink}),
      h('circle', {cx: 18.69, cy: 76, r: 3.7, fill: 'var(--dsw-alias-label-primary, #eceae6)'}),
      h('path', {d: 'M56.5 81.26L66.5 81.26', strokeWidth: 7.2, ...ink}),
      h('path', {d: 'M56.5 22.74L66.5 22.74', strokeWidth: 7.2, ...ink}),
      h('path', {d: 'M61.5 22.74L61.5 82.86', strokeWidth: 5.6, ...ink}),
      h('path', {d: 'M57.5 49.87 L65.5 49.87 L65.5 57.87 L57.5 57.87Z', fill: 'currentColor'}),
      h('path', {d: 'M67.7 29.74 L96.3 29.74 L96.3 21.14 L67.7 21.14Z', fill: 'currentColor'}),
      h('path', {d: 'M77.7 37.2 L77.7 82.86 L86.3 82.86 L86.3 37.2Z', fill: 'currentColor'})));

  const STATUS_WORDS = {local: 'Local model', network: 'Model on your network', remote: 'Hosted model', cloud: 'Cloud'};
  const statusLine = status => {
    if (!status) return null;
    if (status.kind === 'unset') return {tone: 'warn', parts: ['No model endpoint yet'], note: 'Add yours under Settings, Models.'};
    const parts = [STATUS_WORDS[status.kind] ?? 'Model', status.modelName];
    if (status.kind !== 'cloud') parts.push(status.vision ? 'reads images' : 'text only');
    const notes = {
      ok: null,
      refused: 'The endpoint refused the API key. Check it under Settings, Models.',
      signin: 'Sign in to your ChatGPT plan at 127.0.0.1:18345/signin.',
      down: status.kind === 'cloud' ? 'The cloud bridge is not answering. Restart Atelier.' : 'Not answering. Start your model server, then send.',
    };
    return {tone: status.reach === 'ok' ? 'ok' : 'warn', parts, note: notes[status.reach] ?? null};
  };

  exports.apply = ctx => {
    ctx.slots.inject('conversation.chat.assistant-actions', () => ctx.slots.register({
      name: 'conversation.chat.assistant-actions', id: 'turn-undo', order: 90,
      inject: sessionId => ({sessionId: String(sessionId)}),
    }, UndoTurnAction));
    const list = ctx.sessions.list;
    const subscribe = listener => list.subscribe(listener);
    const snapshot = () => list.getSnapshot();
    const useList = () => useSyncExternalStore(subscribe, snapshot);

    let statusRequest;
    const loadStatus = () => {
      if (!ctx.connection?.rpc) return Promise.resolve(null);
      statusRequest ??= ctx.connection.rpc.call('/atelier-start', 'status', {})
        .then(result => (result?.ok ? result.value : null), () => null)
        .finally(() => setTimeout(() => { statusRequest = undefined; }, 15000));
      return statusRequest;
    };
    const useStatus = () => {
      const [status, setStatus] = useState(null);
      useEffect(() => { let live = true; void loadStatus().then(value => { if (live) setStatus(value); }); return () => { live = false; }; }, []);
      return status;
    };

    /** Bottega (team mode) state for the card below. `data` stays null on a device paired through Bottega: the gateway
     *  never forwards this channel there, so only the person at the host computer sees the card. */
    const useBottega = () => {
      const [data, setData] = useState(null);
      const [error, setError] = useState('');
      const [busy, setBusy] = useState(false);
      const call = (endpoint, payload) => ctx.connection.rpc.call('/atelier-bottega', endpoint, payload ?? {})
        .then(result => { if (result?.ok) return result.value; throw Error(result?.error?.message ?? 'Bottega did not answer.'); });
      useEffect(() => {
        if (!ctx.connection?.rpc) return undefined;
        // On a device paired through Bottega the gateway refuses this channel (HTTP 403): ask once more, then stop asking.
        let live = true, timer, failures = 0;
        const tick = () => {
          void call('status').then(value => { failures = 0; if (live) setData(value); }, () => { failures += 1; })
            .finally(() => { if (live && failures < 2) timer = setTimeout(tick, 4000); });
        };
        tick();
        return () => { live = false; clearTimeout(timer); };
      }, []);
      const act = (endpoint, payload) => {
        setBusy(true);
        return call(endpoint, payload).then(value => { setData(value); setError(''); }, e => setError(e.message)).finally(() => setBusy(false));
      };
      return {data, error, busy, act};
    };

    const clock = time => new Date(time).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});

    /** The Bottega card: a switch, where to pair, the code, the paired devices. */
    const BottegaCard = () => {
      const {data, error, busy, act} = useBottega();
      if (data === null) return null;
      const on = data.on;
      const code = data.code ? `${data.code.code.slice(0, 3)} ${data.code.code.slice(3)}` : null;
      return h('section', {className: 'ats-section ats-bottega', 'aria-labelledby': 'ats-bottega-heading'},
        h('div', {className: 'ats-section-head'},
          h('h2', {id: 'ats-bottega-heading', className: 'ats-h2'}, 'Bottega'),
          h('p', {className: 'ats-hint'}, 'Team mode: your workshop, shared on your network.')),
        h('div', {className: 'ats-bottega-body'},
          h('div', {className: 'ats-bottega-switch'},
            h('button', {type: 'button', role: 'switch', 'aria-checked': on, 'aria-label': 'Bottega: share on my network', className: 'ats-switch', 'data-on': on ? 'true' : 'false',
              disabled: busy, onClick: () => { void act('enable', {on: !on}); }}, h('span', {className: 'ats-switch-knob', 'aria-hidden': true})),
            h('span', {className: 'ats-bottega-label'}, on ? 'Sharing on my network' : 'Share on my network')),
          !on && h('p', {className: 'ats-note'}, 'Colleagues on the same office network open this Atelier from their own browser, tablet or phone, after a one-time pairing code. Off by default: until you switch it on, Atelier answers only on this computer. Tailscale support (reaching it from outside your network) is planned and coming soon.'),
          on && h(Fragment, null,
            data.waiting && h('p', {className: 'ats-note', role: 'status'}, 'Waiting for a private network address. Join your office Wi-Fi or plug in a cable.'),
            data.problems.map(text => h('p', {key: text, className: 'ats-note ats-warn', role: 'status'}, text)),
            data.host && !data.host.ok && h('p', {className: 'ats-note ats-warn', role: 'status'}, `Bottega cannot sign in to Atelier on this computer. ${data.host.message}`),
            data.urls.length > 0 && h('div', {className: 'ats-bottega-block'},
              h('p', {className: 'ats-note'}, data.urls.length === 1 ? 'On the other device, open this address:' : 'On the other device, open one of these addresses:'),
              h('ul', {className: 'ats-bottega-urls', role: 'list'}, data.urls.map(url => h('li', {key: url}, h('code', null, url))))),
            data.urls.length > 0 && h('div', {className: 'ats-bottega-block'},
              code ? h(Fragment, null,
                h('p', {className: 'ats-note'}, 'Then enter this pairing code:'),
                h('p', {className: 'ats-bottega-code', 'aria-label': `Pairing code ${data.code.code.split('').join(' ')}`}, code),
                h('p', {className: 'ats-note'}, `Valid until ${clock(data.code.expiresAt)}, for one device.`))
                : h('p', {className: 'ats-note'}, 'No pairing code is active.'),
              h('button', {type: 'button', className: 'ats-btn', disabled: busy, onClick: () => { void act('code'); }}, code ? 'New code' : 'Show a pairing code')),
            h('div', {className: 'ats-bottega-block ats-bottega-wide'},
              h('div', {className: 'ats-bottega-devhead'},
                h('p', {className: 'ats-note ats-bottega-devtitle'}, data.devices.length === 0 ? 'No devices are paired yet.' : `Paired devices (${data.devices.length})`),
                data.devices.length > 1 && h('button', {type: 'button', className: 'ats-btn ats-btn-quiet', disabled: busy, onClick: () => { void act('revoke-all'); }}, 'Revoke all')),
              data.devices.length > 0 && h('ul', {className: 'ats-list ats-bottega-devices', role: 'list'}, data.devices.map(device => h('li', {key: device.id, className: 'ats-bottega-device'},
                h('span', {className: 'ats-bottega-devname'}, device.name),
                h('span', {className: 'ats-bottega-devmeta'}, [device.agent !== device.name && device.agent, device.address, `last used ${ago(device.lastSeen).toLowerCase()}`].filter(Boolean).join(' · ')),
                h('button', {type: 'button', className: 'ats-btn ats-btn-quiet', disabled: busy, 'aria-label': `Revoke ${device.name}`, onClick: () => { void act('revoke', {id: device.id}); }}, 'Revoke'))))),
            h('p', {className: 'ats-note ats-bottega-fine'}, 'Anyone you pair can use Atelier as you do, including approving its tool steps, so pair only people and devices you trust. Windows may ask whether to let Atelier through its firewall: allow Private networks only.')),
          error && h('p', {className: 'ats-note ats-warn', role: 'alert'}, error)));
    };

    /** Heading and orienting line. Root scope, so the cold start (no workspace yet) is covered too. */
    const Head = () => {
      const sessions = useList();
      const current = sessions.current === undefined ? undefined : sessions.byId[sessions.current];
      const off = useGuardrails()?.enabled === false;
      return h('div', {className: 'ats-scope ats-head'},
        h('div', {className: 'ats-title-row'}, h(Mark), h('h1', {className: 'ats-title'}, 'New session')),
        h('p', {className: 'ats-lede'}, current === undefined
          ? (off ? 'Choose a project folder to begin. Atelier guardrails are off (Settings > Safety): Vitruvius can read and write files anywhere and runs commands without asking.'
            : 'Choose a project folder to begin. Atelier reads and writes files only there, and asks before it runs a command.')
          : 'Brief Vitruvius on the project, or start from one of these routes.'));
    };

    /** Routes, recent sessions and model status, below the composer. Only for a session nothing has been sent in. */
    const Body = props => {
      const session = props.session;
      const show = session?.blank === true && session?.promptAttempted !== true;
      const anchor = useRef(null);
      const [host, setHost] = useState(null);
      const sessions = useList();
      const status = useStatus();

      useEffect(() => {
        if (!show) return undefined;
        const stack = anchor.current?.closest('[class*="_composerStack"]');
        if (!stack) return undefined;
        const node = document.createElement('div');
        node.className = 'ats-scope ats-body';
        stack.appendChild(node);
        // Keep the page after the composer if the core re-inserts its own children.
        const keepLast = new MutationObserver(() => { if (node.nextSibling) stack.appendChild(node); });
        keepLast.observe(stack, {childList: true});
        setHost(node);
        return () => { keepLast.disconnect(); node.remove(); setHost(null); };
      }, [show]);

      if (!show) return null;
      const draft = props.input?.draft ?? '';
      const choose = (route, event) => {
        props.inputActions?.setDraft(mergeDraft(draft, route.prefix));
        focusComposer(event.currentTarget);
      };
      const here = session ? sessions.byId[session.sessionId]?.cwd : undefined;
      const recents = sessions.ids.map(id => sessions.byId[id])
        .filter(row => row && !row.blank && row.parentId === undefined && row.origin !== 'subagent' && row.id !== session?.sessionId)
        .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
        .slice(0, 4);
      const line = statusLine(status);

      const page = h(Fragment, null,
        h('section', {className: 'ats-section', 'aria-labelledby': 'ats-routes-heading'},
          h('div', {className: 'ats-section-head'},
            h('h2', {id: 'ats-routes-heading', className: 'ats-h2'}, 'Start from'),
            h('p', {className: 'ats-hint'}, 'Fills the message box. Nothing is sent until you press Enter.')),
          h('ul', {className: 'ats-list ats-routes', role: 'list'}, ROUTES.map(route => h('li', {key: route.id},
            h('button', {type: 'button', className: 'ats-row ats-route', 'data-route': route.id, onClick: event => choose(route, event)},
              h('span', {className: 'ats-route-icon'}, ICONS[route.id]()),
              h('span', {className: 'ats-route-title'}, route.title),
              h('span', {className: 'ats-route-desc'}, status?.vision && route.visionDesc ? route.visionDesc : route.desc),
              route.cmd ? h('code', {className: 'ats-cmd'}, route.cmd) : h('span', {className: 'ats-cmd', 'aria-hidden': true}, '')))))),
        recents.length > 0 && h('section', {className: 'ats-section', 'aria-labelledby': 'ats-recent-heading'},
          h('div', {className: 'ats-section-head'}, h('h2', {id: 'ats-recent-heading', className: 'ats-h2'}, 'Recent sessions')),
          h('ul', {className: 'ats-list', role: 'list'}, recents.map(row => h('li', {key: row.id},
            h('button', {type: 'button', className: 'ats-row ats-recent', onClick: () => ctx.sessions.open(row.id)},
              h('span', {className: 'ats-recent-title'}, row.displayTitle || row.title || 'Untitled session'),
              row.cwd && here && row.cwd !== here ? h('span', {className: 'ats-recent-where'}, folderOf(row.cwd)) : null,
              h('span', {className: 'ats-recent-when'}, ago(row.updatedAt))))))),
        h('p', {className: 'ats-status', 'data-tone': line?.tone ?? 'pending', role: 'status'},
          line && h(Fragment, null,
            h('span', {className: 'ats-dot', 'aria-hidden': true}),
            h('span', {className: 'ats-status-parts'}, line.parts.filter(Boolean).join('  ·  ')),
            line.note && h('span', {className: 'ats-status-note'}, line.note))),
        h(BottegaCard));

      return h(Fragment, null, h('span', {ref: anchor, className: 'ats-anchor', hidden: true}), host && createPortal(page, host));
    };

    // ---------------- Atelier guardrails: Settings > Safety, the confirmation, and the "Guardrails off" chip ----------------
    // The host half is guardrails.mjs. Reading the state goes through /atelier-start (a paired Bottega device sees the chip
    // too); changing it goes through /atelier-guardrails, which Bottega never forwards, so only this computer can change it.
    const guardrails = (() => {
      let value = null;
      const subs = new Set();
      const emit = () => { for (const fn of subs) fn(); };
      const refresh = async () => {
        try { const r = await ctx.connection.rpc.call('/atelier-start', 'guardrails', {}); if (r.ok) { value = r.value; emit(); } } catch { /* next poll */ }
      };
      const set = async (enabled, confirmed = false) => {
        const r = await ctx.connection.rpc.call('/atelier-guardrails', 'set', {enabled, confirmed});
        if (!r.ok) throw Error(r.error?.message ?? 'That did not work.');
        value = {enabled: r.value.enabled}; emit();
      };
      return {get: () => value, subscribe: fn => { subs.add(fn); return () => subs.delete(fn); }, refresh, set};
    })();
    const useGuardrails = () => {
      const value = useSyncExternalStore(guardrails.subscribe, guardrails.get, guardrails.get);
      useEffect(() => {
        void guardrails.refresh();
        // A change made in the terminal (atelier settings set guardrails ...) or in another window shows up here too.
        const timer = setInterval(() => { if (!document.hidden) void guardrails.refresh(); }, 10000);
        const shown = () => { if (!document.hidden) void guardrails.refresh(); };
        document.addEventListener('visibilitychange', shown);
        return () => { clearInterval(timer); document.removeEventListener('visibilitychange', shown); };
      }, []);
      return value;
    };

    /** The confirmation before guardrails go off. "Keep guardrails on" is the default (focused; Escape and the backdrop pick it). */
    const ConfirmOff = ({onKeep, onTurnOff, busy, problem}) => {
      const keep = useRef(null);
      useEffect(() => {
        keep.current?.focus();
        const key = event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onKeep(); return; }
          if (event.key !== 'Tab') return;
          const items = [...document.querySelectorAll('.agr-dialog button:not(:disabled)')];
          if (items.length === 0) return;
          const first = items[0], last = items[items.length - 1];
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
        };
        document.addEventListener('keydown', key, true);
        return () => document.removeEventListener('keydown', key, true);
      }, []);
      return createPortal(h('div', {className: 'agr-scope agr-backdrop', onMouseDown: event => { if (event.target === event.currentTarget) onKeep(); }},
        h('section', {className: 'agr-dialog', role: 'alertdialog', 'aria-modal': 'true', 'aria-labelledby': 'agr-confirm-title', 'aria-describedby': 'agr-confirm-text', 'data-atelier-guardrails-confirm': ''},
          h('h2', {id: 'agr-confirm-title', className: 'agr-title'}, h('span', {className: 'agr-warn-icon', 'aria-hidden': true}, '!'), 'Turn off Atelier guardrails?'),
          h('p', {id: 'agr-confirm-text', className: 'agr-text'}, GUARDRAILS_WARNING),
          problem ? h('p', {className: 'agr-bad', role: 'alert'}, problem) : null,
          h('div', {className: 'agr-actions'},
            h('button', {type: 'button', className: 'agr-button agr-danger', disabled: busy, onClick: onTurnOff}, busy ? 'Turning off…' : 'Turn off guardrails'),
            h('button', {type: 'button', ref: keep, className: 'agr-button agr-primary', disabled: busy, onClick: onKeep}, 'Keep guardrails on')))), document.body);
    };

    const SafetySection = () => {
      const value = useGuardrails();
      const [confirming, setConfirming] = useState(false);
      const [busy, setBusy] = useState(false);
      const [problem, setProblem] = useState('');
      const on = value?.enabled !== false;
      const change = async (enabled, confirmed) => {
        setBusy(true); setProblem('');
        try { await guardrails.set(enabled, confirmed); setConfirming(false); } catch (e) { setProblem(e.message); } finally { setBusy(false); }
      };
      return h('section', {className: 'agr-scope agr-page', 'data-atelier-safety': ''},
        h('h2', {className: 'agr-h2'}, 'Safety'),
        h('div', {className: 'agr-card', 'data-state': on ? 'on' : 'off'},
          h('div', {className: 'agr-row'},
            h('div', {className: 'agr-copy'},
              h('h3', {className: 'agr-h3', id: 'agr-switch-label'}, 'Atelier guardrails'),
              h('p', {className: 'agr-muted'}, on
                ? 'On (recommended). Vitruvius works inside the chat’s project folder and asks you before anything wider, such as a command or a file outside it. Long waits have time limits.'
                : 'Off. Vitruvius can read, change and delete files anywhere on this computer and runs any command without asking you. Long waits have no time limit.')),
            h('button', {type: 'button', role: 'switch', className: 'agr-switch', 'aria-checked': on, 'aria-labelledby': 'agr-switch-label', disabled: busy || value === null,
              'data-atelier-guardrails-switch': '', onClick: () => (on ? setConfirming(true) : change(true, false))},
              h('span', {className: 'agr-knob', 'aria-hidden': true}), h('span', {className: 'agr-switch-word'}, on ? 'On' : 'Off'))),
          !on ? h('p', {className: 'agr-alert', role: 'status'}, 'Guardrails are off. Turn them back on with the switch above; no confirmation is needed.') : null,
          problem && !confirming ? h('p', {className: 'agr-bad', role: 'alert'}, problem) : null),
        h('p', {className: 'agr-muted agr-small'}, 'Always on, whatever this switch says: Bottega pairing and its private-network checks, no telemetry, and the private login token of this browser. The switch is kept in settings.yaml (atelier-guardrails) and can also be changed with: atelier settings set guardrails on|off.'),
        confirming ? h(ConfirmOff, {busy, problem, onKeep: () => { setConfirming(false); setProblem(''); }, onTurnOff: () => change(false, true)}) : null);
    };
    ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: 'atelier-safety', order: 13, label: () => 'Safety'}, SafetySection));

    /** Shown in the session header only while guardrails are off; one click opens the switch to turn them back on. */
    const GuardrailsChip = () => {
      const value = useGuardrails();
      const [open, setOpen] = useState(false);
      const [busy, setBusy] = useState(false);
      const [problem, setProblem] = useState('');
      if (value?.enabled !== false) return null;
      const turnOn = async () => {
        setBusy(true); setProblem('');
        try { await guardrails.set(true); setOpen(false); } catch (e) { setProblem(e.message); } finally { setBusy(false); }
      };
      return h(Fragment, null,
        h('button', {type: 'button', className: 'agr-scope agr-chip', 'data-atelier-guardrails-chip': '', 'aria-haspopup': 'dialog', 'aria-expanded': open,
          title: 'Atelier guardrails are off: full file access and no approval prompts. Click to turn them back on.', onClick: () => setOpen(v => !v)},
          h('span', {className: 'agr-chip-dot', 'aria-hidden': true}), 'Guardrails off'),
        open ? createPortal(h('div', {className: 'agr-scope agr-backdrop agr-backdrop-light', onMouseDown: event => { if (event.target === event.currentTarget) setOpen(false); }},
          h('section', {className: 'agr-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'agr-chip-title', 'data-atelier-guardrails-popover': ''},
            h('h2', {id: 'agr-chip-title', className: 'agr-title'}, 'Atelier guardrails are off'),
            h('p', {className: 'agr-text'}, 'Vitruvius can read, change and delete files anywhere on this computer and runs commands without asking you. Turning guardrails back on takes effect at once, in open chats too.'),
            problem ? h('p', {className: 'agr-bad', role: 'alert'}, problem) : null,
            h('div', {className: 'agr-actions'},
              h('button', {type: 'button', className: 'agr-button', disabled: busy, onClick: () => setOpen(false)}, 'Close'),
              h('button', {type: 'button', className: 'agr-button agr-primary', disabled: busy, autoFocus: true, 'data-atelier-guardrails-on': '', onClick: turnOn}, busy ? 'Turning on…' : 'Turn guardrails on')))), document.body) : null);
    };
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({name: 'conversation.session.header.utilities', id: 'atelier-guardrails', order: 60}, GuardrailsChip));

    ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({name: 'conversation.hero.brand.mark', priority: 10}, Head));
    ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({name: 'conversation.input.dock', id: 'atelier-start', order: 90}, Body));

    if (typeof document !== 'undefined' && !document.getElementById('atelier-start-style')) {
      const style = document.createElement('style');
      style.id = 'atelier-start-style';
      style.textContent = CSS;
      document.head.appendChild(style);
      ctx.on?.('dispose', () => style.remove());
    }
  };

  // Hashed core classes are matched by their stable suffix ([class*="_name"]), the convention this build already uses
  // for the hero badge. Every override is gated on the start page being mounted (:has(.ats-head)).
  const HERO = '[class*="_composerHero"]:has(.ats-head)';
  const CSS = `
.ats-scope {
  --ats-ink: var(--dsw-alias-label-primary);
  --ats-ink-2: var(--dsw-alias-label-secondary);
  --ats-ink-3: var(--dsw-alias-label-secondary);
  --ats-rule: var(--dsw-alias-border-l2);
  --ats-hover: var(--dsw-alias-interactive-bg-hover);
  --ats-accent: #a8683a;
  --ats-ok: #1f7a4a;
  --ats-warn: #a15c00;
  color: var(--ats-ink);
}
body[data-ds-dark-theme] .ats-scope {
  --ats-ink-2: var(--dsw-alias-label-tertiary);
  --ats-ink-3: var(--dsw-alias-label-caption);
  --ats-accent: #d39a66;
  --ats-ok: #7fc79a;
  --ats-warn: #f0b545;
}

/* The stock hero: no glow, no centred question. The heading lines up with the composer's outer edge. */
${HERO} { --ats-x: var(--dsh-composer-side-clearance, 16px); gap: 10px; padding: 40px 0 48px; }
/* Centre the page when it fits and scroll from its top when it does not (flex centring would clip the heading). */
[class*="_scrollBody"]:has(.ats-head) { justify-content: flex-start !important; }
[class*="_scrollBody"]:has(.ats-head) > [data-composer-seat] { margin-block: auto; }
${HERO} > [class*="_heroGlow"] { display: none; }
${HERO} > [class*="_root"] { padding: 0 var(--ats-x); justify-content: flex-start; }
${HERO} [class*="_headline"] { display: block; }
${HERO} [class*="_headlineText"], ${HERO} [class*="_previewBadge"] { display: none; }
${HERO} [class*="_fishHitbox"] { display: block; }
${HERO} > [class*="_root"] [class*="_body"]:empty { display: none; }
${HERO} > [class*="_heroWorkspaceRow"] { margin-top: 8px; padding-left: calc(var(--ats-x) - 8px); }
${HERO} [data-input-scroll] [class*="_input"] { min-height: 72px; }

.ats-head { display: grid; gap: 6px; text-align: left; }
.ats-title-row { display: flex; align-items: center; gap: 12px; }
.ats-mark { flex: none; color: var(--ats-accent); }
.ats-title { margin: 0; font-size: 26px; line-height: 32px; font-weight: 600; letter-spacing: -0.015em; color: var(--ats-ink); }
.ats-lede { margin: 0; max-width: 60ch; font-size: 15px; line-height: 22px; font-weight: 400; color: var(--ats-ink-2); text-wrap: pretty; }

.ats-body {
  container-type: inline-size;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 28px;
  margin-top: 26px;
  padding: 0 var(--dsh-composer-side-clearance, 16px);
}
[data-phase]:not([data-phase="hero"]) .ats-body { display: none; }
.ats-section-head { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; padding: 0 0 8px; }
.ats-h2 { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; color: var(--ats-ink); }
.ats-hint { margin: 0; font-size: 12px; line-height: 18px; color: var(--ats-ink-3); text-align: right; }
.ats-list { list-style: none; margin: 0; padding: 0; border-top: 1px solid var(--ats-rule); }
.ats-list > li { border-bottom: 1px solid var(--ats-rule); }

.ats-row {
  appearance: none;
  display: grid;
  align-items: baseline;
  width: 100%;
  margin: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color 120ms ease-out;
}
.ats-row:hover { background: var(--ats-hover); }
.ats-row:focus-visible { outline: 2px solid var(--ats-accent); outline-offset: -2px; }
.ats-row:active { background: var(--dsw-alias-interactive-bg-active, var(--ats-hover)); }

.ats-routes { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 24px; }
.ats-route { grid-template-columns: 16px minmax(0, 1fr) auto; grid-template-areas: "icon title cmd" ". desc desc"; column-gap: 10px; row-gap: 2px; height: 100%; padding: 12px 8px 14px; }
.ats-route-icon { grid-area: icon; align-self: center; display: inline-flex; color: var(--ats-ink-2); }
.ats-route-title { grid-area: title; }
.ats-route .ats-cmd { grid-area: cmd; }
.ats-route-desc { grid-area: desc; }
.ats-route:hover .ats-route-icon, .ats-route:focus-visible .ats-route-icon { color: var(--ats-accent); }
.ats-route-title { font-size: 14px; line-height: 20px; font-weight: 500; color: var(--ats-ink); }
.ats-route-desc { font-size: 13px; line-height: 20px; color: var(--ats-ink-2); }
.ats-cmd { font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 12px; line-height: 20px; color: var(--ats-ink-3); background: none; padding: 0; white-space: nowrap; }

.ats-recent { display: flex; align-items: baseline; gap: 16px; padding: 9px 8px; }
.ats-recent-title { flex: 1 1 auto; min-width: 0; }
.ats-recent-title { overflow: hidden; font-size: 14px; line-height: 20px; color: var(--ats-ink); text-overflow: ellipsis; white-space: nowrap; }
.ats-recent-where { max-width: 14rem; overflow: hidden; font-size: 12px; line-height: 20px; color: var(--ats-ink-3); text-overflow: ellipsis; white-space: nowrap; }
.ats-recent-when { font-size: 12px; line-height: 20px; color: var(--ats-ink-3); font-variant-numeric: tabular-nums; white-space: nowrap; }

.ats-status { display: flex; flex-wrap: wrap; align-items: baseline; column-gap: 10px; row-gap: 2px; min-height: 20px; margin: -8px 0 0; padding: 0 8px; font-size: 12px; line-height: 20px; color: var(--ats-ink-3); }
.ats-dot { flex: none; align-self: center; width: 7px; height: 7px; border-radius: 50%; background: var(--ats-ok); }
.ats-status[data-tone="warn"] .ats-dot { background: var(--ats-warn); }
.ats-status-parts { color: var(--ats-ink-2); white-space: pre-wrap; }
.ats-status[data-tone="warn"] .ats-status-note { color: var(--ats-ink); }

@container (max-width: 600px) {
  .ats-section-head { flex-direction: column; gap: 0; }
  .ats-hint { text-align: left; }
  .ats-routes { grid-template-columns: minmax(0, 1fr); }
  .ats-route { grid-template-columns: 16px minmax(0, 1fr); grid-template-areas: "icon title" ". desc"; padding: 11px 8px 12px; }
  .ats-route .ats-cmd { display: none; }
  .ats-recent-where { display: none; }
  .ats-status { padding: 0 8px; }
}
@media (max-width: 560px) {
  ${HERO} { padding: 20px 0 24px; }
  .ats-title { font-size: 22px; line-height: 28px; }
  .ats-lede { font-size: 14px; line-height: 21px; }
  .ats-body { margin-top: 20px; gap: 24px; }
}
@media (prefers-reduced-motion: reduce) {
  .ats-row { transition: none; }
}

/* Bottega (team mode) card */
.ats-bottega-body { display: grid; gap: 12px; padding: 12px 8px 0; border-top: 1px solid var(--ats-rule); }
.ats-bottega-switch { display: flex; align-items: center; gap: 12px; }
.ats-bottega-label { font-size: 14px; line-height: 20px; color: var(--ats-ink); }
.ats-switch { appearance: none; position: relative; flex: none; width: 36px; height: 20px; padding: 0; border: 1px solid var(--ats-rule); border-radius: 10px; background: transparent; cursor: pointer; transition: background-color 120ms ease-out; }
.ats-switch[data-on="true"] { background: var(--ats-accent); border-color: var(--ats-accent); }
.ats-switch-knob { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--ats-ink-2); transition: transform 120ms ease-out; }
.ats-switch[data-on="true"] .ats-switch-knob { transform: translateX(16px); background: #fff; }
.ats-switch:focus-visible, .ats-btn:focus-visible { outline: 2px solid var(--ats-accent); outline-offset: 2px; }
.ats-switch:disabled, .ats-btn:disabled { opacity: .55; cursor: default; }
.ats-note { margin: 0; max-width: 64ch; font-size: 13px; line-height: 20px; color: var(--ats-ink-2); text-wrap: pretty; }
.ats-note.ats-warn { color: var(--ats-warn); }
.ats-bottega-block { display: grid; gap: 6px; justify-items: start; }
.ats-bottega-wide { justify-items: stretch; }
.ats-bottega-urls { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.ats-bottega-urls code { font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 13px; line-height: 20px; color: var(--ats-ink); user-select: all; background: none; padding: 0; }
.ats-bottega-code { margin: 0; font-family: var(--ds-font-family-code, ui-monospace, monospace); font-size: 30px; line-height: 38px; font-weight: 600; letter-spacing: .12em; color: var(--ats-ink); user-select: all; }
.ats-btn { appearance: none; min-height: 32px; padding: 0 14px; border: 1px solid var(--ats-rule); border-radius: 16px; background: transparent; color: var(--ats-ink); font: inherit; font-size: 13px; cursor: pointer; }
.ats-btn:hover:not(:disabled) { background: var(--ats-hover); }
.ats-btn-quiet { min-height: 28px; padding: 0 10px; color: var(--ats-ink-2); }
.ats-bottega-devhead { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ats-bottega-devtitle { font-weight: 600; color: var(--ats-ink); }
.ats-bottega-device { display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "name action" "meta action"; column-gap: 12px; align-items: center; padding: 8px 0; }
.ats-bottega-devname { grid-area: name; font-size: 14px; line-height: 20px; color: var(--ats-ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ats-bottega-devmeta { grid-area: meta; font-size: 12px; line-height: 18px; color: var(--ats-ink-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ats-bottega-device .ats-btn { grid-area: action; }
.ats-bottega-fine { font-size: 12px; line-height: 18px; color: var(--ats-ink-3); }
@media (prefers-reduced-motion: reduce) { .ats-switch, .ats-switch-knob { transition: none; } }

/* The canvas toggle in the session header is a bare browser button; give it the header's own pill shape. */
[data-atelier-canvas-toggle] {
  appearance: none;
  min-height: 32px;
  padding: 0 14px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 16px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}
[data-atelier-canvas-toggle]:hover { background: var(--dsw-alias-interactive-bg-hover); }
[data-atelier-canvas-toggle]:focus-visible { outline: 2px solid var(--dsw-alias-label-primary); outline-offset: 2px; }
[data-atelier-canvas-toggle][aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-active, var(--dsw-alias-interactive-bg-hover)); }
/* Atelier guardrails: Settings > Safety, the confirmation and the "Guardrails off" chip */
.agr-scope {
  --agr-ink: var(--dsw-alias-label-primary, #eceae6);
  --agr-ink-2: var(--dsw-alias-label-secondary, #a7afc0);
  --agr-rule: var(--dsw-alias-border-l2, #303746);
  --agr-bg: var(--dsw-alias-bg-layer-1, #171c26);
  --agr-hover: var(--dsw-alias-interactive-bg-hover, #252b38);
  --agr-ok: #1f7a4a; --agr-warn: #a15c00; --agr-bad: #b3261e; --agr-warn-bg: #fdf1e0;
}
body[data-ds-dark-theme] .agr-scope { --agr-ok: #7fc79a; --agr-warn: #f0b545; --agr-bad: #f07878; --agr-warn-bg: #3a2a12; }
.agr-page { display: flex; flex-direction: column; gap: 12px; max-width: 720px; color: var(--agr-ink); }
.agr-h2 { margin: 0; font-size: 16px; line-height: 24px; font-weight: 500; }
.agr-h3 { margin: 0; font-size: 14px; line-height: 20px; font-weight: 600; }
.agr-muted { margin: 4px 0 0; font-size: 13px; line-height: 20px; color: var(--agr-ink-2); }
.agr-small { font-size: 12px; line-height: 18px; }
.agr-card { border: 1px solid var(--agr-rule); border-radius: 12px; padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; background: var(--agr-bg); }
.agr-card[data-state="off"] { border-color: var(--agr-warn); }
.agr-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
.agr-copy { min-width: 0; }
.agr-switch { flex: none; display: inline-flex; align-items: center; gap: 8px; min-height: 36px; padding: 4px 12px 4px 4px; border: 1px solid var(--agr-rule); border-radius: 18px; background: transparent; color: var(--agr-ink); font: inherit; font-size: 13px; cursor: pointer; }
.agr-switch:disabled { opacity: .5; cursor: default; }
.agr-knob { width: 40px; height: 24px; border-radius: 12px; background: var(--agr-rule); position: relative; transition: background .15s; }
.agr-knob::after { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: transform .15s; }
.agr-switch[aria-checked="true"] .agr-knob { background: var(--agr-ok); }
.agr-switch[aria-checked="true"] .agr-knob::after { transform: translateX(16px); }
.agr-switch[aria-checked="false"] .agr-knob { background: var(--agr-warn); }
.agr-alert { margin: 0; padding: 8px 10px; border-radius: 8px; background: var(--agr-warn-bg); color: var(--agr-ink); font-size: 13px; line-height: 20px; }
.agr-bad { margin: 0; color: var(--agr-bad); font-size: 13px; line-height: 20px; }
.agr-backdrop { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 16px; background: rgb(0 0 0 / 45%); }
.agr-backdrop-light { background: rgb(0 0 0 / 25%); }
.agr-dialog { width: min(480px, 100%); display: flex; flex-direction: column; gap: 12px; padding: 20px; border-radius: 14px; border: 1px solid var(--agr-rule); background: var(--dsw-alias-bg-base, var(--agr-bg)); color: var(--agr-ink); box-shadow: 0 18px 48px rgb(0 0 0 / 35%); font-size: 14px; line-height: 21px; }
.agr-title { margin: 0; display: flex; align-items: center; gap: 10px; font-size: 16px; line-height: 24px; font-weight: 600; }
.agr-warn-icon { flex: none; display: inline-grid; place-items: center; width: 24px; height: 24px; border-radius: 50%; background: var(--agr-warn); color: #fff; font-weight: 700; font-size: 14px; }
.agr-text { margin: 0; }
.agr-actions { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
.agr-button { min-height: 36px; padding: 6px 14px; border-radius: 8px; border: 1px solid var(--agr-rule); background: transparent; color: var(--agr-ink); font: inherit; font-size: 13px; cursor: pointer; }
.agr-button:hover:not(:disabled) { background: var(--agr-hover); }
.agr-button:disabled { opacity: .5; cursor: default; }
.agr-primary { background: var(--dsw-alias-button-primary-fill, #2f6fde); color: var(--dsw-alias-label-primary-foreground, #fff); border-color: transparent; }
.agr-primary:hover:not(:disabled) { filter: brightness(1.08); background: var(--dsw-alias-button-primary-fill, #2f6fde); }
.agr-danger { border-color: var(--agr-bad); color: var(--agr-bad); }
.agr-scope button:focus-visible { outline: 2px solid var(--agr-ink); outline-offset: 2px; }
.agr-chip { appearance: none; display: inline-flex; align-items: center; gap: 6px; min-height: 28px; padding: 0 10px; border: 1px solid var(--agr-warn); border-radius: 14px; background: var(--agr-warn-bg); color: var(--agr-ink); font: inherit; font-size: 12px; font-weight: 600; white-space: nowrap; cursor: pointer; }
.agr-chip-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--agr-warn); }
@media (max-width: 560px) { .agr-row { flex-direction: column; } .agr-actions .agr-button { flex: 1 1 100%; } }
@media (pointer: coarse) { .agr-button, .agr-switch { min-height: 44px; } .agr-chip { min-height: 36px; } }
`;
  return exports;
}});
