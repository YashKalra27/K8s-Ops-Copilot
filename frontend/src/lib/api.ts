// Thin typed client for the FastAPI backend. In dev, Vite proxies /api to :8000;
// in production FastAPI serves this app at /ui and the API from the same origin.
const BASE = import.meta.env.DEV ? "/api" : ""

export type TraceStep = {
  name: string
  layer: string | null
  status: "ok" | "hit" | "miss" | "skip" | "fallback" | "blocked" | "error" | string
  ms: number
  detail: Record<string, unknown>
}

export type ChunkPreview = { text: string; source: string; score: number }

export type ResponseMetadata = {
  route: "rag" | "sql" | "hybrid" | string
  retrieved_chunks: ChunkPreview[]
  cache_hit: boolean
  reflection_iterations: number
  reflection_score: number | null
  refined_question: string | null
  crag_score: number | null
  crag_label: string | null
  used_web_fallback: boolean
  sql: string | null
  sql_rows: Record<string, unknown>[]
  trace: TraceStep[]
  total_ms: number | null
  /** Follow-ups: the self-contained question that was actually searched. */
  standalone_question?: string | null
}

export type ChatResponse = {
  answer: string
  sources: string[]
  confidence: number
  pending_sql: { sql: string; query_id: string; explanation: string } | null
  cache_hit: boolean
  cost_saved: string
  metadata: ResponseMetadata
  conversation_id?: string | null
  message_id?: string | null
}

export type ConversationSummary = { id: string; title: string; created_at: string; updated_at: string; message_count: number }

export type StoredMessage = {
  id: string
  role: "user" | "assistant"
  content: string
  /** Assistant: the full ChatResponse, or {error} when a layer blocked it. */
  metadata: Partial<ChatResponse> & { error?: { status: number; message: string; trace: TraceStep[] } }
  created_at: string
}

export type Conversation = { id: string; title: string; created_at: string; updated_at: string; messages: StoredMessage[] }

export type QueryFlags = {
  search_mode: "dense" | "sparse" | "hybrid"
  enable_rerank: boolean
  enable_hyde: boolean
  enable_crag: boolean
  enable_self_reflective: boolean
  top_k: number
  bypass_cache: boolean
}

export type Session = { token: string; username: string; is_admin: boolean }

export type Health = {
  status: "ok" | "degraded"
  postgres: boolean
  qdrant: boolean
  redis: boolean
  llm: boolean
  tavily: boolean
  details: Record<string, string>
  config: Record<string, string>
}

export type CacheTier = { hits: number; misses: number; sets: number; hit_rate: number }
export type CacheStats = Record<"embedding" | "rag" | "sql_gen" | "sql_result" | "intent_router", CacheTier>

export type Corpus = {
  total_chunks: number
  total_sources: number
  sources: { source: string; chunks: number; corpus: "signal" | "noise" | "upload" | "unknown" }[]
}

export type Me = { username: string; is_admin: boolean; token_budget: { used: number; limit: number; remaining: number } }

/** An error that knows which pipeline layer stopped the request. */
export class ApiError extends Error {
  status: number
  trace: TraceStep[]
  /** Set when the turn was saved to a conversation before it was stopped. */
  conversationId: string | null
  constructor(status: number, message: string, trace: TraceStep[] = [], conversationId: string | null = null) {
    super(message)
    this.status = status
    this.trace = trace
    this.conversationId = conversationId
  }
}

function describeValidation(detail: unknown): string {
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: string } | undefined
    return (first?.msg ?? "Invalid request").replace(/^Value error, /, "")
  }
  return "Invalid request"
}

async function request<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (init.token) headers.set("Authorization", `Bearer ${init.token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set("Content-Type", "application/json")

  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, { ...init, headers })
  } catch {
    throw new ApiError(0, "The API is not reachable. Start it with `make api` and try again.")
  }

  const text = await res.text()
  const body = text ? (JSON.parse(text) as unknown) : null
  if (!res.ok) {
    const detail = (body as { detail?: unknown } | null)?.detail
    if (res.status === 422) {
      // L1 (schema + regex) rejects before the handler runs, so there is no server trace.
      throw new ApiError(422, describeValidation(detail), [
        { name: "Schema + injection regex", layer: "L1", status: "blocked", ms: 0, detail: {} },
      ])
    }
    if (detail && typeof detail === "object" && "message" in detail) {
      const d = detail as { message: string; trace?: TraceStep[] }
      throw new ApiError(res.status, d.message, d.trace ?? [])
    }
    throw new ApiError(res.status, typeof detail === "string" ? detail : res.statusText)
  }
  return body as T
}

export type StreamHandlers = {
  /** A pipeline stage started (name matches TraceStep.name). */
  onBegin?: (stage: { name: string; layer: string | null }) => void
  /** A pipeline stage finished. */
  onStep?: (step: TraceStep) => void
}

/** POST /query/stream: the same pipeline as /query, but each stage is pushed to the
 *  browser as it starts and finishes (Server-Sent Events). EventSource cannot send a
 *  POST with an Authorization header, so the stream is read from fetch directly. */
async function queryStream(
  token: string,
  question: string,
  flags: QueryFlags,
  handlers: StreamHandlers,
  conversationId: string | null = null,
): Promise<ChatResponse> {
  let res: Response
  try {
    res = await fetch(`${BASE}/query/stream`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ question, ...flags, conversation_id: conversationId }),
    })
  } catch {
    throw new ApiError(0, "The API is not reachable. Start it with `make up` and try again.")
  }
  if (!res.ok || !res.body) {
    // Validation (L1) and auth failures happen before streaming starts.
    const body = (await res.json().catch(() => null)) as { detail?: unknown } | null
    if (res.status === 422) {
      throw new ApiError(422, describeValidation(body?.detail), [
        { name: "Schema + injection regex", layer: "L1", status: "blocked", ms: 0, detail: {} },
      ])
    }
    const d = body?.detail
    if (d && typeof d === "object" && "message" in d) {
      const e = d as { message: string; trace?: TraceStep[]; conversation_id?: string }
      throw new ApiError(res.status, e.message, e.trace ?? [], e.conversation_id ?? null)
    }
    throw new ApiError(res.status, typeof d === "string" ? d : res.statusText)
  }

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += value
    let cut: number
    while ((cut = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      let event = "message"
      let data = ""
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7)
        else if (line.startsWith("data: ")) data += line.slice(6)
      }
      if (!data) continue // keep-alive comment
      const payload = JSON.parse(data)
      if (event === "begin") handlers.onBegin?.(payload)
      else if (event === "step") handlers.onStep?.(payload as TraceStep)
      else if (event === "result") return payload as ChatResponse
      else if (event === "error") {
        const e = payload as { status: number; message: string; trace?: TraceStep[]; conversation_id?: string }
        throw new ApiError(e.status, e.message, e.trace ?? [], e.conversation_id ?? null)
      }
    }
  }
  throw new ApiError(0, "The stream ended before an answer arrived.")
}

export const api = {
  queryStream,
  login: (username: string, password: string) =>
    request<Session>("/auth/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  me: (token: string) => request<Me>("/auth/me", { token }),
  query: (token: string, question: string, flags: QueryFlags) =>
    request<ChatResponse>("/query", { method: "POST", token, body: JSON.stringify({ question, ...flags }) }),
  approve: (token: string, query_id: string, approved: boolean) =>
    request<ChatResponse>("/query/sql/execute", {
      method: "POST",
      token,
      body: JSON.stringify({ query_id, approved }),
    }),
  conversations: (token: string) => request<{ conversations: ConversationSummary[] }>("/conversations", { token }),
  conversation: (token: string, id: string) => request<Conversation>(`/conversations/${id}`, { token }),
  renameConversation: (token: string, id: string, title: string) =>
    request<{ status: string }>(`/conversations/${id}`, { method: "PATCH", token, body: JSON.stringify({ title }) }),
  deleteConversation: (token: string, id: string) =>
    request<{ status: string }>(`/conversations/${id}`, { method: "DELETE", token }),
  health: () => request<Health>("/admin/health"),
  cacheStats: (token: string) => request<CacheStats>("/admin/cache/stats", { token }),
  clearCache: (token: string) => request<{ cleared: string[] }>("/admin/cache/clear", { method: "POST", token }),
  documents: (token: string) => request<Corpus>("/documents", { token }),
  upload: (token: string, file: File) => {
    const form = new FormData()
    form.append("file", file)
    return request<{ status: string; source?: string; chunks?: number }>("/documents/upload", {
      method: "POST",
      token,
      body: form,
    })
  },
}
