import { useMemo, useState } from "react"
import { ChatsCircleIcon, DotsThreeIcon, MagnifyingGlassIcon, NotePencilIcon, PencilSimpleIcon, TrashIcon } from "@phosphor-icons/react"

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import type { ConversationSummary } from "@/lib/api"
import { cn } from "@/lib/utils"

type Props = {
  conversations: ConversationSummary[] | null
  activeId: string | null
  busy: boolean
  onNew: () => void
  onOpen: (id: string) => void
  onRename: (id: string, title: string) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

function groupOf(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const days = Math.floor((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return "Previous 7 days"
  return "Older"
}

export function ChatSidebar({ conversations, activeId, busy, onNew, onOpen, onRename, onDelete }: Props) {
  const [query, setQuery] = useState("")
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null)
  const [deleting, setDeleting] = useState<ConversationSummary | null>(null)

  const groups = useMemo(() => {
    const filtered = (conversations ?? []).filter((c) => c.title.toLowerCase().includes(query.toLowerCase()))
    const out = new Map<string, ConversationSummary[]>()
    for (const c of filtered) {
      const g = groupOf(c.updated_at)
      out.set(g, [...(out.get(g) ?? []), c])
    }
    return [...out.entries()]
  }, [conversations, query])

  const saveRename = async () => {
    if (!editing) return
    const title = editing.title.trim()
    const id = editing.id
    setEditing(null)
    if (title) await onRename(id, title)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 p-3">
      <Button onClick={onNew} variant="outline" className="h-10 justify-start gap-2.5 rounded-xl bg-background/60 text-sm" disabled={busy}>
        <NotePencilIcon data-icon="inline-start" />
        New chat
      </Button>
      <div className="relative">
        <MagnifyingGlassIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search chats" aria-label="Search chats" className="h-9 rounded-xl pl-9" />
      </div>

      <nav aria-label="Saved chats" className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1" data-lenis-prevent>
        {conversations === null ? (
          <div className="flex flex-col gap-2 pt-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-8 rounded-lg" />
            ))}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-4 pt-10 text-center text-sm text-muted-foreground">
            <ChatsCircleIcon className="size-8 opacity-60" weight="duotone" aria-hidden />
            <p>Your chats will appear here. Ask a question to start one.</p>
          </div>
        ) : groups.length === 0 ? (
          <p className="px-2 pt-4 text-sm text-muted-foreground">No chat matches “{query}”.</p>
        ) : (
          groups.map(([label, items]) => (
            <section key={label} className="pb-3">
              <h3 className="px-2 pt-2 pb-1 text-xs font-medium text-muted-foreground">{label}</h3>
              <ul className="flex flex-col gap-0.5">
                {items.map((c) => {
                  const active = c.id === activeId
                  return (
                    <li key={c.id} className="group/item relative">
                      {editing?.id === c.id ? (
                        <Input
                          autoFocus
                          value={editing.title}
                          aria-label="Chat name"
                          onChange={(e) => setEditing({ id: c.id, title: e.target.value })}
                          onBlur={() => void saveRename()}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") void saveRename()
                            if (e.key === "Escape") setEditing(null)
                          }}
                          className="h-8 rounded-lg text-sm"
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onOpen(c.id)}
                            aria-current={active ? "page" : undefined}
                            className={cn(
                              "flex h-8 w-full items-center rounded-lg pr-8 pl-2.5 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring",
                              active ? "bg-accent text-accent-foreground" : "text-foreground/85 hover:bg-muted",
                            )}
                            title={c.title}
                          >
                            <span className="truncate">{c.title}</span>
                          </button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                variant="ghost"
                                size="icon-xs"
                                aria-label={`Options for ${c.title}`}
                                className={cn(
                                  "absolute top-1/2 right-1 -translate-y-1/2 opacity-0 group-hover/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100",
                                  active && "opacity-100",
                                )}
                              >
                                <DotsThreeIcon weight="bold" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-40">
                              <DropdownMenuItem onSelect={() => setEditing({ id: c.id, title: c.title })}>
                                <PencilSimpleIcon /> Rename
                              </DropdownMenuItem>
                              <DropdownMenuItem variant="destructive" onSelect={() => setDeleting(c)}>
                                <TrashIcon /> Delete
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          ))
        )}
      </nav>
      <p className="px-2 text-xs leading-relaxed text-muted-foreground">
        Chats are saved to your account. Personal data is redacted before anything is stored.
      </p>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>“{deleting?.title}” and all its messages will be removed. This can’t be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              onClick={() => {
                if (deleting) void onDelete(deleting.id)
                setDeleting(null)
              }}
            >
              Delete chat
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
