/** Browser-safe Connection protocol and shared application value exports. */
export { RpcId, transportError } from "../rpc.js";
/**
 * Return the business result carried by a narrow fixture response.
 * @param response - fixture response to unwrap.
 * @returns the response's business result.
 */
export function resultOf(response) {
    return response.result;
}
