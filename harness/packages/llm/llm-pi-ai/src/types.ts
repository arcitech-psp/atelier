/** Engine-reported context windows supplied by a deployment plugin through `ctx.engineContext`. */
export interface PiAiEngineContextSource {
  /** Changes whenever any reported window changes. */
  readonly revision: number
  /**
   * @param provider - route key.
   * @param model - model id on that route.
   * @returns the window the serving engine reports, or undefined to keep the configured value.
   */
  window(provider: string, model: string): number | undefined
}

/** One stream that ended at its token limit or with a context overflow. */
export interface PiAiLengthStop {
  provider: string
  model: string
  /** `max-tokens` for a length finish, `context-overflow` for an overflow failure. */
  reason: 'max-tokens' | 'context-overflow'
  /** The context window the request was sized against. */
  contextWindow: number
}
