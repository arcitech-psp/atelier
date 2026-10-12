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
    const call = async (endpoint, payload) => { const result = await ctx.connection.rpc.call('/atelier-canvas', endpoint, payload); if (!result.ok) throw Error(result.error.message); return result.value; };
    const Header = props => h('button', {type: 'button', onClick: props.onToggleSidePanel, 'aria-expanded': props.sidePanelOpen === true, title: 'Open canvas', 'data-atelier-canvas-toggle': ''}, 'Canvas');
    const Panel = props => {
      const [scene, setScene] = useState(null), [error, setError] = useState(''), [fullSize, setFullSize] = useState(false);
      useEffect(() => {
        let active = true;
        const refresh = async () => { try { const value = await call('get', {sessionId: props.sessionId}); if (active) {setScene(value); setError('');} } catch (e) {if (active) setError(e.message);} };
        void refresh(); const timer = setInterval(refresh, 1800);
        return () => {active = false; clearInterval(timer);};
      }, [props.sessionId]);
      const edit = async i => { const value = window.prompt('Card label', scene.cards[i].label); if (value === null) return; try {const cards = scene.cards.map((c, j) => j === i ? {...c, label: value} : c); setScene(await call('save', {sessionId: props.sessionId, scene: {...scene, cards}}));} catch(e) {setError(e.message);} };
      const width = Math.max(800, ...(scene?.cards ?? []).map(c => c.x + c.width + 24));
      const height = Math.max(500, ...(scene?.cards ?? []).map(c => c.y + c.height + 24));
      return h('section', {'data-atelier-canvas': '', style: {height: '100%', overflow: 'auto', padding: 16}},
        h('h2', null, scene?.title ?? 'Your design canvas'),
        h('p', null, error || (scene ? 'Click a card to edit its label. Concept sketch; dimensions and assumptions are in the notes.' : 'Ask Vitruvius for a plan or moodboard.')),
        h('button', {type:'button', onClick:()=>setFullSize(value=>!value)}, fullSize?'Fit diagram':'Full size diagram'),
        scene?.image ? h('img', {src: scene.image, alt: scene.title, style: {maxWidth: '100%'}}) : null,
        h('svg', {viewBox: `0 0 ${width} ${height}`, width: fullSize?width:'100%', style:{display:'block'}, role: 'img', 'aria-label': scene?.title ?? 'Empty canvas'}, ...(scene?.cards ?? []).map((c, i) =>
          h('g', {key: c.id, tabIndex: 0, role: 'button', 'aria-label': `Edit ${c.label}`, onClick: () => edit(i), onKeyDown: e => {if(e.key === 'Enter') void edit(i);}},
            h('rect', {x: c.x, y: c.y, width: c.width, height: c.height, fill: c.color, stroke: '#555555', rx: 6}),
            h('foreignObject', {x: c.x + 10, y: c.y + 10, width: Math.max(20, c.width - 20), height: Math.max(20, c.height - 20)},
              h('div', {xmlns: 'http://www.w3.org/1999/xhtml', style: {color: textColor(c.color), font: '14px system-ui', overflowWrap: 'anywhere'}}, h('strong', null, c.label), h('p', {style: {fontSize: 12, whiteSpace: 'pre-wrap'}}, c.note)))))),
        h('div', null, ...(scene?.cards??[]).map((c,i)=>h('article',{key:c.id,style:{marginTop:16,borderLeft:'6px solid '+c.color,paddingLeft:10}},h('button',{type:'button',onClick:()=>edit(i),'aria-label':'Rename '+c.label},c.label),h('p',{style:{whiteSpace:'pre-wrap'}},c.note)))));
    };
    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({name: 'conversation.session.header.utilities', id: 'atelier-canvas', order: 80}, Header));
    ctx.slots.inject('conversation.session.side-panel', () => ctx.slots.register({name: 'conversation.session.side-panel', priority: 80}, Panel));
    const Brand = () => h('span', {title: 'Atelier by ARCITECH — powered by DSH (DeepSeek Harness)'}, 'Atelier by ARCITECH');
    // The AIT mark, sidebar cut from the brand kit: ink follows the theme text colour (currentColor), walls take the brand tan.
    const MARK_SVG = '<defs><clipPath id="ait-cut-w1"><path d="M14.94 25.37 L47.37 82.86 L54.86 78.63 L22.43 21.14Z"/></clipPath><clipPath id="ait-cut-w2"><path d="M67.7 29.74 L96.3 29.74 L96.3 21.14 L67.7 21.14Z"/></clipPath><clipPath id="ait-cut-w3"><path d="M77.7 37.2 L77.7 82.86 L86.3 82.86 L86.3 37.2Z"/></clipPath></defs><g transform="translate(9.67 3.65) scale(0.82)"><path d="M14.94 25.37 L47.37 82.86 L54.86 78.63 L22.43 21.14Z" fill="none" stroke="var(--mark-wall, #d39a66)" stroke-width="5" stroke-linejoin="miter" clip-path="url(#ait-cut-w1)"/><g><circle cx="18.69" cy="76" r="8" fill="none" stroke="currentColor" stroke-width="1.6" opacity="0.38"/><path d="M18.69 68A8 8 0 1 1 10.690000000000001 76" stroke="currentColor" stroke-width="2.3" fill="none"/><circle cx="18.69" cy="76" r="2.7" fill="currentColor"/></g><g><path d="M1 86.6L97 86.6" stroke="currentColor" stroke-width="1.2" fill="none"/><g><path d="M56.5 22.74L66.5 22.74" stroke="currentColor" stroke-width="3.2" fill="none"/><path d="M61.5 22.74L61.5 86.6" stroke="currentColor" stroke-width="2.4" fill="none"/></g><path d="M58.1 90L64.9 83.2" stroke="currentColor" stroke-width="3" fill="none"/><path d="M57.5 49.87 L65.5 49.87 L65.5 57.87 L57.5 57.87Z" fill="var(--mark-wall, #d39a66)"/><path d="M57.5 49.87H65.5V57.87H57.5Z" stroke="var(--mark-wall, #d39a66)" stroke-width="1.1" fill="none"/></g><path d="M67.7 29.74 L96.3 29.74 L96.3 21.14 L67.7 21.14Z" fill="none" stroke="var(--mark-wall, #d39a66)" stroke-width="5" stroke-linejoin="miter" clip-path="url(#ait-cut-w2)"/><path d="M77.7 37.2 L77.7 82.86 L86.3 82.86 L86.3 37.2Z" fill="none" stroke="var(--mark-wall, #d39a66)" stroke-width="5" stroke-linejoin="miter" clip-path="url(#ait-cut-w3)"/><path d="M82 29.74A7.46 7.46 0 0 0 74.54 37.2" stroke="currentColor" stroke-width="1.2" fill="none" stroke-dasharray="2.2 1.9"/><path d="M82 37.2L74.54 37.2" stroke="currentColor" stroke-width="1.8" fill="none"/></g>';
    const Mark = props => h('svg', {viewBox: '0 0 100 100', width: props?.size ?? 24, height: props?.size ?? 24, className: props?.className, role: 'img', 'aria-label': 'Atelier by ARCITECH',
      style: {color: 'var(--dsw-alias-label-primary, #eceae6)', '--mark-wall': '#d39a66', display: 'block'}, dangerouslySetInnerHTML: {__html: MARK_SVG}});
    ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({name: 'sidebar.brand.name', priority: 100}, Brand));
    ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({name: 'sidebar.brand.mark', priority: 100}, Mark));
    ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({name: 'conversation.hero.brand.mark', priority: 100}, Mark));
  };
  return exports;
}});
