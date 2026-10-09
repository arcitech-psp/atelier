import { jsx as _jsx } from "react/jsx-runtime";
/** Internal React bindings for renderer hosts and standard-source scopes. */
import { createContext, useContext } from 'react';
import { bindSnapshotSelector } from "./bind.js";
/** Missing renderer assembly dependency. */
export class SlotAssemblyError extends Error {
}
/** In-package renderer host context. */
export const HostContext = createContext(null);
/**
 * Read the installed renderer host.
 * @returns the host API.
 */
export function useHost() {
    const host = useContext(HostContext);
    if (host === null)
        throw new SlotAssemblyError('slot machinery rendered outside the installed renderer tree');
    return host;
}
const RootBindingContext = createContext(null);
const ScopeBindingContext = createContext(null);
/**
 * Read the root standard-source binding.
 * @returns the current root binding.
 */
export function useRootBinding() {
    const binding = useContext(RootBindingContext);
    if (binding === null)
        throw new SlotAssemblyError('slot rendered outside the root standard-source provider');
    return binding;
}
/**
 * Read the current-session-optional binding.
 * @returns a binding whose key is absent when no Session is selected.
 */
export function useScopeBinding() {
    const binding = useContext(ScopeBindingContext);
    if (binding === null)
        throw new SlotAssemblyError('scoped slot rendered outside its scope provider');
    return binding;
}
/**
 * Bind one observable source to an identity-stable selector Hook.
 * @param source - observable source.
 * @returns cached selector Hook.
 */
export function observableHook(source) {
    let hook = hookCache.get(source);
    if (hook === undefined) {
        hook = bindSnapshotSelector(source);
        hookCache.set(source, hook);
    }
    return hook;
}
const hookCache = new WeakMap();
const absentSource = {
    getSnapshot: () => undefined,
    subscribe: () => () => { },
};
/**
 * Bind an optional source without changing Hook call order.
 * @param source - current source, or absence.
 * @returns selector Hook returning `undefined` while absent.
 */
export function maybeObservableHook(source) {
    if (source !== undefined)
        return observableHook(source);
    return useAbsentSnapshot;
}
function useAbsentSnapshot(_selector, _equal) {
    observableHook(absentSource)(() => undefined);
    return undefined;
}
/**
 * Bind an open-key source family.
 * @param source - keyed resolver, or absence for an optional scope.
 * @returns cached keyed selector Hook.
 */
export function keyedObservableHook(source) {
    if (source === undefined)
        return absentKeyedHook;
    let hook = keyedHookCache.get(source);
    if (hook === undefined) {
        hook = (key, selector, equal) => {
            const useValue = observableHook(source(key) ?? absentSource);
            return useValue(selector ?? identity, equal);
        };
        keyedHookCache.set(source, hook);
    }
    return hook;
}
const keyedHookCache = new WeakMap();
const identity = (value) => value;
const absentKeyedHook = (_key, selector, equal) => observableHook(absentSource)(selector ?? identity, equal);
/** Subscribe the tree to the atomically assembled root standard-source roster. */
export function RootStandardProvider({ children }) {
    const host = useHost();
    const binding = observableHook(host.root)(value => value);
    return _jsx(RootBindingContext.Provider, { value: binding, children: children });
}
/** Subscribe to the scope roster before resolving and binding its current adapter. */
export function ScopeProvider({ scope, children, }) {
    const host = useHost();
    observableHook(host.scopeRevision)(value => value);
    const adapter = host.scope(scope);
    if (adapter === undefined)
        throw new SlotAssemblyError(`scope '${scope}' rendered without an installed adapter`);
    const binding = observableHook(adapter.current)(value => value);
    return _jsx(ScopeBindingContext.Provider, { value: binding, children: children });
}
