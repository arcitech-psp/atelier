const EMPTY_LIST = [];
const EMPTY_TIMELINE = { turnOrder: EMPTY_LIST, turns: new Map() };
/** Empty Chat target used before a view builder is registered. */
export const EMPTY_CHAT_SNAPSHOT = {
    order: EMPTY_LIST,
    nodes: {
        get: () => undefined,
        values: () => EMPTY_LIST,
    },
    locations: {
        getTurn: () => EMPTY_LIST,
        getStep: () => EMPTY_LIST,
    },
    navigation: {
        items: () => EMPTY_LIST,
    },
    timeline: EMPTY_TIMELINE,
    legacy: {
        nodes: EMPTY_LIST,
        turnTimings: new Map(),
        turnEnds: new Map(),
        partial: null,
        runningCalls: EMPTY_LIST,
    },
};
