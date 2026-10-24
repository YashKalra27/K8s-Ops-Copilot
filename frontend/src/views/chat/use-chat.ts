import { useCallback, useEffect, useRef, useState } from "react"

import { ApiError, api, type ChatResponse, type ConversationSummary, type QueryFlags, type StoredMessage, type TraceStep } from "@/lib/api"
import { useSession } from "@/lib/session"

export type LiveState = { steps: TraceStep[]; current: { name: string; layer: string | null } | null; startedAt: number }

export type ChatTurn =
  | { id: string; role: "user"; content: string }
  | {
      id: string
      role: "assistant"
      content: string
      response?: ChatResponse
      error?: ApiError
      live?: LiveState
      approving?: boolean
      /** True for messages that arrived in this session (animate them); false for loaded history. */
      fresh?: boolean
    }

export const DEFAULT_FLAGS: QueryFlags = {
  search_mode: "hybrid",
  enable_rerank: true,
  enable_crag: true,
  enable_hyde: false,
  enable_self_reflective: false,
  top_k: 5,
  bypass_cache: false,
}

/** Conversation id from the URL: #ask/<id>. */
export function conversationFromHash(): string | null {
  const [view, id] = window.location.hash.replace("#", "").split("/")
  return view === "ask" && id ? id : null
}

function setHash(id: string | null) {
  const next = id ? `#ask/${id}` : "#ask"
  if (window.location.hash !== next) history.pushState(null, "", next)
}

function fromStored(m: StoredMessage): ChatTurn {
  if (m.role === "user") return { id: m.id, role: "user", content: m.content }
  const { error, ...rest } = m.metadata ?? {}
  if (error) return { id: m.id, role: "assistant", content: "", error: new ApiError(error.status, error.message, error.trace ?? []) }
  return { id: m.id, role: "assistant", content: m.content, response: rest as ChatResponse }
}

let tempId = 0
const nextId = (prefix: string) => `${prefix}-${Date.now()}-${tempId++}`

export function useChat() {
  const { session, signOut } = useSession()
  const token = session?.token ?? ""
  const [conversations, setConversations] = useState<ConversationSummary[] | null>(null)
  const [activeId, setActiveId] = useState<string | null>(conversationFromHash)
  const [turns, setTurns] = useState<ChatTurn[]>([])
  const [loadingConversation, setLoadingConversation] = useState(false)
  const [flags, setFlags] = useState<QueryFlags>(DEFAULT_FLAGS)
  const [busy, setBusy] = useState(false)
  // The conversation the in-flight request belongs to, so switching chats mid-run
  // doesn't paint the answer into the wrong thread.
  const inflight = useRef<string | null>(null)

  const refreshList = useCallback(() => {
    if (!token) return
    api
      .conversations(token)
      .then((r) => setConversations(r.conversations))
      .catch((e: ApiError) => {
        if (e.status === 401) signOut()
        setConversations((c) => c ?? [])
      })
  }, [token, signOut])

  useEffect(refreshList, [refreshList])

  // Load the selected conversation (on start, on sidebar click, and on back/forward).
  const open = useCallback(
    (id: string | null) => {
      setActiveId(id)
      setHash(id)
      if (!id) {
        setTurns([])
        return
      }
      if (inflight.current === id) return // already showing the live turn
      setLoadingConversation(true)
      api
        .conversation(token, id)
        .then((c) => setTurns(c.messages.map(fromStored)))
        .catch(() => {
          setTurns([])
          setActiveId(null)
          setHash(null)
        })
        .finally(() => setLoadingConversation(false))
    },
    [token],
  )

  useEffect(() => {
    if (activeId) open(activeId)
    const onNav = () => {
      const id = conversationFromHash()
      if (window.location.hash.startsWith("#ask")) open(id)
    }
    window.addEventListener("popstate", onNav)
    return () => window.removeEventListener("popstate", onNav)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const patchTurn = (id: string, patch: (t: Extract<ChatTurn, { role: "assistant" }>) => Partial<ChatTurn>) =>
    setTurns((all) => all.map((t) => (t.id === id && t.role === "assistant" ? ({ ...t, ...patch(t) } as ChatTurn) : t)))

  const send = useCallback(
    async (text: string) => {
      const question = text.trim()
      if (!question || !token || busy) return
      const convAtStart = activeId
      const userTurn: ChatTurn = { id: nextId("u"), role: "user", content: question }
      const botId = nextId("a")
      const botTurn: ChatTurn = { id: botId, role: "assistant", content: "", fresh: true, live: { steps: [], current: null, startedAt: Date.now() } }
      setTurns((all) => [...all, userTurn, botTurn])
      setBusy(true)
      inflight.current = convAtStart ?? "new"
      try {
        const data = await api.queryStream(
          token,
          question,
          flags,
          {
            onBegin: (stage) => patchTurn(botId, (t) => ({ live: t.live && { ...t.live, current: stage } })),
            onStep: (step) =>
              patchTurn(botId, (t) => ({
                live: t.live && { ...t.live, steps: [...t.live.steps, step], current: t.live.current?.name === step.name ? null : t.live.current },
              })),
          },
          convAtStart,
        )
        patchTurn(botId, () => ({ live: undefined, response: data, content: data.answer }))
        if (!convAtStart && data.conversation_id) {
          inflight.current = data.conversation_id
          setActiveId(data.conversation_id)
          setHash(data.conversation_id)
        }
      } catch (e) {
        const error = e instanceof ApiError ? e : new ApiError(0, String(e))
        if (error.status === 401) signOut()
        // The server's error carries the full trace up to the blocking layer; fall back to what streamed in.
        patchTurn(botId, (t) => ({
          live: undefined,
          error: new ApiError(error.status, error.message, error.trace.length ? error.trace : (t.live?.steps ?? []), error.conversationId),
        }))
        if (!convAtStart && error.conversationId) {
          setActiveId(error.conversationId)
          setHash(error.conversationId)
        }
      } finally {
        inflight.current = null
        setBusy(false)
        refreshList()
      }
    },
    [token, busy, activeId, flags, refreshList, signOut],
  )

  const decide = useCallback(
    async (turnId: string, queryId: string, approved: boolean) => {
      if (!token) return
      patchTurn(turnId, () => ({ approving: true }))
      try {
        const data = await api.approve(token, queryId, approved)
        patchTurn(turnId, (t) => ({
          approving: false,
          fresh: true,
          content: data.answer,
          // Keep the checks from the first half of the run, then the resume.
          response: { ...data, metadata: { ...data.metadata, trace: [...(t.response?.metadata.trace ?? []), ...data.metadata.trace] } },
        }))
      } catch (e) {
        const error = e instanceof ApiError ? e : new ApiError(0, String(e))
        patchTurn(turnId, () => ({ approving: false, error }))
      } finally {
        refreshList()
      }
    },
    [token, refreshList],
  )

  const rename = useCallback(
    async (id: string, title: string) => {
      await api.renameConversation(token, id, title)
      refreshList()
    },
    [token, refreshList],
  )

  const remove = useCallback(
    async (id: string) => {
      await api.deleteConversation(token, id)
      if (id === activeId) open(null)
      refreshList()
    },
    [token, activeId, open, refreshList],
  )

  const active = conversations?.find((c) => c.id === activeId) ?? null

  return { conversations, active, activeId, turns, loadingConversation, flags, setFlags, busy, send, decide, open, rename, remove }
}
