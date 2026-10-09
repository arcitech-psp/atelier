import { isRunningTool } from "../contract/chat-nodes.js";
import { TURN_PROCESS_INDEPENDENT_KINDS } from "../contract/turn-process.js";
import { sessionRecallLabels } from "./event-projection.js";
import { sameTurnNavigationItem, turnNavigationItem } from "./turn-navigation.js";
const EMPTY_KEYS = [];
const EMPTY_TURNS = [];
const EMPTY_ITEMS = [];
const EMPTY_LIST = [];
function sameReferences(left, right) {
    return left.length === right.length && left.every((value, index) => value === right[index]);
}
class MutableChatNodeStore {
    byKey = new Map();
    valuesCache = EMPTY_LIST;
    valuesDirty = false;
    get(key) {
        return this.byKey.get(key);
    }
    values() {
        if (this.valuesDirty) {
            this.valuesCache = [...this.byKey.values()];
            this.valuesDirty = false;
        }
        return this.valuesCache;
    }
    replace(nodes) {
        this.byKey.clear();
        for (const node of nodes)
            this.byKey.set(node.key, node);
        this.valuesCache = [...this.byKey.values()];
        this.valuesDirty = false;
    }
    upsert(nodes) {
        let changed = false;
        for (const node of nodes) {
            if (this.byKey.get(node.key) === node)
                continue;
            this.byKey.set(node.key, node);
            changed = true;
        }
        if (changed)
            this.valuesDirty = true;
    }
}
class MutableChatLocationIndex {
    turns = new Map();
    steps = new Map();
    getTurn(turn) {
        return this.turns.get(turn) ?? EMPTY_KEYS;
    }
    getStep(turn, step) {
        return this.steps.get(stepKey(turn, step)) ?? EMPTY_KEYS;
    }
    rebuild(order, store) {
        const turns = new Map();
        const steps = new Map();
        for (const key of order) {
            const location = store.get(key)?.location;
            if (location === undefined)
                continue;
            const coordinates = locationCoordinates(location);
            if (coordinates.turn === undefined)
                continue;
            const turnKeys = turns.get(coordinates.turn) ?? [];
            turnKeys.push(key);
            turns.set(coordinates.turn, turnKeys);
            if (coordinates.step === undefined)
                continue;
            const step = stepKey(coordinates.turn, coordinates.step);
            const stepKeys = steps.get(step) ?? [];
            stepKeys.push(key);
            steps.set(step, stepKeys);
        }
        this.turns = updateIndex(this.turns, turns);
        this.steps = updateIndex(this.steps, steps);
    }
    /** Invalidate aggregate readers when member data changes without moving. */
    touch(nodes) {
        const turns = new Set();
        const steps = new Set();
        for (const node of nodes) {
            const coordinates = locationCoordinates(node.location);
            if (coordinates.turn === undefined || !this.turns.get(coordinates.turn)?.includes(node.key))
                continue;
            turns.add(coordinates.turn);
            if (coordinates.step !== undefined)
                steps.add(stepKey(coordinates.turn, coordinates.step));
        }
        for (const turn of turns) {
            const keys = this.turns.get(turn);
            if (keys === undefined)
                continue;
            this.turns.set(turn, [...keys]);
        }
        for (const step of steps) {
            const keys = this.steps.get(step);
            if (keys === undefined)
                continue;
            this.steps.set(step, [...keys]);
        }
    }
}
function updateIndex(previous, nextMutable) {
    const next = new Map();
    const keys = new Set([...previous.keys(), ...nextMutable.keys()]);
    for (const key of keys) {
        const before = previous.get(key) ?? EMPTY_KEYS;
        const candidate = nextMutable.get(key) ?? EMPTY_KEYS;
        const value = sameReferences(before, candidate) ? before : candidate;
        if (candidate.length > 0)
            next.set(key, value);
    }
    return next;
}
/**
 * Loaded-Turn rail projection accumulated alongside the node store: a
 * structural change re-derives the Turn set, a content-only upsert re-derives
 * only the Turns whose nodes moved, and the published array keeps its identity
 * until an item actually changes. Renderers therefore consume final Turn data
 * instead of scanning the loaded window per frame.
 */
class MutableTurnNavigationIndex {
    current = EMPTY_ITEMS;
    byTurn = new Map();
    items() {
        return this.current;
    }
    /** Re-derive the whole Turn set; runs only when the loaded structure moves. */
    rebuild(timeline, locations, nodes) {
        const next = [];
        const byTurn = new Map();
        for (const turn of timeline.turnOrder) {
            const derived = turnNavigationItem(turn, locations, nodes);
            if (derived === undefined)
                continue;
            const previous = this.byTurn.get(turn);
            const item = previous !== undefined && sameTurnNavigationItem(previous, derived) ? previous : derived;
            next.push(item);
            byTurn.set(turn, item);
        }
        this.byTurn = byTurn;
        const unchanged = next.length === this.current.length
            && next.every((item, index) => item === this.current[index]);
        if (!unchanged)
            this.current = next;
    }
    /** Re-derive only the Turns a content-only upsert touched. */
    touch(turns, locations, nodes) {
        if (turns.size === 0)
            return;
        const next = this.current.map((item) => {
            if (!turns.has(item.turn))
                return item;
            const derived = turnNavigationItem(item.turn, locations, nodes);
            if (derived === undefined || sameTurnNavigationItem(item, derived))
                return item;
            this.byTurn.set(item.turn, derived);
            return derived;
        });
        if (next.some((item, index) => item !== this.current[index]))
            this.current = next;
    }
}
function stepKey(turn, step) {
    return `${turn}:${step}`;
}
function locationCoordinates(location) {
    if (location.kind === 'step')
        return { turn: location.turn.turn, step: location.step.step };
    if (location.kind === 'turn')
        return { turn: location.turn.turn };
    return {};
}
function turnProcessPresentations(nodes) {
    const presentations = new Map();
    for (const raw of nodes) {
        const node = raw;
        if (node.kind === 'turn-process') {
            presentations.set(node.data.turn, { ...presentations.get(node.data.turn), control: node });
        }
    }
    for (const raw of nodes) {
        const node = raw;
        const location = node.location;
        if (location.kind !== 'turn' && location.kind !== 'step')
            continue;
        const current = presentations.get(location.turn.turn) ?? {};
        if ((node.kind === 'user' || node.kind === 'steering')
            && node.anchorSeq < (current.control?.data.controlAnchorSeq ?? Number.POSITIVE_INFINITY)) {
            presentations.set(location.turn.turn, {
                ...current,
                openingHumanAnchor: Math.min(current.openingHumanAnchor ?? node.anchorSeq, node.anchorSeq),
            });
            continue;
        }
        if (TURN_PROCESS_INDEPENDENT_KINDS.has(node.kind))
            continue;
        presentations.set(location.turn.turn, {
            ...current,
            earliestProcessAnchor: Math.min(current.earliestProcessAnchor ?? node.anchorSeq, node.anchorSeq),
        });
    }
    return presentations;
}
function presentationPosition(raw, presentations) {
    const node = raw;
    const location = node.location;
    if (location.kind !== 'turn' && location.kind !== 'step') {
        return { anchor: node.anchorSeq, rank: 0, originalAnchor: node.anchorSeq };
    }
    const presentation = presentations.get(location.turn.turn);
    if (presentation === undefined) {
        return { anchor: node.anchorSeq, rank: 0, originalAnchor: node.anchorSeq };
    }
    const openingHumanAnchor = presentation.openingHumanAnchor;
    if (openingHumanAnchor !== undefined
        && node.anchorSeq < openingHumanAnchor
        && !TURN_PROCESS_INDEPENDENT_KINDS.has(node.kind)) {
        return { anchor: openingHumanAnchor, rank: 2, originalAnchor: node.anchorSeq };
    }
    if (presentation.control !== undefined && node.key === presentation.control.key) {
        return openingHumanAnchor === undefined
            ? {
                anchor: presentation.earliestProcessAnchor ?? node.anchorSeq,
                rank: -1,
                originalAnchor: node.anchorSeq,
            }
            : { anchor: openingHumanAnchor, rank: 1, originalAnchor: node.anchorSeq };
    }
    return { anchor: node.anchorSeq, rank: 0, originalAnchor: node.anchorSeq };
}
/**
 * Order visible Chat Nodes without changing existing relative order as process
 * eligibility changes. Opening human input precedes process candidates, while
 * each synthetic process control sits between them.
 * @param nodes - currently materialized Chat Nodes.
 * @returns visible Nodes in presentation order.
 */
export function orderedVisibleChatNodes(nodes) {
    const visible = nodes.filter(node => node.visibility === 'visible');
    const presentations = turnProcessPresentations(visible);
    return visible.sort((left, right) => {
        const leftPosition = presentationPosition(left, presentations);
        const rightPosition = presentationPosition(right, presentations);
        return leftPosition.anchor - rightPosition.anchor
            || leftPosition.rank - rightPosition.rank
            || leftPosition.originalAnchor - rightPosition.originalAnchor
            || left.key.localeCompare(right.key);
    });
}
function referenceMessageSeq(node) {
    const candidate = node;
    return candidate.kind === 'user' || candidate.kind === 'steering'
        ? candidate.data.seq
        : undefined;
}
function followingRecall(node) {
    const candidate = node;
    if (candidate.kind !== 'context')
        return undefined;
    return {
        messageSeq: candidate.data.seq - 1,
        labels: sessionRecallLabels(candidate.data.source),
    };
}
function withReferenceLabels(node, labels) {
    const candidate = node;
    if (candidate.kind !== 'user' && candidate.kind !== 'steering')
        return node;
    const current = candidate.data.referenceLabels ?? EMPTY_KEYS;
    const hasLabels = Object.hasOwn(candidate.data, 'referenceLabels');
    if (sameReferences(current, labels) && hasLabels === (labels.length > 0))
        return node;
    const data = { ...candidate.data };
    if (labels.length === 0)
        delete data.referenceLabels;
    else
        data.referenceLabels = labels;
    return { ...candidate, data };
}
/** Associates a direct message with the sourced recall event that immediately follows it. */
class ReferenceLabelProjector {
    messagesBySeq = new Map();
    labelsByMessageSeq = new Map();
    replace(nodes) {
        this.messagesBySeq.clear();
        this.labelsByMessageSeq.clear();
        for (const node of nodes) {
            const messageSeq = referenceMessageSeq(node);
            if (messageSeq !== undefined)
                this.messagesBySeq.set(messageSeq, node.key);
            const recall = followingRecall(node);
            if (recall !== undefined && recall.labels.length > 0) {
                this.labelsByMessageSeq.set(recall.messageSeq, recall.labels);
            }
        }
        return nodes.map((node) => {
            const messageSeq = referenceMessageSeq(node);
            return messageSeq === undefined
                ? node
                : withReferenceLabels(node, this.labelsByMessageSeq.get(messageSeq) ?? EMPTY_KEYS);
        });
    }
    apply(upserts, store) {
        const byKey = new Map(upserts.map(node => [node.key, node]));
        const affected = new Set();
        for (const node of upserts) {
            const messageSeq = referenceMessageSeq(node);
            if (messageSeq !== undefined) {
                this.messagesBySeq.set(messageSeq, node.key);
                affected.add(messageSeq);
            }
            const recall = followingRecall(node);
            if (recall === undefined)
                continue;
            const current = this.labelsByMessageSeq.get(recall.messageSeq);
            if (recall.labels.length === 0)
                this.labelsByMessageSeq.delete(recall.messageSeq);
            else {
                this.labelsByMessageSeq.set(recall.messageSeq, current !== undefined && sameReferences(current, recall.labels) ? current : recall.labels);
            }
            affected.add(recall.messageSeq);
        }
        for (const messageSeq of affected) {
            const key = this.messagesBySeq.get(messageSeq);
            if (key === undefined)
                continue;
            const node = byKey.get(key) ?? store.get(key);
            if (node === undefined)
                continue;
            byKey.set(key, withReferenceLabels(node, this.labelsByMessageSeq.get(messageSeq) ?? EMPTY_KEYS));
        }
        return [...byKey.values()];
    }
}
const EMPTY_CONTRIBUTION = {
    anchorSeq: 0,
    nodes: EMPTY_LIST,
    partial: null,
    running: null,
};
function legacyContribution(raw) {
    const node = raw;
    // Content-free settled Assistants remain in the finalized compatibility
    // stream so StatsLine preserves its pre-assembly step counts; hidden running
    // attempts have no final Node to contribute.
    if (raw.visibility !== 'visible' && node.kind !== 'assistant-step')
        return EMPTY_CONTRIBUTION;
    switch (node.kind) {
        case 'user':
        case 'steering':
        case 'context':
        case 'command':
        case 'compaction':
        case 'turn-error':
        case 'turn-max-tokens':
        case 'unknown':
            return { anchorSeq: node.anchorSeq, nodes: [node.data], partial: null, running: null };
        case 'assistant-step': {
            const data = node.data;
            if (data.status === 'running') {
                if (raw.visibility !== 'visible')
                    return EMPTY_CONTRIBUTION;
                return {
                    anchorSeq: node.anchorSeq,
                    nodes: EMPTY_LIST,
                    partial: { turn: data.turn, step: data.step, blocks: data.blocks },
                    running: null,
                };
            }
            return {
                anchorSeq: node.anchorSeq,
                nodes: data.finalNode === undefined ? EMPTY_LIST : [data.finalNode],
                partial: null,
                running: null,
            };
        }
        case 'tool-call': {
            const root = node.data.root;
            return isRunningTool(root)
                ? { anchorSeq: node.anchorSeq, nodes: EMPTY_LIST, partial: null, running: root }
                : { anchorSeq: node.anchorSeq, nodes: [root], partial: null, running: null };
        }
        case 'manual-compaction': {
            const data = node.data;
            return {
                anchorSeq: node.anchorSeq,
                nodes: data.compaction === null ? [data.command] : [data.command, data.compaction],
                partial: null,
                running: null,
            };
        }
        case 'model-retry':
            return {
                anchorSeq: node.anchorSeq,
                nodes: node.data.attempts,
                partial: null,
                running: null,
            };
        case 'turn-tail':
        case 'system-prompt':
            // These known Chat rows intentionally make no legacy timeline contribution.
            return EMPTY_CONTRIBUTION;
        default:
            return EMPTY_CONTRIBUTION;
    }
}
function sameContribution(left, right) {
    return left !== undefined
        && left.anchorSeq === right.anchorSeq
        && left.partial?.blocks === right.partial?.blocks
        && left.partial?.turn === right.partial?.turn
        && left.partial?.step === right.partial?.step
        && left.running === right.running
        && sameReferences(left.nodes, right.nodes);
}
/** Incremental compatibility projection for StatsLine and legacy top-level snapshot fields. */
class LegacySliceBuilder {
    contributions = new Map();
    finalizedContributions = new Map();
    runningContributions = new Map();
    partialContributions = new Map();
    finalized = EMPTY_LIST;
    runningCalls = EMPTY_LIST;
    partial = null;
    timeline;
    turnTimings = new Map();
    turnEnds = new Map();
    replace(nodes, timeline) {
        this.contributions.clear();
        this.finalizedContributions.clear();
        this.runningContributions.clear();
        this.partialContributions.clear();
        for (const node of nodes) {
            const contribution = legacyContribution(node);
            this.contributions.set(node.key, contribution);
            this.indexContribution(node.key, contribution);
        }
        this.rebuildFinalized();
        this.rebuildRunning();
        this.rebuildPartial();
        this.updateTimeline(timeline);
        return this.snapshot();
    }
    apply(upserts, timeline) {
        let finalizedChanged = false;
        let runningChanged = false;
        let partialChanged = false;
        for (const node of upserts) {
            const contribution = legacyContribution(node);
            const previous = this.contributions.get(node.key);
            if (sameContribution(previous, contribution))
                continue;
            finalizedChanged ||= finalizedContributionChanged(previous, contribution);
            runningChanged ||= runningContributionChanged(previous, contribution);
            partialChanged ||= partialContributionChanged(previous, contribution);
            this.contributions.set(node.key, contribution);
            this.indexContribution(node.key, contribution);
        }
        if (finalizedChanged)
            this.rebuildFinalized();
        if (runningChanged)
            this.rebuildRunning();
        if (partialChanged)
            this.rebuildPartial();
        this.updateTimeline(timeline);
        return this.snapshot();
    }
    indexContribution(key, contribution) {
        updateContributionIndex(this.finalizedContributions, key, contribution, contribution.nodes.length > 0);
        updateContributionIndex(this.runningContributions, key, contribution, contribution.running !== null);
        updateContributionIndex(this.partialContributions, key, contribution, contribution.partial !== null);
    }
    rebuildFinalized() {
        const finalized = [...this.finalizedContributions.values()]
            .flatMap(value => value.nodes)
            .sort((left, right) => left.seq - right.seq);
        if (!sameReferences(this.finalized, finalized))
            this.finalized = finalized;
    }
    rebuildRunning() {
        const runningCalls = [...this.runningContributions.values()]
            .sort((left, right) => left.anchorSeq - right.anchorSeq)
            .flatMap(value => value.running === null ? [] : [value.running]);
        if (!sameReferences(this.runningCalls, runningCalls))
            this.runningCalls = runningCalls;
    }
    rebuildPartial() {
        const partial = [...this.partialContributions.values()]
            .sort((left, right) => left.anchorSeq - right.anchorSeq)
            .findLast(value => value.partial !== null)?.partial ?? null;
        if (this.partial?.blocks !== partial?.blocks
            || this.partial?.turn !== partial?.turn
            || this.partial?.step !== partial?.step)
            this.partial = partial;
    }
    updateTimeline(timeline) {
        if (this.timeline === timeline)
            return;
        this.timeline = timeline;
        const turnTimings = new Map();
        const turnEnds = new Map();
        for (const turn of timeline.turns.values()) {
            if (turn.start !== undefined) {
                turnTimings.set(turn.turn, {
                    startTime: turn.start.time,
                    ...turn.end === undefined ? {} : { endTime: turn.end.time },
                });
            }
            if (turn.end !== undefined)
                turnEnds.set(turn.turn, turn.end.seq);
        }
        this.turnTimings = turnTimings;
        this.turnEnds = turnEnds;
    }
    snapshot() {
        return {
            nodes: this.finalized,
            turnTimings: this.turnTimings,
            turnEnds: this.turnEnds,
            partial: this.partial,
            runningCalls: this.runningCalls,
        };
    }
}
function updateContributionIndex(index, key, contribution, present) {
    if (present)
        index.set(key, contribution);
    else
        index.delete(key);
}
function finalizedContributionChanged(previous, next) {
    const previousNodes = previous?.nodes ?? EMPTY_LIST;
    return !sameReferences(previousNodes, next.nodes)
        || ((previousNodes.length > 0 || next.nodes.length > 0) && previous?.anchorSeq !== next.anchorSeq);
}
function runningContributionChanged(previous, next) {
    return previous?.running !== next.running
        || ((previous.running !== null || next.running !== null)
            && previous.anchorSeq !== next.anchorSeq);
}
function partialContributionChanged(previous, next) {
    return previous?.partial?.blocks !== next.partial?.blocks
        || previous?.partial?.turn !== next.partial?.turn
        || previous?.partial?.step !== next.partial?.step
        || (((previous?.partial ?? null) !== null || next.partial !== null)
            && previous?.anchorSeq !== next.anchorSeq);
}
/** Incremental keyed Chat builder registered under the `chat` target. */
export class ChatSnapshotBuilder {
    store = new MutableChatNodeStore();
    locations = new MutableChatLocationIndex();
    navigation = new MutableTurnNavigationIndex();
    legacy = new LegacySliceBuilder();
    referenceLabels = new ReferenceLabelProjector();
    order = EMPTY_KEYS;
    /** Last published timeline: a Turn boundary can land without a new node. */
    timeline = null;
    empty;
    constructor() {
        this.empty = this.snapshot({ turnOrder: EMPTY_TURNS, turns: new Map() });
    }
    replace(input) {
        const nodes = this.referenceLabels.replace(input.nodes);
        this.store.replace(nodes);
        this.order = orderedVisibleChatNodes(nodes).map(node => node.key);
        this.locations.rebuild(this.order, this.store);
        this.navigation.rebuild(input.timeline, this.locations, this.store);
        this.timeline = input.timeline;
        return this.snapshot(input.timeline, this.legacy.replace(nodes, input.timeline));
    }
    apply(input) {
        const upserts = this.referenceLabels.apply(input.upserts, this.store);
        let structural = false;
        const contentOnly = [];
        for (const node of upserts) {
            const previous = this.store.get(node.key);
            const nodeStructural = previous === undefined
                || previous.kind !== node.kind
                || previous.anchorSeq !== node.anchorSeq
                || previous.visibility !== node.visibility
                || locationIdentity(previous.location) !== locationIdentity(node.location);
            structural ||= nodeStructural;
            if (!nodeStructural)
                contentOnly.push(node);
        }
        this.store.upsert(upserts);
        if (structural) {
            const next = orderedVisibleChatNodes(this.store.values()).map(node => node.key);
            this.order = sameReferences(this.order, next) ? this.order : next;
            this.locations.rebuild(this.order, this.store);
        }
        this.locations.touch(contentOnly);
        if (structural || input.timeline !== this.timeline) {
            this.navigation.rebuild(input.timeline, this.locations, this.store);
        }
        else {
            this.navigation.touch(turnsOf(contentOnly), this.locations, this.store);
        }
        this.timeline = input.timeline;
        return this.snapshot(input.timeline, this.legacy.apply(upserts, input.timeline));
    }
    snapshot(timeline, legacy = this.legacy.replace(EMPTY_LIST, timeline)) {
        return {
            order: this.order,
            nodes: this.store,
            locations: this.locations,
            navigation: this.navigation,
            timeline,
            legacy,
        };
    }
}
/** Turns owning the given nodes, for the content-only navigation update. */
function turnsOf(nodes) {
    const turns = new Set();
    for (const node of nodes) {
        const turn = locationCoordinates(node.location).turn;
        if (turn !== undefined)
            turns.add(turn);
    }
    return turns;
}
function locationIdentity(location) {
    const coordinates = locationCoordinates(location);
    return `${location.kind}:${coordinates.turn ?? ''}:${coordinates.step ?? ''}`;
}
/** Chat target factory contributed to the Conversation view registry. */
export const chatViewDefinition = {
    target: 'chat',
    create: () => new ChatSnapshotBuilder(),
    isActive: snapshot => snapshot.order.some(key => snapshot.nodes.get(key)?.kind !== 'command'),
};
/**
 * Register the incremental Chat target builder.
 * @param ctx - owning UI Conversation context.
 */
export function registerChatConversationView(ctx) {
    ctx.uiConversation.views.register(chatViewDefinition);
}
