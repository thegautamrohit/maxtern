# Maxtern — Project State

Last updated: 2026-06-14

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
id         String   @id @default(cuid())
title      String
content    String   (full raw text of the source)
sourceType String   (pdf | website | github)
metadata   Json
chunk      Chunk[]  (relation)
createdAt  DateTime @default(now())
```

**Chunk**
```
id         String   @id @default(cuid())
content    String   (chunk text)
metadata   Json
chunkIndex Int      (position within document)
documentId String   (FK → Document.id)
document   Document @relation(...)
createdAt  DateTime @default(now())
```

### Qdrant (Collection: "chunks")

```
id      String   (same as PostgreSQL Chunk.id)
vector  float[]  (768 dims — nomic-embed-text, Cosine similarity)
payload:
  chunkId     String   (PostgreSQL Chunk.id — for content lookup)
  documentId  String   (PostgreSQL Document.id)
  sourceType  String   (pdf | website | github)
```

**Key design decision:** Qdrant stores only vectors + reference IDs. Content lives exclusively in PostgreSQL. Query time: Qdrant returns chunkIds → PostgreSQL fetches content.

**Future:** `userId` will be added to Qdrant payload for per-user document isolation (multi-tenancy via Qdrant filter).

---

## Folder Structure

```
src/
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
  workflows/
    ingest.ts                       ✅ Done
  retrieval/
    retrievers/
      semantic-retriever.ts         ✅ Done
      summary-retriever.ts          ✅ Done
    query-analyzer.ts               ✅ Done
    retrieval-router.ts             ✅ Done
  llm/
    llm.ts                          ✅ Done
  prompts/
    prompt.ts                       ✅ Done
  workflows/
    query.ts                        ✅ Done
  observability/                    ⏸ Deferred to V2

app/
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
interface Document {
  title: string
  content: string
  sourceType: "pdf" | "website" | "github"
  metadata: any
}

interface Chunk {
  content: string
  chunkIndex: number
  metadata: any
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

**`storeChunk(chunk, vector, documentId)`** — saves Chunk to PostgreSQL, then upserts point to Qdrant with `id = chunk.id`, vector, and payload `{ chunkId, documentId, sourceType }`

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

### `src/workflows/ingest.ts`

Main ingestion orchestrator. Entry point for all document ingestion.

**`ingestDocument(sourceType, source, branch?)`**

1. Calls `ensureCollections()` — Qdrant collection guaranteed to exist
2. Routes to correct loader based on `sourceType`
3. Calls `processSingleDocument` for each document

**`processSingleDocument(doc, sourceType)`** (internal)

1. `normalizeDocument` — clean HTML entities, whitespace
2. `storeDocument` — save to PostgreSQL, get `documentId`
3. Chunk — GitHub → `markdownChunk`, PDF/Website → `recursiveChunk`
4. `embedTexts` — batch embed all chunk contents
5. `Promise.all(chunks.map(...storeChunk...))` — parallel store to PostgreSQL + Qdrant

GitHub returns `Document[]` → looped. PDF/Website return single `Document` → direct call.

---

## Completed Components (continued)

### `src/retrieval/retrievers/semantic-retriever.ts`

Accepts a query string, embeds it, searches Qdrant for top-5 similar chunks, fetches content from PostgreSQL, and returns `RetrievedChunk[]`.

Key details:
- `embedText(query)` → 768-dim vector
- `qdrant.search("chunks", { vector, limit: 5 })` → top 5 points
- chunkIds extracted from Qdrant payload → `prisma.chunk.findMany`
- Score + sourceType mapped via a `Map` for O(1) lookup (not filter per chunk)
- `RetrievedChunk` type added to `src/core/types.ts`

---

## Completed Components (continued)

### `src/retrieval/retrievers/summary-retriever.ts`

Same flow as semantic retriever — `limit: 20` instead of 5. Kept as a separate file intentionally for future divergence (document-level filtering, different scoring logic in V2).

---

### `src/retrieval/query-analyzer.ts`

Rule-based, no LLM. Checks if query contains summary keywords (`summary`, `summarise`, `overview`, `architecture`) using `.some()` — returns `"summary"` or `"semantic"` as `RetrievalStrategy`.

---

### `src/retrieval/retrieval-router.ts`

Takes `RetrievalStrategy` + `query`, calls the correct retriever, returns `Promise<RetrievedChunk[]>`.

---

### `src/prompts/prompt.ts`

`qaPrompt` — LangChain `PromptTemplate` with `{context}` and `{userQuery}` variables. Instructs LLM to answer using only retrieved context. Returns "I don't have enough information" if answer not in context.

---

### `src/llm/llm.ts`

`generateAnswer(query, chunks)` — builds context string from chunk contents, pipes `qaPrompt | ChatOllama("llama3") | StringOutputParser` via LCEL chain, returns answer as `Promise<string>`.

---

### `src/workflows/query.ts`

`handleQuery(userQuery)` — end-to-end query orchestrator:
1. `queryAnalyzer` → `RetrievalStrategy`
2. `retrievalRouter` → `RetrievedChunk[]`
3. `generateAnswer` → answer string
4. Fetches document titles from PostgreSQL via Map (O(1) lookup, not N+1)
5. Returns `{ answer, debugInfo: DebugInfo }` — tokens placeholder for now

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

## Development Order (per PROJECT_SPECS.md)

### Phase 1 — V1 Foundation
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
| 9 | Semantic Retriever | ✅ Done |
| 10 | Query API | ✅ Done |
| 11 | Answer Generation | ✅ Done |

### Phase 2 — Adaptive Retrieval
| # | Component | Status |
|---|---|---|
| 12 | Summary Retriever | ✅ Done |
| 13 | Query Analyzer | ✅ Done |
| 14 | Retrieval Router | ✅ Done |
| 15 | Observability | ⏸ Deferred to V2 |

### Phase 3 — V2
| # | Component | Status |
|---|---|---|
| 16 | LangGraph | 🔴 Pending |
| 17 | Hybrid Retrieval | 🔴 Pending |
| 18 | CRAG | 🔴 Pending |

### Phase 4 — V3
| # | Component | Status |
|---|---|---|
| 19 | Tool Calling | 🔴 Pending |
| 20 | MCP Integration | 🔴 Pending |
| 21 | Agents | 🔴 Pending |

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
| Sidebar | ✅ Done |
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
| `/chat` route | ✅ Done |
| `/chat/[chatId]` route | 🔴 Not needed (single-session V1) |

### Session Isolation
- `documentIds` stored in `ChatSession`
- Passed to `/api/query` → `handleQuery` → `retrievalRouter` → retrievers
- Qdrant filter: `match: { any: documentIds }` — only session's chunks searched
- No documentIds → general LLM answer (no retrieval)

### UX Flow (current)
- No blocking source selector screen — chat starts immediately
- Paperclip button in input opens bottom Sheet with SourceSelector
- Source badge shown at top after ingest — clickable to change source
- Dark/light theme toggle in sidebar footer

---

## Known Decisions & Trade-offs

| Decision | Reason |
|---|---|
| Qdrant stores only references, not content | PostgreSQL is source of truth for content; enables SQL queries, JOINs, relational integrity |
| Manual retrieval (no LangChain VectorStore abstraction) | Our hybrid Qdrant+Postgres setup doesn't map to LangChain's QdrantVectorStore which stores content in Qdrant payload |
| Batch embedding (`embedTexts`) over per-chunk (`embedText`) | Single model call for all chunks — significantly more efficient |
| `Promise.all` for chunk storing | Parallel PostgreSQL + Qdrant writes per chunk — faster than sequential loop |
| `he` library for HTML entity decoding | Normalizer responsibility, not loader's — loaders return raw, normalizer cleans |
| `MarkdownTextSplitter` over `MarkdownHeaderTextSplitter` | `MarkdownHeaderTextSplitter` is Python-only; JS equivalent is `MarkdownTextSplitter` |
| Ollama for embeddings (dev) | Local, free, no API key. Switch to OpenAI for production — one line change in embedder.ts |
| `userId` in Qdrant payload deferred | V1 is single-user; add for multi-tenancy when needed |
