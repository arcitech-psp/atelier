/** Instance-owned concurrency bound for native image transformations. */
/** FIFO limiter for asynchronous compression work. */
export class CompressionLimiter {
    concurrency;
    active = 0;
    waiting = [];
    /**
     * @param concurrency - positive maximum number of active tasks.
     */
    constructor(concurrency) {
        this.concurrency = concurrency;
    }
    /**
     * Run one task after an instance slot becomes available.
     * @param task - compression operation occupying one slot until settlement.
     * @returns the task result.
     */
    run(task) {
        return new Promise((resolve, reject) => {
            const start = () => {
                this.active += 1;
                const release = () => {
                    this.active -= 1;
                    this.waiting.shift()?.();
                };
                void Promise.resolve().then(task).then((value) => {
                    release();
                    resolve(value);
                }, (error) => {
                    release();
                    reject(error instanceof Error
                        ? error
                        : new Error('Image compression task rejected with a non-Error value.', { cause: error }));
                });
            };
            if (this.active < this.concurrency)
                start();
            else
                this.waiting.push(start);
        });
    }
}
