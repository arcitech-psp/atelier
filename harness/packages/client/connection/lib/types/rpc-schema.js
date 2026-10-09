/** Runtime validation for Connection RPC envelopes. */
import { z } from 'zod';
/** Correlation id after wire validation. */
export const rpcIdSchema = z.string();
/** Generic endpoint failure carried in a response envelope. */
export const rpcErrorSchema = z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.unknown()),
});
/**
 * Build the result parser for one endpoint value parser.
 * @param value - endpoint-owned success-value parser.
 * @returns parser for either a success value or generic failure.
 */
export function rpcResultSchema(value) {
    return z.union([
        z.object({ ok: z.literal(true), value }),
        z.object({ ok: z.literal(false), error: rpcErrorSchema }),
    ]);
}
/** Client request envelope; endpoint payload validation belongs to its owner. */
export const clientRequestSchema = z.object({
    type: z.literal('client-request'),
    rpcId: rpcIdSchema,
    method: z.string(),
    payload: z.unknown(),
});
/** Server response envelope; endpoint value validation belongs to its caller. */
export const serverResponseSchema = z.object({
    type: z.literal('server-response'),
    rpcId: rpcIdSchema,
    result: rpcResultSchema(z.unknown().optional()),
});
/** Either Connection RPC envelope direction. */
export const rpcMessageSchema = z.discriminatedUnion('type', [
    clientRequestSchema,
    serverResponseSchema,
]);
