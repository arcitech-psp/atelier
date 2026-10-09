/** Strict per-session header/body content inserted into the resident conversation layout. */
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots';
import type { ConversationSessionHeaderSlotProps, ConversationSessionSlotProps } from '../contract/slots.ts';
/** Full props composed from the strict session body contract. */
export type ConversationSessionProps = ConversationSessionSlotProps & PropsLocale<'conversation'>;
/** Full props composed from the strict session header contract. */
export type ConversationSessionHeaderProps = ConversationSessionHeaderSlotProps;
/**
 * Renders Session header chrome above the resident conversation scrollport.
 * @param props - Strict Session store, view ledger, navigation, render, and locale shares.
 * @returns the hidden blank-session header or visible title and tabs.
 */
export declare function ConversationSessionHeader({ sessionId, useSession, useSessions, useConversation, useConversationViews, useStore, actions, renderSlot, open, t, useSidePanelAvailable, }: ConversationSessionHeaderProps): import("react").JSX.Element;
/**
 * Renders the active Session view inside the resident scrollport and keeps
 * the input draft mirrored while blank Hero chrome is visible.
 * @param props - Strict Session input/store, view ledger, and render shares.
 * @returns the active view area, or null while the Session remains blank.
 */
export declare function ConversationSession({ sessionId, useSession, useSessions, useConversation, useConversationViews, useInput, inputActions, useStore, actions, renderSlot, bindDraftMirror, knowledgeGraph, releaseKnowledgeGraphStorage, stageAttachment, t, useSidePanelAvailable, }: ConversationSessionProps): import("react").JSX.Element | null;
