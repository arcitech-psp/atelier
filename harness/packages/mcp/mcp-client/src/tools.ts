/**
 * Tool bridge: discovers MCP tools, registers them on the harness ToolRuntime
 * under deterministic server-qualified public names, and handles re-sync when
 * the server's tool list changes.
 *
 * Naming contract (see the mcp-client Agent Note "Naming invariants"): every MCP tool
 * has the stable identity `(serverName, rawName)`; the model-facing public name
 * is `mcp__<serverName>__<rawName>`, normalized to the DeepSeek function-name
 * constraints. The raw name is only ever sent on the wire (`tools/call`); the
 * public name is never parsed to recover it.
 *
 * @module
 */

import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import type { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { ListToolsResultSchema } from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import { isImageAdmissionError } from '@deepseek-ai/dsh-attachment'
import type {
  AttachmentStore,
  ImageAttachmentLimits,
  ImageAttachmentRef,
  ImageMediaType,
  SaveImageAttachment,
} from '@deepseek-ai/dsh-attachment'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { ToolDefinition, ToolExecution, ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import { assertSupportedJsonSchema } from '@deepseek-ai/dsh-tools'
import type { JsonSchemaNode, JsonValue } from '@deepseek-ai/dsh-tools'

/** Resolved options relevant to tool bridging. */
export interface ToolBridgeOptions {
  /** Whether a registry conflict is contained or rejects this synchronization. */
  registrationFailure: 'contain' | 'throw'
  serverName: string
  toolCallTimeoutMs: number
}

/** State for one sync generation: the current set of disposers keyed by public name. */
export type ToolDisposers = Map<string, () => void>

/** Canonical MCP result exposed to PTC mode without discarding protocol blocks. */
export type McpResult<Structured extends JsonValue = JsonValue> = {
  content: JsonValue[]
  structuredContent?: Structured
  /** Full-size durable images reserved for UI presentation, outside model content. */
  displayImages?: ImageAttachmentRef[]
}

/**
 * DeepSeek function-name contract: at most 64 characters. Wire-protocol
 * constant, not configuration.
 */
const MAX_PUBLIC_NAME_LENGTH = 64

/** DeepSeek function-name contract: only `[A-Za-z0-9_-]` is allowed. */
const INVALID_NAME_CHARS = /[^A-Za-z0-9_-]/g

/** Hex chars of the SHA-256 identity hash appended on lossy normalization. */
const HASH_LENGTH = 12

/** Raw result record: the bridge owns JSON-value validation after transport. */
const RawCallToolResultSchema = z.record(z.string(), z.unknown())

/** Raster formats supported by the durable attachment vocabulary. */
const IMAGE_MEDIA_TYPES: readonly ImageMediaType[] = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
]

/** Canonical RFC 4648 base64, excluding whitespace and URL-safe aliases. */
const CANONICAL_BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/

/** Maximum text characters admitted to whole-result JSON parsing for embedded-image projection. */
const MAX_EMBEDDED_IMAGE_JSON_PARSE_CHARS = 32 * 1024 * 1024

/** Absolute encoded-string ceiling before route-specific image admission. */
const MAX_UNADMITTED_IMAGE_BASE64_CHARS = 32 * 1024 * 1024

/** Model-facing replacement for an image-like JSON result too large to parse safely. */
const OVERSIZED_EMBEDDED_IMAGE_DIAGNOSTIC = '[embedded image unavailable: result exceeds the safe JSON projection limit; raw image data remains available to programmatic callers]'

/** List without mutating the SDK's per-page output-validator cache. */
function listToolsUncached(client: Client, cursor?: string) {
  return client.request(
    { method: 'tools/list', ...cursor === undefined ? {} : { params: { cursor } } },
    ListToolsResultSchema,
  )
}

/** Call without the SDK pre-validating an output schema the bridge may not support. */
function callToolUncached(
  client: Client,
  rawName: string,
  args: Record<string, unknown>,
  exec: ToolExecution,
  opts: ToolBridgeOptions,
) {
  return client.request(
    { method: 'tools/call', params: { name: rawName, arguments: args } },
    RawCallToolResultSchema,
    {
      signal: exec.signal,
      timeout: opts.toolCallTimeoutMs,
    },
  )
}

/**
 * Derive the model-facing public name for one MCP tool.
 *
 * Deterministic pure function of `(serverName, rawName)`: the clean case is
 * `mcp__<serverName>__<rawName>` verbatim. When character replacement or
 * truncation to the DeepSeek function-name contract (64 chars,
 * `[A-Za-z0-9_-]`) changes the name, a 12-hex-char SHA-256 hash of the
 * identity is appended so distinct MCP identities never collapse into the
 * same public name.
 *
 * @param serverName - Stable local namespace from plugin config.
 * @param rawName - The MCP server's own tool name.
 * @returns The globally unique, model-facing ToolRuntime name.
 */
export function publicToolName(serverName: string, rawName: string): string {
  const joined = `mcp__${serverName}__${rawName}`
  const normalized = joined.replace(INVALID_NAME_CHARS, '_')
  if (normalized === joined && normalized.length <= MAX_PUBLIC_NAME_LENGTH) return normalized
  const hash = createHash('sha256').update(`${serverName}\0${rawName}`).digest('hex').slice(0, HASH_LENGTH)
  return `${normalized.slice(0, MAX_PUBLIC_NAME_LENGTH - HASH_LENGTH - 1)}_${hash}`
}

/**
 * Sync the MCP server's tool list into the harness ToolRuntime.
 *
 * Two phases keep the swap safe:
 *
 * 1. Fetch: drain uncached `tools/list` pagination and build the full next
 *    generation of `ToolDefinition`s under public names. Any failure here
 *    (network error, duplicate raw name in the server's list) rejects and
 *    leaves the previous generation registered untouched.
 * 2. Swap: dispose the previous generation, register the new one. A registry
 *    conflict here can only mean a foreign registration squats on this
 *    server's `mcp__<serverName>__` namespace — the partial generation is
 *    rolled back (zero tools from this server) and logged. Initial strict
 *    synchronization may propagate the conflict so its parent transaction
 *    rejects; ordinary clients and later re-syncs return an empty map.
 *
 * @param client - Connected MCP Client instance used to list and call tools.
 * @param ctx - Cordis context providing the `tools` service for registration.
 * @param opts - Bridge options: server namespace and per-call timeout.
 * @param previous - Disposer map from the prior sync generation; disposed
 *   during the swap phase (only after the fetch phase succeeded).
 * @returns A map of registered public tool names to their unregister
 *   disposers — the exact set of live registrations owned by this server.
 */
export async function syncTools(
  client: Client,
  ctx: Context,
  opts: ToolBridgeOptions,
  previous: ToolDisposers,
): Promise<ToolDisposers> {
  // Phase 1: fetch and build the next generation without touching the registry.
  const definitions = new Map<string, ToolDefinition>()
  let cursor: string | undefined
  do {
    const response = await listToolsUncached(client, cursor)
    for (const tool of response.tools) {
      const publicName = publicToolName(opts.serverName, tool.name)
      if (definitions.has(publicName)) {
        throw new Error(
          `mcp-client(${opts.serverName}): server listed tool "${tool.name}" more than once — invalid tool list`,
        )
      }
      definitions.set(publicName, createDefinition(
        client,
        ctx,
        publicName,
        tool.name,
        tool.description ?? '',
        tool.inputSchema,
        supportedOutputSchema(tool.outputSchema),
        tool.execution?.taskSupport === 'required',
        opts,
      ))
    }
    cursor = response.nextCursor
  } while (cursor)

  // Phase 2: swap generations.
  for (const dispose of previous.values()) dispose()
  const disposers: ToolDisposers = new Map()
  try {
    for (const [publicName, definition] of definitions) {
      disposers.set(publicName, ctx.tools.register(definition))
    }
  } catch (error) {
    // A conflict on an `mcp__<serverName>__`-qualified name means a foreign
    // registration occupies this server's namespace. Roll back so the model
    // sees either the full generation or none of it — never a partial set.
    for (const dispose of disposers.values()) dispose()
    ctx.logger.error(`mcp-client(${opts.serverName}): tool registration failed, no tools registered: ${String(error)}`)
    if (opts.registrationFailure === 'throw') throw error
    return new Map()
  }
  return disposers
}

/**
 * The shape we read from each MCP content block. Intentionally looser than the
 * SDK's `ContentBlock` type: we're at a network trust boundary (data arrives
 * from an external MCP server process via JSON-RPC), so fields that the SDK
 * declares required may be absent at runtime if the server is buggy.
 */
interface McpContentBlock {
  type: string
  text?: string
  mimeType?: string
  data?: string
  name?: string
  uri?: string
}

/** Async rich projection staged for one exact ToolRuntime execution. */
interface PreparedProjection {
  /** Canonical MCP value returned by execute before registry materialization. */
  value: McpResult
  /** Synchronous output.render projection expected before finalization. */
  fallback: ContentBlock[]
  /** Image-enriched or explicit-refusal projection prepared during execute. */
  content: ContentBlock[]
}

/** Stored UI originals and the bounded image blocks retained in model history. */
interface PreparedImages {
  readonly content: ContentBlock[]
  readonly displayImages: ImageAttachmentRef[]
}

/** Keep a supported advertised schema; unsupported MCP vocabulary falls back to JsonValue. */
function supportedOutputSchema(candidate: unknown): JsonSchemaNode | undefined {
  if (candidate === undefined) return undefined
  try {
    assertSupportedJsonSchema(candidate)
    return candidate
  } catch {
    return undefined
  }
}

/**
 * Build one generation-local tool definition and its execution-local rich projections.
 * @param client - connected MCP client used for calls.
 * @param ctx - plugin context carrying optional attachment and model services.
 * @param publicName - registry-qualified public tool name.
 * @param rawName - MCP wire tool name.
 * @param description - model-facing tool description.
 * @param parameters - MCP input schema.
 * @param structuredSchema - supported structured-output schema, when advertised.
 * @param taskRequired - whether this MCP tool requires unsupported task execution.
 * @param opts - bridge timeout and namespace options.
 * @returns a complete ToolRuntime definition.
 */
function createDefinition(
  client: Client,
  ctx: Context,
  publicName: string,
  rawName: string,
  description: string,
  parameters: Record<string, unknown>,
  structuredSchema: JsonSchemaNode | undefined,
  taskRequired: boolean,
  opts: ToolBridgeOptions,
): ToolDefinition {
  const projections = new WeakMap<ToolExecution, PreparedProjection>()
  return {
    name: publicName,
    description,
    parameters,
    output: createOutput(rawName, structuredSchema),
    execute: createExecutor(client, ctx, rawName, taskRequired, opts, projections),
    finalizeContent(exec: Readonly<ToolExecution>, result: Readonly<ToolExecutionResult>) {
      const projection = projections.get(exec)
      if (projection === undefined) return undefined
      projections.delete(exec)
      if (result.isError) return undefined
      if (!isDeepStrictEqual(result.value, projection.value)) return undefined
      if (!isDeepStrictEqual(result.content, projection.fallback)) return undefined
      return projection.content
    },
  }
}

/** Build the canonical result schema and existing Native text projection. */
function createOutput(rawName: string, structuredSchema: JsonSchemaNode | undefined): ToolDefinition['output'] {
  return {
    schema: {
      type: 'object',
      properties: {
        content: { type: 'array', items: {} },
        structuredContent: structuredSchema ?? {},
        displayImages: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              attachmentId: { type: 'string' },
              mediaType: { type: 'string' },
              bytes: { type: 'number' },
              width: { type: 'number' },
              height: { type: 'number' },
              name: { type: 'string' },
              originalDimensions: {
                type: 'object',
                properties: { width: { type: 'number' }, height: { type: 'number' } },
                required: ['width', 'height'],
                additionalProperties: false,
              },
            },
            required: ['attachmentId', 'mediaType', 'bytes', 'width', 'height'],
            additionalProperties: false,
          },
        },
      },
      required: structuredSchema === undefined ? ['content'] : ['content', 'structuredContent'],
      additionalProperties: false,
    },
    render(_args: unknown, value: JsonValue) {
      const result = value as unknown as McpResult
      return [{ type: 'text', text: extractText(result.content, rawName) }]
    },
    presentationMeta(_args: unknown, value: JsonValue) {
      const result = value as unknown as McpResult
      return result.displayImages === undefined ? {} : { images: result.displayImages as unknown as JsonValue }
    },
  }
}

/**
 * Create an execute function for one MCP tool. The executor closes over the
 * raw MCP tool name and sends an uncached `tools/call` request with it (never
 * the public name), with abort signal and timeout, then maps the result to
 * harness ContentBlocks. Owning the raw request prevents the SDK's internal
 * per-page schema cache from pre-validating a different contract.
 *
 * When the MCP server returns `isError: true`, the executor throws so that
 * the ToolRuntime's catch path produces an `isError` result for the model.
 */
function createExecutor(
  client: Client,
  ctx: Context,
  rawName: string,
  taskRequired: boolean,
  opts: ToolBridgeOptions,
  projections: WeakMap<ToolExecution, PreparedProjection>,
): ToolDefinition['execute'] {
  return async (args: unknown, exec: ToolExecution) => {
    if (taskRequired) {
      throw new Error(`Tool "${rawName}" requires task-based execution, which this bridge does not support`)
    }
    // The agent loop passes `JSON.parse(model_arguments)` which is usually an
    // object, but can be any JSON value if the model misbehaves (outputs a bare
    // string/number/null). Fallback to {} lets the MCP server produce a
    // specific "missing required param" error the model can learn from.
    const argsObj = (typeof args === 'object' && args !== null ? args : {}) as Record<string, unknown>
    const result = await callToolUncached(client, rawName, argsObj, exec, opts)

    // The SDK may return a legacy `toolResult` shape; normalize to content array.
    if (!Array.isArray(result.content)) {
      const rendered: unknown = 'toolResult' in result
        ? JSON.stringify(result.toolResult)
        : '(no output)'
      const text = typeof rendered === 'string' ? rendered : '(no output)'
      if (result.isError === true) throw new Error(text)
      return {
        content: [{ type: 'text', text }],
        ...result.structuredContent !== undefined
          ? { structuredContent: result.structuredContent as JsonValue }
          : {},
      }
    }

    // Trust boundary: the SDK's return type erases to `any[]` due to the
    // union of CallToolResult | CompatibilityCallToolResult; extractText
    // validates each element.
    const content = result.content as unknown as JsonValue[]
    // Unreal's editor bridge currently wraps CaptureViewport's PNG in a JSON
    // text block (`returnValue.image`) instead of returning an MCP image block.
    // Normalize that representation only for model-facing content; `value`
    // below remains the canonical raw MCP result for programmatic callers.
    const modelContent = normalizeEmbeddedImages(content)
    const text = extractText(content, rawName)

    // MCP isError → throw so ToolRuntime produces an isError result for the model.
    if (result.isError === true) {
      throw new Error(text)
    }

    const value: McpResult = {
      content,
      ...result.structuredContent !== undefined
        ? { structuredContent: result.structuredContent as JsonValue }
        : {},
    }
    if (containsImage(modelContent)) {
      const fallback: ContentBlock[] = [{ type: 'text', text: extractText(content, rawName) }]
      const projected = await prepareImageProjection(ctx, exec, modelContent, rawName)
      value.displayImages = projected.displayImages
      projections.set(exec, { value, fallback, content: projected.content })
    }
    return value
  }
}

/** Whether an untrusted MCP content array contains a declared image block. */
function containsImage(content: JsonValue[]): boolean {
  return content.some(value => isRecord(value) && value.type === 'image')
}

/** Marker used in the sanitized JSON text projection for an embedded image. */
const EMBEDDED_IMAGE_DATA_REDACTION = '[native image attachment emitted separately]'

/**
 * Convert an Unreal-style JSON text result containing `*.image.data` into
 * model-facing MCP image blocks while preserving all non-image metadata.
 *
 * The editor MCP currently serializes CaptureViewport as text JSON. Keeping
 * the raw base64 in that text causes a local model to spend its context on
 * pixels and can trigger spill/reasoning loops. This projection is deliberately
 * narrow: only an object stored under `image` (viewport) or `returnValue`
 * (asset thumbnail) with string `mimeType` and `data` fields is lifted. The canonical raw result is never
 * mutated.
 */
function normalizeEmbeddedImages(content: JsonValue[]): JsonValue[] {
  const normalized: JsonValue[] = []
  for (const value of content) {
    if (!isRecord(value) || value.type !== 'text' || typeof value.text !== 'string') {
      normalized.push(value)
      continue
    }
    const projection = normalizeEmbeddedImageText(value.text)
    if (projection === undefined) {
      normalized.push(value)
      continue
    }
    normalized.push({ type: 'text', text: projection.text })
    normalized.push(...projection.images as unknown as JsonValue[])
  }
  return normalized
}

interface EmbeddedImageTextProjection {
  text: string
  images: McpContentBlock[]
}

/** Parse one text block and lift any supported nested image object. */
function normalizeEmbeddedImageText(text: string): EmbeddedImageTextProjection | undefined {
  if (text.length > MAX_EMBEDDED_IMAGE_JSON_PARSE_CHARS) {
    return oversizedJsonContainsEmbeddedImage(text)
      ? { text: OVERSIZED_EMBEDDED_IMAGE_DIAGNOSTIC, images: [] }
      : undefined
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return undefined
  }
  if (parsed === null || typeof parsed !== 'object') return undefined

  const images: McpContentBlock[] = []
  const sanitized = redactEmbeddedImages(parsed as JsonValue, images)
  if (images.length === 0) return undefined
  return { text: JSON.stringify(sanitized), images }
}

/** Find an unescaped JSON string terminator without allocating its contents. */
function jsonStringEnd(text: string, start: number): number | undefined {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === '\\') {
      index += 1
      continue
    }
    if (text[index] === '"') return index
  }
  return undefined
}

/** Skip JSON whitespace from one character offset. */
function skipJsonWhitespace(text: string, start: number): number {
  let index = start
  while (index < text.length) {
    const code = text.charCodeAt(index)
    if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) break
    index += 1
  }
  return index
}

/** Compare one bounded JSON string token with a property name, including escaped spellings. */
function jsonStringEquals(text: string, start: number, end: number, expected: string): boolean {
  const rawLength = end - start - 1
  if (rawLength === expected.length && text.startsWith(expected, start + 1)) return true
  if (rawLength > expected.length * 6 || !text.slice(start + 1, end).includes('\\')) return false
  try {
    return JSON.parse(text.slice(start, end + 1)) === expected
  } catch {
    return false
  }
}

/** Whether one object value has top-level string `mimeType` and `data` properties. */
function imageObjectHasStringFields(text: string, objectStart: number): boolean {
  let depth = 1
  let hasMediaType = false
  let hasData = false
  for (let index = objectStart + 1; index < text.length; index += 1) {
    const character = text[index]
    if (character === '"') {
      const end = jsonStringEnd(text, index)
      if (end === undefined) return false
      if (depth === 1) {
        const colon = skipJsonWhitespace(text, end + 1)
        const valueStart = skipJsonWhitespace(text, colon + 1)
        if (text[colon] === ':' && text[valueStart] === '"') {
          if (jsonStringEquals(text, index, end, 'mimeType')) hasMediaType = true
          if (jsonStringEquals(text, index, end, 'data')) hasData = true
          if (hasMediaType && hasData) return true
          const valueEnd = jsonStringEnd(text, valueStart)
          if (valueEnd === undefined) return false
          index = valueEnd
          continue
        }
      }
      index = end
      continue
    }
    if (character === '{') depth += 1
    if (character === '}') {
      depth -= 1
      if (depth === 0) return false
    }
  }
  return false
}

/**
 * Detect the exact embedded-image object form without parsing or retaining a
 * huge JSON value. Ordinary large text and JSON without that form pass through.
 */
function oversizedJsonContainsEmbeddedImage(text: string): boolean {
  const first = skipJsonWhitespace(text, 0)
  if (text[first] !== '{' && text[first] !== '[') return false
  for (let index = first; index < text.length; index += 1) {
    if (text[index] !== '"') continue
    const end = jsonStringEnd(text, index)
    if (end === undefined) return false
    if (jsonStringEquals(text, index, end, 'image') || jsonStringEquals(text, index, end, 'returnValue')) {
      const colon = skipJsonWhitespace(text, end + 1)
      const objectStart = skipJsonWhitespace(text, colon + 1)
      if (text[colon] === ':' && text[objectStart] === '{'
        && imageObjectHasStringFields(text, objectStart)) return true
    }
    index = end
  }
  return false
}

/** Recursively redact nested image bytes and collect the image blocks. */
function redactEmbeddedImages(
  value: JsonValue,
  images: McpContentBlock[],
  propertyName?: string,
): JsonValue {
  if (Array.isArray(value)) {
    return value.map(item => redactEmbeddedImages(item, images))
  }
  if (!isRecord(value)) return value
  if ((propertyName === 'image' || propertyName === 'returnValue')
    && typeof value.mimeType === 'string' && typeof value.data === 'string') {
    images.push({ type: 'image', mimeType: value.mimeType, data: value.data })
    return { ...value, data: EMBEDDED_IMAGE_DATA_REDACTION }
  }

  const sanitized: Record<string, JsonValue> = {}
  for (const [key, child] of Object.entries(value)) {
    sanitized[key] = redactEmbeddedImages(child, images, key)
  }
  return sanitized
}

/** Narrow one JSON value to a string-keyed object. */
function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Narrow a declared MIME string to the durable image vocabulary. */
function isImageMediaType(value: string): value is ImageMediaType {
  return IMAGE_MEDIA_TYPES.includes(value as ImageMediaType)
}

interface EncodedImagePlan {
  data: string
  decodedBytes: number
  mediaType: ImageMediaType
}

/** Map one RFC 4648 base64 character to its six-bit value. */
function base64Sextet(character: string): number {
  const code = character.charCodeAt(0)
  if (code >= 0x41 && code <= 0x5a) return code - 0x41
  if (code >= 0x61 && code <= 0x7a) return code - 0x61 + 26
  if (code >= 0x30 && code <= 0x39) return code - 0x30 + 52
  return character === '+' ? 62 : 63
}

/** Whether a padded base64 string leaves every unused low bit zero. */
function hasCanonicalBase64Padding(data: string): boolean {
  if (data.endsWith('==')) return (base64Sextet(data[data.length - 3] as string) & 0x0f) === 0
  if (data.endsWith('=')) return (base64Sextet(data[data.length - 2] as string) & 0x03) === 0
  return true
}

/** Validate one encoded image string and size it without decoding. */
function inspectEncodedImage(block: McpContentBlock): EncodedImagePlan {
  if (block.mimeType === undefined || !isImageMediaType(block.mimeType)) {
    throw new Error('the declared media type is not PNG, JPEG, WebP, or GIF')
  }
  if (block.data === undefined) {
    throw new Error('the image data is not canonical base64')
  }
  if (block.data.length > MAX_UNADMITTED_IMAGE_BASE64_CHARS) {
    throw new Error('the image data exceeds the MCP bridge encoded-string limit before decoding')
  }
  if (!CANONICAL_BASE64.test(block.data) || !hasCanonicalBase64Padding(block.data)) {
    throw new Error('the image data is not canonical base64')
  }
  const padding = block.data.endsWith('==') ? 2 : block.data.endsWith('=') ? 1 : 0
  const decodedBytes = block.data.length / 4 * 3 - padding
  return { data: block.data, decodedBytes, mediaType: block.mimeType }
}

/** Validate one preflighted image against deployment policy without decoding it. */
function validateEncodedImagePlan(plan: EncodedImagePlan, limits: ImageAttachmentLimits): void {
  if (!limits.mediaTypes.includes(plan.mediaType)) {
    throw new Error(`image type ${plan.mediaType} is not accepted by this deployment`)
  }
  if (plan.decodedBytes > limits.maxImageBytes) {
    throw new Error('the image data exceeds the configured per-image byte limit before decoding')
  }
}

/** Decode one preflighted canonical image string. */
function decodeImage(plan: EncodedImagePlan): SaveImageAttachment {
  const data = Buffer.from(plan.data, 'base64')
  if (data.byteLength !== plan.decodedBytes || data.toString('base64') !== plan.data) {
    throw new Error('the image data is not canonical base64')
  }
  return { data, mediaType: plan.mediaType }
}

/** Resolve the durable attachment store for an image-bearing result. */
function resolveAttachmentStore(ctx: Context): AttachmentStore {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) throw new Error('no attachment store is mounted')
  return attachments
}

/** Verify that the active model route accepts images before adding a thumbnail to model history. */
async function verifyImageRoute(ctx: Context, exec: ToolExecution): Promise<void> {
  const routed = exec.agent?.session.requestHeader()?.config
  const provider = routed?.provider ?? exec.agent?.options.provider
  const model = routed?.model ?? exec.agent?.options.model
  const llm = ctx.get('llm')
  if (provider === undefined || model === undefined || llm === undefined) {
    throw new Error('the current model route could not be resolved')
  }
  let info: Awaited<ReturnType<typeof llm.resolveModelInfo>>
  try {
    info = await llm.resolveModelInfo(provider, model, exec.signal)
  } catch {
    throw new Error('the current model route could not be verified')
  }
  if (info.inputModalities === undefined || !info.inputModalities.includes('image')) {
    throw new Error(`model "${model}" does not declare image input`)
  }
  if (exec.signal.aborted) throw new Error('the tool call was canceled before image storage')
}

/** Stable diagnostic text for an image block that was not admitted. */
function imageDiagnostic(block: McpContentBlock, reason: string): string {
  const mediaType = block.mimeType ?? 'unknown media type'
  return `[image unavailable: ${mediaType}; ${reason}; raw image data remains available to programmatic callers]`
}

/**
 * Decode, preflight, and durably save one MCP result's ordered image batch.
 * Any refusal projects every image as text while retaining the canonical raw
 * value for programmatic callers.
 */
async function prepareImageProjection(
  ctx: Context,
  exec: ToolExecution,
  content: JsonValue[],
  toolName: string,
): Promise<PreparedImages> {
  const imageIndexes: number[] = []
  const plans: EncodedImagePlan[] = []
  const validationErrors = new Map<number, string>()
  for (const [index, value] of content.entries()) {
    if (!isRecord(value) || value.type !== 'image') continue
    imageIndexes.push(index)
    try {
      plans.push(inspectEncodedImage(value as unknown as McpContentBlock))
    } catch (error: unknown) {
      // inspectEncodedImage owns every throw above and always produces Error.
      validationErrors.set(index, (error as Error).message)
    }
  }
  if (validationErrors.size > 0) {
    return { content: projectContent(content, toolName, (block, index) => ({
      type: 'text',
      text: imageDiagnostic(
        block,
        validationErrors.get(index) ?? 'another image in the same result was invalid',
      ),
    })), displayImages: [] }
  }

  let attachments: AttachmentStore
  try {
    attachments = resolveAttachmentStore(ctx)
  } catch (error: unknown) {
    // resolveAttachmentStore throws Error only.
    const reason = (error as Error).message
    return {
      content: projectContent(content, toolName, block => ({ type: 'text', text: imageDiagnostic(block, reason) })),
      displayImages: [],
    }
  }

  const { imageLimits } = attachments
  if (imageIndexes.length > imageLimits.maxImagesPerMessage) {
    const reason = 'image admission rejected the result: image batch exceeds the configured image-count limit'
    return {
      content: projectContent(content, toolName, block => ({ type: 'text', text: imageDiagnostic(block, reason) })),
      displayImages: [],
    }
  }

  for (const [offset, index] of imageIndexes.entries()) {
    try {
      validateEncodedImagePlan(plans[offset] as EncodedImagePlan, imageLimits)
    } catch (error: unknown) {
      // validateEncodedImagePlan owns every throw above and always produces Error.
      validationErrors.set(index, (error as Error).message)
    }
  }
  if (validationErrors.size > 0) {
    return { content: projectContent(content, toolName, (block, index) => ({
      type: 'text',
      text: imageDiagnostic(
        block,
        validationErrors.get(index) ?? 'another image in the same result was invalid',
      ),
    })), displayImages: [] }
  }

  const totalBytes = plans.reduce((sum, plan) => sum + plan.decodedBytes, 0)
  if (totalBytes > imageLimits.maxMessageImageBytes) {
    const reason = 'image admission rejected the result: image batch exceeds the configured aggregate image-byte limit'
    return {
      content: projectContent(content, toolName, block => ({ type: 'text', text: imageDiagnostic(block, reason) })),
      displayImages: [],
    }
  }

  const decoded = plans.map(decodeImage)
  let displayImages: ImageAttachmentRef[] = []

  try {
    displayImages = [...await attachments.saveImages(decoded)]
    let imageRouteError: string | undefined
    try {
      await verifyImageRoute(ctx, exec)
    } catch (error: unknown) {
      imageRouteError = (error as Error).message
    }
    if (imageRouteError !== undefined) {
      return {
        content: projectContent(content, toolName, block => ({
          type: 'text',
          text: imageDiagnostic(block, `${imageRouteError}; the stored original remains available in the chat`),
        })),
        displayImages,
      }
    }

    const modelRefs: ImageAttachmentRef[] = []
    for (const ref of displayImages) {
      const request = await attachments.readImageRequest(ref, {
        maxPixels: 512 * 512,
        maxBytes: 256 * 1024,
      }, exec.signal)
      modelRefs.push(await attachments.saveImage({ data: request.data, mediaType: request.mediaType }))
    }
    const byIndex = new Map(imageIndexes.map((index, offset) => [index, modelRefs[offset] as ImageAttachmentRef] as const))
    return {
      content: projectContent(content, toolName, (_block, index) => ({
        type: 'image',
        attachment: byIndex.get(index) as ImageAttachmentRef,
      })),
      displayImages,
    }
  } catch (error: unknown) {
    const reason = isImageAdmissionError(error)
      ? `image admission rejected the result: ${error.message}`
      : 'durable image storage rejected the result'
    return {
      content: projectContent(content, toolName, block => ({
        type: 'text',
        text: imageDiagnostic(block, reason),
      })),
      displayImages,
    }
  }
}

/**
 * Extract text from an MCP content array into a single string.
 * - text blocks: join with '\n'
 * - image/audio/resource blocks: replaced with a placeholder
 *
 * Defensive: fields that the MCP spec declares required (mimeType, text) are
 * guarded with fallbacks because this is a network trust boundary.
 */
function extractText(mcpContent: JsonValue[], toolName: string): string {
  const content = projectContent(normalizeEmbeddedImages(mcpContent), toolName)
  // The default image projector below also returns text, so this local call
  // cannot produce a core image block.
  return content.map(block => (block as Extract<ContentBlock, { type: 'text' }>).text).join('\n')
}

/**
 * Project ordered MCP blocks into the core content vocabulary.
 * Text-like runs are newline-coalesced; admitted images split those runs at
 * their original position.
 */
function projectContent(
  mcpContent: JsonValue[],
  toolName: string,
  image: (block: McpContentBlock, index: number) => ContentBlock = block => ({
    type: 'text',
    text: imageDiagnostic(block, 'this result was not admitted to durable model context'),
  }),
): ContentBlock[] {
  const projected: ContentBlock[] = []
  const text: string[] = []
  const flushText = (): void => {
    if (text.length === 0) return
    projected.push({ type: 'text', text: text.splice(0).join('\n') })
  }

  for (const [index, value] of mcpContent.entries()) {
    if (!isRecord(value)) {
      text.push('[unsupported MCP content block: expected an object]')
      continue
    }
    const block = value as unknown as McpContentBlock
    switch (block.type) {
      case 'text':
        if (block.text !== undefined) text.push(block.text)
        break
      case 'image':
        flushText()
        projected.push(image(block, index))
        break
      case 'resource_link':
        if (block.name === undefined || block.uri === undefined) {
          text.push('[resource link unavailable: the MCP block is missing its name or URI]')
        } else {
          text.push(`Resource link: ${block.name} (${block.uri})`)
        }
        break
      case 'audio':
        text.push(`[audio result unsupported: ${block.mimeType ?? 'unknown media type'}; raw audio data remains available to programmatic callers]`)
        break
      case 'resource':
        text.push('[embedded resource unsupported; raw resource data remains available to programmatic callers]')
        break
      default:
        text.push(`[unsupported MCP content type: ${block.type}]`)
    }
  }
  flushText()
  return projected.length > 0
    ? projected
    : [{ type: 'text', text: `(${toolName} returned no model-visible content)` }]
}
