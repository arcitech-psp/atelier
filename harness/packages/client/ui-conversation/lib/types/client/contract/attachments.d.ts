/** Type-only contracts for optional durable attachment observation. */
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
/** Durable result associated with one staged image after Host observation. */
export interface AttachmentObservationReceipt {
    readonly sessionId: string;
    readonly attachment: ImageAttachmentRef;
}
/** Optional callback invoked after one staged image reaches durable observation. */
export interface AttachmentObservationOptions {
    readonly onObserved?: (receipt: AttachmentObservationReceipt) => void;
}
/** Controller-only metadata captured when a staged image is created. */
export interface DraftAttachmentRegistrationOptions extends AttachmentObservationOptions {
    readonly sessionId: SessionId;
}
