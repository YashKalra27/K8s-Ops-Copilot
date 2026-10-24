import { useEffect, useRef, useState } from "react"
import { LayoutGroup, motion, useReducedMotion } from "motion/react"
import { ListIcon, NotePencilIcon } from "@phosphor-icons/react"

import { Button } from "@/components/ui/button"
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@/components/ui/message-scroller"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { useSession } from "@/lib/session"

import { Composer, SUGGESTIONS } from "./composer"
import { AssistantMessage, UserMessage } from "./messages"
import { ChatSidebar } from "./sidebar"
import { useChat } from "./use-chat"

const composerMotion = { layout: "position" as const, transition: { type: "spring" as const, bounce: 0.12, visualDuration: 0.45 } }

export function ChatView({ prefill, onPrefillUsed }: { prefill: string | null; onPrefillUsed: () => void }) {
  const chat = useChat()
  const { session } = useSession()
  const [draft, setDraft] = useState("")
  const [historyOpen, setHistoryOpen] = useState(false)
  const reduce = useReducedMotion()
  const input = useRef<HTMLTextAreaElement>(null)

  // "Open in Ask" from the How-it-works page: start a fresh chat with the question ready.
  useEffect(() => {
    if (!prefill) return
    chat.open(null)
    setDraft(prefill)
    onPrefillUsed()
    input.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill])

  const send = (text = draft) => {
    if (!text.trim() || chat.busy) return
    setDraft("")
    void chat.send(text)
  }

  const newChat = () => {
    chat.open(null)
    setDraft("")
    setHistoryOpen(false)
    requestAnimationFrame(() => input.current?.focus())
  }

  const empty = chat.turns.length === 0 && !chat.loadingConversation
  const firstName = session?.username.split("@")[0].replace(/[._-]/g, " ") ?? ""

  const sidebar = (
    <ChatSidebar
      conversations={chat.conversations}
      activeId={chat.activeId}
      busy={chat.busy}
      onNew={newChat}
      onOpen={(id) => {
        chat.open(id)
        setHistoryOpen(false)
      }}
      onRename={chat.rename}
      onDelete={chat.remove}
    />
  )

  return (
    <div className="grid h-[calc(100dvh-4rem)] min-h-0 lg:grid-cols-[17rem_minmax(0,1fr)]">
      <aside className="hidden min-h-0 border-r bg-card/30 lg:block" aria-label="Chat history">
        {sidebar}
      </aside>

      <section className="relative flex min-h-0 min-w-0 flex-col" aria-label="Chat">
        {/* Thin top bar: history drawer on small screens, the chat's title, new chat. */}
        <div className="flex h-12 shrink-0 items-center gap-2 px-3 md:px-5">
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open chat history">
                <ListIcon />
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[18rem] p-0" showCloseButton={false} data-lenis-prevent>
              <SheetHeader className="sr-only">
                <SheetTitle>Chat history</SheetTitle>
                <SheetDescription>Your saved conversations</SheetDescription>
              </SheetHeader>
              {sidebar}
            </SheetContent>
          </Sheet>
          <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-muted-foreground">
            {chat.active?.title ?? (chat.activeId ? "" : "New chat")}
          </h1>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={newChat} aria-label="New chat" disabled={chat.busy}>
            <NotePencilIcon />
          </Button>
        </div>

        <LayoutGroup>
          {empty ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-4 pb-10">
              <div className="flex w-full max-w-3xl flex-col items-center gap-7">
                <motion.div
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: "spring", bounce: 0, visualDuration: 0.5 }}
                  className="flex flex-col items-center gap-3 text-center"
                >
                  <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="size-11" />
                  <h2 className="text-3xl font-semibold tracking-tight text-balance md:text-4xl">
                    {firstName ? `What should we look into, ${firstName}?` : "What should we look into?"}
                  </h2>
                  <p className="max-w-[52ch] text-[15px] text-muted-foreground">
                    Ask about Kubernetes concepts, your incident data, or both. Follow-up questions remember the conversation.
                  </p>
                </motion.div>

                <motion.div layoutId="composer" {...composerMotion} className="w-full">
                  <Composer ref={input} value={draft} onChange={setDraft} onSend={() => send()} busy={chat.busy} flags={chat.flags} setFlags={chat.setFlags} />
                </motion.div>

                <ul className="grid w-full gap-2.5 sm:grid-cols-2" aria-label="Suggestions">
                  {SUGGESTIONS.map((s, i) => (
                    <motion.li
                      key={s.text}
                      initial={reduce ? false : { opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.08 + i * 0.05, type: "spring", bounce: 0, visualDuration: 0.4 }}
                    >
                      <button
                        type="button"
                        onClick={() => send(s.text)}
                        disabled={chat.busy}
                        className="group flex h-full w-full flex-col gap-1.5 rounded-2xl border bg-card/50 p-4 text-left transition-colors hover:border-primary/40 hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-50"
                      >
                        <span className="flex items-center gap-2 text-xs font-medium text-muted-foreground group-hover:text-primary">
                          <s.icon className="size-4" weight="duotone" aria-hidden />
                          {s.kind}
                        </span>
                        <span className="line-clamp-2 text-sm leading-snug">{s.text}</span>
                      </button>
                    </motion.li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <>
              <MessageScrollerProvider autoScroll>
                <MessageScroller className="flex-1">
                  <MessageScrollerViewport className="[mask-image:linear-gradient(to_bottom,transparent,black_1.5rem)]">
                    <MessageScrollerContent className="mx-auto w-full max-w-3xl gap-9 px-4 pt-4 pb-10 md:px-6">
                      {chat.loadingConversation && chat.turns.length === 0 ? (
                        <div className="flex flex-col gap-6 pt-6" aria-label="Loading conversation">
                          <Skeleton className="ml-auto h-10 w-2/5 rounded-3xl" />
                          <div className="flex flex-col gap-2.5">
                            <Skeleton className="h-4 w-11/12" />
                            <Skeleton className="h-4 w-4/5" />
                            <Skeleton className="h-4 w-3/5" />
                          </div>
                        </div>
                      ) : (
                        chat.turns.map((t) => (
                          <MessageScrollerItem key={t.id} messageId={t.id} scrollAnchor={t.role === "user"}>
                            {t.role === "user" ? (
                              <UserMessage content={t.content} />
                            ) : (
                              <AssistantMessage turn={t} onDecide={(queryId, ok) => void chat.decide(t.id, queryId, ok)} />
                            )}
                          </MessageScrollerItem>
                        ))
                      )}
                    </MessageScrollerContent>
                  </MessageScrollerViewport>
                  <MessageScrollerButton className="rounded-full shadow-md" />
                </MessageScroller>
              </MessageScrollerProvider>

              <div className="mx-auto w-full max-w-3xl shrink-0 px-4 pb-3 md:px-6">
                <motion.div layoutId="composer" {...composerMotion}>
                  <Composer
                    ref={input}
                    value={draft}
                    onChange={setDraft}
                    onSend={() => send()}
                    busy={chat.busy}
                    flags={chat.flags}
                    setFlags={chat.setFlags}
                    placeholder="Ask a follow-up"
                  />
                </motion.div>
                <p className="pt-2 text-center text-xs text-muted-foreground">
                  Answers come from the Kubernetes docs and the operations database. Check anything important.
                </p>
              </div>
            </>
          )}
        </LayoutGroup>
      </section>
    </div>
  )
}
