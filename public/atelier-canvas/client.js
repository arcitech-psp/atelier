window.__ModuleLoader__.load({id: '@arcitech/atelier-canvas', factory: require => {
  const {createElement: h, useState, useEffect} = require('react');
  const textColor = color => {const rgb=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16)); return rgb[0]*0.299+rgb[1]*0.587+rgb[2]*0.114<135?'#ffffff':'#151515';};
  const exports = {};
  exports.inject = ['slots', 'connection'];
  exports.apply = ctx => {
    // Owner 8 Oct: no hero status badge ("Preview" / "Runs locally") in the Atelier UI.
    if (typeof document !== 'undefined' && !document.getElementById('atelier-hide-hero-badge')) {
      const style = document.createElement('style'); style.id = 'atelier-hide-hero-badge';
      style.textContent = '[class*="_previewBadge"]{display:none!important}';
      document.head.appendChild(style);
      ctx.on?.('dispose', () => style.remove());
    }
    // Phones (760 px and narrower, the harness's own breakpoint): the side panel that holds the canvas becomes a full sheet
    // over the chat (its Close button or the Canvas button hides it again), and the session header puts its tools on a
    // second line instead of drawing them over the chat title.
    if (typeof document !== 'undefined' && !document.getElementById('atelier-phone-layout')) {
      const style = document.createElement('style'); style.id = 'atelier-phone-layout';
      const dock = '[class*="_viewAreaSideBySide"] [class*="_panelDock"]:has([data-atelier-canvas])';
      style.textContent = '@media (max-width: 760px) {'
        + `${dock}{position:absolute;inset:0;z-index:8;flex:none;width:auto;height:auto;display:flex;flex-direction:column;overflow:auto;background:var(--dsw-alias-bg-base,#1f1f20)}`
        + `${dock}>*{flex:1 1 auto;min-height:100%;max-height:none}`
        + `${dock}>*:not(:has([data-atelier-canvas])){display:none}`
        + `${dock} [class*="_body"]{flex:1 1 auto;height:auto;min-height:0}`
        + `${dock} [class*="_trajectoryPanel"]{flex:1 1 auto;height:auto;min-height:0}`
        + '[class*="_header"]>[class*="_titleRow"]{flex-wrap:wrap;row-gap:6px}'
        + '[class*="_titleRow"]>[class*="_titleCluster"]{flex:1 1 100%}'
        + '[class*="_titleRow"]>[class*="_headerUtilities"]{margin-left:0;flex:1 1 100%;min-width:0;overflow-x:auto;justify-content:flex-start;padding-bottom:4px}'
        + '}';
      document.head.appendChild(style);
      ctx.on?.('dispose', () => style.remove());
    }
    const call = async (endpoint, payload) => { const result = await ctx.connection.rpc.call('/atelier-canvas', endpoint, payload); if (!result.ok) throw Error(result.error.message); return result.value; };
    const Header = props => h('button', {type: 'button', onClick: props.onToggleSidePanel, 'aria-expanded': props.sidePanelOpen === true, title: 'Open canvas', 'data-atelier-canvas-toggle': ''}, 'Canvas');
    // Plans come in metres (origin at the south-west corner, x east, y north); diagrams and moodboards in canvas pixels.
    // A plan is scaled to fit the view, flipped so north is up, and gets a scale bar and a north arrow.
    const fmt = n => (Math.round(n * 100) / 100).toString();
    const placedOf = scene => (scene?.cards ?? []).map((c, i) => ({c, i})).filter(({c}) => c.placed !== false);
    const isMetric = scene => scene?.units === 'm' || (scene?.units === undefined && placedOf(scene).length > 0
      && Math.max(...placedOf(scene).map(({c}) => Math.max(c.x + c.width, c.y + c.height))) <= 150);
    const layout = scene => {
      const cards = scene?.cards ?? [];
      if (!isMetric(scene)) {
        return {metric: false, width: Math.max(800, ...cards.map(c => c.x + c.width + 24)), height: Math.max(500, ...cards.map(c => c.y + c.height + 24)),
          items: cards.map((c, i) => ({c, i, x: c.x, y: c.y, w: c.width, h: c.height, boundary: false})), extras: []};
      }
      const placed = placedOf(scene);
      const minX = Math.min(...placed.map(({c}) => c.x)), minY = Math.min(...placed.map(({c}) => c.y));
      const maxX = Math.max(...placed.map(({c}) => c.x + c.width)), maxY = Math.max(...placed.map(({c}) => c.y + c.height));
      const spanX = Math.max(maxX - minX, 1), spanY = Math.max(maxY - minY, 1);
      const pad = 40, s = Math.max(4, Math.min(720 / spanX, 900 / spanY));
      const width = Math.round(spanX * s + 2 * pad), height = Math.round(spanY * s + 2 * pad + 28);
      const inside = (a, b) => b.x >= a.x - 1e-6 && b.y >= a.y - 1e-6 && b.x + b.width <= a.x + a.width + 1e-6 && b.y + b.height <= a.y + a.height + 1e-6;
      const items = placed
        .map(({c, i}) => ({c, i, x: pad + (c.x - minX) * s, y: pad + (maxY - c.y - c.height) * s, w: c.width * s, h: c.height * s,
          boundary: placed.filter(o => o.c !== c && inside(c, o.c)).length >= 2}))
        .sort((a, b) => b.w * b.h - a.w * a.h);
      const nice = [0.5, 1, 2, 5, 10, 20, 50, 100].filter(n => n <= spanX / 2.5).pop() ?? 0.5;
      const barY = height - 22, barW = nice * s;
      const extras = [
        h('g', {key: 'scale', stroke: 'currentColor', fill: 'none', strokeWidth: 1.5, 'aria-hidden': true},
          h('path', {d: `M${pad} ${barY} h${barW} M${pad} ${barY - 5} v10 M${pad + barW} ${barY - 5} v10 M${pad + barW / 2} ${barY - 3} v6`}),
          h('text', {x: pad + barW + 8, y: barY + 4, fill: 'currentColor', stroke: 'none', style: {font: '12px system-ui'}}, `${fmt(nice)} m`)),
        h('g', {key: 'north', 'aria-hidden': true, transform: `translate(${width - 22} 26)`},
          h('path', {d: 'M0 -14 L6 4 L0 0 L-6 4 Z', fill: 'currentColor'}),
          h('text', {x: 0, y: 18, textAnchor: 'middle', fill: 'currentColor', style: {font: 'bold 12px system-ui'}}, 'N')),
      ];
      return {metric: true, width, height, items, extras};
    };
    const Panel = props => {
      const [scene, setScene] = useState(null), [error, setError] = useState(''), [fullSize, setFullSize] = useState(false);
      useEffect(() => {
        let active = true;
        const refresh = async () => { try { const value = await call('get', {sessionId: props.sessionId}); if (active) {setScene(value); setError('');} } catch (e) {if (active) setError(e.message);} };
        void refresh(); const timer = setInterval(refresh, 1800);
        return () => {active = false; clearInterval(timer);};
      }, [props.sessionId]);
      const edit = async i => { const value = window.prompt('Card label', scene.cards[i].label); if (value === null) return; try {const cards = scene.cards.map((c, j) => j === i ? {...c, label: value} : c); setScene(await call('save', {sessionId: props.sessionId, scene: {...scene, cards}}));} catch(e) {setError(e.message);} };
      const cards = scene?.cards ?? [];
      const plan = layout(scene);
      const ink = 'var(--dsw-alias-label-primary, #eceae6)';
      return h('section', {'data-atelier-canvas': '', style: {height: '100%', overflow: 'auto', padding: 16, boxSizing: 'border-box'}},
        h('h2', null, scene?.title ?? 'Your design canvas'),
        h('p', null, error || (scene ? (plan.metric ? 'Drawn to scale in metres, north up. Click a room to edit its label. Concept sketch; dimensions and assumptions are in the notes.' : 'Click a card to edit its label. Concept sketch; dimensions and assumptions are in the notes.') : 'Ask Vitruvius for a plan or moodboard.')),
        h('button', {type:'button', onClick:()=>setFullSize(value=>!value)}, fullSize?'Fit diagram':'Full size diagram'),
        scene?.image ? h('img', {src: scene.image, alt: scene.title, style: {maxWidth: '100%'}}) : null,
        h('svg', {viewBox: `0 0 ${plan.width} ${plan.height}`, width: fullSize ? plan.width : '100%', style: {display: 'block', color: ink, ...(fullSize ? {} : {maxHeight: '75vh'})}, role: 'img', 'aria-label': scene?.title ?? 'Empty canvas'},
          ...plan.items.map(({c, i, x, y, w, h: ht, boundary}) => {
            const size = plan.metric ? Math.max(8, Math.min(13, w / 7, ht / 2.6)) : 14;
            const dims = plan.metric ? `${fmt(c.width)} × ${fmt(c.height)} m` : '';
            return h('g', {key: c.id, tabIndex: 0, role: 'button', 'aria-label': `Edit ${c.label}`, onClick: () => edit(i), onKeyDown: e => {if(e.key === 'Enter') void edit(i);}},
              h('title', null, `${c.label}${dims ? ` (${dims})` : ''}`),
              h('rect', {x, y, width: w, height: ht, fill: c.color, fillOpacity: boundary ? 0.22 : 0.92, stroke: boundary ? 'currentColor' : '#555555', strokeDasharray: boundary ? '6 4' : undefined, rx: plan.metric ? 1 : 6}),
              // A boundary (the lot) is labelled just above its outline, so the rooms drawn inside it never hide the label.
              boundary ? h('text', {x, y: y - 9, fill: 'currentColor', style: {font: `bold 13px system-ui`}}, `${c.label.length > 60 ? c.label.slice(0, 59) + '…' : c.label}  ·  ${dims}`) :
              h('foreignObject', {x: x + 4, y: y + 3, width: Math.max(8, w - 8), height: Math.max(8, ht - 6)},
                h('div', {xmlns: 'http://www.w3.org/1999/xhtml', style: {color: boundary ? 'currentColor' : textColor(c.color), font: `${size}px/1.2 system-ui`, overflow: 'hidden', overflowWrap: 'anywhere', height: '100%'}},
                  h('strong', null, c.label), plan.metric ? h('div', {style: {fontSize: Math.max(7, size - 2)}}, dims) : h('p', {style: {fontSize: 12, whiteSpace: 'pre-wrap'}}, c.note))));
          }),
          ...plan.extras),
        h('div', null, ...(scene?.cards??[]).map((c,i)=>h('article',{key:c.id,style:{marginTop:16,borderLeft:'6px solid '+c.color,paddingLeft:10}},h('button',{type:'button',onClick:()=>edit(i),'aria-label':'Rename '+c.label},c.label),h('p',{style:{whiteSpace:'pre-wrap'}},c.note)))));
    };
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({name: 'conversation.session.header.utilities', id: 'atelier-canvas', order: 80}, Header));
    ctx.slots.inject('conversation.session.side-panel', () => ctx.slots.register({name: 'conversation.session.side-panel', priority: 80}, Panel));
    const Brand = () => h('span', {title: 'Atelier by ARCITECH — powered by DSH (DeepSeek Harness)'}, 'Atelier by ARCITECH');
    // The AIT mark from the brand kit: ink follows the theme text colour (currentColor), walls take the brand tan.
    // Below 64 px the kit's small-size cut (solid walls, heavier strokes); larger, the sidebar cut.
    const MARK_SVG = '<defs><clipPath id="ait-cut-w1"><path d="M14.94 25.37 L47.37 82.86 L54.86 78.63 L22.43 21.14Z"/></clipPath><clipPath id="ait-cut-w2"><path d="M67.7 29.74 L96.3 29.74 L96.3 21.14 L67.7 21.14Z"/></clipPath><clipPath id="ait-cut-w3"><path d="M77.7 37.2 L77.7 82.86 L86.3 82.86 L86.3 37.2Z"/></clipPath></defs><g transform="translate(9.67 3.65) scale(0.82)"><path d="M14.94 25.37 L47.37 82.86 L54.86 78.63 L22.43 21.14Z" fill="none" stroke="var(--mark-wall, #d39a66)" stroke-width="5" stroke-linejoin="miter" clip-path="url(#ait-cut-w1)"/><g><circle cx="18.69" cy="76" r="8" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.38"/><path d="M18.69 68A8 8 0 1 1 10.690000000000001 76" stroke="currentColor" stroke-width="2.3" fill="none"/><circle cx="18.69" cy="76" r="2.7" fill="currentColor"/></g><g><path d="M1 86.6L97 86.6" stroke="currentColor" stroke-width="1.2" fill="none"/><g><path d="M56.5 22.74L66.5 22.74" stroke="currentColor" stroke-width="3.2" fill="none"/><path d="M61.5 22.74L61.5 86.6" stroke="currentColor" stroke-width="2.4" fill="none"/></g><path d="M58.1 90L64.9 83.2" stroke="currentColor" stroke-width="3" fill="none"/><path d="M57.5 49.87 L65.5 49.87 L65.5 57.87 L57.5 57.87Z" fill="var(--mark-wall, #d39a66)"/><path d="M57.5 49.87H65.5V57.87H57.5Z" stroke="var(--mark-wall, #d39a66)" stroke-width="1.1" fill="none"/></g><path d="M67.7 29.74 L96.3 29.74 L96.3 21.14 L67.7 21.14Z" fill="none" stroke="var(--mark-wall, #d39a66)" stroke-width="5" stroke-linejoin="miter" clip-path="url(#ait-cut-w2)"/><path d="M77.7 37.2 L77.7 82.86 L86.3 82.86 L86.3 37.2Z" fill="none" stroke="var(--mark-wall, #d39a66)" stroke-width="5" stroke-linejoin="miter" clip-path="url(#ait-cut-w3)"/><path d="M82 29.74A7.46 7.46 0 0 0 74.54 37.2" stroke="currentColor" stroke-width="1.2" fill="none" stroke-dasharray="2.2 1.9"/><path d="M82 37.2L74.54 37.2" stroke="currentColor" stroke-width="1.8" fill="none"/></g>';
    const MARK_SMALL_SVG = '<g transform="translate(2.36 2.02) scale(0.91)"><path d="M14.94 25.37 L47.37 82.86 L54.86 78.63 L22.43 21.14Z" fill="var(--mark-wall, #d39a66)"/><g><circle cx="18.69" cy="76" r="8" fill="none" stroke="currentColor" stroke-width="4.6"/><circle cx="18.69" cy="76" r="3.7" fill="currentColor"/></g><g><path d="M56.5 81.26L66.5 81.26" stroke="currentColor" stroke-width="7.2" fill="none"/><g><path d="M56.5 22.74L66.5 22.74" stroke="currentColor" stroke-width="7.2" fill="none"/><path d="M61.5 22.74L61.5 82.86" stroke="currentColor" stroke-width="5.6" fill="none"/></g><path d="M57.5 49.87 L65.5 49.87 L65.5 57.87 L57.5 57.87Z" fill="var(--mark-wall, #d39a66)"/></g><path d="M67.7 29.74 L96.3 29.74 L96.3 21.14 L67.7 21.14Z" fill="var(--mark-wall, #d39a66)"/><path d="M77.7 37.2 L77.7 82.86 L86.3 82.86 L86.3 37.2Z" fill="var(--mark-wall, #d39a66)"/></g>';
    const Mark = props => h('svg', {viewBox: '0 0 100 100', width: props?.size ?? 24, height: props?.size ?? 24, className: props?.className, role: 'img', 'aria-label': 'Atelier by ARCITECH',
      style: {color: 'var(--dsw-alias-label-primary, #eceae6)', '--mark-wall': '#d39a66', display: 'block'}, dangerouslySetInnerHTML: {__html: (props?.size ?? 24) < 64 ? MARK_SMALL_SVG : MARK_SVG}});
    ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({name: 'sidebar.brand.name', priority: 100}, Brand));
    ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({name: 'sidebar.brand.mark', priority: 100}, Mark));
    ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({name: 'conversation.hero.brand.mark', priority: 100}, Mark));
  };
  return exports;
}});
