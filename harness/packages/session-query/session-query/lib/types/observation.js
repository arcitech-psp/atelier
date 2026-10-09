/** Shared live/prepared observations for Session page and lifecycle consumers. */
import { SessionQueryError } from "./config.js";
/** Builds point observations without a corpus listing preflight. */
export class SessionObservationReader {
    ctx;
    /** @param ctx - context carrying Session and optional persistence/projection services. */
    constructor(ctx) {
        this.ctx = ctx;
    }
    /**
     * Observe one live-preferred Session and retain a cold preparation until disposal.
     * @param sessionId - logical Session identity.
     * @param options - cancellation and all-or-none projection computation for this read.
     * @returns one exact immutable observation.
     */
    async read(sessionId, options = {}) {
        const { signal, projectionMode = 'all' } = options;
        for (;;) {
            throwIfObservationAborted(signal);
            const live = this.ctx.sessions.get(sessionId);
            if (live !== undefined)
                return this.live(live, projectionMode);
            const persistence = this.ctx.get('sessionPersistence');
            if (persistence === undefined)
                throw notFound(sessionId);
            let borrowed;
            try {
                borrowed = await persistence.borrowSession(sessionId, signal);
            }
            catch (error) {
                throwIfObservationAborted(signal);
                if (hasErrorName(error, 'SessionPersistenceNotFoundError'))
                    throw notFound(sessionId, error);
                if (hasErrorName(error, 'SessionPersistenceCorruptionError')) {
                    throw new SessionQueryError(`stored session "${sessionId}" is corrupt: ${error.message}`, 'SESSION_QUERY_CORRUPT_SESSION', { cause: error });
                }
                throw new SessionQueryError(`failed to observe session "${sessionId}": ${errorMessage(error)}`, 'SESSION_QUERY_PERSISTENCE_FAILED', { cause: error });
            }
            try {
                throwIfObservationAborted(signal);
                if (borrowed.inspection.meta.id !== sessionId) {
                    throw new SessionQueryError(`session persistence returned "${borrowed.inspection.meta.id}" for "${sessionId}"`, 'SESSION_QUERY_SOURCE_CONFLICT');
                }
                const attached = this.ctx.sessions.get(sessionId);
                if (attached !== undefined) {
                    const liveObservation = this.live(attached, projectionMode);
                    borrowed[Symbol.dispose]();
                    return liveObservation;
                }
                if (borrowed.source === 'live') {
                    // The live Session disappeared between persistence's race check and
                    // this read. Retry against its now-cold durable identity.
                    borrowed[Symbol.dispose]();
                    continue;
                }
                const prepared = borrowed;
                const events = prepared.inspection.events;
                let projections;
                try {
                    projections = projectionMode === 'none'
                        ? undefined
                        : this.preparedProjections(prepared, events);
                }
                catch (error) {
                    throw new SessionQueryError(`failed to project session "${sessionId}": ${errorMessage(error)}`, 'SESSION_QUERY_CORRUPT_SESSION', { cause: error });
                }
                let references = 1;
                const lease = () => {
                    let disposed = false;
                    return {
                        source: 'prepared',
                        header: prepared.inspection.meta,
                        events,
                        cursor: events.at(-1)?.seq ?? -1,
                        revision: prepared.revision,
                        ...projections === undefined ? {} : { projections },
                        retain: () => {
                            if (disposed || references === 0)
                                throw new Error(`session observation "${sessionId}" is disposed`);
                            references += 1;
                            return lease();
                        },
                        [Symbol.dispose]: () => {
                            if (disposed)
                                return;
                            disposed = true;
                            references -= 1;
                            if (references === 0)
                                prepared[Symbol.dispose]();
                        },
                    };
                };
                return lease();
            }
            catch (error) {
                borrowed[Symbol.dispose]();
                throw error;
            }
        }
    }
    live(session, projectionMode) {
        const events = Object.freeze([...session.events]);
        const projections = projectionMode === 'none'
            ? undefined
            : this.ctx.get('sessionProjections')?.snapshot(session);
        const lease = () => {
            let disposed = false;
            return {
                source: 'live',
                header: session.header,
                events,
                cursor: events.at(-1)?.seq ?? -1,
                ...projections === undefined ? {} : { projections },
                retain: () => {
                    if (disposed)
                        throw new Error(`session observation "${session.id}" is disposed`);
                    return lease();
                },
                [Symbol.dispose]: () => { disposed = true; },
            };
        };
        return lease();
    }
    preparedProjections(observation, events) {
        const registry = this.ctx.get('sessionProjections');
        if (registry === undefined)
            return undefined;
        const prepared = observation.preparedSession;
        const cache = this.ctx.get('sessionProjectionCache');
        return cache === undefined
            ? registry.hydrate(prepared, {}, events, 0)
            : cache.hydratePrepared(prepared, observation.inspection.meta, events);
    }
}
function throwIfObservationAborted(signal) {
    if (signal?.aborted !== true)
        return;
    throw new SessionQueryError('session observation was aborted', 'SESSION_QUERY_ABORTED', { cause: signal.reason });
}
function notFound(sessionId, cause) {
    return new SessionQueryError(`session "${sessionId}" not found`, 'SESSION_QUERY_SESSION_NOT_FOUND', cause === undefined ? undefined : { cause });
}
function errorMessage(error) {
    return error instanceof Error ? error.message : 'unknown error';
}
function hasErrorName(error, name) {
    return error instanceof Error && error.name === name;
}
