# Audit and completion notes

The downloaded project did not start: three source files had syntax-level errors, and several features the
README describes were missing or wired incorrectly. Every item below was found by reading the code and running
it end to end (local Ollama models, embedded Qdrant, Postgres, Redis), and each fix is covered by a unit test
under `tests/unit/` where one was practical. The original code is the first commit in this repository's git
history, so `git diff HEAD~1` (or the first commit) shows every change.

## 1. The service could not start

| Problem | File | Fix |
|---|---|---|
| Module docstring indented by 4 spaces (`IndentationError` on import) | `app/security/input_restructuring.py` | De-indented |
| First import indented (`IndentationError`) | `app/services/llm_service.py` | De-indented |
| `LocalStorage` code pasted into `app/storage/__init__.py` with a bad indent; `local_storage.py` was empty | `app/storage/` | Moved the class into `local_storage.py` |
| `create_access_token` used `expire` before assignment whenever a custom expiry was passed | `app/middleware/auth.py` | Always compute `expire` |
| Rate limiter and token budget crashed without Upstash credentials | `app/middleware/rate_limiter.py`, `app/security/token_budget.py` | Shared store: Upstash, else `REDIS_URL`, else in-memory (`app/services/redis_client.py`) |
| `seed_db.py` ignored `.env` (read `DATABASE_URL` only from the shell) | `scripts/seed_db.py` | Uses app settings |
| Undeclared dependencies (`scikit-learn`, `psycopg`, `psycopg-pool`, `python-docx`) | `pyproject.toml` | Declared; `redis` added |

## 2. Security bugs

| Problem | Impact | Fix |
|---|---|---|
| The hybrid route called `run_rag`, which **executed the generated SQL before the human approved it** | Human-in-the-loop approval was bypassed for every hybrid question | `retrieve_rag` now only retrieves; SQL runs after approval (test: `test_hybrid_route_waits_for_approval_before_sql`) |
| `/query/sql/execute` resumed any thread id for any user | Any signed-in user could approve and run someone else's pending query | Ownership check, 404 for others, 409 if already answered (test: `test_sql_flow_and_ownership_over_http`) |
| Text2SQL schema introspection included the `users` table | The LLM could be asked for `password_hash` values | Allow-list of the 7 ops tables; `users`, `pg_*`, `information_schema` blocked at execution |
| SELECT check missed multi-statement, comments, `pg_sleep`, data-modifying CTEs | Weak SQL guard | Stricter `check_sql`, plus a read-only session, 5 s statement timeout and 200-row cap |
| Unsafe SQL was shown to the human for approval | Confusing and risky | Blocked before the approval step |
| L2 guard silently allowed everything when llm-guard was unavailable | Layer disabled without notice | Heuristic rules (including base64-decoded payloads) always run; llm-guard adds ML scanning |
| Spotlighting did not escape `</chunk>` in documents | A document could break out of the "untrusted data" fence | Closing tags escaped |
| Empty `JWT_SECRET` signed tokens with an empty key | Forgeable tokens | Random per-process secret with a warning |
| PII regex missed SSNs and API keys | Leakage | Patterns added; regex pass always runs |

## 3. Features that were wired wrong or missing

| Problem | Fix |
|---|---|
| L9 output validator was never called; the system prompt demanded JSON, so answers came back as raw JSON strings | `generate_rag_answer` validates with retry and degrades to plain text instead of failing |
| Hybrid answers received only file **names**, never the document text | Real chunk text is passed through the graph state |
| SQL answers were a raw JSON dump | Short natural-language summary plus the rows (shown as a table in the UI) |
| Intent router contained a keyword list from an unrelated research-paper project ("table", "figure", "paper" forced the docs route) | Removed |
| CRAG graded all passages with one score and dropped everything below 0.7; with no web key the model then answered from memory with high confidence | Per-passage grading (as in the CRAG paper), keep only passages that pass, keep-and-add-web for "ambiguous", and an honest "not found" answer when nothing relevant remains (never a guess) |
| `crag_ambiguous_threshold` setting existed but was unused | Implemented the ambiguous branch |
| "Sparse" search was TF-IDF, rebuilt from a full collection scroll on **every query**, and only read the first 10,000 points | BM25 with hyphen-aware tokens, built once, cached, paged over the whole collection, invalidated on upsert |
| A new Qdrant client and a new cross-encoder model were created per request | Shared singletons |
| `POST /documents/upload` was documented but did not exist; the SHA-256 dedup cache was unused | Implemented (admin only, size and type limits, dedup) plus `GET /documents` |
| Docling cannot read `.txt`, so 12 of the 50 shipped docs failed ingestion silently; docling device was hard-coded to Apple MPS | `.txt` uses a text parser; device is AUTO; simple parser fallback |
| kubernetes.io page footers ("Was this page helpful?") were in 47 of 50 docs and out-ranked real content | Stripped at ingestion |
| `nomic-embed-text` used without its required task prefixes | `EMBEDDING_QUERY_PREFIX` / `EMBEDDING_DOCUMENT_PREFIX` |
| Blocking LLM calls inside `async def` endpoints froze the event loop for every other request | Endpoints are sync (run in the threadpool) |
| Eval: goldens cited 7 documents that were never shipped, and source matching compared `pods.html` with `concepts__workloads__pods.html` so overlap was always 0 | Missing docs fetched/generated by the data pipeline; normalised matching; `scripts/validate_goldens.py` |
| README promised `tests/`, `scripts/data_pipeline/`, `eval/diff.py`, `make validate` | All written (63 unit tests) |
| Health check ran a paid Tavily search on every ping | Configuration check only |
| `/admin/cache/clear` claimed to clear Redis but did nothing | Deletes keys by prefix |

## 4. Added

- **Runs with no Docker and no paid keys:** any OpenAI-compatible endpoint (`OPENAI_BASE_URL`, e.g. Ollama), embedded Qdrant (`QDRANT_PATH`), project-local Postgres (`scripts/local_stack.sh`), plain Redis (`REDIS_URL`).
- **Pipeline trace:** every response carries `metadata.trace` (each layer, its status and timing); blocked requests return the trace up to the blocking layer.
- **Demo console** (`frontend/`): React + shadcn/ui + Motion + Bklit charts. Ask questions, approve SQL, watch the trace, learn each stage, browse the knowledge base, see health and cache statistics.
- **Data pipeline** (`scripts/data_pipeline/`): official Kubernetes docs the eval needs, synthetic internal runbooks (including one with a hidden prompt-injection line to test spotlighting), and a seeded noise sample.

## 5. Round 2: showcase frontend

- **Landing page** (`frontend/src/landing/`): WebGL hero (React Bits WebThreads, gated by `LiveBackground`), GSAP SplitText headline, a scroll-pinned pipeline scene replaying a real recorded run (DrawSVG + MotionPath), a scrubbed retrieval funnel over 612 dots (6,122 passages), a sticky stack of real attack attempts, an interactive SQL-approval demo using real rows, a bento of internals, and the guide PDF. Lenis smooth scroll on this page only. Reduced motion: no WebGL context is ever created, nothing pins, all content is static and complete.
- **Live pipeline in the console**: new `POST /query/stream` (Server-Sent Events) pushes each stage as it begins and finishes; the console lights stages in real time instead of replaying a trace afterwards. Tests: `test_stream_emits_live_steps_then_result`, `test_stream_reports_blocked_requests_as_error_event`.
- **Midnight palette**, dark by default (light still available); all token pairs pass WCAG AA (worst 5.51:1).
- Verified in Chrome at 1440 / 1280 / 1024 / 390 px, dark and light, reduced motion; WebGL contexts return to 0 when the hero leaves the screen; production build served by the API at `/ui/`.

## 6. Round 3: chat with memory

- **Ask is now a chat** (`frontend/src/views/chat/`): sidebar of saved chats (search, rename, delete, grouped by date), centred empty state with suggestions, user bubbles, assistant answers with sources, live "thinking" row, SQL approval and blocked attacks inside the thread, mobile drawer. Built on shadcn `MessageScroller`, `Message`, `Bubble`, `Sheet`, `Popover`, `AlertDialog`.
- **Chats are saved**: new tables `conversations` and `chat_messages` (`seed/migrations/004_create_conversations.sql`, created on first use), service `app/services/conversation_service.py`, endpoints `GET/PATCH/DELETE /conversations[/{id}]`. Users can only read or continue their own chats (404 otherwise). Questions are stored after PII redaction; approving SQL later updates the saved message.
- **Follow-up questions**: `app/services/followup_service.py` rewrites a follow-up into a standalone question from the last three usable turns, with the history fenced as untrusted data; the rewrite is scanned by L2 again; falls back to the original question on any problem.
- New tests (82 pass in total) cover conversation creation, follow-up rewriting, ownership, blocked turns excluded from context, SQL approval updating the saved message, and the conversation endpoints.
- Verified in Chrome end to end (see `frontend/DESIGN.md` §8).

## 7. Known limits

- The L2 prompt-injection model has occasional false positives on harmless wording (for example "What if the logs say it was OOMKilled?"); the chat suggests rewording. A 3B model also sometimes leaves a follow-up unrewritten.
- `infra/` (CloudFormation) and the GitHub Actions workflow mentioned in the README are not in the download and were not recreated.
- The SQL dataset is synthetic: cluster names look like `k8s-production-useast1-001`, so goldens that mention `prod-eu-west` find no rows.
- With a 3B local model, answers are slower (10 to 60 s) and weaker than with GPT-4o; the pipeline is the same.
- Embedded Qdrant allows one process at a time: stop the API before running `make seed`.
