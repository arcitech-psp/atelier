/** Display helpers for the compact composer telemetry strip. */
export interface TaskClock {
    readonly seconds: number;
    readonly running: boolean;
}
/** Format a live generation rate without implying per-chat attribution. */
export declare function formatOutputRate(value: number | null | undefined): string;
/** Format the current task duration as m:ss; absent task time is unknown. */
export declare function formatTaskElapsed(task: TaskClock | null | undefined): string;
