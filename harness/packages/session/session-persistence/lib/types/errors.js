/** Stable failures exposed by the session-persistence service. */
/** The requested Session identity has no materialized durable log. */
export class SessionPersistenceNotFoundError extends Error {
    sessionId;
    /** @param sessionId - absent durable Session identity. */
    constructor(sessionId) {
        super(`session "${sessionId}" not found`);
        this.sessionId = sessionId;
        this.name = 'SessionPersistenceNotFoundError';
    }
}
