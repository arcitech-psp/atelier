/** Wire and presentation types for the optional Host Knowledge Graph read. */
/** Maximum accepted UTF-8 response size for the Knowledge Graph endpoint. */
export declare const KNOWLEDGE_GRAPH_MAX_BYTES: number;
/** One source node returned by the Host Knowledge Graph index. */
export interface KnowledgeGraphNode {
    readonly id: string;
    readonly label: string;
    readonly file_type: string;
    readonly source_file: string;
    readonly source_location?: string;
    readonly community?: number | null;
    readonly community_name?: string;
    readonly evidence_status?: string;
    readonly rationale?: string;
}
/** One directed relationship between two Knowledge Graph nodes. */
export interface KnowledgeGraphEdge {
    readonly source: string;
    readonly target: string;
    readonly relation: string;
    readonly confidence: string;
    readonly confidence_score?: number;
}
/** Validated successful response from the Host Knowledge Graph route. */
export interface KnowledgeGraphSuccess {
    readonly ok: true;
    readonly corpus: string;
    readonly revision: string;
    readonly builtAt: string;
    readonly referenceOnly: true;
    readonly totalNodes: number;
    readonly totalEdges: number;
    readonly nodes: readonly KnowledgeGraphNode[];
    readonly edges: readonly KnowledgeGraphEdge[];
    readonly truncated: boolean;
    readonly droppedNodeIds?: readonly string[];
    readonly droppedEdgeCount?: number;
}
/** Unavailable or rejected response from the Host Knowledge Graph route. */
export interface KnowledgeGraphUnavailable {
    readonly ok: false;
    readonly error: string;
}
/** Result returned by the injected Knowledge Graph loader. */
export type KnowledgeGraphResponse = KnowledgeGraphSuccess | KnowledgeGraphUnavailable;
/** Transport capability supplied to the Conversation panel by `apply()`. */
export interface KnowledgeGraphTransport {
    /** Read the current Host snapshot; callers decide when a read is needed. */
    load: () => Promise<KnowledgeGraphResponse>;
    /** Abort the current read, if any. */
    abort: () => void;
}
/**
 * Validate the Host JSON payload at the wire boundary.
 * @param value - parsed JSON from `/api/knowledge-graph`.
 * @returns a render-safe response union.
 */
export declare function parseKnowledgeGraphResponse(value: unknown): KnowledgeGraphResponse;
