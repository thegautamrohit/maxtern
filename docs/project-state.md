# Maxtern — Project State

Last updated: 2026-07-07 (synced with architecture.md)

---

## What is Maxtern

Adaptive Retrieval Runtime (ARR) — an AI-native knowledge system that ingests documents from multiple sources, understands user queries, intelligently selects retrieval strategies, and generates grounded responses with full observability.

This is NOT a simple RAG chatbot. It is a project covering: LangChain, RAG, Vector DBs, Embeddings, Adaptive Retrieval, LangGraph, Tool Calling, Agents, MCP, and Observability.

---

## V1 Scope (Current)

- Sources: PDF, Website, GitHub
- Retrieval: Semantic + Summary
- No Agents. No MCP. No LangGraph.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router) |
| Language | TypeScript |
| AI Framework | LangChain JS v1.x |
| Vector DB | Qdrant (local Docker, port 6333) |
| Relational DB | PostgreSQL (local Docker, port 5432) |
| ORM | Prisma 6 with PrismaPg adapter |
| Embeddings | Ollama — nomic-embed-text (768 dims) |
| LLM | OpenAI / Anthropic / Gemini (V1 TBD) |
| Observability | Custom debug layer |

---

## Infrastructure

### Docker Compose

- `postgres` container — port 5432, named volume `postgres_data`
- `qdrant` container — port 6333 (HTTP) + 6334 (gRPC), named volume `qdrant_data`

### Environment

```
DATABASE_URL=postgresql://maxtern:maxtern@localhost:5432/maxtern
```

---

## Database Schemas

### PostgreSQL (Prisma)

**Document**
```
id          String   @id @default(uuid())
userId      String   (Clerk userId — owner of this document)
title       String
content     String   (full raw text of the source)
sourceType  String   (pdf | website | github)
metadata    Json
contentHash String   (SHA-256 of normalized content — deduplication key)
chunk       Chunk[]  (relation)
createdAt   DateTime @default(now())
@@unique([userId, contentHash])
```

**Chunk**
```
id         String   @id @default(cuid())
content    String   (chunk text)
metadata   Json
chunkIndex Int      (position within document)
vectorized Boolean  @default(false) — flipped to true after Qdrant upsert confirms
documentId String   (FK → Document.id)
document   Document @relation(...)
createdAt  DateTime @default(now())
```

### Qdrant (Collection: "chunks")

```
id      String   (same as PostgreSQL Chunk.id)
vectors:
  dense   float[]             (768 dims — nomic-embed-text, Cosine)
  sparse  { indices, values } (BM25 TF-IDF keyword vector)
payload:
  chunkId     String   (PostgreSQL Chunk.id — for content lookup)
  documentId  String   (PostgreSQL Document.id)
  sourceType  String   (pdf | website | github)
  userId      String   (Clerk userId — for per-user retrieval isolation)
```

**Key design decision:** Qdrant stores only vectors + reference IDs. Content lives exclusively in PostgreSQL. Query time: Qdrant returns chunkIds → PostgreSQL fetches content.

**Named vectors:** Both dense and sparse are stored as named vectors (`vector: { dense: [...], sparse: {...} }`). Required when storing multiple vector types per point.

**Multi-tenancy:** `userId` is stored in Qdrant payload and used as a filter at query time — retrieval is scoped to the authenticated user's documents only.

---

## Folder Structure

```
src/
  middleware.ts                     ✅ Done (Clerk — public/protected route gate)
  core/
    types.ts                        ✅ Done
  db/
    client.ts                       ✅ Done
  vector/
    client.ts                       ✅ Done
    collection.ts                   ✅ Done
    store.ts                        ✅ Done
  ingestion/
    loaders/
      pdf-loader.ts                 ✅ Done
      website-loader.ts             ✅ Done
      github-loader.ts              ✅ Done
    normalizers/
      document-normalizer.ts        ✅ Done
  chunking/
    recursive-chunker.ts            ✅ Done
    markdown-chunker.ts             ✅ Done
  embeddings/
    embedder.ts                     ✅ Done
    sparse-embedder.ts              ✅ Done
  tools/
    web-search.ts                   ✅ Done
  workflows/
    ingest.ts                       ✅ Done
    query.ts                        ✅ Done (updated — compiledGraph.invoke)
    graph/
      state.ts                      ✅ Done
      nodes.ts                      ✅ Done
      edges.ts                      ✅ Done
      graph.ts                      ✅ Done
  retrieval/
    retrievers/
      semantic-retriever.ts         ✅ Done
      summary-retriever.ts          ✅ Done
    query-analyzer.ts               ✅ Done
    retrieval-router.ts             ✅ Done
    reranker.ts                     ✅ Done (V3 — cross-encoder, Xenova/ms-marco-MiniLM-L-6-v2)
    query-rewriter.ts               🔴 Not started (V3)
    retrievers/
      dense-retriever.ts            ✅ Done
  llm/
    llm.ts                          ✅ Done
  prompts/
    prompt.ts                       ✅ Done
  lib/
    utils.ts                        ✅ Done (Tailwind cn helper)
    ingest-validation.ts            ✅ Done (V3 — URL validation + SSRF protection)
    rate-limit.ts                   ✅ Done (V3 — Redis sliding window, per-user, query + ingest limits)
    query-logger.ts                 ✅ Done (V3 — writes QueryLog row after every query execution)
  observability/                    ⏸ Deferred to V3

app/
  (auth)/
    sign-in/
      page.tsx                      ✅ Done
    sign-up/
      page.tsx                      ✅ Done
    sso-callback/
      page.tsx                      ✅ Done
  api/
    ingest/
      route.ts                      ✅ Done
    query/
      route.ts                      ✅ Done
    documents/                      🔴 Not started
```

---

## Completed Components

### `src/core/types.ts`

Shared TypeScript interfaces — database independent.

```typescript
type SourceType = "pdf" | "website" | "github" | "web"

interface Document {
  userId: string
  title: string
  content: string
  sourceType: SourceType
  metadata: any
  contentHash?: string    // optional — computed in ingest.ts, not set by loaders
}

interface Chunk {
  content: string
  chunkIndex: number
  metadata: any
}

interface QueryIntent {
  strategy: RetrievalStrategy
  confidence: number
  reasoning: string
}
```

---

### `src/db/client.ts`

Singleton Prisma client. Uses PrismaPg adapter (Prisma 6 requirement). Global hot-reload fix for Next.js dev mode.

---

### `src/vector/client.ts`

Singleton QdrantClient pointing to `localhost:6333`.

---

### `src/vector/collection.ts` — `ensureCollections()`

Checks if "chunks" collection exists in Qdrant. Creates it if not (size: 768, Cosine). Called at the start of every `ingestDocument` call — idempotent, safe to call repeatedly.

---

### `src/vector/store.ts`

**`storeDocument(doc)`** — saves Document to PostgreSQL, returns `document.id`

**`storeChunksInPostgres(tx, chunk, documentId)`** — writes a single chunk to PostgreSQL using the transaction client `tx`, with `vectorized: false`. Called inside `prisma.$transaction` in `ingest.ts`.

**`upsertChunksInQdrant(chunk, chunkId, documentId, sparseVector, vector, userId)`** — upserts a single point to Qdrant. Called after the PG transaction commits. Does not swallow errors — throws on failure so the caller can rollback.

**`markChunksVectorised(chunkIds)`** — flips `vectorized: true` for all given chunk IDs via `updateMany`. Called only after all Qdrant upserts confirm.

---

### `src/ingestion/loaders/pdf-loader.ts`

Uses LangChain `PDFLoader`. Joins all pages into single content string. Extracts title from PDF metadata (`pdf.info.Title`). Returns single `Document`.

---

### `src/ingestion/loaders/website-loader.ts`

Uses LangChain `CheerioWebBaseLoader`. Single page only — no recursive crawling. Throws if content is empty (bot-protected sites are a V1 known limitation). Returns single `Document`.

---

### `src/ingestion/loaders/github-loader.ts`

Uses LangChain `GithubRepoLoader`. Accepts `repoUrl` + optional `branch` (default: "main"). Returns `Document[]` — one Document per file in the repo.

---

### `src/ingestion/normalizers/document-normalizer.ts`

Uses `he` library for HTML entity decoding (`&#039;` → `'`, `&amp;` → `&`, etc.).
Regex cleanup: 3+ newlines → 2 newlines, multiple spaces/tabs → single space.
Exposes: `normalizeContent`, `normalizeDocument`, `normalizeDocuments`.

---

### `src/chunking/recursive-chunker.ts`

Uses LangChain `RecursiveCharacterTextSplitter`. chunkSize: 1000, chunkOverlap: 200.
Used for: PDF + Website sources.
Returns `Chunk[]`.

---

### `src/chunking/markdown-chunker.ts`

Uses LangChain `MarkdownTextSplitter`. chunkSize: 1000, chunkOverlap: 200.
Used for: GitHub sources (preserves markdown structure).
Returns `Chunk[]`.

Note: `MarkdownHeaderTextSplitter` is Python-only — `MarkdownTextSplitter` is the JS equivalent.

---

### `src/embeddings/embedder.ts`

Uses LangChain `OllamaEmbeddings` with `nomic-embed-text` model (768 dims).

- `embedText(text)` → `number[]` — single query embedding
- `embedTexts(texts[])` → `number[][]` — batch embedding (used in ingestion for efficiency)

**Switching to OpenAI later:** Change `OllamaEmbeddings` to `OpenAIEmbeddings`, update model. Qdrant collection will need recreation (768 → 1536 dims).

---

### `src/embeddings/sparse-embedder.ts`

BM25-style sparse vector generator using the `natural` library.

- `computeSparseVector(text)` → `{ indices: number[], values: number[] }`
- Process: tokenize → filter stopwords → count term frequency → hash words to indices → return sparse format
- Called during ingestion (per chunk) and at query time (per query)
- Sparse format stores only non-zero positions — memory efficient for large vocabularies

---

### `src/workflows/ingest.ts`

Main ingestion orchestrator. Entry point for all document ingestion.

**`ingestDocument(sourceType, source, branch?)`**

1. Calls `ensureCollections()` — Qdrant collection guaranteed to exist
2. Routes to correct loader based on `sourceType`
3. Calls `processSingleDocument` for each document

**`processSingleDocument(doc, sourceType)`** (internal)

1. `normalizeDocument` — clean HTML entities, whitespace
2. SHA-256 hash normalized content → check `userId_contentHash` unique constraint → skip if duplicate (#25)
3. `storeDocument` — save to PostgreSQL, get `documentId`
4. Chunk — GitHub → `markdownChunk`, PDF/Website → `recursiveChunk`
5. `embedTexts` — batch embed all chunk contents
6. **Phase 1** — `prisma.$transaction` writes all chunks to PostgreSQL with `vectorized: false` — atomic, all-or-nothing (#26)
7. **Phase 2** — `Promise.all(upsertChunksInQdrant)` — batch upsert to Qdrant. On success: `markChunksVectorised` flips all to `true`. On failure: `deleteMany` rolls back PG chunk rows, error re-thrown (#26)

GitHub returns `Document[]` → looped. PDF/Website return single `Document` → direct call.

---

## Completed Components (continued)

### `src/retrieval/retrievers/semantic-retriever.ts`

Hybrid retriever — combines dense (semantic) and sparse (BM25 keyword) search, merges results via RRF, returns top-5 `RetrievedChunk[]`.

Key details:
- `embedText(query)` → 768-dim dense vector
- `computeSparseVector(query)` → BM25 sparse vector `{ indices, values }`
- Both searches run against named vectors: `{ name: "dense", vector: ... }` and `{ name: "sparse", vector: ... }`, `limit: 20` each, filtered by `documentIds`
- RRF merge: `score += 1 / (K + rank + 1)` where K=60 — accumulates across both result lists
- Top-5 chunk IDs by RRF score → `prisma.chunk.findMany`
- sourceType map built from both dense + sparse results (covers sparse-only results)
- Final score is RRF score, not Qdrant's raw cosine/BM25 score

---

## Completed Components (continued)

### `src/retrieval/retrievers/summary-retriever.ts`

Same flow as semantic retriever — `limit: 20` instead of 5. Kept as a separate file intentionally for future divergence (document-level filtering, different scoring logic in V2).

---

### `src/retrieval/query-analyzer.ts`

LLM-based intent classifier (V3 — replaced rule-based keyword matching). Uses `ChatOllama` (`qwen3:4b`, temperature 0) with `withStructuredOutput` and a Zod schema. Returns `QueryIntent: { strategy, confidence, reasoning }`. The `reasoning` field flows into the debug panel as `retrievalReason`, replacing hardcoded strings.

---

### `src/retrieval/retrieval-router.ts`

Takes `RetrievalStrategy` + `query`, calls the correct retriever, returns `Promise<RetrievedChunk[]>`.

---

### `src/retrieval/reranker.ts`

Cross-encoder reranker (V3). Uses `Xenova/ms-marco-MiniLM-L-6-v2` via `@xenova/transformers` — loaded once via singleton (`AutoTokenizer` + `AutoModelForSequenceClassification`). Scores each query-chunk pair via a single forward pass producing a raw logit. Chunks sorted by logit descending, filtered by `score > 0`. Fallback to top 3 if all scores are negative. Sits between `retrieverNode` and `evaluatorNode` in the LangGraph pipeline.

---

### `src/prompts/prompt.ts`

`qaPrompt` — LangChain `PromptTemplate` with `{context}` and `{userQuery}` variables. Instructs LLM to answer using only retrieved context. Returns "I don't have enough information" if answer not in context.

---

### `src/llm/llm.ts`

`generateAnswer(query, chunks)` — builds context string from chunk contents, pipes `qaPrompt | ChatOllama("llama3") | StringOutputParser` via LCEL chain, returns answer as `Promise<string>`.

---

### `src/lib/ingest-validation.ts`

Validation utilities for `POST /api/ingest` — kept separate to avoid stretching the route handler.

- **`validateWebsiteUrl(source)`** — async. Checks: valid URL format → `https:` protocol only → hostname not in private IP ranges (regex) → DNS resolution check (SSRF: resolved IP also checked against private ranges). Returns error string or `null`.
- **`validateGithubUrl(source)`** — sync. Checks: valid URL format → hostname must be `github.com` → `https:` protocol only. Returns error string or `null`.
- **`MAX_PDF_SIZE`** — 50MB constant used in route for file size check.

SSRF protection covers: `127.x`, `10.x`, `192.168.x`, `172.16–31.x`, `localhost`, `::1`. DNS lookup catches domains that resolve to private IPs even if the hostname looks public.

---

### `src/workflows/query.ts`

`handleQuery(userQuery, documentIds, userId, conversationHistory)` — end-to-end query orchestrator:
1. `compiledGraph.invoke({ query, documentIds, userId })` — runs full LangGraph pipeline
2. Destructures `{ answer, chunks, strategy, queryReasoning }` from graph output
3. Fetches document titles from PostgreSQL via Map (O(1) lookup, not N+1)
4. Returns `{ answer, debugInfo: DebugInfo }` with `retrievalReason` sourced from LLM reasoning

---

## Pending Components

### `src/observability/` — Debug Layer

Every query response includes:
```json
{
  "selectedRetriever": "semantic",
  "retrievalReason": ["precise question detected"],
  "retrievedChunks": 5,
  "executionTime": 1200
}
```

---

### API Routes

**POST /api/ingest**
```json
Input:  { "type": "pdf", "source": "..." }
Output: { "documentId": "...", "status": "completed" }
```

**POST /api/query**
```json
Input:  { "query": "What is JWT?" }
Output: { "answer": "...", "debug": {} }
```

---

## Development Order

### V1 — Foundation
| # | Component | Status |
|---|---|---|
| 1 | Qdrant Setup | ✅ Done |
| 2 | PostgreSQL Setup | ✅ Done |
| 3 | PDF Loader | ✅ Done |
| 4 | Website Loader | ✅ Done |
| 5 | GitHub Loader | ✅ Done |
| 6 | Recursive Chunking | ✅ Done |
| 7 | Markdown Chunking | ✅ Done |
| 8 | Embeddings | ✅ Done |
| 9 | Semantic Retriever + Summary Retriever | ✅ Done |
| 10 | Rule-based Query Analyzer + Retrieval Router | ✅ Done |
| 11 | Answer Generation (LLM + prompt) | ✅ Done |
| 12 | POST /api/ingest + POST /api/query | ✅ Done |
| 13 | Frontend — chat UI, debug panel, source selector | ✅ Done |

### V2 — Smarter Retrieval
| # | Component | Status |
|---|---|---|
| 14 | LangGraph pipeline (5 nodes) | ✅ Done |
| 15 | Hybrid Retrieval — dense + sparse (BM25) + RRF fusion | ✅ Done |
| 16 | CRAG — LLM evaluator + web search fallback | ✅ Done |
| 17 | Tool Calling (graph-controlled, Approach 3) | ✅ Done |
| 18 | Multi-Query Retrieval | 🔴 Pending |
| 19 | CRAG Retry Loop | 🔴 Pending |
| 20 | Queue-based Ingestion (BullMQ + Redis) | 🔴 Pending |
| 21 | SSE Streaming for Query API | 🔴 Pending |
| 22 | URL Fetcher Tool | 🔴 Pending |

### V3 — Production Hardening
| # | Component | Status |
|---|---|---|
| 23 | LLM-based Query Analyzer (replaces rule-based) | ✅ Done |
| 24 | Cross-Encoder Reranker | ✅ Done |
| 25 | Ingestion Deduplication (SHA-256 hash) | ✅ Done |
| 26 | Transactional Ingestion (`vectorized` flag + rollback) | ✅ Done |
| 27 | Authentication — Option A (Clerk gate) | ✅ Done |
| 28 | Authentication — Option B (per-user document isolation) | ✅ Done |
| 29 | Rate Limiting (Redis sliding window) | ✅ Done |
| 30 | Conversational Query Rewriting | ✅ Done |
| 31 | Ingestion Input Validation + SSRF protection | ✅ Done |
| 32 | Persistent Query Logs (`query_logs` table) | ✅ Done |
| 33 | Error Handling — typed errors, backoff, circuit breaker | 🔴 Pending |
| 34 | Observability Layer (debug storage + dashboards) | 🔴 Pending |

### V4 — Agentic Capabilities
| # | Component | Status |
|---|---|---|
| 35 | Full LLM Tool Calling — ReAct pattern (Approach 2) | 🔴 Pending |
| 36 | MCP Consumer Integration | 🔴 Pending |
| 37 | Planner + Research Agent | 🔴 Pending |

### V5 — Multi-Agent + Memory
| # | Component | Status |
|---|---|---|
| 38 | Multi-Agent Architecture (Planner, Retrieval, Research, Review) | 🔴 Pending |
| 39 | Self-RAG (groundedness + faithfulness scoring) | 🔴 Pending |
| 40 | Custom Memory Layer (PostgreSQL-backed, per-user/session) | 🔴 Pending |
| 41 | Maxtern as MCP Server | 🔴 Pending |
| 42 | RAG Evaluation (Ragas / DeepEval) | 🔴 Pending |

---

## Frontend

### Overview

React (Next.js App Router) chatbot UI. Two-panel layout — left sidebar for chat history, main area for active chat.

---

### Layout

```
┌─────────────────┬────────────────────────────────────────┐
│   Sidebar       │           Main Chat Area               │
│                 │                                        │
│  + New Chat     │  ┌──────────────────────────────────┐  │
│  ─────────────  │  │        Welcome / Source Select   │  │
│  Chat 1         │  │                                  │  │
│  Chat 2         │  │   [ PDF ]  [ URL ]  [ GitHub ]   │  │
│  Chat 3         │  │                                  │  │
│  ...            │  │   or just start typing below     │  │
│                 │  └──────────────────────────────────┘  │
│                 │                                        │
│                 │  ┌──────────────────────────────────┐  │
│                 │  │  Message input + Send button     │  │
│                 │  └──────────────────────────────────┘  │
└─────────────────┴────────────────────────────────────────┘
```

---

### Pages & Routes

| Route | Component | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Redirect to `/chat` or landing |
| `/chat` | `app/chat/page.tsx` | New chat — shows source selection screen |
| `/chat/[chatId]` | `app/chat/[chatId]/page.tsx` | Active chat conversation |

---

### Components

```
src/components/
  layout/
    Sidebar.tsx               Chat list + New Chat button
    ChatLayout.tsx            Two-panel wrapper

  chat/
    ChatWindow.tsx            Main conversation area
    MessageList.tsx           Scrollable list of messages
    MessageBubble.tsx         Single message (user / assistant)
    MessageInput.tsx          Text input + send button

  onboarding/
    SourceSelector.tsx        Shown when starting a new chat
    PDFUpload.tsx             File input for PDF
    URLInput.tsx              Text input for website URL
    GitHubInput.tsx           Text input for GitHub repo URL + branch

  debug/
    DebugPanel.tsx            Collapsible panel per assistant message — full retrieval trace
    DebugSummaryBar.tsx       Compact one-line bar: retriever used, chunks fetched, latency, tokens
    ChunkCard.tsx             Single retrieved chunk — content preview, score, source doc, chunkIndex
    ChunkList.tsx             Scrollable list of ChunkCards ranked by similarity score
    RetrieverBadge.tsx        Pill showing "semantic" or "summary" + reason why it was selected
    TokenUsage.tsx            Token breakdown — prompt tokens, completion tokens, total cost estimate
```

---

### Chat Flow

**New chat — with source:**
```
User clicks "New Chat"
  ↓
SourceSelector shown — PDF / URL / GitHub options
  ↓
User selects source type + provides input
  ↓
POST /api/ingest → documentId returned
  ↓
Chat created, documentId attached to session
  ↓
User types query → POST /api/query (with documentId)
  ↓
Answer + debug info shown
```

**New chat — without source (general):**
```
User clicks "New Chat"
  ↓
SourceSelector shown — user skips / types directly
  ↓
POST /api/query (no documentId — searches across all stored docs)
  ↓
Answer + debug info shown
```

---

### State Shape (per chat session)

```typescript
type ChatSession = {
  id: string
  title: string                        // auto-generated from first message
  documentId?: string                  // set if source was ingested
  sourceType?: "pdf" | "website" | "github"
  messages: Message[]
  createdAt: Date
}

type Message = {
  id: string
  role: "user" | "assistant"
  content: string
  debug?: DebugInfo                    // only on assistant messages
}

type DebugInfo = {
  selectedRetriever: "semantic" | "summary"
  retrievalReason: string[]           // e.g. ["precise question detected"]
  retrievedChunks: number             // count of chunks fetched
  executionTime: number               // ms — total query execution time
  chunks: RetrievedChunkDebug[]       // each chunk with score + source info
  tokens: TokenUsage                  // cost breakdown
}

type RetrievedChunkDebug = {
  chunkId: string
  documentId: string
  sourceType: "pdf" | "website" | "github"
  sourceTitle: string                 // document title
  chunkIndex: number                  // position within document
  score: number                       // Qdrant similarity score (0–1)
  contentPreview: string              // first ~150 chars of chunk
}

type TokenUsage = {
  promptTokens: number                // context + query tokens sent to LLM
  completionTokens: number            // tokens in LLM response
  totalTokens: number
  estimatedCost: string               // e.g. "$0.0012" — based on model pricing
  ragUsed: boolean                    // true if retrieval happened, false if direct LLM
}
```

---

### UI States to Handle

| State | Behavior |
|---|---|
| Ingestion in progress | Loading spinner, input disabled |
| Ingestion failed | Error message, retry option |
| Query loading | Streaming or loading indicator on assistant bubble |
| Empty chat (no source) | Show source selector + "or ask anything" prompt |
| Debug panel | Collapsible, shown below each assistant message — full retrieval trace |
| No RAG used | TokenUsage still shown, `ragUsed: false`, chunk list empty |

---

### Frontend Status

| Component | Status |
|---|---|
| Sidebar (with logout button) | ✅ Done |
| ChatLayout | ✅ Done |
| ChatWindow | ✅ Done |
| MessageList / MessageBubble | ✅ Done |
| MessageInput | ✅ Done |
| SourceSelector | ✅ Done |
| PDFUpload / URLInput / GitHubInput | ✅ Done |
| DebugPanel (container) | ✅ Done |
| DebugSummaryBar | ✅ Done |
| ChunkCard + ChunkList | ✅ Done |
| RetrieverBadge | ✅ Done |
| TokenUsage | ✅ Done |
| ThemeToggle (dark/light) | ✅ Done |
| `/sign-in` — custom Clerk sign-in page | ✅ Done |
| `/sign-up` — custom Clerk sign-up page (2-step) | ✅ Done |
| `/sso-callback` — Google OAuth callback handler | ✅ Done |
| `/chat` route | ✅ Done |
| `/chat/[chatId]` route | 🔴 Not needed (single-session V1) |

### Session Isolation
- `documentIds` stored in `ChatSession`
- Passed to `/api/query` → `handleQuery` → `retrievalRouter` → retrievers
- Qdrant filter: `match: { any: documentIds }` — only session's chunks searched
- No documentIds → general LLM answer (no retrieval)

### Conversation History
- `session.messages` passed from `ChatWindow` → `/api/query`
- Route converts `Message[]` → `HumanMessage[]` / `AIMessage[]` (LangChain types)
- `generateAnswer` accepts `BaseMessage[]` — passed to both `qaPrompt` and `generalPrompt`
- Prompts use `ChatPromptTemplate` + `MessagesPlaceholder("history")` — proper multi-turn

### Session Persistence
- `sessions` + `activeChatId` synced to `localStorage` via `useEffect` in `ChatPage`
- Loaded on mount — `hydrated` flag prevents SSR/client flash
- `createdAt` Date serialization handled — `new Date(s.createdAt)` on parse

### PDF Upload
- File picker (`<input type="file">`) instead of path input
- Frontend sends `FormData` (multipart) — server detects via `Content-Type` header
- Server saves to `/tmp/uuid.pdf` → `ingestDocument` → `unlinkSync` cleanup in `finally`

### UX Flow (current)
- Unauthenticated users redirected to `/sign-in` via Clerk middleware
- Signed-in users visiting `/sign-in` or `/sign-up` redirected to `/chat`
- Sign-in supports email/password + Google OAuth + device trust (email OTP on new device)
- Sign-up is 2-step: collect info → verify email OTP → redirect to `/chat`
- Logout button in sidebar footer (LogOut icon, next to ThemeToggle)
- No blocking source selector screen — chat starts immediately after login
- Paperclip button in input opens bottom Sheet with SourceSelector
- Source badge shown at top after ingest — clickable to change source
- Dark/light theme toggle in sidebar footer
- Markdown rendered in assistant messages via `react-markdown`

---

## Known Decisions & Trade-offs

| Decision | Reason |
|---|---|
| Qdrant stores only references, not content | PostgreSQL is source of truth for content; enables SQL queries, JOINs, relational integrity |
| Manual retrieval (no LangChain VectorStore abstraction) | Our hybrid Qdrant+Postgres setup doesn't map to LangChain's QdrantVectorStore which stores content in Qdrant payload |
| Batch embedding (`embedTexts`) over per-chunk (`embedText`) | Single model call for all chunks — significantly more efficient |
| Clerk v7 custom flow — `signIn.password()` + `signIn.finalize()` | Clerk v7 replaced the v6 hook API: methods return `{ error }` instead of throwing; `setActive()` replaced by `finalize()`; manual `router.push()` required after finalize |
| `src/middleware.ts` not project root | Next.js resolves middleware from `src/` when app uses the `src/` directory layout — placing it at root is silently ignored |
| Auth Option A before Option B | Option A (gate) is a prerequisite for Option B (per-user isolation) — no point scoping queries by userId before users exist |
| `Promise.all` for chunk storing | Parallel PostgreSQL + Qdrant writes per chunk — faster than sequential loop |
| `he` library for HTML entity decoding | Normalizer responsibility, not loader's — loaders return raw, normalizer cleans |
| `MarkdownTextSplitter` over `MarkdownHeaderTextSplitter` | `MarkdownHeaderTextSplitter` is Python-only; JS equivalent is `MarkdownTextSplitter` |
| Ollama for embeddings (dev) | Local, free, no API key. Switch to OpenAI for production — one line change in embedder.ts |
| `userId` in Qdrant payload deferred | V1 is single-user; add for multi-tenancy when needed |
