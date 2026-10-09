/**
 * Quiescence tracking for emit-shaped hook runs that no extension point awaits. Bridges
 * track the run plus its continuation, pass the tracker signal into execution,
 * and drain on disposal so no process or late callback outlives the fiber.
 * @module @deepseek-ai/dsh-hook-protocol/detached
 */
/**
 * Create a {@link DetachedRuns} tracker (one per bridge `apply()`); settled
 * runs are pruned so a long-lived session does not accumulate them.
 * @returns the tracker.
 */
export function createDetachedRuns() {
    const inflight = new Set();
    const controller = new AbortController();
    return {
        signal: controller.signal,
        track(run) {
            inflight.add(run);
            const settled = () => { inflight.delete(run); };
            void run.then(settled, settled);
        },
        async drain() {
            controller.abort(new Error('hook bridge disposed'));
            // Re-check after each wave: a chain can be tracked while a prior wave is
            // settling; loop until the registry is observed empty.
            while (inflight.size > 0) {
                await Promise.allSettled([...inflight]);
            }
        },
    };
}
