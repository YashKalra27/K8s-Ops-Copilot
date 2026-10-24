import {
  ArrowsClockwiseIcon,
  BracketsAngleIcon,
  ChatTextIcon,
  CoinsIcon,
  DatabaseIcon,
  EyeSlashIcon,
  FileCodeIcon,
  GaugeIcon,
  GlobeIcon,
  HandPalmIcon,
  KeyIcon,
  LightbulbIcon,
  LightningIcon,
  MagnifyingGlassIcon,
  ScalesIcon,
  ScissorsIcon,
  ShieldCheckIcon,
  ShieldWarningIcon,
  SignpostIcon,
  SortAscendingIcon,
  TableIcon,
  type Icon,
} from "@phosphor-icons/react"

export type Act = "check" | "route" | "find" | "answer"

export type Stage = {
  /** Matches TraceStep.name from the API. */
  name: string
  short: string
  act: Act
  layer: string
  icon: Icon
  plain: string
  analogy: string
  why: string
  code: string
  /** Present-tense line shown while this stage is running in the console. */
  doing?: string
}

export const ACTS: { id: Act; title: string; summary: string }[] = [
  {
    id: "check",
    title: "Check the question",
    summary: "Seven security layers decide whether the question is allowed in at all.",
  },
  {
    id: "route",
    title: "Decide where to look",
    summary: "A small AI call sorts the question: documents, the database, or both.",
  },
  {
    id: "find",
    title: "Find the facts",
    summary: "Search the documents, or write a database query that a human approves.",
  },
  {
    id: "answer",
    title: "Write and check the answer",
    summary: "The AI writes from the facts it was given, then the answer is checked again.",
  },
]

export const STAGES: Stage[] = [
  {
    name: "Schema + injection regex",
    short: "Shape check",
    act: "check",
    layer: "L1",
    icon: ShieldCheckIcon,
    plain:
      "Before anything else, the request is checked for the right shape (a question between 1 and 2,000 characters) and scanned for well-known attack phrases such as \"ignore previous instructions\".",
    analogy: "A bouncer checking that you are holding a ticket, and that it is not obviously fake.",
    why: "It is the cheapest possible check, so it runs first and rejects the laziest attacks for free (HTTP 422).",
    code: "app/models.py",
  },
  {
    name: "JWT auth",
    short: "Who are you",
    act: "check",
    layer: "L4a",
    icon: KeyIcon,
    plain:
      "Every request carries a signed token (a JWT) received at sign-in. The server verifies the signature and reads who you are and whether you are an admin.",
    analogy: "A wristband from the front desk: staff can check it without phoning the desk again.",
    why: "Limits, budgets and SQL approvals are all per person, so the system must know who is asking.",
    code: "app/middleware/auth.py",
  },
  {
    name: "Rate limit",
    short: "Speed limit",
    act: "check",
    layer: "L4b",
    icon: GaugeIcon,
    plain:
      "Counts your requests in a sliding 60-second window (stored in Redis). Past the limit (20 by default) you get HTTP 429 until the window moves on.",
    analogy: "A turnstile that lets only so many people through per minute.",
    why: "Stops one user or script from flooding the system and running up AI costs.",
    code: "app/middleware/rate_limiter.py",
  },
  {
    name: "Token budget",
    short: "Daily budget",
    act: "check",
    layer: "L6",
    icon: CoinsIcon,
    plain:
      "AI models are billed in tokens (pieces of words). Each user has a daily token allowance; the request's cost is estimated and refused if it would exceed what is left.",
    analogy: "A prepaid card with a daily spending limit.",
    why: "Caps the damage if an account is stolen or a script misbehaves.",
    code: "app/security/token_budget.py",
  },
  {
    name: "Input restructuring",
    short: "Trim",
    act: "check",
    layer: "L5",
    icon: ScissorsIcon,
    plain:
      "Very long questions are cut to fit: moderately long ones are truncated, extremely long ones are reduced to their first sentences that fit.",
    analogy: "An editor trimming a letter so it fits on one page.",
    why: "Keeps room in the AI's limited reading window for the retrieved documents and the answer.",
    code: "app/security/input_restructuring.py",
  },
  {
    name: "Input guard scan",
    doing: "Scanning the question for prompt injection, abuse and banned topics.",
    short: "Attack scan",
    act: "check",
    layer: "L2",
    icon: ShieldWarningIcon,
    plain:
      "A dedicated scanner looks for prompt injection (attempts to take over the AI), toxic language and banned topics. It uses llm-guard's ML models when installed, plus built-in rules that also decode base64-hidden text.",
    analogy: "Airport security scanning bags for things that are not allowed on board.",
    why: "Stops prompt injection, abuse and banned topics before any AI model sees the question, including attacks reworded to slip past the L1 phrase list (HTTP 400).",
    code: "app/security/input_guard.py",
  },
  {
    name: "Input moderation + PII redaction",
    short: "Hide personal data",
    act: "check",
    layer: "L7a",
    icon: EyeSlashIcon,
    plain:
      "Personal data in the question (emails, phone numbers, card numbers, IP addresses, API keys) is replaced with labels like [REDACTED_EMAIL] before any AI model sees it.",
    analogy: "Blacking out names on a document before handing it to a contractor.",
    why: "Private data should never be sent to an AI provider or stored in caches.",
    code: "app/security/content_moderation.py",
  },
  {
    name: "Intent router",
    doing: "Asking a small model whether this needs the docs, the database, or both.",
    short: "Router",
    act: "route",
    layer: "route",
    icon: SignpostIcon,
    plain:
      "A quick AI call classifies the question: \"rag\" (needs documentation), \"sql\" (needs numbers from the operations database) or \"hybrid\" (needs both). The decision is cached for 24 hours.",
    analogy: "A receptionist who sends you to the library, the records office, or both.",
    why: "Documents can't count incidents, and a database can't explain a concept. Each kind of question needs its own path.",
    code: "app/services/router_service.py",
  },
  {
    name: "RAG answer cache",
    short: "Answer cache",
    act: "find",
    layer: "cache",
    icon: LightningIcon,
    plain:
      "If the same question was answered recently with the same settings, the saved answer is returned instantly (kept for 1 hour).",
    analogy: "A teacher who remembers answering your exact question ten minutes ago.",
    why: "Repeated questions cost nothing and come back in milliseconds.",
    code: "app/services/query_cache_service.py",
  },
  {
    name: "HyDE hypotheses",
    doing: "Writing a guessed answer to search with.",
    short: "HyDE",
    act: "find",
    layer: "retrieve",
    icon: LightbulbIcon,
    plain:
      "HyDE (Hypothetical Document Embeddings): the AI first writes a short guess at the answer, and the search looks for documents similar to that guess as well as to the question.",
    analogy: "Describing the book you want to a librarian in the book's own words, not just its title.",
    why: "Short questions (\"server died, app down?\") use different words from the docs that answer them. A full-sentence guess bridges that gap.",
    code: "app/services/hyde.py",
  },
  {
    name: "Retrieve",
    doing: "Searching 6,122 passages by meaning and by exact keywords.",
    short: "Search",
    act: "find",
    layer: "retrieve",
    icon: MagnifyingGlassIcon,
    plain:
      "Finds the most relevant text chunks. Dense search compares meaning (vectors in Qdrant); sparse search (BM25) matches exact rare words like \"ErrImagePull\"; hybrid runs both and merges them with Reciprocal Rank Fusion.",
    analogy: "Asking two librarians, one who understands topics and one who knows every exact word, then combining their lists.",
    why: "Each method misses things the other finds. Combining them is more reliable than either alone.",
    code: "app/services/vector_store.py",
  },
  {
    name: "Rerank (cross-encoder)",
    doing: "Re-reading the 20 candidates with a second model to keep the best 5.",
    short: "Rerank",
    act: "find",
    layer: "retrieve",
    icon: SortAscendingIcon,
    plain:
      "Search returns 20 candidates quickly but roughly. A cross-encoder model then reads the question and each candidate together, scores them carefully, and keeps the best 5.",
    analogy: "A fast first sort of job applications, then a careful interview of the shortlist.",
    why: "Most of the knowledge base is deliberately irrelevant noise; careful re-scoring rescues the right chunks.",
    code: "app/services/reranking.py",
  },
  {
    name: "CRAG grading",
    doing: "Grading each passage: does it actually help answer the question?",
    short: "Grade",
    act: "find",
    layer: "crag",
    icon: ScalesIcon,
    plain:
      "Corrective RAG: an AI grader scores how relevant the chunks really are (0 to 1). Good: keep them. Unsure: keep them and add web results. Bad: replace them with web results, or with nothing.",
    analogy: "Checking that the books you grabbed are actually about your topic before you start writing.",
    why: "Answering from irrelevant documents makes an AI confidently wrong. It is better to say \"I don't know\".",
    code: "app/services/crag.py",
  },
  {
    name: "Web search (Tavily)",
    doing: "Searching the web because the documents were not good enough.",
    short: "Web",
    act: "find",
    layer: "crag",
    icon: GlobeIcon,
    plain:
      "When the documents fail the grade, the Tavily search API fetches fresh results from the web. It runs only when a Tavily key is configured.",
    analogy: "Going online when the office library has nothing on the topic.",
    why: "Covers questions the internal docs can't, such as the latest Kubernetes release.",
    code: "app/services/web_search.py",
  },
  {
    name: "Text2SQL generate",
    doing: "Writing a SQL query and having Postgres check it with EXPLAIN.",
    short: "Write SQL",
    act: "find",
    layer: "sql",
    icon: DatabaseIcon,
    plain:
      "The AI turns the question into a SQL query (the language databases understand), using the table layout and real example values. Anything other than a single read-only SELECT on the 7 operations tables is blocked.",
    analogy: "A clerk filling in the records-office request form for you.",
    why: "Counting incidents or finding the busiest engineer needs exact numbers, which only the database has.",
    code: "app/services/sql_service.py",
  },
  {
    name: "Paused for SQL approval",
    short: "Human check",
    act: "find",
    layer: "hitl",
    icon: HandPalmIcon,
    plain:
      "Human in the loop: the workflow (a LangGraph state machine) pauses and saves itself to Postgres. You see the exact SQL and choose to run it or reject it.",
    analogy: "A bank teller asking you to confirm the amount before the transfer goes through.",
    why: "AI-written database queries can be wrong or expensive. A person stays in control of what touches the data.",
    code: "app/core/graph.py",
  },
  {
    name: "Human approval",
    short: "Approved",
    act: "find",
    layer: "hitl",
    icon: HandPalmIcon,
    plain: "Your decision resumes the saved workflow exactly where it paused, even after a server restart.",
    analogy: "Picking up a saved game at the checkpoint.",
    why: "Only the person who asked may approve their own query.",
    code: "app/api/query.py",
  },
  {
    name: "Execute SQL (read-only)",
    doing: "Running the approved query in a read-only session.",
    short: "Run SQL",
    act: "find",
    layer: "sql",
    icon: TableIcon,
    plain:
      "The approved query runs in a read-only database session with a 5-second time limit and a 200-row cap. Results are cached for 15 minutes.",
    analogy: "Reading the records under supervision: you can look but not change anything.",
    why: "Even if a bad query slipped through, it still can't modify data or hang the database.",
    code: "app/services/sql_service.py",
  },
  {
    name: "Spotlighting",
    short: "Fence the data",
    act: "answer",
    layer: "L8",
    icon: BracketsAngleIcon,
    plain:
      "Retrieved chunks are wrapped in <chunk> tags with a notice: this is untrusted data, not instructions. Documents can't close the tags to escape.",
    analogy: "Putting quoted material in a clearly marked box so nobody mistakes it for your own orders.",
    why: "A document could contain hidden text like \"ignore your rules\" (this corpus includes one on purpose). The fence keeps it as data.",
    code: "app/security/spotlighting.py",
  },
  {
    name: "Generate answer",
    doing: "Writing the answer from the fenced passages only.",
    short: "Write",
    act: "answer",
    layer: "generate",
    icon: ChatTextIcon,
    plain:
      "The main AI model writes the answer using only the fenced chunks, cites its sources, and gives a confidence score. A hardened system prompt (L3) tells it to treat user text as data.",
    analogy: "Writing an essay where every claim must point to a page in the provided books.",
    why: "Grounding the answer in retrieved text is what makes RAG trustworthy.",
    code: "app/services/rag_service.py",
  },
  {
    name: "Generate hybrid answer",
    doing: "Combining the database rows and the documents into one answer.",
    short: "Combine",
    act: "answer",
    layer: "generate",
    icon: ChatTextIcon,
    plain: "For hybrid questions, the AI combines the database rows and the documents into one answer.",
    analogy: "A report that quotes both the spreadsheet and the policy manual.",
    why: "Questions like \"how many P1s breached SLA, and what is our escalation policy?\" need both.",
    code: "app/services/rag_service.py",
  },
  {
    name: "Summarize SQL rows",
    doing: "Turning the result rows into a plain-English answer.",
    short: "Explain rows",
    act: "answer",
    layer: "generate",
    icon: ChatTextIcon,
    plain: "The AI turns the raw result rows into one to three plain sentences. The rows are shown too.",
    analogy: "A colleague reading the spreadsheet and telling you the bottom line.",
    why: "Raw tables are hard to read; a summary with the table beside it is both readable and checkable.",
    code: "app/core/graph.py",
  },
  {
    name: "Output schema validation",
    doing: "Checking the answer has the required format.",
    short: "Format check",
    act: "answer",
    layer: "L9",
    icon: FileCodeIcon,
    plain:
      "The AI must reply in a fixed JSON format (answer, sources, confidence). If it doesn't, the validation error is sent back and it gets two more tries.",
    analogy: "Returning a form that was filled in wrongly, with the mistake circled.",
    why: "Downstream code depends on a predictable shape; unvalidated AI output breaks programs.",
    code: "app/security/output_validator.py",
  },
  {
    name: "Self-RAG reflection",
    doing: "Reviewing the answer and deciding whether to try again.",
    short: "Self-review",
    act: "answer",
    layer: "reflect",
    icon: ArrowsClockwiseIcon,
    plain:
      "Self-RAG: a strict reviewer model scores the answer for relevance, accuracy, completeness and clarity. If it is weak, the question is rewritten more precisely and answered again (up to 2 retries).",
    analogy: "Proofreading your essay, and rewriting it if it doesn't really answer the question.",
    why: "Vague questions (\"tell me about pods\") produce vague answers. Reflection catches and fixes them.",
    code: "app/services/self_reflective.py",
  },
  {
    name: "Output moderation + PII redaction",
    short: "Final check",
    act: "answer",
    layer: "L7b",
    icon: EyeSlashIcon,
    plain: "The finished answer is scanned once more and any personal data is redacted before it reaches you.",
    analogy: "A last look at the letter before it goes in the envelope.",
    why: "Documents and database rows can contain personal data even if your question didn't.",
    code: "app/api/query.py",
  },
]

const BY_NAME = new Map(STAGES.map((s) => [s.name, s]))

export function stageFor(name: string): Stage | undefined {
  return BY_NAME.get(name)
}

export const ROUTE_LABEL: Record<string, string> = {
  rag: "Docs",
  sql: "Database",
  hybrid: "Docs + Database",
}

export const GLOSSARY: { term: string; meaning: string }[] = [
  { term: "LLM", meaning: "Large language model: an AI that reads and writes text, such as GPT-4o or Qwen." },
  { term: "RAG", meaning: "Retrieval-Augmented Generation: look up relevant documents first, then let the AI answer from them." },
  { term: "Embedding", meaning: "A list of numbers that captures a text's meaning, so similar meanings get similar numbers." },
  { term: "Vector database", meaning: "A database (here Qdrant) that finds the embeddings closest to a question's embedding." },
  { term: "Chunk", meaning: "A short passage (about a paragraph) cut from a document. Search works on chunks, not whole files." },
  { term: "BM25", meaning: "A classic keyword-scoring formula that rewards rare exact words. The \"sparse\" search." },
  { term: "RRF", meaning: "Reciprocal Rank Fusion: merges two ranked lists by giving each item 1 / (60 + rank) from every list." },
  { term: "Cross-encoder", meaning: "A model that reads question and passage together to score relevance. Slower but more accurate." },
  { term: "Text2SQL", meaning: "Turning a plain-English question into a SQL database query with an AI." },
  { term: "LangGraph", meaning: "A library for building AI workflows as a graph of steps that can pause, save and resume." },
  { term: "Prompt injection", meaning: "Text that tries to make the AI ignore its rules, typed by a user or hidden inside a document." },
  { term: "PII", meaning: "Personally identifiable information: emails, phone numbers, ID numbers and similar." },
  { term: "JWT", meaning: "JSON Web Token: a signed pass that proves who you are on each request." },
  { term: "Kubernetes", meaning: "Software that runs and manages containers (packaged apps) across many servers." },
  { term: "Pod", meaning: "The smallest unit Kubernetes runs: one or more containers that share a network and storage." },
  { term: "SRE", meaning: "Site Reliability Engineer: the person who keeps production systems running and handles incidents." },
]
