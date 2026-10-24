# Design System: K8s Ops Copilot (landing + console)

## 1. Atmosphere
Reading this as: a showcase landing page plus a live demo console for an AI-systems project, for first-time viewers (reviewers, recruiters, classmates) who must be impressed in seconds and understand the system in a minute, with a cinematic "mission control at night" language, leaning toward shadcn/ui + Tailwind v4 + Geist, GSAP scroll storytelling + Lenis on the landing, Motion for console states, and one recoloured WebGL background.

Dials:
- **Landing (`#/`)**: DESIGN_VARIANCE 8, MOTION_INTENSITY 8, VISUAL_DENSITY 3.
- **Console (`#ask`, `#learn`, `#knowledge`, `#system`)**: 5 / 6 / 5. It is product UI: no Lenis, no WebGL.

Mood: an operations room at night. Deep midnight surfaces, one cobalt signal colour, and light that only moves when data moves. Every number on screen is real (API or a recorded real run), never decorative.

User decision (round 2): "super cool and attractive, catch the eyes of viewers". This overrides round 1's deliberately restrained 5/5/5 product look. Theme defaults to **dark** (the brief insists on the night control room); the light theme stays available from the toggle and is fully supported.

## 2. Colour palette and roles
| Role token | Name | Dark (default) | Light | Use |
|---|---|---|---|---|
| `--background` | Midnight Ops / Frost | `#0A0E17` | `#F5F6F8` | page |
| `--card` | Console Glass / Sheet | `#111726` | `#FCFCFD` | panels |
| `--foreground` | Starlight / Graphite Ink | `#E7EBF3` | `#171A21` | primary text |
| `--muted-foreground` | Instrument Grey / Slate Note | `#9AA5BC` | `#566072` | secondary text |
| `--primary` | Signal Cobalt | `#7A9CF0` | `#2D5BCB` | the single accent: CTAs, the travelling packet, live stations |
| `--accent` / `--accent-soft` | Cobalt Wash | `#1A2440` / `#131C33` | `#E6ECFA` / `#EEF2FC` | selected states |
| `--ok` | Pine | `#4FC08D` | `#1C7A57` | stage passed |
| `--warn` | Amber | `#E0A642` | `#8F5A05` | fallback / partial |
| `--destructive` | Brick | `#F07A63` | `#B53D28` | blocked |
| `--border` | Hairline | `#1F2940` | `#DDE1E8` | dividers |

Status colours are semantic only (pass / fallback / blocked), never decoration. WebThreads background colours: `#2D5BCB`, `#7A9CF0`, core `#C9D6FA` (dark) / light-mode variant. Charts: `--chart-1` cobalt, `--chart-2` slate.

## 3. Typography
- Geist Variable for everything; display at 600-650 weight, `tracking-tight`, `leading-[1.02]`. Geist Mono only for SQL, file names, model ids, JSON.
- Landing display: `text-5xl md:text-7xl` for the hero (2 lines at 1440), `text-4xl md:text-5xl` for section heads. Console: as round 1.
- Numbers `tabular-nums`. Body max 60ch.

## 4. Components
- Radius rule: buttons 8px, panels 16px on the landing / 12px in the console, pills full. Nothing else.
- Primary CTA "Open the console" (one label everywhere: header, hero, end band). Secondary "See how it works" (scrolls to the pipeline scene). Tertiary "Download the guide" (PDF).
- Console: live pipeline rail while a request runs; answer card; approval card; trace; passages.
- **Ask is a chat (round 3).** ChatGPT / Gemini conventions so it needs no learning:
  - Left sidebar (17rem): "New chat", search, saved chats grouped Today / Yesterday / Previous 7 days / Older; each row has a menu with Rename (inline field) and Delete (AlertDialog, "Keep it" / "Delete chat"). Below 1024px it becomes a left Sheet opened from the top bar.
  - Empty state: logo, "What should we look into, {name}?", the composer, and four suggestion cards (Documentation, Operations data, Both at once, Try to break it).
  - User turns: right-aligned `Bubble` (secondary, 24px radius). Assistant turns: no bubble, avatar at the top left (hidden below 640px), plain prose at 15px.
  - Thinking row: the current stage in words (shimmer text), a 4-act progress rail and a live clock; "Show steps" opens the live trace.
  - Follow-ups show "Understood as: ..." when the question was rewritten using the conversation.
  - Under each answer: sources as pills, copy, route and cache pills, then collapsed "N checks and steps" and "N passages used".
  - Composer: 26px-radius card, Enter sends, Shift+Enter new line, settings popover for search method and techniques, round send button. Disclaimer line below it.
  - Approval and blocked states live inside the thread as cards.

## 5. Layout
- Landing max width 1280px, `px-5 md:px-8`. Eight sections, eight layout families: split hero, inline proof row, pinned diagram, full-bleed dot field, sticky stack, split interactive demo, 5-cell bento, centred CTA band.
- Every multi-column layout collapses to one column below 768px; pinned scenes become static stacked content on mobile widths under 768px and under reduced motion.
- Console layout as round 1, except Ask: full-height grid `17rem | 1fr`, thread column max 768px (`max-w-3xl`), composer pinned to the bottom of the same column, 1.5rem fade where the thread scrolls under the title bar.

## 6. Motion (engine per component, reason)
- Hero headline: **GSAP SplitText** masked lines (introduces the promise in reading order).
- Hero screenshot: **GSAP ScrollTrigger scrub**, 3D tilt flattens as you scroll (the product "comes forward" as the story starts).
- Hero background: **React Bits WebThreads** in `LiveBackground` (threads through pinch points = a request through checkpoints). One background per page, recoloured.
- Proof numbers: **GSAP counter** recipe (real values count in once).
- **Signature (landing): "Follow one question"**: GSAP pin + scrub, DrawSVG draws the route, MotionPath moves a packet through 4 acts, stations light with the real timings of a recorded run.
- Haystack: GSAP scrubbed timeline over 612 dots (6,122 chunks / 10): search, rerank, grade.
- Attack cards: GSAP sticky stack (§5.A pattern).
- Approval demo: **Motion** `AnimatePresence` (state change on click).
- Smooth scroll: **Lenis**, landing route only.
- **Signature (console): live pipeline**: Server-Sent Events from `POST /query/stream`; each station lights the moment the backend starts/finishes it (**Motion** layout + presence). Real progress, never simulated.
- Answer arrival: Motion word stagger (state change), static under reduced motion.
- Chat (round 3): **Motion** `layoutId="composer"` moves the composer from the centre of the empty state to the bottom when the first question is sent (it shows where the conversation continues); the empty-state greeting and suggestions fade up once; new answers reveal paragraph by paragraph, loaded history is static. Thread scrolling is the shadcn `MessageScroller` (auto-scroll, anchor on the user's turn, jump-to-latest button). No GSAP, no Lenis.
- Reduced motion: every GSAP setup inside `gsap.matchMedia(MOTION_OK)`; WebGL replaced by a static poster; pinned scenes render as static final states; Lenis off.

## 7. Project-specific bans
- No fake progress, no invented metrics, no fake screenshots (real screenshots of this console only).
- No eyebrow labels; no `A · B · C` metas; no arrows appended to button text; no scroll cue.
- No WebGL or smooth scroll inside the console.

Directions tried: round 1 shipped a restrained light console (5/5/5) with a post-hoc trace replay; the user found it not eye-catching enough. Round 2 adds the cinematic landing and real-time streaming. A three-column console was tried in round 1 and rejected as too dense.

## 8. Decisions and verification (round 3, 2026-10-23: chat)
- Replaced the form-style Ask page (question box, live rail, answer card) with a chat. The user found the old page unlike modern chat apps.
- Removed accessory: the close (X) button in the mobile history drawer; it covered "New chat", and tap-outside, Escape and picking a chat already close it.
- Verified in Chrome: new chat, three-turn follow-up ("How do I fix it?" understood as "How do I fix ErrImagePull?"), reload restores the thread from `#ask/<id>`, rename, delete with confirmation, SQL approval in the thread, blocked attack in the thread, 1440 and 390 px, dark and light, reduced motion, no console errors, no horizontal overflow. ui-audit clean; 21st review: one intentional `autoFocus` (rename field after choosing Rename).
- Known model quirk: the L2 PromptInjection classifier scores "What if the logs say it was OOMKilled?" at 1.0 ("What if it was OOMKilled?" passes). The blocked card now suggests rewording; the threshold was not lowered.

## 9. Decisions and verification (round 2, 2026-10-23)
- Removed accessory: the giant faint layer watermark ("L1", "L2") on attack cards; it repeated the "Stopped by" chip.
- One label per intent: "Open the console" (header, hero, end band), "How it works" (header, hero), "Download the guide (PDF)" (end band only).
- Bug found in testing: SplitText `autoSplit` re-runs `onSplit` when the web font loads; a re-run `.from()` tweened the hero buttons from 0 to 0 (invisible on phones). Only the line reveal lives in `onSplit`; everything else is a once-only `fromTo`.
- Tailwind v4 `scale-*` uses the CSS `scale` property, which stacks with GSAP's transform scale: static-only scale classes are reset while a scene is live.
- Verified in Chrome: hero headline exactly 2 lines and CTA above the fold at 1440 / 1280 / 1024 / 390 px; no horizontal overflow; dark, light, reduced motion (0 WebGL contexts ever created, no pins); WebGL: 12 mounts over 5 round trips leave 1 live context, 0 once the hero scrolls away; live console run streams 16 steps in order; production build at `/ui/` end to end; strict tsc, ui-audit, 21st review (only max-width false positives and the allowed shader hex values), contrast AA.
