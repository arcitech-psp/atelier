import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
/** Session-owned rendering semantics for the standard SessionProvider seat. */
import { Fragment } from 'react';
/**
 * Render the selected Session body or its empty branch.
 * @param binding - current Session scope binding.
 * @param props - standard Session area render props.
 * @returns the selected Session subtree, keyed by Session identity.
 */
export function renderSessionArea(binding, { empty, children }) {
    const sessionId = binding.key;
    if (sessionId === undefined)
        return _jsx(_Fragment, { children: empty?.() ?? null });
    return _jsx(Fragment, { children: children }, sessionId);
}
