/** Wire and presentation types for the optional Host Knowledge Graph read. */
/** Maximum accepted UTF-8 response size for the Knowledge Graph endpoint. */
export const KNOWLEDGE_GRAPH_MAX_BYTES = 2 * 1024 * 1024;
const INVALID_RESPONSE = 'Invalid Knowledge Graph response';
function isRecord(value) {
    return typeof value === 'object' && value !== null;
}
function requiredString(value) {
    return typeof value === 'string';
}
function optionalString(value) {
    return value === undefined ? undefined : requiredString(value) ? value : undefined;
}
function optionalCommunity(value) {
    if (value === undefined || value === null)
        return value;
    return finiteNumber(value) ? value : undefined;
}
function nonNegativeInteger(value) {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function finiteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}
function parseNode(value) {
    if (!isRecord(value)
        || !requiredString(value.id)
        || !requiredString(value.label)
        || !requiredString(value.file_type)
        || !requiredString(value.source_file))
        return undefined;
    const sourceLocation = optionalString(value.source_location);
    const community = optionalCommunity(value.community);
    const communityName = optionalString(value.community_name);
    const evidenceStatus = optionalString(value.evidence_status);
    const rationale = optionalString(value.rationale);
    return {
        id: value.id,
        label: value.label,
        file_type: value.file_type,
        source_file: value.source_file,
        ...(sourceLocation === undefined ? {} : { source_location: sourceLocation }),
        ...(community === undefined ? {} : { community }),
        ...(communityName === undefined ? {} : { community_name: communityName }),
        ...(evidenceStatus === undefined ? {} : { evidence_status: evidenceStatus }),
        ...(rationale === undefined ? {} : { rationale }),
    };
}
function parseEdge(value) {
    if (!isRecord(value)
        || !requiredString(value.source)
        || !requiredString(value.target)
        || !requiredString(value.relation)
        || !requiredString(value.confidence))
        return undefined;
    if (value.confidence_score !== undefined && !finiteNumber(value.confidence_score))
        return undefined;
    return {
        source: value.source,
        target: value.target,
        relation: value.relation,
        confidence: value.confidence,
        ...(value.confidence_score === undefined ? {} : { confidence_score: value.confidence_score }),
    };
}
/**
 * Validate the Host JSON payload at the wire boundary.
 * @param value - parsed JSON from `/api/knowledge-graph`.
 * @returns a render-safe response union.
 */
export function parseKnowledgeGraphResponse(value) {
    if (!isRecord(value) || value.ok !== true) {
        const error = isRecord(value) && requiredString(value.error) ? value.error : INVALID_RESPONSE;
        return { ok: false, error: error.slice(0, 160) };
    }
    if (!requiredString(value.corpus)
        || !requiredString(value.revision)
        || !requiredString(value.builtAt)
        || value.referenceOnly !== true
        || !nonNegativeInteger(value.totalNodes)
        || !nonNegativeInteger(value.totalEdges)
        || !Array.isArray(value.nodes)
        || !Array.isArray(value.edges)
        || typeof value.truncated !== 'boolean')
        return { ok: false, error: INVALID_RESPONSE };
    const nodes = value.nodes.map(parseNode);
    const edges = value.edges.map(parseEdge);
    if (nodes.some(node => node === undefined) || edges.some(edge => edge === undefined)) {
        return { ok: false, error: INVALID_RESPONSE };
    }
    return {
        ok: true,
        corpus: value.corpus,
        revision: value.revision,
        builtAt: value.builtAt,
        referenceOnly: true,
        totalNodes: value.totalNodes,
        totalEdges: value.totalEdges,
        nodes: nodes,
        edges: edges,
        truncated: value.truncated,
        ...(Array.isArray(value.droppedNodeIds) && value.droppedNodeIds.every(requiredString)
            ? { droppedNodeIds: value.droppedNodeIds }
            : {}),
        ...(nonNegativeInteger(value.droppedEdgeCount) ? { droppedEdgeCount: value.droppedEdgeCount } : {}),
    };
}
