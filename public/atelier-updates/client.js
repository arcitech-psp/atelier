window.__ModuleLoader__.load({id: '@arcitech/atelier-updates', factory: require => {
  const {createElement: h, useState, useEffect, useCallback} = require('react');
  const exports = {};
  exports.inject = ['slots', 'connection'];
  exports.apply = ctx => {
    const call = async (endpoint, payload) => {
      const result = await ctx.connection.rpc.call('/atelier-updates', endpoint, payload ?? {});
      if (!result.ok) throw Error(result.error.message);
      return result.value;
    };
    const mb = bytes => `${(bytes / 1048576).toFixed(0)} MB`;
    const row = {display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', margin: '12px 0'};
    const muted = {opacity: 0.72, fontSize: 13, lineHeight: 1.5};

    const UpdatesSection = () => {
      const [s, setS] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState('');
      const refresh = useCallback(async () => { try { setS(await call('status')); } catch (e) { setError(e.message); } }, []);
      useEffect(() => {
        void refresh();
        const timer = setInterval(refresh, 1500);
        return () => clearInterval(timer);
      }, [refresh]);
      const act = (name, endpoint, payload) => async () => {
        setBusy(name); setError('');
        try { setS(await call(endpoint, payload)); } catch (e) { setError(e.message); } finally { setBusy(''); }
      };
      if (!s) return h('section', {style: {padding: 4}}, h('p', null, error || 'Loading...'));
      const check = s.job.lastCheck, latest = check?.latest, state = s.install;
      const installed = s.mode === 'installed';
      const pending = state.pending && state.pending !== state.current ? state.pending : null;
      return h('section', {'data-atelier-updates': '', style: {padding: 4, maxWidth: 640}},
        h('h3', {style: {margin: '0 0 4px'}}, `Atelier ${s.plain}`),
        h('p', {style: muted}, 'Atelier by ARCITECH — powered by DSH (DeepSeek Harness). A design assistant for architects; public preview.'),
        h('p', {style: muted}, `Built on DSH ${s.dshVersion} by DeepSeek-AI, MIT licence.`),
        h('h4', {style: {margin: '20px 0 4px'}}, 'Updates'),
        h('p', {style: muted}, `Atelier only contacts GitHub (github.com/${s.repo}) when you press Check for updates, or when automatic updates are on.`),
        h('div', {style: row},
          h('button', {type: 'button', disabled: !!busy || s.job.state !== 'idle', onClick: act('check', 'check')},
            s.job.state === 'checking' ? 'Checking...' : 'Check for updates'),
          s.lastCheckAt ? h('span', {style: muted}, `Last checked ${new Date(s.lastCheckAt).toLocaleString()}`) : null),
        check && !check.newer && !s.job.error ? h('p', null, `You have the newest version${latest ? ` (${latest.version})` : ''}.`) : null,
        check?.newer ? h('div', {style: {border: '1px solid currentColor', borderRadius: 8, padding: 12, margin: '8px 0'}},
          h('strong', null, `Atelier ${latest.version} is available`),
          h('p', {style: muted}, `${latest.asset.name}, ${mb(latest.asset.size)}. Installed next to your current version, which is kept so you can go back.`),
          latest.notes ? h('details', null, h('summary', null, 'What is new'), h('pre', {style: {whiteSpace: 'pre-wrap', fontSize: 12}}, latest.notes)) : null,
          installed ? (s.job.state === 'installing'
            ? h('p', null, `Downloading and checking... ${s.job.progress ? mb(s.job.progress.bytes) : ''}`)
            : s.job.state !== 'ready' && !pending
              ? h('button', {type: 'button', disabled: !!busy, onClick: act('install', 'install')}, 'Download and install')
              : null)
            : h('p', {style: muted}, h('a', {href: latest.page, target: '_blank', rel: 'noreferrer'}, 'Download it from the Releases page'), ' (this copy runs from source).')) : null,
        pending ? h('div', {style: row},
          h('span', null, `Atelier ${pending} is ready and starts next time.`),
          h('button', {type: 'button', disabled: !!busy, onClick: act('restart', 'restart')}, 'Restart now'),
          h('button', {type: 'button', disabled: !!busy, onClick: act('cancel', 'cancel')}, 'Not now')) : null,
        installed && state.previous && state.previous !== state.current && !pending ? h('div', {style: row},
          h('button', {type: 'button', disabled: !!busy, onClick: act('rollback', 'rollback')}, `Roll back to ${state.previous}`),
          h('span', {style: muted}, 'Your chats and settings stay as they are.')) : null,
        installed ? h('label', {style: {...row, cursor: 'pointer'}},
          h('input', {type: 'checkbox', checked: s.auto, disabled: !!busy, onChange: e => act('auto', 'auto', {enabled: e.target.checked})()}),
          h('span', null, 'Install updates automatically (off by default). Atelier then checks once a day and switches on the next start.'))
          : h('p', {style: muted}, 'Running from source: update with git, or install a release to get one-click updates.'),
        s.job.error || error ? h('p', {role: 'alert', style: {color: '#b3261e'}}, s.job.error || error) : null);
    };

    ctx.slots.inject('settings.section', () => ctx.slots.register({
      name: 'settings.section', id: 'atelier-updates', order: 90, label: () => 'Updates',
    }, UpdatesSection));
  };
  return exports;
}});
