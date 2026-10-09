/**
 * `LocalSpillStore`: the host-filesystem implementation of the
 * `@deepseek-ai/dsh-spill` storage seam. Persists a tool's oversized text to a
 * private, session-scoped file (see `./store.ts` for the traversal-safe naming
 * and exclusive owner-only write) and returns a path locator plus local
 * read/grep retrieval guidance. After activation it runs one best-effort
 * startup sweep that reclaims spill files older than `cleanupPeriodDays`.
 *
 * @module @deepseek-ai/dsh-spill-local
 */
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import z from '@deepseek-ai/schemastery';
import { SpillLocator, SpillStore } from '@deepseek-ai/dsh-spill';
import { gatherSweepRoots, sweepSpillRoots } from "./cleanup.js";
import { privateRoot, saveTextFile } from "./store.js";
export { discoverDefaultRoots, sweepSpillRoots } from "./cleanup.js";
export { DEFAULT_ROOT_PREFIX, encodeSegment, isErrno, privateRoot, saveTextFile, sessionDir } from "./store.js";
/** Milliseconds in one day — converts the `cleanupPeriodDays` config to the sweep cutoff. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
/**
 * Local-filesystem spill backend. Files land under `<root>/session-<hash>/…`
 * with unpredictable names, an exclusive owner-only (0600) write, and a private
 * (0700) root — a spilled tool result must not be readable by other local users
 * or redirectable via a planted symlink.
 *
 * After activation it launches ONE best-effort cleanup sweep (see
 * {@link cleanupPeriodDays}) that reclaims expired spill files without delaying
 * service availability; the sweep is owned by the plugin fiber and awaited
 * during disposal, so a fiber unload never returns before it quiesces.
 */
export class LocalSpillStore extends SpillStore {
    static Config = z.object({
        root: z.string(),
        cleanupPeriodDays: z.number().step(1).min(0).default(30),
    });
    /** Resolved absolute spill root (config `root`, else the private default), fixed at construction. */
    root;
    /** Validated config (schemastery applied the `cleanupPeriodDays` default before construction). */
    config;
    /**
     * The in-flight (or settled) startup cleanup sweep. Held so disposal can await
     * it; `undefined` when cleanup is disabled (`cleanupPeriodDays === 0`).
     */
    cleanup;
    constructor(ctx, config) {
        super(ctx);
        // schemastery (static Config) has already filled `cleanupPeriodDays`; the
        // cast records that runtime fact for exactOptionalPropertyTypes.
        this.config = config;
        this.root = config.root !== undefined ? resolve(config.root) : privateRoot();
        // One best-effort startup sweep, owned by the fiber. The generator body runs
        // at activation but does NOT await the sweep — it launches it and yields an
        // async disposer that awaits the SAME promise, so service availability is
        // never delayed yet a fiber unload reaches quiescence (no sweep I/O outlives
        // the fiber). Disabled (`cleanupPeriodDays === 0`) yields a no-op disposer.
        ctx.effect(function* () {
            if (this.config.cleanupPeriodDays > 0) {
                const warn = (message) => { this.ctx.logger.warn(message); };
                this.cleanup = this.runCleanup(warn);
            }
            yield async () => { await this.cleanup; };
        }.bind(this), 'spill-local cleanup sweep');
    }
    /**
     * Run the one-shot cleanup: gather the roots to sweep (see {@link gatherRoots})
     * and sweep all of them at the age cutoff. Best-effort —
     * {@link sweepSpillRoots} contains every filesystem failure, so this never
     * rejects and cannot fail activation or a concurrent spill write.
     *
     * @param warn - sink for a contained filesystem failure.
     * @returns Resolves when the sweep finishes (never rejects).
     */
    async runCleanup(warn) {
        const cutoffMs = Date.now() - this.config.cleanupPeriodDays * MS_PER_DAY;
        const roots = await this.gatherRoots(warn);
        await sweepSpillRoots({ roots, cutoffMs, warn });
    }
    /**
     * The roots the startup sweep covers: each discovered prior-default
     * `dsh-spill-*` temp root (see {@link discoverDefaultRoots}), pruned when
     * emptied, plus the active/configured root, which is never itself pruned while
     * the live process may write into it. Empty session directories are pruned in
     * every root. Filesystem identity de-duplicates aliases before the active root
     * overrides a discovered match as non-prunable. A test overrides this to
     * inject an isolated root set — and, being the sweep's one async gather point,
     * to hold the sweep open across a disposal for the quiescence check; it is a
     * test seam, not a deployment knob.
     *
     * @param warn - sink for a contained discovery failure.
     * @returns The roots to sweep, each flagged for prune-when-empty.
     */
    async gatherRoots(warn) {
        return gatherSweepRoots(this.root, warn, this.defaultRootsBase());
    }
    /**
     * The directory scanned for prior default `dsh-spill-*` roots — the OS tmpdir,
     * where {@link privateRoot} creates them (accumulation only happens there). A
     * test overrides this to point discovery at an isolated fixture instead of the
     * real tmpdir; it is a test seam, not a deployment knob.
     *
     * @returns The base directory to scan for default spill roots.
     */
    defaultRootsBase() {
        return tmpdir();
    }
    async saveText(input) {
        const saved = await saveTextFile({
            root: this.root,
            sessionId: input.owner.sessionId,
            suggestedName: input.suggestedName,
            content: input.content,
        });
        return {
            locator: SpillLocator(saved.path),
            bytes: saved.bytes,
            retrievalHint: 'Use read with offset/limit, or grep this path to search within it.',
        };
    }
}
export default LocalSpillStore;
