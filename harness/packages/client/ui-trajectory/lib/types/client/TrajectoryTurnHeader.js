import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
// TrajectoryTurnHeader: sticky per-turn bar with Input/Output/Think/Time labels.
import css from './TrajectoryTurnHeader.module.css';
const COLUMN_LABEL_KEYS = [
    'column.input', 'column.output', 'column.think', 'column.time',
];
/**
 * Render the sticky turn header row.
 * @param props.turn - turn index.
 * @returns the sticky header element.
 */
export function TrajectoryTurnHeader({ turn, t }) {
    return (_jsx("div", { className: css.root, children: _jsxs("div", { className: css.inner, children: [_jsx("span", { className: css.title, children: t('turn.label', { turn }) }), _jsx("div", { className: css.columns, "aria-hidden": "true", children: COLUMN_LABEL_KEYS.map(key => (_jsx("span", { className: css.column, children: t(key) }, key))) })] }) }));
}
