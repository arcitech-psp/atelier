import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * Font-size preference row registered into the General section item slot:
 * title + body-text-only description + stepper pill (centered value; hover
 * reveals the up/down arrow column anchored to the pill's right edge) + a px
 * unit label after the pill. Registered by this package — the theme feature
 * owns the content font-size setting the same way it owns the appearance
 * preference. The displayed value follows the persisted setting, never the
 * click echo.
 */
import { IconChevronDownOutline14, IconChevronUpOutline14, } from '@deepseek-ai/dsh-client-ui-primitives';
import { FONT_SIZE_MAX, FONT_SIZE_MIN } from "../theme-settings.js";
import css from './FontSizeRow.module.css';
/**
 * Render the font-size row.
 * @param props - composed slot props.
 * @returns the row element tree.
 */
export function FontSizeRow({ t, setFontSize, useStore }) {
    const fontSize = useStore(s => s.fontSize);
    return (_jsxs("div", { className: css.row, children: [_jsxs("div", { className: css.rowText, children: [_jsx("div", { className: css.title, children: t('fontSize.title') }), _jsx("div", { className: css.desc, children: t('fontSize.description') })] }), _jsxs("div", { className: css.control, children: [_jsxs("div", { className: css.stepper, children: [_jsx("span", { className: css.value, children: fontSize }), _jsxs("span", { className: css.arrows, children: [_jsx("button", { type: "button", className: css.arrow, "aria-label": t('fontSize.increase'), disabled: fontSize >= FONT_SIZE_MAX, onClick: () => { setFontSize(fontSize + 1); }, children: _jsx(IconChevronUpOutline14, { size: 9 }) }), _jsx("button", { type: "button", className: css.arrow, "aria-label": t('fontSize.decrease'), disabled: fontSize <= FONT_SIZE_MIN, onClick: () => { setFontSize(fontSize - 1); }, children: _jsx(IconChevronDownOutline14, { size: 9 }) })] })] }), _jsx("span", { className: css.unit, children: t('fontSize.unit') })] })] }));
}
