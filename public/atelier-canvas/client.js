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
    const Brand = () => h('span', {title: 'Atelier by ARCITECH, built on DSH'}, 'Atelier by ARCITECH');
    const Mark = () => h('span', {'aria-label': 'Atelier'}, 'AT');
    ctx.slots.inject('sidebar.brand.name', () => ctx.slots.register({name: 'sidebar.brand.name', priority: 100}, Brand));
    ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.register({name: 'sidebar.brand.mark', priority: 100}, Mark));
    ctx.slots.inject('conversation.hero.brand.mark', () => ctx.slots.register({name: 'conversation.hero.brand.mark', priority: 100}, Mark));
  };
  return exports;
}});
