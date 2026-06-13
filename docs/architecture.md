# Maxtern — System Architecture

---

# System Overview

Maxtern is an Adaptive Retrieval Runtime (ARR). It ingests documents from multiple sources, stores them as searchable vector chunks, and answers user queries by selecting the right retrieval strategy before generating a grounded response.

The core principle: **every query is analyzed before retrieval happens**. The system decides how to retrieve based on what the user is asking — not a one-size-fits-all vector search.

```
┌─────────────────────────────────────────────────────────────┐
│                        Maxtern                              │
│                                                             │
│   ┌──────────┐    ┌───────────────┐    ┌─────────────────┐  │
│   │ Ingestion│    │   Retrieval   │    │ Answer          │  │
│   │ Pipeline │    │   Pipeline    │    │ Generation      │  │
│   └──────────┘    └───────────────┘    └─────────────────┘  │
│        │                 │                      │           │
│        ▼                 ▼                      ▼           │
│   ┌──────────────────────────────────────────────────────┐  │
│   │               Storage Layer                          │  │
│   │         PostgreSQL          Qdrant                   │  │
│   └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Tech Stack**

| Layer | Technology |
|---|---|
| Framework | Next.js (App Router) + TypeScript |
| AI Framework | LangChain JS v1.x |
| Vector DB | Qdrant — Cosine similarity, 768 dims |
| Relational DB | PostgreSQL via Prisma 6 + PrismaPg adapter |
| Embeddings | Ollama (nomic-embed-text) → OpenAI in production |
| LLM | OpenAI / Anthropic / Gemini |
| Infra | Docker Compose (local) |

---

# Data Flow

## Ingestion Flow

```
User provides source (PDF path / Website URL / GitHub URL)
        │
        ▼
   [ Loader ]
   PDF Loader → single Document
   Website Loader → single Document
   GitHub Loader → Document[] (one per file)
        │
        ▼
   [ Normalizer ]
   HTML entity decode (he library)
   Whitespace cleanup (regex)
   Output: Document (cleaned)
        │
        ▼
   [ PostgreSQL — Document saved ]
   prisma.document.create(...)
   Returns: documentId
        │
        ▼
   [ Chunker ]
   PDF / Website → RecursiveCharacterTextSplitter (1000 / 200)
   GitHub       → MarkdownTextSplitter (1000 / 200)
   Output: Chunk[]
        │
        ▼
   [ Embedder ]
   embedTexts([...chunk contents]) — single batch call
   Output: number[][] (one vector per chunk, 768 dims)
        │
        ▼
   [ Store — parallel ]
   For each chunk:
     1. prisma.chunk.create(...)  → chunkId
     2. qdrant.upsert("chunks", { id: chunkId, vector, payload })
```

## Query Flow

```
User query: "What is JWT?"
        │
        ▼
   [ Query Analyzer ]
   Rule-based:
   "summarize" / "overview" / "architecture" → summary
   Everything else → semantic
        │
        ▼
   [ Retrieval Router ]
   Selects retriever based on analyzer output
        │
        ├── semantic → [ Semantic Retriever ]
        │                embedText(query) → Qdrant top-5 → PostgreSQL fetch
        │
        └── summary  → [ Summary Retriever ]
                         embedText(query) → Qdrant top-20 → PostgreSQL fetch
        │
        ▼
   [ LLM — Answer Generation ]
   Prompt: user query + retrieved chunk contents
   Rules: grounded answer only, no hallucination
        │
        ▼
   [ Response ]
   {
     answer: "...",
     debug: {
       selectedRetriever, retrievalReason,
       retrievedChunks, executionTime,
       chunks[{ score, sourceTitle, chunkIndex, contentPreview }],
       tokens: { promptTokens, completionTokens, estimatedCost, ragUsed }
     }
   }
```

---

# Ingestion Pipeline

## Loaders

Each loader is responsible for extracting raw text from a source. Loaders do not clean, normalize, or store anything — they only extract.

| Loader | LangChain Class | Input | Output |
|---|---|---|---|
| PDF | `PDFLoader` | File path | Single `Document` |
| Website | `CheerioWebBaseLoader` | URL | Single `Document` |
| GitHub | `GithubRepoLoader` | Repo URL + branch | `Document[]` |

**Document shape out of loaders:**
```typescript
{
  title: string        // extracted from source metadata
  content: string      // full raw text (all pages joined for PDF)
  sourceType: "pdf" | "website" | "github"
  metadata: object     // source-specific: filePath, totalPages, repoUrl, branch, etc.
}
```

**Known V1 limitation:** Bot-protected websites (Cloudflare, etc.) will fail with `CheerioWebBaseLoader`. Playwright-based loader is a V2 consideration.

## Normalizer

Runs after every loader, before any storage.

- HTML entity decoding via `he` library — handles `&#039;`, `&amp;`, `&lt;`, `&gt;`, `&quot;`
- Collapses 3+ consecutive newlines → 2 newlines
- Collapses multiple spaces/tabs → single space
- Trims leading/trailing whitespace

**Why normalizer, not loader:** Loaders return raw source output. Normalization is a separate concern applied uniformly regardless of source type.

## Chunkers

| Chunker | Used For | LangChain Class | Size / Overlap |
|---|---|---|---|
| Recursive | PDF, Website | `RecursiveCharacterTextSplitter` | 1000 / 200 |
| Markdown | GitHub | `MarkdownTextSplitter` | 1000 / 200 |

Markdown chunker preserves section structure. Recursive chunker splits by characters with fallback separators (`\n\n`, `\n`, ` `).

**Note:** `MarkdownHeaderTextSplitter` is Python-only. `MarkdownTextSplitter` is the JS equivalent.

---

# Retrieval Pipeline

## Semantic Retriever

For precise questions — "What is JWT?", "How does login work?", "Explain middleware."

```
query string
  ↓
embedText(query) → number[] (768 dims)
  ↓
qdrant.search("chunks", { vector, limit: 5 })
  ↓
extract chunkIds from Qdrant payload
  ↓
prisma.chunk.findMany({ where: { id: { in: chunkIds } } })
  ↓
return RetrievedChunk[] { content, score, metadata }
```

Top K = 5

## Summary Retriever

For broad questions — "Summarize this document", "Give an overview", "Explain the architecture."

Same flow as semantic but Top K = 20–30. Retrieves a wider coverage of the document before generating a summary-style answer.

## Query Analyzer

Rule-based — no LLM involved.

```
query.toLowerCase() contains any of:
  "summarize", "overview", "architecture", "explain", "what is this about"
    → strategy: "summary"

otherwise
    → strategy: "semantic"
```

File: `src/retrieval/query-analyzer.ts`

## Retrieval Router

Takes the analyzer output and calls the correct retriever.

```typescript
analyzerOutput === "summary"  → summaryRetriever(query)
analyzerOutput === "semantic" → semanticRetriever(query)
```

File: `src/retrieval/retrieval-router.ts`

---

# Embedding Pipeline

Single file: `src/embeddings/embedder.ts`

**Model:** `nomic-embed-text` via Ollama (local dev) → `text-embedding-3-small` via OpenAI (production)

**Dimensions:** 768 (Ollama) → 1536 (OpenAI)

**Functions:**
- `embedText(text: string): Promise<number[]>` — single embedding, used at query time
- `embedTexts(texts: string[]): Promise<number[][]>` — batch embedding, used at ingestion time

**Why batch at ingestion:** A document can produce 50–200 chunks. One `embedTexts` call is dramatically more efficient than 50–200 individual `embedText` calls.

**Switching providers:** Change one import in `embedder.ts`. Qdrant collection must be recreated when switching (dimension change: 768 → 1536).

---

# Router

The Retrieval Router is the decision point of the query pipeline. It sits between Query Analysis and Retrieval Execution.

```
                    ┌─────────────────┐
    query ────────▶ │  Query Analyzer │
                    └────────┬────────┘
                             │
                    strategy: "semantic" | "summary"
                             │
                    ┌────────▼────────┐
                    │ Retrieval Router│
                    └────────┬────────┘
                             │
               ┌─────────────┴─────────────┐
               ▼                           ▼
    ┌──────────────────┐       ┌──────────────────────┐
    │ Semantic Retriever│      │  Summary Retriever    │
    │  top-5 chunks     │      │  top-20/30 chunks     │
    └──────────────────┘       └──────────────────────┘
```

**V2 extension:** Router will be replaced by a LangGraph node that can handle more complex routing logic — multi-query, CRAG retry, hybrid search fallback.

---

# Storage Layer

## PostgreSQL

Managed via Prisma 6 with PrismaPg adapter.

**Document table** — one row per ingested source. Stores full raw content.

**Chunk table** — many rows per document. Stores chunk text + position. FK to Document with cascade delete.

**Purpose:** Source of truth for all text content. Enables SQL queries, JOINs, full-text search, relational integrity.

## Qdrant

Collection: `"chunks"` — created once via `ensureCollections()` (idempotent).

**Point structure:**
```
id:      String  (= PostgreSQL Chunk.id — same ID, shared key)
vector:  float[] (768 dims, Cosine similarity)
payload:
  chunkId:    String  (PostgreSQL Chunk.id)
  documentId: String  (PostgreSQL Document.id)
  sourceType: String
```

**Purpose:** Vector similarity search only. Does not store content. Returns chunkIds → PostgreSQL fetches content.

## Why two databases

| Concern | PostgreSQL | Qdrant |
|---|---|---|
| Content storage | ✅ | ✗ |
| Similarity search | ✗ | ✅ |
| Relational queries / JOINs | ✅ | ✗ |
| Keyword / full-text search | ✅ (ILIKE / tsvector) | ✅ (sparse vectors — V2) |
| Filtering by userId, docId | SQL WHERE | Qdrant payload filter |
| Referential integrity | FK + cascade | ✗ |

## Multi-tenancy (planned, not V1)

Add `userId` to Qdrant payload. At query time, apply filter:
```typescript
filter: { must: [{ key: "userId", match: { value: userId } }] }
```
This isolates each user's retrieval without separate collections.

---

# Observability Layer

First-class feature. Every query execution must be explainable.

## Debug Response Shape

Attached to every assistant message in the API response.

```typescript
type DebugInfo = {
  selectedRetriever: "semantic" | "summary"
  retrievalReason: string[]        // why this retriever was chosen
  retrievedChunks: number          // how many chunks were fetched
  executionTime: number            // total ms for the query pipeline
  chunks: RetrievedChunkDebug[]    // each chunk ranked by score
  tokens: TokenUsage               // LLM token + cost breakdown
}

type RetrievedChunkDebug = {
  chunkId: string
  documentId: string
  sourceType: "pdf" | "website" | "github"
  sourceTitle: string              // document title from PostgreSQL
  chunkIndex: number               // position within the document
  score: number                    // Qdrant similarity score (0–1)
  contentPreview: string           // first ~150 chars of chunk content
}

type TokenUsage = {
  promptTokens: number             // tokens sent to LLM (context + query)
  completionTokens: number         // tokens in the LLM response
  totalTokens: number
  estimatedCost: string            // e.g. "$0.0012"
  ragUsed: boolean                 // false if no retrieval happened
}
```

## Frontend Debug UI

Every assistant message has a collapsible debug panel:

- `DebugSummaryBar` — one-line: retriever used, chunk count, latency, token cost
- `RetrieverBadge` — pill: "semantic" or "summary" + reason
- `ChunkList` → `ChunkCard` — each retrieved chunk: score, source title, chunkIndex, content preview
- `TokenUsage` — prompt / completion / total tokens + estimated cost

---

# API Layer

Next.js Route Handlers under `app/api/`.

## POST /api/ingest

```
Input:
{
  "type": "pdf" | "website" | "github",
  "source": "...",       // file path, URL, or GitHub repo URL
  "branch": "main"       // optional, GitHub only
}

Output:
{
  "documentId": "...",
  "status": "completed"
}
```

Internally calls: `ingestDocument(sourceType, source, branch?)`

## POST /api/query

```
Input:
{
  "query": "What is JWT?",
  "documentId": "..."    // optional — scoped retrieval
}

Output:
{
  "answer": "...",
  "debug": { ...DebugInfo }
}
```

Internally calls: `queryWorkflow(query, documentId?)`

## Future: GET /api/documents

List all ingested documents. Used in sidebar to show what has been ingested.

---

# Future Roadmap

## V2 — Smarter Retrieval

**LangGraph Integration**
Replace the simple retrieval router with a LangGraph graph. Each node (Analyzer, Retriever, Generator) becomes a graph node. Enables conditional edges, retry loops, parallel retrieval.

**Hybrid Retrieval**
Combine dense vectors (semantic) with sparse vectors (BM25/keyword). Useful for API names, function names, error codes — terms that semantic search misses. Both Qdrant and PostgreSQL support this.

**Multi-Query Retrieval**
LLM generates 3–5 sub-queries from the original query. Each retrieved independently. Results merged and de-duplicated. Better coverage for complex questions.

**CRAG (Corrective RAG)**
After retrieval, evaluate chunk relevance scores. If scores are low (poor retrieval), retry with a reformulated query before generating the answer.

**Queue-based Ingestion**
BullMQ + Redis for async ingestion. Large PDFs and GitHub repos can take minutes — move to background jobs with status polling.

**SSE Streaming for Query API**
Implement Server-Sent Events (SSE) on `POST /api/query` for streaming LLM responses token-by-token. Industry standard approach used by OpenAI, Anthropic, Perplexity.

Event format:
```
data: {"type": "debug", "payload": {...debugInfo}}   ← sent first, after retrieval
data: {"type": "token", "payload": "JWT"}            ← one per LLM token
data: [DONE]                                         ← stream end signal
```

Flow: retrieval runs first → debug event sent → LLM streams tokens → [DONE].

Deferred to post-V2 — implement alongside BullMQ queues so long-running ingestion jobs and streaming query responses share the same async infrastructure. Frontend will use `fetch` with `ReadableStream` to consume the SSE stream.

## V3 — Agentic Capabilities

**Tool Calling**
LLM can call tools: web search, repository search, documentation lookup. Extends beyond ingested knowledge.

**MCP Integration**
Support external MCP servers — GitHub MCP, Filesystem MCP, Browser MCP. System becomes a runtime for MCP-powered knowledge retrieval.

**Planner + Research Agent**
Break complex queries into subtasks. Iterative retrieval across multiple sources. Structured report generation.

## V4 — Multi-Agent + Self-Evaluation

**Multi-Agent Architecture**
Separate agents for Planning, Retrieval, Research, Review. Agents coordinate via message passing.

**Self-RAG**
System evaluates its own retrieval quality and answer quality before responding. Retries if self-evaluation fails.

**Long-Term Memory**
Conversation-level memory. System remembers context across sessions.
