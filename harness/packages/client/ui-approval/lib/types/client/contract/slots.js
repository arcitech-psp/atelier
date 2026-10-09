/* jscpd:ignore-start -- Approval and Question intentionally own independent pending-settlement lifecycles. */
function settlePendingComposer(settle, failureMessage) {
    try {
        settle();
        return Promise.resolve();
    }
    catch (error) {
        return Promise.reject(error instanceof Error
            ? error
            : new Error(failureMessage, { cause: error }));
    }
}
let nextApprovalKey = 0;
/** One answerable Client presentation of a pending Host waterfall. */
export class PendingApproval {
    sessionId;
    /** Domain discriminator used by Session pending-interaction consumers. */
    kind = 'approval';
    /** Opaque render identity and one-shot remount axis. */
    key;
    /** Tool requesting the decision. */
    toolName;
    /** Correlated Tool call, when supplied by the asker. */
    callId;
    /** Human-readable reason supplied by the asker. */
    reason;
    /** Result returned by the Remote Event listener to the Host waterfall. */
    result;
    #resolve;
    #reject;
    #signal;
    #onAbort;
    #delegated = Symbol('pending approval delegated');
    #settled = false;
    /**
     * @param sessionId - Agent/Session identity owning the scoped request.
     * @param request - Host approval request projected through the Remote Event.
     */
    constructor(sessionId, request) {
        this.sessionId = sessionId;
        nextApprovalKey += 1;
        this.key = `approval:${String(nextApprovalKey)}`;
        this.toolName = request.toolName;
        this.callId = request.callId;
        this.reason = request.reason;
        const completion = Promise.withResolvers();
        this.result = completion.promise;
        this.#resolve = completion.resolve;
        this.#reject = completion.reject;
        this.#signal = request.signal;
        if (request.signal === undefined) {
            this.#onAbort = undefined;
            return;
        }
        const onAbort = () => {
            this.abort(request.signal?.reason ?? new Error('approval request was aborted'));
        };
        this.#onAbort = onAbort;
        request.signal.addEventListener('abort', onAbort, { once: true });
        if (request.signal.aborted)
            onAbort();
    }
    /**
     * Resolve the Host waterfall with the user's decision.
     * @param outcome - supported interactive decision.
     */
    answer(outcome) {
        return settlePendingComposer(() => {
            this.finish(() => { this.#resolve(outcome); });
        }, 'pending approval settlement failed');
    }
    /** Delegate an unanswered request to the next waterfall listener. */
    delegate() {
        if (this.#settled)
            return;
        this.finish(() => { this.#reject(this.#delegated); });
    }
    /**
     * Test whether a rejection requests waterfall delegation.
     * @param reason - rejection received from {@link PendingApproval.result}.
     * @returns whether {@link PendingApproval.delegate} produced it.
     */
    isDelegation(reason) {
        return reason === this.#delegated;
    }
    /**
     * End an unanswered presentation when its transport, scope, or plugin lifetime ends.
     * @param reason - rejection exposed to the waiting Remote Event listener.
     */
    abort(reason) {
        if (this.#settled)
            return;
        this.finish(() => { this.#reject(reason); });
    }
    finish(settle) {
        if (this.#settled)
            throw new Error(`pending approval ${this.key} is already settled`);
        this.#settled = true;
        if (this.#signal !== undefined && this.#onAbort !== undefined) {
            this.#signal.removeEventListener('abort', this.#onAbort);
        }
        settle();
    }
}
