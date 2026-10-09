/** Wire and presentation types for the optional Host Knowledge Graph read. */

/** Maximum accepted UTF-8 response size for the Knowledge Graph endpoint. */
export const KNOWLEDGE_GRAPH_MAX_BYTES = 2 * 1024 * 1024

/** One source node returned by the Host Knowledge Graph index. */
export interface KnowledgeGraphNode {
  readonly id: string
  readonly label: string
  readonly file_type: string
  readonly source_file: string
  readonly source_location?: string
  readonly community?: number | null
  readonly community_name?: string
  readonly evidence_status?: string
  readonly rationale?: string
}

/** One directed relationship between two Knowledge Graph nodes. */
export interface KnowledgeGraphEdge {
  readonly source: string
  readonly target: string
  readonly relation: string
  readonly confidence: string
  readonly confidence_score?: number
}

/** Validated successful response from the Host Knowledge Graph route. */
export interface KnowledgeGraphSuccess {
  readonly ok: true
  readonly corpus: string
  readonly revision: string
  readonly builtAt: string
  readonly referenceOnly: true
  readonly totalNodes: number
  readonly totalEdges: number
  readonly nodes: readonly KnowledgeGraphNode[]
  readonly edges: readonly KnowledgeGraphEdge[]
  readonly truncated: boolean
  readonly droppedNodeIds?: readonly string[]
  readonly droppedEdgeCount?: number
}

/** Unavailable or rejected response from the Host Knowledge Graph route. */
export interface KnowledgeGraphUnavailable {
  readonly ok: false
  readonly error: string
}

/** Result returned by the injected Knowledge Graph loader. */
export type KnowledgeGraphResponse = KnowledgeGraphSuccess | KnowledgeGraphUnavailable

/** Transport capability supplied to the Conversation panel by `apply()`. */
export interface KnowledgeGraphTransport {
  /** Read the current Host snapshot; callers decide when a read is needed. */
  load: () => Promise<KnowledgeGraphResponse>
  /** Abort the current read, if any. */
  abort: () => void
}

const INVALID_RESPONSE = 'Invalid Knowledge Graph response'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function requiredString(value: unknown): value is string {
  return typeof value === 'string'
}

function optionalString(value: unknown): string | undefined {
  return value === undefined ? undefined : requiredString(value) ? value : undefined
}

function optionalCommunity(value: unknown): number | null | undefined {
  if (value === undefined || value === null) return value
  return finiteNumber(value) ? value : undefined
}

function nonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function parseNode(value: unknown): KnowledgeGraphNode | undefined {
  if (!isRecord(value)
    || !requiredString(value.id)
    || !requiredString(value.label)
    || !requiredString(value.file_type)
    || !requiredString(value.source_file)) return undefined
  const sourceLocation = optionalString(value.source_location)
  const community = optionalCommunity(value.community)
  const communityName = optionalString(value.community_name)
  const evidenceStatus = optionalString(value.evidence_status)
  const rationale = optionalString(value.rationale)
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
  }
}

function parseEdge(value: unknown): KnowledgeGraphEdge | undefined {
  if (!isRecord(value)
    || !requiredString(value.source)
    || !requiredString(value.target)
    || !requiredString(value.relation)
    || !requiredString(value.confidence)) return undefined
  if (value.confidence_score !== undefined && !finiteNumber(value.confidence_score)) return undefined
  return {
    source: value.source,
    target: value.target,
    relation: value.relation,
    confidence: value.confidence,
    ...(value.confidence_score === undefined ? {} : { confidence_score: value.confidence_score }),
  }
}

/**
 * Validate the Host JSON payload at the wire boundary.
 * @param value - parsed JSON from `/api/knowledge-graph`.
 * @returns a render-safe response union.
 */
export function parseKnowledgeGraphResponse(value: unknown): KnowledgeGraphResponse {
  if (!isRecord(value) || value.ok !== true) {
    const error = isRecord(value) && requiredString(value.error) ? value.error : INVALID_RESPONSE
    return { ok: false, error: error.slice(0, 160) }
  }
  if (!requiredString(value.corpus)
    || !requiredString(value.revision)
    || !requiredString(value.builtAt)
    || value.referenceOnly !== true
    || !nonNegativeInteger(value.totalNodes)
    || !nonNegativeInteger(value.totalEdges)
    || !Array.isArray(value.nodes)
    || !Array.isArray(value.edges)
    || typeof value.truncated !== 'boolean') return { ok: false, error: INVALID_RESPONSE }

  const nodes = value.nodes.map(parseNode)
  const edges = value.edges.map(parseEdge)
  if (nodes.some(node => node === undefined) || edges.some(edge => edge === undefined)) {
    return { ok: false, error: INVALID_RESPONSE }
  }
  return {
    ok: true,
    corpus: value.corpus,
    revision: value.revision,
    builtAt: value.builtAt,
    referenceOnly: true,
    totalNodes: value.totalNodes,
    totalEdges: value.totalEdges,
    nodes: nodes as KnowledgeGraphNode[],
    edges: edges as KnowledgeGraphEdge[],
    truncated: value.truncated,
    ...(Array.isArray(value.droppedNodeIds) && value.droppedNodeIds.every(requiredString)
      ? { droppedNodeIds: value.droppedNodeIds }
      : {}),
    ...(nonNegativeInteger(value.droppedEdgeCount) ? { droppedEdgeCount: value.droppedEdgeCount } : {}),
  }
}
