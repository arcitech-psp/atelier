/** ACL/token bindings layered on the shared Win32 process owner. */
import koffi from 'koffi';
import { ERROR_INSUFFICIENT_BUFFER, Win32Error, extendWin32ProcessBindings, isNullPtr, throwLastError, } from '@deepseek-ai/dsh-win32-process';
import * as abi from "./win32-abi.js";
export { allocPtrSlot, allocUint32, decodePtr, decodeUint32, isNullPtr, throwLastError, throwWin32, } from '@deepseek-ai/dsh-win32-process';
const PVOID = koffi.pointer('void');
const PPVOID = koffi.pointer(PVOID);
/**
 * Return whether CreateFileW produced INVALID_HANDLE_VALUE.
 * @param handle - handle returned by CreateFileW.
 * @returns true for null, zero, or the all-bits-one sentinel.
 */
export function isInvalidHandle(handle) {
    if (isNullPtr(handle))
        return true;
    return handle === 0xffffffffffffffffn || handle === -1n;
}
/**
 * Encode a uint32 into an allocated slot.
 * @param slot - slot allocated by allocUint32.
 * @param value - unsigned value to store.
 */
export function encodeUint32(slot, value) {
    koffi.encode(slot, 'uint32', value);
}
/**
 * Return a Koffi pointer's numeric address for struct packing.
 * @param ptr - native pointer.
 * @returns pointer address.
 */
export function ptrAddress(ptr) {
    return koffi.address(ptr);
}
/**
 * Allocate a raw byte block.
 * @param length - byte count.
 * @returns allocated pointer.
 */
export function allocBytes(length) {
    return koffi.alloc('uint8', length);
}
/**
 * Allocate one zeroed x64 OVERLAPPED record.
 * @returns allocated pointer.
 * @remarks Koffi 3.1.1 crashes when LockFileEx or UnlockFileEx receives NULL;
 * a zeroed OVERLAPPED is equivalent for the synchronous lock-file handle.
 */
export function allocOverlapped() {
    return allocBytes(32);
}
/**
 * Decode a pointer value from a Buffer field.
 * @param buffer - encoded native record.
 * @param offset - pointer field byte offset.
 * @returns decoded pointer, or null for address zero.
 */
export function decodePtrAt(buffer, offset) {
    const value = koffi.decode(buffer, offset, PVOID);
    return isNullPtr(value) ? null : value;
}
/**
 * Decode a uint8 field at a native pointer offset.
 * @param ptr - native record pointer.
 * @param offset - field byte offset.
 * @returns decoded value.
 */
export function decodeUint8At(ptr, offset) {
    return koffi.decode(ptr, offset, 'uint8');
}
/**
 * Decode a uint16 field at a native pointer offset.
 * @param ptr - native record pointer.
 * @param offset - field byte offset.
 * @returns decoded value.
 */
export function decodeUint16At(ptr, offset) {
    return koffi.decode(ptr, offset, 'uint16');
}
/**
 * Decode a uint32 field at a native pointer offset.
 * @param ptr - native record pointer.
 * @param offset - field byte offset.
 * @returns decoded value.
 */
export function decodeUint32At(ptr, offset) {
    return koffi.decode(ptr, offset, 'uint32');
}
/**
 * Compare two in-memory SID records without allocating strings.
 * @param left - first native buffer.
 * @param leftOffset - first SID byte offset.
 * @param right - second native buffer.
 * @param rightOffset - second SID byte offset.
 * @returns true when revision, authority, and every sub-authority match.
 */
export function sameSidAt(left, leftOffset, right, rightOffset) {
    if (decodeUint8At(left, leftOffset) !== decodeUint8At(right, rightOffset))
        return false;
    const leftCount = decodeUint8At(left, leftOffset + 1);
    const rightCount = decodeUint8At(right, rightOffset + 1);
    if (leftCount !== rightCount || leftCount > abi.SID_MAX_SUB_AUTHORITIES)
        return false;
    for (let index = 0; index < 6; index += 1) {
        if (decodeUint8At(left, leftOffset + 2 + index) !== decodeUint8At(right, rightOffset + 2 + index)) {
            return false;
        }
    }
    for (let index = 0; index < leftCount; index += 1) {
        if (decodeUint32At(left, leftOffset + 8 + index * 4) !==
            decodeUint32At(right, rightOffset + 8 + index * 4))
            return false;
    }
    return true;
}
let cached;
function bindings() {
    if (cached !== undefined)
        return cached;
    cached = extendWin32ProcessBindings(({ kernel32, advapi32, bind }) => ({
        openProcess: bind(kernel32, 'OpenProcess', PVOID, ['uint32', 'int', 'uint32']),
        openProcessToken: bind(advapi32, 'OpenProcessToken', 'int', [PVOID, 'uint32', PPVOID]),
        localAlloc: bind(kernel32, 'LocalAlloc', PVOID, ['uint32', 'size_t']),
        localFree: bind(kernel32, 'LocalFree', PVOID, [PVOID]),
        convertStringSidToSidW: bind(advapi32, 'ConvertStringSidToSidW', 'int', ['str16', PPVOID]),
        createWellKnownSid: bind(advapi32, 'CreateWellKnownSid', 'int', [
            'int', PVOID, PVOID, koffi.pointer('uint32'),
        ]),
        isValidSid: bind(advapi32, 'IsValidSid', 'int', [PVOID]),
        getLengthSid: bind(advapi32, 'GetLengthSid', 'uint32', [PVOID]),
        copySid: bind(advapi32, 'CopySid', 'int', ['uint32', PVOID, PVOID]),
        getTokenInformation: bind(advapi32, 'GetTokenInformation', 'int', [
            PVOID, 'int', PVOID, 'uint32', koffi.pointer('uint32'),
        ]),
        setTokenInformation: bind(advapi32, 'SetTokenInformation', 'int', [PVOID, 'int', PVOID, 'uint32']),
        createRestrictedToken: bind(advapi32, 'CreateRestrictedToken', 'int', [
            PVOID, 'uint32', 'uint32', PVOID, 'uint32', PVOID, 'uint32', PVOID, PPVOID,
        ]),
        setEntriesInAclW: bind(advapi32, 'SetEntriesInAclW', 'uint32', ['uint32', PVOID, PVOID, PPVOID]),
        setNamedSecurityInfoW: bind(advapi32, 'SetNamedSecurityInfoW', 'uint32', [
            'str16', 'int', 'uint32', PVOID, PVOID, PVOID, PVOID,
        ]),
        getNamedSecurityInfoW: bind(advapi32, 'GetNamedSecurityInfoW', 'uint32', [
            'str16', 'int', 'uint32', PPVOID, PPVOID, PPVOID, PPVOID, PPVOID,
        ]),
        getTempPathW: bind(kernel32, 'GetTempPathW', 'uint32', ['uint32', PVOID]),
        setEnvironmentVariableW: bind(kernel32, 'SetEnvironmentVariableW', 'int', ['str16', 'str16']),
        setConsoleCtrlHandler: bind(kernel32, 'SetConsoleCtrlHandler', 'int', [PVOID, 'int']),
        createFileW: bind(kernel32, 'CreateFileW', PVOID, [
            'str16', 'uint32', 'uint32', PVOID, 'uint32', 'uint32', PVOID,
        ]),
        lockFileEx: bind(kernel32, 'LockFileEx', 'int', [
            PVOID, 'uint32', 'uint32', 'uint32', 'uint32', PVOID,
        ]),
        unlockFileEx: bind(kernel32, 'UnlockFileEx', 'int', [
            PVOID, 'uint32', 'uint32', 'uint32', PVOID,
        ]),
    }));
    return cached;
}
/**
 * Resolve the cached ACL/token binding table asynchronously.
 * @returns generic process plus ACL/token bindings.
 */
export function win32() {
    return Promise.resolve(bindings());
}
/**
 * Resolve the cached ACL/token binding table synchronously.
 * @returns generic process plus ACL/token bindings.
 */
export function win32Sync() {
    return bindings();
}
/**
 * Resolve the current Windows temporary directory.
 * @param api - active ACL/token binding table.
 * @returns UTF-16 path reported by GetTempPathW.
 */
export function getTempPath(api) {
    const buffer = Buffer.alloc((abi.MAX_PATH + 1) * 2);
    const length = api.getTempPathW(buffer.length / 2, buffer);
    if (length === 0)
        throwLastError(api, 'GetTempPathW');
    if (length > buffer.length / 2) {
        throw new Win32Error('GetTempPathW', ERROR_INSUFFICIENT_BUFFER, `required ${length} chars exceed the ${buffer.length / 2}-char buffer; nothing was written`);
    }
    return buffer.subarray(0, length * 2).toString('utf16le');
}
