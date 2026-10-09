function toolNode(node) {
    return node?.kind === 'tool-call' ? node : undefined;
}
/**
 * Find any root or nested Tool lifecycle through the internal Node store.
 * @param snapshot - current Conversation snapshot.
 * @param callId - root or nested call identity.
 * @returns current Tool lifecycle when materialized in the loaded window.
 */
export function findToolCall(snapshot, callId) {
    const visit = (block) => {
        if (block.callId === callId)
            return block;
        for (const child of block.subCalls) {
            const found = visit(child);
            if (found !== undefined)
                return found;
        }
        return undefined;
    };
    for (const node of snapshot.nodes.values()) {
        const root = toolNode(node)?.data.root;
        if (root === undefined)
            continue;
        const found = visit(root);
        if (found !== undefined)
            return found;
    }
    return undefined;
}
