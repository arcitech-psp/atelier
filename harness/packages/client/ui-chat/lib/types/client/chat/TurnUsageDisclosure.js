import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from 'react';
import { DisclosureRow, IconDataOutline16 } from '@deepseek-ai/dsh-client-ui-primitives';
import { formatCacheHitPercent, formatExactTokens, formatTokens } from "./token-format.js";
import css from './TurnUsageDisclosure.module.css';
function formatCompactCount(value, t) {
    return t('message.turnUsage.count', { count: formatTokens(value, t) });
}
function formatExactCount(value, t) {
    return t('message.turnUsage.count', { count: formatExactTokens(value, t) });
}
/** Compact per-Turn usage summary with an opt-in bucket breakdown. */
export function TurnUsageDisclosure({ usage, t }) {
    const [open, setOpen] = useState(false);
    const cacheHit = usage.cacheReadTokens === undefined
        ? null
        : formatCacheHitPercent(usage.cacheReadTokens, usage.totalTokens - usage.outputTokens, 1);
    const total = formatCompactCount(usage.totalTokens, t);
    const summary = cacheHit === null
        ? total
        : t('message.turnUsage.summaryWithCache', { total, percent: cacheHit });
    const routes = usage.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? '';
    return (_jsx(DisclosureRow, { icon: _jsx(IconDataOutline16, {}), title: t('message.turnUsage.title'), open: open, expandable: true, onToggle: () => { setOpen(value => !value); }, expandOnRowClick: true, keepContentWhenOpen: true, collapsedContent: (_jsxs(_Fragment, { children: [_jsx("span", { className: css.separator, "aria-hidden": true }), _jsx("span", { className: css.summary, children: summary })] })), className: css.root, chevronClassName: css.chevron, children: _jsxs("dl", { className: css.details, "data-turn-usage-details": true, children: [routes !== '' && (_jsxs(_Fragment, { children: [_jsx("dt", { children: t('message.turnUsage.model') }), _jsx("dd", { className: css.route, children: routes })] })), _jsx("dt", { children: t('message.turnUsage.input') }), _jsx("dd", { children: formatExactCount(usage.uncachedInputTokens, t) }), usage.cacheReadTokens !== undefined && (_jsxs(_Fragment, { children: [_jsx("dt", { children: t('message.turnUsage.cacheRead') }), _jsx("dd", { children: formatExactCount(usage.cacheReadTokens, t) })] })), usage.cacheWriteTokens !== undefined && (_jsxs(_Fragment, { children: [_jsx("dt", { children: t('message.turnUsage.cacheWrite') }), _jsx("dd", { children: formatExactCount(usage.cacheWriteTokens, t) })] })), _jsx("dt", { children: t('message.turnUsage.output') }), _jsxs("dd", { children: [formatExactCount(usage.outputTokens, t), usage.reasoningTokens !== undefined && (_jsx("span", { className: css.reasoning, children: t('message.turnUsage.reasoning', { tokens: formatExactCount(usage.reasoningTokens, t) }) }))] }), _jsx("dt", { className: css.totalLabel, children: t('message.turnUsage.total') }), _jsx("dd", { className: css.totalValue, children: formatExactCount(usage.totalTokens, t) })] }) }));
}
