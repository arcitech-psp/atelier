/**
 * Browser stand-in for `node:module`. `createRequire` is unreachable in the
 * configured loader path and fails loud if that assumption changes.
 */
/** Fail if browser boot reaches Node's module loader. */
export const createRequire = () => {
    throw new Error('node:module is not available in the browser');
};
