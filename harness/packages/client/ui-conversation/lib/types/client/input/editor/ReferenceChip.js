import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Visual body of one inline reference chip: the DecoratorNode's React
 * face. Pure display — identity, invalidation, and lifecycle live on the
 * ReferenceChipNode; this component renders whatever the node carries.
 */
import clsx from 'clsx';
import { ReferenceIcon } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './ReferenceChip.module.css';
/**
 * Render one inline reference chip.
 * @param props - label, optional domain glyph, and the invalid bit.
 * @returns the chip body (icon + truncating label).
 */
export function ReferenceChip({ label, appearance, invalid }) {
    return (_jsxs("span", { className: clsx(css.chip, invalid && css.invalid), title: label, children: [appearance === undefined
                ? _jsx("span", { className: css.marker, "aria-hidden": true, children: "@" })
                : _jsx(ReferenceIcon, { kind: appearance, size: 14, className: css.icon }), _jsx("span", { className: css.label, children: label })] }));
}
