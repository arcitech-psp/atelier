/**
 * Scope-addressed conversation send, cancel, and history orchestration.
 *
 * Scope addressing rides the cordis Service tracker: property access through
 * `ctx.conversation` rebinds `this.ctx` to the caller's context, so methods
 * read the session tag with `scopeOf`. Mutable state must remain reachable
 * through one property read; assignment through the tracker proxy and `#`
 * private fields bypass that rebinding.
 */
import { Service } from '@deepseek-ai/cordis';
import { randomUUID } from '@deepseek-ai/dsh-util-crypto';
/** Create one browser-only draft descriptor; only its id enters input state. */
function browserDraftAttachment(file) {
    return {
        kind: 'image',
        id: randomUUID(),
        previewUrl: URL.createObjectURL(file),
        file,
    };
}
/**
 * Fill the draft's intrinsic dimensions once the browser parses the image
 * header (a metadata read off the preview URL, not a full decode). Failures
 * and non-browser runtimes leave them absent — consumers size those images
 * from CSS constraints instead. The descriptors stay registry-owned; submit
 * reads the dimensions into an immutable echo snapshot, so this late write
 * does not require a store notification.
 */
function probeDimensions(attachment) {
    if (typeof Image !== 'function')
        return;
    const probe = new Image();
    probe.onload = () => {
        attachment.width = probe.naturalWidth;
        attachment.height = probe.naturalHeight;
    };
    probe.src = attachment.previewUrl;
}
/** Give the echo one paint opportunity without letting a throttled frame clock block admission. */
function nextPaint() {
    return new Promise((resolve) => {
        if (typeof requestAnimationFrame === 'function') {
            if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
                setTimeout(resolve, 0);
                return;
            }
            let settled = false;
            const finish = () => {
                if (settled)
                    return;
                settled = true;
                clearTimeout(fallback);
                setTimeout(resolve, 0);
            };
            const fallback = setTimeout(finish, 100);
            requestAnimationFrame(finish);
        }
        else {
            setTimeout(resolve, 0);
        }
    });
}
/** Native canonical base64 of one browser file (FileReader data-URL encode; no main-thread byte loop). */
function base64Of(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const url = reader.result;
            resolve(url.slice(url.indexOf(',') + 1));
        };
        reader.onerror = () => {
            reject(reader.error ?? new Error('conversation: image read failed'));
        };
        reader.readAsDataURL(file);
    });
}
/** Unsupported browser-declared image type, localized by the UI boundary. */
export class UnsupportedImageMediaTypeError extends Error {
    /** Browser-declared MIME value, possibly empty. */
    mediaType;
    /** @param mediaType - Browser-declared MIME value, possibly empty. */
    constructor(mediaType) {
        super(`unsupported image media type: ${mediaType || '(empty)'}`);
        this.name = 'UnsupportedImageMediaTypeError';
        this.mediaType = mediaType;
    }
}
/** Scope-addressed conversation service (root singleton, provided as `conversation`). */
export class ConversationController extends Service {
    /** The per-session input machine registry (SessionInputResolver face). */
    input;
    /** The per-session composer-block registry. */
    blocks;
    draftAttachments = new Map();
    draftObservations = new Map();
    /**
     * @param ctx - owning root context (the plugin apply context; the service
     * registers itself and follows that fiber's lifetime).
     * @param config - carries the SessionInputResolver and composer-block registry
     * constructed by the plugin apply (the same instances the slot inject
     * factories close over).
     */
    constructor(ctx, config) {
        super(ctx, 'conversation');
        this.input = config.input;
        this.blocks = config.blocks;
        ctx.effect(() => () => {
            for (const attachment of this.draftAttachments.values()) {
                revokePreview(attachment.previewUrl);
            }
            this.draftAttachments.clear();
            this.draftObservations.clear();
        }, 'conversation draft attachments');
    }
    /**
     * Send a prompt into the scoped session. Business failures also land in the
     * session snapshot's promptError (object-layer state); the rejection here
     * exists for caller choreography (the composer restores the draft on it).
     * @param text - prompt text, sent verbatim as one text block.
     */
    async send(text) {
        const session = this.scopedSession('send');
        const result = await session.prompt([{ type: 'text', text }], 'queue');
        if (!result.ok)
            throw new Error(`conversation.send failed: ${result.error.code}: ${result.error.message}`);
    }
    /**
     * Submit ordered draft images with text through one host admission. A local
     * submission echo enters the session snapshot synchronously; serialization
     * and the prompt round-trip start after the browser can paint it. On the
     * echo's observed retirement the draft images hand their preview URLs to
     * the durable image cache and leave the registry; on failure they stay
     * registered so the composer can restore them.
     * @param session - target session.
     * @param text - serialized prompt text.
     * @param imageIds - ordered draft-local attachment ids.
     * @param mode - queue or steer delivery selected by composer policy.
     * @param signal - optional cancellation for the complete Host admission.
     * @returns the Host admission outcome; local attachment preparation failures reject.
     */
    async sendSession(session, text, imageIds, mode, signal) {
        const attachments = this.draftImages(imageIds);
        if (attachments.length !== imageIds.length) {
            throw new Error('conversation.sendSession: one or more draft images are no longer available');
        }
        const mismatched = attachments.find((attachment) => {
            const observation = this.draftObservations.get(attachment.id);
            return observation !== undefined && observation.sessionId !== session.sessionId;
        });
        if (mismatched !== undefined) {
            const observation = this.draftObservations.get(mismatched.id);
            throw new Error(`conversation.sendSession: staged attachment belongs to session "${observation?.sessionId}"`);
        }
        if (session.getSnapshot().subagent !== null) {
            // InputHub normally rejects this before the service is reached. Keep the
            // service boundary defensive so another caller cannot upload images to
            // a continuation transport that does not accept them.
            if (attachments.length > 0)
                return { kind: 'error' };
            const uploaded = await this.serializeImages(attachments.map(attachment => attachment.file));
            const content = [...uploaded, ...(text === '' ? [] : [{ type: 'text', text }])];
            const result = await session.prompt(content, mode, signal);
            return result.ok ? { kind: 'success' } : { kind: 'error' };
        }
        let finishRetirement;
        const retirement = attachments.length === 0
            ? undefined
            : new Promise((resolve) => { finishRetirement = resolve; });
        const submission = session.beginSubmission({
            text,
            images: attachments.map(attachment => ({
                previewUrl: attachment.previewUrl,
                ...(attachment.file.name === '' ? {} : { name: attachment.file.name }),
                ...(attachment.width === undefined ? {} : { width: attachment.width }),
                ...(attachment.height === undefined ? {} : { height: attachment.height }),
            })),
            onRetire: (settlement) => {
                this.settleSubmittedImages(session.sessionId, attachments, settlement);
                finishRetirement?.(settlement);
            },
        });
        let content;
        try {
            await nextPaint();
            const uploaded = await this.serializeImages(attachments.map(attachment => attachment.file));
            content = [...uploaded, ...(text === '' ? [] : [{ type: 'text', text }])];
        }
        catch (error) {
            submission.abandon();
            throw error;
        }
        const result = await session.prompt(content, mode, signal, submission.requestId);
        if (!result.ok)
            return { kind: 'error' };
        if (retirement !== undefined && (await retirement).reason !== 'observed')
            return { kind: 'error' };
        return { kind: 'success' };
    }
    /**
     * Create runtime-only draft images and their object URLs.
     * @param files - browser files to register after MIME validation.
     * @returns ordered draft descriptors.
     */
    createDraftImages(files, options) {
        for (const file of files)
            imageMediaType(file.type);
        return files.map((file) => {
            const attachment = browserDraftAttachment(file);
            this.draftAttachments.set(attachment.id, attachment);
            if (options?.onObserved !== undefined) {
                this.draftObservations.set(attachment.id, {
                    sessionId: options.sessionId,
                    onObserved: options.onObserved,
                });
            }
            probeDimensions(attachment);
            return attachment;
        });
    }
    /**
     * Resolve ordered input-state ids to runtime-owned draft images.
     * @param ids - draft attachment ids.
     * @returns descriptors that remain live, in requested order.
     */
    draftImages(ids) {
        const attachments = [];
        for (const id of ids) {
            const attachment = this.draftAttachments.get(id);
            if (attachment !== undefined)
                attachments.push(attachment);
        }
        return attachments;
    }
    /**
     * Serialize ordered draft images to command-submit wire payloads without
     * sending or releasing them (the composer releases only after the command
     * settles successfully).
     * @param imageIds - ordered draft-local attachment ids.
     * @returns base64 payloads in id order.
     */
    async serializeDraftImages(imageIds) {
        const attachments = this.draftImages(imageIds);
        if (attachments.length !== imageIds.length) {
            throw new Error('conversation.serializeDraftImages: one or more draft images are no longer available');
        }
        return Promise.all(attachments.map(attachment => this.encodeImage(attachment.file)));
    }
    /**
     * Release one browser-owned draft image and preview URL.
     * @param id - draft attachment id.
     */
    releaseDraftImage(id) {
        const attachment = this.draftAttachments.get(id);
        if (attachment === undefined)
            return;
        this.draftAttachments.delete(id);
        this.draftObservations.delete(id);
        revokePreview(attachment.previewUrl);
    }
    /**
     * Release a set of browser-owned draft images.
     * @param attachments - descriptors to release.
     */
    releaseDraftImages(attachments) {
        for (const attachment of attachments)
            this.releaseDraftImage(attachment.id);
    }
    /** Apply one operation to a pending queue occurrence. */
    async updateQueue(itemId, action) {
        const session = this.scopedSession('updateQueue');
        const result = await session.updateQueue(itemId, action);
        if (!result.ok) {
            if (action.kind === 'steer'
                && (result.error.code === 'steer-unavailable' || result.error.code === 'queue-item-not-found'))
                return;
            throw new Error(`conversation.updateQueue failed: ${result.error.code}: ${result.error.message}`);
        }
    }
    /** Cancel the scoped session's in-flight turn while preserving Queue (failures land in promptError and reject, as in send). */
    async cancel() {
        const session = this.scopedSession('cancel');
        const result = await session.cancel();
        if (!result.ok)
            throw new Error(`conversation.cancel failed: ${result.error.code}: ${result.error.message}`);
    }
    /** Pull one older history page for the scoped Session. */
    async loadOlder() {
        await this.scopedSession('loadOlder').loadOlder();
    }
    /** Resolve the caller scope's session face or throw on root contexts. */
    scopedSession(op) {
        const id = this.scopeId(op);
        const binding = this.requireSessions().binding(id);
        if (binding === undefined)
            throw new Error(`conversation.${op}: session "${id}" resolved no binding`);
        return binding.session;
    }
    /** Read the caller's session scope tag via the sessions service; root contexts fail loud. */
    scopeId(op) {
        const id = this.requireSessions().scopeOf(this.ctx);
        if (id === undefined) {
            throw new Error(`conversation.${op} requires a session scope — address one via ctx.sessions.scope(id).conversation`);
        }
        return id;
    }
    requireSessions() {
        // Strict ctx.get, not the injection proxy: the scope-addressed pattern
        // reads the service off whatever context the tracker rebound.
        const sessions = this.ctx.get('sessions');
        if (sessions === undefined)
            throw new Error('conversation: sessions service unavailable');
        return sessions;
    }
    /**
     * Settle one submission's draft images when its echo retires. Observed:
     * each image leaves the registry, handing its preview URL to the durable
     * image cache (seeded under the admitted reference so the transcript node
     * renders immediately while the cache reads canonical bytes) or revoking it
     * when the cache already holds that reference. Failed: nothing changes;
     * the ids stay registered for the composer's rail restore.
     */
    settleSubmittedImages(sessionId, attachments, retirement) {
        if (retirement.reason !== 'observed')
            return;
        const uiConversation = this.ctx.get('uiConversation');
        attachments.forEach((attachment, index) => {
            const live = this.draftAttachments.get(attachment.id);
            if (live === undefined)
                return;
            const observation = this.draftObservations.get(attachment.id);
            this.draftAttachments.delete(attachment.id);
            this.draftObservations.delete(attachment.id);
            const ref = retirement.attachments[index];
            if (ref === undefined) {
                revokePreview(attachment.previewUrl);
                return;
            }
            if (uiConversation?.seedImageUrl(sessionId, ref, attachment.previewUrl) !== true) {
                revokePreview(attachment.previewUrl);
            }
            if (observation !== undefined) {
                try {
                    observation.onObserved({ sessionId: String(sessionId), attachment: copyAttachmentRef(ref) });
                }
                catch (error) {
                    console.error('conversation: attachment observation callback failed', error);
                }
            }
        });
    }
    /** Convert browser files to canonical base64 prompt parts. */
    serializeImages(images) {
        return Promise.all(images.map(async (file) => ({ type: 'image', ...await this.encodeImage(file) })));
    }
    /** Canonical base64 wire form of one browser image file. */
    async encodeImage(file) {
        return {
            mediaType: imageMediaType(file.type),
            data: await base64Of(file),
            ...(file.name === '' ? {} : { name: file.name }),
        };
    }
}
function imageMediaType(value) {
    switch (value) {
        case 'image/png':
        case 'image/jpeg':
        case 'image/webp':
        case 'image/gif':
            return value;
        default:
            throw new UnsupportedImageMediaTypeError(value);
    }
}
/** Copy the durable reference before exposing it to an untrusted callback. */
function copyAttachmentRef(ref) {
    return {
        ...ref,
        ...(ref.originalDimensions === undefined
            ? {}
            : { originalDimensions: { ...ref.originalDimensions } }),
    };
}
function revokePreview(url) {
    if (url.startsWith('blob:'))
        URL.revokeObjectURL(url);
}
