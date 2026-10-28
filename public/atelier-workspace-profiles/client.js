window.__ModuleLoader__.load({id: '@arcitech/atelier-workspace-profiles', factory: require => {
  const {createElement: h, useState, useEffect} = require('react');
  return {inject: ['slots', 'connection'], apply(ctx) {
    const call = async (method, data) => {
      const result = await ctx.connection.rpc.call('/atelier-workspace-profiles', method, data || {});
      if (!result.ok) throw Error(result.error.message);
      return result.value;
    };
    const Page = () => {
      const [state, setState] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
      const [path, setPath] = useState(''), [profile, setProfile] = useState('');
      const refresh = () => call('status').then(setState).catch(e => setError(e.message));
      useEffect(() => { void refresh(); }, []);
      const act = async (method, data) => {
        setBusy(true); setError('');
        try { setState(await call(method, data)); if (method === 'create') setPath(''); }
        catch (e) { setError(e.message); } finally { setBusy(false); }
      };
      if (!state) return h('p', {role: error ? 'alert' : undefined}, error || 'Loading workspace profiles…');
      const select = (value, onChange, label) => h('select', {value, 'aria-label': label, disabled: busy, onChange: e => onChange(e.target.value), style: {maxWidth: '100%', minHeight: 36}},
        h('option', {value: ''}, `Use global default (${state.globalDefault})`),
        state.profiles.map(p => h('option', {key: p.id, value: p.id, disabled: !!p.broken}, `${p.name}${p.broken ? ' — unavailable' : ''}`)));
      return h('section', {'data-workspace-profiles': '', style: {maxWidth: 760, display: 'grid', gap: 14, overflowWrap: 'anywhere'}},
        h('h3', {style: {margin: 0}}, 'Workspace profiles'),
        h('p', null, 'Each new chat starts with its workspace’s default profile. Existing chats keep their profile.'),
        h('form', {onSubmit: e => { e.preventDefault(); void act('create', {path, profile: profile || null}); }, style: {display: 'grid', gap: 10, border: '1px solid #414b5c', borderRadius: 8, padding: 14}},
          h('strong', null, 'Add a workspace'),
          h('label', null, 'Project folder on the host', h('input', {value: path, onChange: e => setPath(e.target.value), required: true, disabled: busy, style: {display: 'block', boxSizing: 'border-box', width: '100%', minHeight: 36}})),
          h('label', null, 'Default profile ', select(profile, setProfile, 'New workspace default profile')),
          h('button', {type: 'submit', disabled: busy || !path.trim(), style: {minHeight: 36, justifySelf: 'start'}}, 'Add workspace')),
        state.workspaces.map(w => h('div', {key: w.id, style: {borderBottom: '1px solid #414b5c', paddingBottom: 12, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12}},
          h('div', {style: {flex: '1 1 200px', minWidth: 0}}, h('strong', null, w.title), h('div', {style: {fontSize: 12, opacity: .75}}, w.path)),
          h('label', null, 'Default profile ', select(w.defaultProfile || '', value => { void act('set', {workspaceId: w.id, profile: value || null}); }, `Default profile for ${w.title}`)))),
        h('button', {type: 'button', onClick: refresh, disabled: busy, style: {justifySelf: 'start'}}, 'Refresh workspaces'),
        error ? h('p', {role: 'alert'}, error) : null);
    };
    ctx.slots.inject('settings.section', () => ctx.slots.register({name: 'settings.section', id: 'atelier-workspace-profiles', order: 42, label: () => 'Workspace profiles'}, Page));
  }};
}});
