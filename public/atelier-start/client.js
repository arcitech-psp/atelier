// Atelier new-chat page, browser half. Replaces the stock DSH hero ("What are we designing today?" over a blue glow)
// with a studio start sheet: a plain heading and orienting line, the project and profile chips the core already owns,
// a generous composer, four starting routes mapped to the skills this release ships, recent sessions, and one quiet
// line of model status. Everything here is scoped to the blank-session hero; the chat itself is untouched.
// Slots used: conversation.hero.brand.mark (heading, root scope, so it shows before a workspace exists) and
// conversation.input.dock (routes, recents, status; portalled below the composer so focus order follows the page).
window.__ModuleLoader__.load({id: '@arcitech/atelier-start', factory: require => {
  const React = require('react');
  const {createElement: h, Fragment, useEffect, useRef, useState, useSyncExternalStore} = React;
  const {createPortal} = require('react-dom');
  const exports = {};
  exports.inject = ['slots', 'sessions', 'connection'];

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
      h('path', {d: 'M16.3 30.6L10.35 66.1', strokeWidth: 5.6, ...ink}),
      h('path', {d: 'M13.57 60L32.27 60', strokeWidth: 5.6, ...ink}),
      h('circle', {cx: 10, cy: 76, r: 8, strokeWidth: 4.6, ...ink}),
      h('circle', {cx: 10, cy: 76, r: 3.7, fill: 'var(--dsw-alias-label-primary, #eceae6)'}),
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

    /** Heading and orienting line. Root scope, so the cold start (no workspace yet) is covered too. */
    const Head = () => {
      const sessions = useList();
      const current = sessions.current === undefined ? undefined : sessions.byId[sessions.current];
      return h('div', {className: 'ats-scope ats-head'},
        h('div', {className: 'ats-title-row'}, h(Mark), h('h1', {className: 'ats-title'}, 'New session')),
        h('p', {className: 'ats-lede'}, current === undefined
          ? 'Choose a project folder to begin. Atelier reads and writes files only there, and asks before it runs a command.'
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
            line.note && h('span', {className: 'ats-status-note'}, line.note))));

      return h(Fragment, null, h('span', {ref: anchor, className: 'ats-anchor', hidden: true}), host && createPortal(page, host));
    };

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
`;
  return exports;
}});
