const CONNECTION_DEFAULTS = {
    backoffBaseMs: 500,
    backoffFactor: 2,
    backoffMaxMs: 10_000,
    generationReadyTimeoutMs: 3_000,
};
function sleep(ms, signal) {
    return new Promise((resolve) => {
        const t = setTimeout(done, ms);
        signal.addEventListener('abort', done, { once: true });
        function done() {
            clearTimeout(t);
            signal.removeEventListener('abort', done);
            resolve();
        }
    });
}
/**
 * Opens the registered generation source, reconnecting with exponential backoff on loss.
 * State (generation/attempt) is instance-private, never in the store.
 * Sink exceptions do not kill the generation loop.
 */
export class ConnectionController {
    source;
    sinks;
    generation = 0;
    attempt = 0;
    current = null;
    running = false;
    lastState = null;
    config;
    constructor(source, sinks = {}, config = {}) {
        this.source = source;
        this.sinks = sinks;
        this.config = { ...CONNECTION_DEFAULTS, ...config };
    }
    /** Idempotent: begin the connect/pump/reconnect loop. */
    start() {
        if (this.running)
            return;
        this.running = true;
        void this.loop();
    }
    /** Stop the loop and abort the current generation source. */
    stop() {
        this.running = false;
        this.current?.abort();
        this.current = null;
    }
    backoffDelay(attempt) {
        const { backoffBaseMs, backoffFactor, backoffMaxMs } = this.config;
        const cap = Math.min(backoffMaxMs, backoffBaseMs * backoffFactor ** Math.max(0, attempt - 1));
        return cap / 2 + Math.random() * (cap / 2);
    }
    /** Read through a method: stop() flips the flag across awaits, so narrowing from the loop condition must not stick. */
    isRunning() {
        return this.running;
    }
    /** Re-read both mutable liveness guards after a potentially reentrant sink. */
    isGenerationActive(controller) {
        return this.isRunning() && !controller.signal.aborted;
    }
    async loop() {
        while (this.running) {
            const gen = ++this.generation;
            const ac = new AbortController();
            this.current = ac;
            let sourceReady = false;
            let resolveReady;
            let rejectReady;
            let rejectSourceLost;
            const ready = new Promise((resolve, reject) => {
                resolveReady = resolve;
                rejectReady = reject;
            });
            const sourceLost = new Promise((_resolve, reject) => {
                rejectSourceLost = reject;
            });
            const reportReady = (host) => {
                if (sourceReady)
                    return;
                sourceReady = true;
                resolveReady(host);
            };
            const failed = new Promise((resolve) => {
                const settle = () => {
                    if (gen === this.generation && !ac.signal.aborted)
                        ac.abort();
                    resolve();
                };
                void Promise.resolve()
                    .then(() => this.source(ac.signal, reportReady))
                    .then(() => {
                    const error = new Error('connection generation ended');
                    if (!sourceReady)
                        rejectReady(error);
                    rejectSourceLost(error);
                    settle();
                }, (error) => {
                    const failure = error instanceof Error
                        ? error
                        : new Error('connection generation failed', { cause: error });
                    if (!sourceReady)
                        rejectReady(failure);
                    rejectSourceLost(failure);
                    settle();
                });
            });
            try {
                const host = await Promise.race([
                    waitForReady(ready, this.config.generationReadyTimeoutMs, ac.signal),
                    sourceLost,
                ]);
                if (ac.signal.aborted)
                    throw new Error('generation aborted during readiness handshake');
                this.attempt = 0;
                this.emitState('connected');
                // A state sink may synchronously stop this controller.
                if (this.isGenerationActive(ac)) {
                    this.callSink(() => { this.sinks.onConnected?.(host); });
                }
            }
            catch {
                // Transport failure: treat as generation failure, fall through to the shared backoff.
                if (!ac.signal.aborted)
                    ac.abort();
            }
            await failed;
            if (!this.isRunning())
                return;
            this.emitState('reconnecting');
            this.attempt += 1;
            console.warn(`[connection] connection lost, retry #${this.attempt}`);
            const idle = new AbortController();
            await sleep(this.backoffDelay(this.attempt), idle.signal);
        }
    }
    /** Deduplicated state emission (sink isolation applies). */
    emitState(state) {
        if (this.lastState === state)
            return;
        this.lastState = state;
        this.callSink(() => this.sinks.onStateChange?.(state));
    }
    /** Sink exception isolation: a business-layer throw is logged only, never affecting pump or reconnect semantics. */
    callSink(fn) {
        try {
            fn();
        }
        catch (error) {
            console.error('[connection] connection sink threw:', error);
        }
    }
}
/** Await source readiness without letting a stalled carrier wedge startup forever. */
function waitForReady(ready, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
            finish({ error: new Error(`connection generation was not ready within ${String(timeoutMs)}ms`) });
        }, timeoutMs);
        const aborted = () => {
            finish({ error: new Error('connection generation aborted', { cause: signal.reason }) });
        };
        const finish = (outcome) => {
            if (settled)
                return;
            settled = true;
            clearTimeout(timeout);
            signal.removeEventListener('abort', aborted);
            if ('error' in outcome)
                reject(outcome.error);
            else
                resolve(outcome.value);
        };
        signal.addEventListener('abort', aborted, { once: true });
        void ready.then((value) => { finish({ value }); }, (error) => {
            finish({ error: error });
        });
    });
}
