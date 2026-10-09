import type { Context } from '@deepseek-ai/cordis';
/** Allowlisted counters only; never forward raw metrics, credentials or arbitrary URLs. */
export declare function parseInferenceCounters(text: string): Record<string, number>;
/** Server-wide sampler: deliberately not attributed to whichever chat is open. */
export declare function mountInferenceTelemetry(ctx: Context): void;
