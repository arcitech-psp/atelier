/**
 * Browser stand-in for `node:module`. `createRequire` is unreachable in the
 * configured loader path and fails loud if that assumption changes.
 */
/** Fail if browser boot reaches Node's module loader. */
export declare const createRequire: () => never;
/** Type-only peer for the vendored loader. */
export type LoadHookContext = never;
