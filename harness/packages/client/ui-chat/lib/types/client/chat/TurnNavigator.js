import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { memo, useId, useState, } from 'react';
import css from './TurnNavigator.module.css';
/** Resting gap between neighbouring marks before the rail compresses to fit. */
const TURN_SPACING_PX = 10;
/** Rail padding above the first mark and below the last one, per end. */
const RAIL_INSET_PX = 6;
function itemPosition(index, count) {
    const ratio = count <= 1 ? 0 : index / (count - 1);
    return {
        '--turn-natural-position': `${String(index * TURN_SPACING_PX)}px`,
        '--turn-position': `${String(ratio * 100)}%`,
    };
}
function railSize(count) {
    return {
        '--turn-natural-height': `${String((count - 1) * TURN_SPACING_PX + 2 * RAIL_INSET_PX)}px`,
        '--turn-rail-inset': `${String(RAIL_INSET_PX)}px`,
    };
}
function itemAtPointer(items, rail, clientY) {
    const rect = rail.getBoundingClientRect();
    const usableHeight = Math.max(1, rect.height - 2 * RAIL_INSET_PX);
    const ratio = Math.max(0, Math.min(1, (clientY - rect.top - RAIL_INSET_PX) / usableHeight));
    return items[Math.round(ratio * (items.length - 1))];
}
function TurnNavigatorRail({ items, activeTurn, onNavigate, t }) {
    const [previewTurn, setPreviewTurn] = useState(null);
    const previewId = useId();
    if (items.length < 2)
        return null;
    const previewIndex = items.findIndex(item => item.turn === previewTurn);
    const preview = previewIndex < 0 ? undefined : items[previewIndex];
    const previewPosition = previewIndex < 0 ? undefined : itemPosition(previewIndex, items.length);
    const previewAtPointer = (event) => {
        setPreviewTurn(itemAtPointer(items, event.currentTarget, event.clientY)?.turn ?? null);
    };
    const navigateAtPointer = (event) => {
        const item = itemAtPointer(items, event.currentTarget, event.clientY);
        if (item !== undefined)
            onNavigate(item);
    };
    return (_jsx("div", { className: css.slot, children: _jsxs("nav", { className: css.rail, style: railSize(items.length), "aria-label": t('chat.turnNavigation.label'), onClick: navigateAtPointer, onPointerMove: previewAtPointer, onPointerLeave: () => { setPreviewTurn(null); }, children: [_jsx("div", { className: css.marks, children: items.map((item, index) => {
                        const active = item.turn === activeTurn;
                        const showingPreview = item.turn === previewTurn;
                        const markClass = active
                            ? `${css.mark} ${css.markActive}`
                            : showingPreview ? `${css.mark} ${css.markPreview}` : css.mark;
                        return (_jsx("div", { className: css.markPosition, style: itemPosition(index, items.length), children: _jsx("button", { type: "button", className: markClass, "aria-label": t('chat.turnNavigation.jump', { turn: item.turn }), "aria-current": active ? 'true' : undefined, "aria-describedby": showingPreview ? previewId : undefined, onClick: (event) => {
                                    event.stopPropagation();
                                    onNavigate(item);
                                }, onFocus: () => { setPreviewTurn(item.turn); }, onBlur: () => { setPreviewTurn(null); } }) }, item.turn));
                    }) }), preview !== undefined && previewPosition !== undefined && (_jsxs("div", { id: previewId, role: "tooltip", className: css.preview, style: previewPosition, children: [_jsx("div", { className: css.previewPrompt, children: preview.prompt || t('chat.turnNavigation.turn', { turn: preview.turn }) }), preview.response !== '' && _jsx("div", { className: css.previewResponse, children: preview.response })] }))] }) }));
}
/**
 * Compact rail of the currently loaded Turns with hover and focus previews.
 *
 * Memoized because it renders two host elements per loaded Turn while the
 * enclosing view re-renders on every streaming delta: without the guard a long
 * session rebuilds hundreds of marks per commit for a rail that only changes
 * when a Turn is added, removed, or becomes active. Its props must therefore
 * stay referentially stable across those commits.
 */
export const TurnNavigator = memo(TurnNavigatorRail);
