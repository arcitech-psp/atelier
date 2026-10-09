/** Low-level Win32 process, stdio, and Job Object primitives used by the Windows ACL sandbox. */
export { ERROR_INSUFFICIENT_BUFFER } from "./abi.js";
export * from "./errors.js";
export { allocPtrSlot, allocUint32, decodePtr, decodeUint32, extendWin32ProcessBindings, isNullPtr, throwLastError, throwWin32, } from "./ffi.js";
export { drainPipe, spawnInheritedJobProcess, spawnPipedProcess, waitForProcessExit, } from "./process.js";
