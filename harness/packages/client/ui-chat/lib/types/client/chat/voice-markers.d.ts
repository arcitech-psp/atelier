export interface SplitVoiceText {
    readonly text: string;
    readonly note: string | null;
}
/** Remove the machine hints from a user message's text; the interruption becomes a short muted note. */
export declare function splitVoiceMarkers(raw: string): SplitVoiceText;
