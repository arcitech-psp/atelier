import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
/** Shared side-panel chrome: pop-out, tile, and close stay consistent across every panel slot. */
import { useEffect, useRef, useState } from 'react';
import css from './PanelHost.module.css';
function popoutUrl(id) {
    return `/?panel=${encodeURIComponent(id)}&solo=1`;
}
export function PanelHost({ id, title, open, tiled, solo, onToggleTile, onClose, children }) {
    const popup = useRef(null);
    const [detached, setDetached] = useState(false);
    useEffect(() => {
        if (solo || !detached)
            return;
        const timer = window.setInterval(() => {
            if (popup.current?.closed !== false) {
                popup.current = null;
                setDetached(false);
            }
        }, 500);
        return () => { window.clearInterval(timer); };
    }, [detached, solo]);
    useEffect(() => {
        if (solo)
            return;
        const receive = (event) => {
            if (event.origin !== window.location.origin)
                return;
            const data = event.data;
            if (data?.type === 'dsh-panel-dock' && data.id === id) {
                popup.current = null;
                setDetached(false);
            }
        };
        window.addEventListener('message', receive);
        return () => { window.removeEventListener('message', receive); };
    }, [id, solo]);
    const popOut = () => {
        if (typeof window === 'undefined')
            return;
        const next = window.open(popoutUrl(id), `dsh-panel-${id}`, 'popup,width=900,height=700,resizable=yes,scrollbars=yes');
        if (next === null)
            return;
        popup.current = next;
        setDetached(true);
        next.focus();
    };
    const dock = () => {
        const opener = window.opener;
        if (opener !== null && typeof opener === 'object' && 'postMessage' in opener && typeof opener.postMessage === 'function') {
            opener.postMessage({ type: 'dsh-panel-dock', id }, window.location.origin);
        }
        window.close();
    };
    return (_jsxs("section", { className: css.host, "data-panel-host": id, "data-panel-tiled": tiled ? '' : undefined, "data-panel-detached": detached ? '' : undefined, hidden: !open && !solo, children: [_jsxs("header", { className: css.header, children: [_jsx("span", { className: css.title, children: title }), _jsx("div", { className: css.actions, children: solo ? (_jsx("button", { type: "button", className: css.button, onClick: dock, children: "Dock" })) : (_jsxs(_Fragment, { children: [_jsx("button", { type: "button", className: css.button, onClick: popOut, disabled: detached, children: "Pop out" }), _jsx("button", { type: "button", className: css.button, "aria-pressed": tiled, onClick: onToggleTile, children: "Tile" }), _jsx("button", { type: "button", className: css.button, onClick: onClose, children: "Close" })] })) })] }), _jsx("div", { className: css.body, "aria-busy": detached || undefined, children: children })] }));
}
