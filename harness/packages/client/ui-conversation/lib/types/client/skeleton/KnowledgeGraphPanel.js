import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/** Optional reference-only Knowledge Graph side panel. The old preview looked bad; reuse the settled graph view here. */
import { useCallback, useEffect, useState } from 'react';
import { IconCloseOutline16, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './KnowledgeGraphPanel.module.css';
// The panel draws the knowledge graph it reports (the ~230 cards), not the whole 5,800-node Neuro Graph: at panel width
// that was one solid ball (2026-09-26). The full Neuro Graph stays one click away in the session header.
const GRAPH_VIEW_URL = '/api/neuro-graph/cards?panel=1';
function isAbortError(error) {
    return error instanceof DOMException && error.name === 'AbortError';
}
/**
  * Keep the compact shell in React and let the shared graphify renderer own graph interaction.
 * @param props - transport, close action, and locale shares.
 * @returns the mounted Knowledge Graph side panel.
 */
export function KnowledgeGraphPanel({ open, onClose, transport, width, t }) {
    const [state, setState] = useState({ kind: 'idle' });
    const load = useCallback(async () => {
        if (transport === undefined) {
            setState({ kind: 'error', error: t('graph.unavailable') });
            return;
        }
        setState({ kind: 'loading' });
        try {
            const response = await transport.load();
            if (response.ok) {
                setState({ kind: 'ready', graph: response });
            }
            else {
                setState({ kind: 'error', error: response.error });
            }
        }
        catch (error) {
            if (isAbortError(error))
                return;
            setState({ kind: 'error', error: error instanceof Error ? error.message : String(error) });
        }
    }, [t, transport]);
    useEffect(() => {
        if (open) {
            void load();
        }
        else {
            transport?.abort();
        }
        return () => { transport?.abort(); };
    }, [load, open, transport]);
    const graph = state.graph;
    const close = () => {
        transport?.abort();
        onClose();
    };
    return (_jsxs("section", { id: "dsh-knowledge-graph-panel", className: css.panel, "aria-label": t('graph.panel'), hidden: !open, "data-knowledge-graph-panel": "", style: { '--dsh-knowledge-graph-panel-width': `${width}px` }, children: [_jsxs("div", { className: css.header, children: [_jsx("span", { className: css.title, children: t('graph.panel') }), _jsxs("div", { className: css.headerActions, children: [_jsx("button", { type: "button", className: css.iconButton, "aria-label": t('graph.refresh'), title: t('graph.refresh'), disabled: state.kind === 'loading', onClick: () => { void load(); }, children: _jsx(IconRefreshOutline16, { size: 14 }) }), _jsx("button", { type: "button", className: css.iconButton, "aria-label": t('graph.close'), title: t('graph.close'), onClick: close, children: _jsx(IconCloseOutline16, { size: 14 }) })] })] }), _jsxs("div", { className: css.body, children: [state.kind === 'loading' && _jsx("p", { className: css.status, children: t('graph.loading') }), state.kind === 'error' && (_jsxs("p", { className: css.status, role: "alert", children: [t('graph.unavailable'), ": ", state.error] })), graph !== undefined && (_jsxs(_Fragment, { children: [_jsxs("div", { className: css.meta, children: [_jsx("span", { children: t('graph.referenceOnly') }), _jsx("span", { children: t('graph.revision', { revision: graph.revision }) }), _jsx("span", { children: t('graph.builtAt', { builtAt: graph.builtAt }) }), _jsx("span", { children: t('graph.coverage', {
                                            shown: graph.totalNodes,
                                            totalNodes: graph.totalNodes,
                                            edges: graph.totalEdges,
                                            totalEdges: graph.totalEdges,
                                        }) }), graph.truncated && _jsx("span", { className: css.warning, children: t('graph.truncated') })] }), _jsx("div", { className: css.graphFrame, children: _jsx("iframe", { className: css.graphFrameView, src: GRAPH_VIEW_URL, title: t('graph.graphLabel'), loading: "eager" }) })] }))] })] }));
}
