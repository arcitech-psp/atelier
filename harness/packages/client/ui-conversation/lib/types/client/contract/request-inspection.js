/**
 * Canonicalize one request header and classify its model-visible prompt change.
 * @param previous - Prompt from the preceding loaded request header, when available.
 * @param event - Durable full request header to inspect.
 * @returns The canonical prompt and an initial/system/tool change when it can be established.
 */
export function inspectRequestPrompt(previous, event) {
    const header = event.data.header;
    const rawTools = header.tools;
    const prompt = {
        config: header.config,
        system: header.system ?? '',
        tools: Array.isArray(rawTools) ? rawTools : [],
    };
    if (previous === undefined && event.data.reason !== 'initial')
        return { prompt };
    const systemChanged = previous !== undefined && previous.system !== prompt.system;
    const toolsChanged = previous !== undefined
        && JSON.stringify(previous.tools) !== JSON.stringify(prompt.tools);
    if (previous !== undefined && !systemChanged && !toolsChanged)
        return { prompt };
    return {
        prompt,
        change: {
            seq: event.seq,
            time: event.time,
            kind: previous === undefined
                ? 'initial'
                : systemChanged && toolsChanged
                    ? 'system-and-tools'
                    : systemChanged ? 'system' : 'tools',
            ...(previous === undefined ? {} : { previous }),
        },
    };
}
