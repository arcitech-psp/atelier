import { jsx as _jsx } from "react/jsx-runtime";
/**
 * Configurable Host plugins contributed to the shared Plugins section.
 *
 * The tab enumerates settings namespaces but never interprets one — a card
 * arrives through `settings.plugin.item` keyed by the namespace it edits, so a
 * plugin that ships a browser half owns its own card and this tab only decides
 * which keys to dispatch.
 */
import { Fragment } from 'react';
import css from './PluginsSettingsSection.module.css';
/**
 * Render cards registered by plugins that expose editable settings.
 * @param props - locale copy, slot rendering, and the namespaces to dispatch.
 * @returns the card list, or the empty line once the Host has answered.
 */
export function ConfigurablePluginsTab(props) {
    const { t, renderSlot } = props;
    const { loaded, namespaces } = props.useConfigurablePlugins(snapshot => snapshot);
    if (namespaces.length > 0) {
        return (_jsx("ul", { className: css.cards, children: namespaces.map(ns => (_jsx(Fragment, { children: renderSlot('settings.plugin.item', {}, { entryKey: ns }) }, ns))) }));
    }
    return loaded ? _jsx("p", { className: css.empty, children: t('empty') }) : null;
}
