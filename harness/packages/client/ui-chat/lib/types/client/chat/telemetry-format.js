/** Format a live generation rate without implying per-chat attribution. */
export function formatOutputRate(value) {
    return value === null || value === undefined || !Number.isFinite(value) || value < 0
        ? '—'
        : value.toFixed(1);
}
/** Format the current task duration as m:ss; absent task time is unknown. */
export function formatTaskElapsed(task) {
    if (task === null || task === undefined || !Number.isFinite(task.seconds) || task.seconds < 0)
        return '—';
    const total = Math.floor(task.seconds);
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}
