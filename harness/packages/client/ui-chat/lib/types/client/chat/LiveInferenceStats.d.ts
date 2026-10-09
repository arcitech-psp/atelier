import type { ChatViewSlotProps } from '../contract/slots.ts';
interface Sample {
    at: number;
    counters?: Record<string, number>;
    identity?: string;
    task?: {
        seconds: number;
        running: boolean;
    } | null;
}
/** Differences are valid only within one monotonic server counter epoch. */
export declare function counterRate(a: Sample, b: Sample, field: string): number | null;
/** Compact per-route status, throughput, and task time beside a Mission Control action. */
export declare function LiveInferenceStats({ sessionId, t }: {
    sessionId?: string | undefined;
    t: ChatViewSlotProps['t'];
}): import("react").JSX.Element;
export {};
