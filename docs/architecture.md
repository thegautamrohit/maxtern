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
| Auth | Clerk v7 (`@clerk/nextjs@^7`) |
| Rate Limiting | Upstash Redis + `@upstash/ratelimit` (sliding window) |
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
   [ Deduplication Check ] (#25)
   SHA-256 hash of normalized content
   prisma.document.findUnique({ userId_contentHash })
   Duplicate → return existing documentId, skip ingestion
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
   [ Phase 1 — PostgreSQL Transaction ] (#26)
   prisma.$transaction → all chunks written atomically with vectorized: false
   Partial PG write impossible — all commit or none do
        │
        ▼
   [ Phase 2 — Qdrant Upsert ] (#26)
   Promise.all(upsertChunksInQdrant) for all chunks
   Success → markChunksVectorised(chunkIds) → vectorized: true
   Failure → deleteMany(chunkIds) rollback PG rows → throw
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

# Project Status

## V1 — Complete ✅

V1 is fully implemented. The core ingestion and retrieval pipeline is production-ready at the feature level.

**Completed:**
- PDF, Website, GitHub loaders + normalizer
- Recursive and Markdown chunkers
- Batch embedding pipeline (Ollama local → OpenAI in production)
- Qdrant vector storage + PostgreSQL chunk storage (shared ID key)
- Semantic retriever (top-5) and Summary retriever (top-20)
- Rule-based query analyzer and retrieval router
- RRF (Reciprocal Rank Fusion) for hybrid dense + sparse ranking
- Grounded LLM answer generation
- Full debug response layer — chunks, scores, tokens, latency, cost
- Frontend debug UI — `DebugSummaryBar`, `RetrieverBadge`, `ChunkList`, `TokenUsage`
- `POST /api/ingest` and `POST /api/query` route handlers

## V2 — Largely Complete ✅

V2 is further along than the roadmap reflects. Most V2 features are shipped.

**Completed:**
- Full LangGraph pipeline — 5 nodes: `analyzerNode → retrieverNode → evaluatorNode → generatorNode → webSearchNode`
- LLM-based CRAG evaluator using `qwen3:4b` via Ollama — replaces the broken RRF score threshold
- Hybrid retrieval with RRF fusion (K=60) — custom TF-hash sparse embedder alongside dense vectors
- Serper API web search fallback — triggered globally from evaluator node
- Frontend chat UI and debug panel updated
- `POST /api/query` and `POST /api/ingest` route handlers updated

**Remaining V2 work:**
- Multi-query retrieval (LLM generates sub-queries, results merged via RRF)
- CRAG retry loop (reformulate + retry once before generating)
- Queue-based ingestion (BullMQ + Redis)
- SSE streaming for query API
- `url_fetcher` tool

---

# Roadmap

## V2 — Smarter Retrieval (Remaining items)

Core V2 is shipped. See Project Status above for what is complete. The following items remain.

**Multi-Query Retrieval**
LLM generates 3–5 sub-queries from the original query. Each retrieved independently from Qdrant. Results merged and de-duplicated via RRF before passing to the evaluator. Better coverage for comparative and multi-hop questions.

**CRAG Retry Loop**
If the evaluator returns `relevant: false` and web search also returns low-quality results, the graph reformulates the query and retries retrieval once before generating. Max one retry — avoids infinite loops.

**Queue-based Ingestion**
BullMQ + Redis for async ingestion. Large PDFs and GitHub repos can take minutes — synchronous ingestion on a web request will time out in production.

```
POST /api/ingest → returns { jobId, status: "queued" } immediately
BullMQ worker   → runs ingestion pipeline in background
GET /api/ingest/status/:jobId → client polls for progress
```

**SSE Streaming for Query API**
Server-Sent Events on `POST /api/query` for token-by-token LLM response streaming.

```
data: {"type": "debug", "payload": {...debugInfo}}   ← sent first, after retrieval
data: {"type": "token", "payload": "JWT"}            ← one per LLM token
data: [DONE]                                         ← stream end signal
```

Flow: retrieval runs first → debug event sent → LLM streams tokens → [DONE]. Frontend uses `fetch` with `ReadableStream`. Implemented alongside BullMQ so both share the same async infrastructure.

**URL Fetcher Tool**
Fetches full page content from a URL returned by web search. Serper returns snippets — when the LLM needs the full article or GitHub thread, this tool fetches and returns the complete text.

---

## V3 — Production Hardening

> **Note:** V3 is sequenced before V4 and V5 intentionally. Agentic features built on top of an unsecured, unvalidated system inherit its failure modes. Auth, dedup, error handling, and observability must be in place before adding agent complexity.

V3 does not add new capabilities. It addresses gaps that exist across V1–V2 that prevent Maxtern from running reliably in a real production environment. Every item in V3 is a correctness, security, or reliability fix — not a feature.

See the full V3 specification below.

---

## V4 — Agentic Capabilities

V4 evolves the tool calling pattern from graph-controlled (Approach 3, implemented in V2) to LLM-controlled (Approach 2, true ReAct). The graph decides when to call tools in V2. In V4, the LLM decides.

**Full LLM Tool Calling (Approach 2 — ReAct)**
The generator LLM is bound to the tool set. It emits `tool_call` responses when it needs information. A `ToolNode` intercepts, executes the tool, returns the result, and the LLM continues. The LLM is the decision-maker — not the graph.

```
generator LLM → emits tool_call → ToolNode executes → LLM sees result → answer
```

This is the canonical production agent pattern. V2's Approach 3 teaches tool definition (schema, description, `tool()` wrapper). V4's Approach 2 teaches LLM-driven execution. The tool definitions from V2 are reused unchanged — only control shifts from the graph to the LLM.

**Full Tool Set**
| Tool | Purpose |
|---|---|
| `document_search` | Searches Maxtern's ingested knowledge base (already in V1) |
| `web_search` | Live internet search for current information (Serper, added in V2) |
| `url_fetcher` | Fetches full page content from a URL returned by web search |
| `github_file_reader` | Reads a specific file from an ingested GitHub repo on demand |
| `calculator` | Reliable arithmetic via mathjs — for queries involving numbers from documents |
| `date_time` | Returns current date/time — fixes "latest / this week" query failures |

**MCP Consumer Integration**
Connect external MCP servers as tool sources — GitHub MCP, Filesystem MCP, Browser MCP. Maxtern becomes a runtime for MCP-powered knowledge retrieval. Tools registered via MCP are available to the LLM agent alongside native tools.

**Planner + Research Agent**
A dedicated planner node breaks complex queries into subtasks. Each subtask runs its own retrieval + tool loop. Results are assembled into a structured report. Used for: "Compare how three companies approach RAG in production", "Summarize everything we know about authentication across these five documents."

---

## V5 — Multi-Agent + Memory

**Multi-Agent Architecture**
Separate specialist agents for Planning, Retrieval, Research, and Review. Agents coordinate via message passing — the Planner assigns subtasks, each agent executes independently, the Planner assembles the final response.

```
                    ┌─────────────────┐
   User Query ────▶ │  Planner Agent  │
                    └────────┬────────┘
                             │ assigns subtasks
          ┌──────────────────┼──────────────────┐
          ▼                  ▼                  ▼
  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐
  │  Retrieval    │  │  Research     │  │  Review       │
  │  Agent        │  │  Agent        │  │  Agent        │
  │               │  │               │  │               │
  │ Searches      │  │ Web, GitHub,  │  │ Fact-checks   │
  │ ingested docs │  │ APIs, docs    │  │ all outputs   │
  └───────┬───────┘  └───────┬───────┘  └───────┬───────┘
          └──────────────────┼──────────────────┘
                             ▼
                    ┌─────────────────┐
                    │  Planner Agent  │
                    │  assembles      │
                    │  final answer   │
                    └─────────────────┘
```

**Self-RAG**
After generation, a separate evaluation pass scores the answer against retrieved chunks:
- Groundedness score — is every claim in the answer traceable to a chunk?
- Faithfulness score — does the answer contradict any retrieved content?
- Relevance score — does the answer actually address the query?

If any score falls below threshold, the system reformulates the query and retries before responding. Never silently returns a low-quality answer.

**Custom Memory Layer**
Conversation-level memory stored outside the model. Architecture:

```
Memory Write (after each turn):
  Extract entities and facts from the conversation
  Classify each: ADD | UPDATE | DELETE | NOOP
  Conflict resolution: UPDATE wins over ADD for same entity
  Store in PostgreSQL memory table (userId + sessionId scoped)

Memory Read (before retrieval):
  Query memory store using hybrid retrieval (same pattern as document retrieval)
  Relevance gate: only inject memories that score above threshold
  Inject as additional context into the LLM prompt
```

Custom memory layer chosen over Mem0 for learning depth and portfolio differentiation. Mem0 integration remains an option for production deployments that prioritise operational simplicity over control.

**Maxtern as an MCP Server**
Expose Maxtern's own retrieval capabilities as an MCP server — so any MCP-aware client (Claude Desktop, Cursor, VS Code) can query your ingested knowledge base as a tool.

```typescript
// MCP tools exposed:
// query_knowledge_base({ query: string, documentId?: string }) → answer + chunks
// ingest_document({ type, source, branch? }) → jobId
// list_documents() → Document[]
```

Any developer using Cursor or Claude Desktop can install the Maxtern MCP server and immediately have their ingested documents available as a tool in their IDE. This is the primary portfolio artifact — a real, installable product.

**RAG Evaluation (Ragas)**
Systematic measurement of retrieval and answer quality:

| Metric | What it measures |
|---|---|
| Context recall | Are the right chunks being retrieved? |
| Answer faithfulness | Does the answer stick to what the chunks say? |
| Answer relevance | Does the answer address what was asked? |
| Context precision | Are the retrieved chunks actually useful, or just noise? |

Implemented as a Python `evals/` directory alongside the TypeScript pipeline. Ragas or DeepEval. Run against a golden dataset of query/answer pairs to establish a baseline before any architecture change — so you can measure whether V5 changes actually improved quality or just changed behaviour.

---

# V3 — Production Hardening (Full Specification)

V3 does not add new capabilities. It addresses the gaps that exist across V1–V2 that prevent Maxtern from running reliably in a real production environment. Every item in V3 is a correctness, security, or reliability fix — not a feature.

---

### 1. LLM-Based Query Analyzer

**Problem:** The V1 query analyzer uses string matching — `query.toLowerCase().includes("summarize")`. This logic carries forward into V2, feeding the LangGraph router. LangGraph can have sophisticated conditional edges, but if the signal feeding it is wrong, every downstream routing decision is wrong. Natural language queries like "give me the gist of this" or "high level walkthrough" route to semantic, not summary, because they don't contain the exact trigger words.

**Fix:** Replace the rule-based analyzer with a single cheap LLM call (claude-haiku / gpt-4o-mini). The classifier receives the query and returns a structured JSON intent:

```typescript
type QueryIntent = {
  strategy: "factual" | "summary" | "comparative" | "multi-hop" | "conversational"
  confidence: number        // 0–1
  reasoning: string         // why this strategy was chosen — fed into debug panel
}
```

This call costs ~$0.0001 per query. It routes correctly on any phrasing, including follow-up questions and implicit intent. The `reasoning` field replaces the hardcoded `retrievalReason` strings currently in `DebugInfo`.

File: `src/retrieval/query-analyzer.ts` — same file, new implementation.

---

### 2. Cross-Encoder Reranker

**Problem:** Maxtern currently has no reranking step. After Qdrant returns top-K chunks by cosine similarity + RRF fusion, those chunks go directly to the CRAG evaluator and then the LLM in fusion score order. RRF is a rank-based heuristic — it has no understanding of the query or the content. It just says “this chunk ranked well in both dense and sparse lists.” That is a coarse signal.

**Why reranking fixes this:**

The retrieval pipeline uses bi-encoders (separate query and chunk embeddings, compared via cosine similarity). A cross-encoder works differently:

| | Bi-encoder (current retriever) | Cross-encoder (reranker) |
|---|---|---|
| How it scores | Encodes query and chunk **separately**, compares via cosine | Encodes query and chunk **together** in one forward pass |
| Attends across | Query alone, chunk alone | Query AND chunk simultaneously |
| Speed | Fast — chunk vectors precomputed | Slow — forward pass per query-chunk pair |
| Accuracy | Good but approximate | Significantly more accurate |
| Scale | Works over millions of chunks | Only feasible over small candidate sets (20–100) |

This is exactly why reranking is a **second-stage** filter. You cannot run a cross-encoder over the entire Qdrant index, but you can run it over the 20–30 candidates that hybrid retrieval + RRF already narrowed down.

**Why this matters more for Maxtern specifically:**

Maxtern ingests GitHub repositories and code files. Code retrieval is a case where bi-encoder embeddings underperform, because:
- Function names, variable names, and import statements carry meaning that general-purpose embedding models were not trained to weight correctly
- Two functions can be semantically close in embedding space but functionally unrelated
- The cross-encoder attends to the exact query tokens against the exact chunk tokens — it catches query-specific relevance that cosine similarity misses

**Fix:** Add a reranker node between the retriever and the CRAG evaluator.

```
Query
  ├→ Dense retriever → top-20
  └→ Sparse/BM25 retriever → top-20
           ↓
       RRF fusion → top-30 candidates
           ↓
       Cross-encoder reranker → re-score all 30
           ↓
       Dynamic top-K (chunks above relevance threshold)
           ↓
       CRAG evaluator → generator
```

The fusion step’s job changes once reranking is added: it no longer needs to nail precision, it just needs good **recall** — get the right chunk somewhere in the top-30, and let the reranker handle ordering and precision.

**Dynamic K:** Instead of hardcoded top-5 or top-20, retrieve top-30 from RRF, rerank, then pass only chunks scoring above a relevance threshold (e.g. `score > 0.75`). The reranker decides how many chunks the LLM sees — not a number baked into the code.

**Provider options:**
- **Cohere Rerank API** — drop-in, no infrastructure, pay-per-call
- **`cross-encoder/ms-marco-MiniLM-L-6-v2`** — local model, no API cost, runs via `@xenova/transformers` in the same Node.js process or via Ollama

**Recommended for Maxtern:** Local model via `@xenova/transformers`. Keeps the system fully self-hosted, no ongoing API cost, consistent with the enterprise private RAG use case.

File: `src/retrieval/reranker.ts` (new)

---

### 3. Ingestion Deduplication

**Problem:** No version in V1–V2 prevents the same document from being ingested twice. Ingesting the same PDF twice creates two `Document` rows in PostgreSQL and two full sets of chunk vectors in Qdrant. Retrieval then returns duplicate chunks for every query, wastes context window tokens, and inflates LLM cost. The system has no way to detect or recover from this state.

**Fix:** SHA-256 hash the source content immediately after loading, before normalization or storage. Store the hash on the `Document` table.

```typescript
// Schema addition
model Document {
  id          String   @id @default(cuid())
  contentHash String   @unique          // SHA-256 of raw content
  title       String
  content     String
  sourceType  String
  createdAt   DateTime @default(now())
  chunks      Chunk[]
}
```

On every ingest call, check the hash before proceeding:

```typescript
const hash = sha256(rawContent)
const existing = await prisma.document.findUnique({ where: { contentHash: hash } })
if (existing) return { documentId: existing.id, status: "duplicate" }
```

For updated sources (same URL, new content), the hash differs — ingestion proceeds and the old document is replaced.

---

### 4. Transactional Ingestion

**Problem:** The V1 ingestion store step writes to PostgreSQL and Qdrant in parallel for each chunk. If PostgreSQL succeeds but the Qdrant upsert fails mid-batch, the result is orphaned chunk rows in PostgreSQL with no corresponding vectors — content that is stored but can never be retrieved. There is no rollback mechanism in any version.

**Fix:** Two-phase ingestion with a `vectorized` flag and compensating rollback.

```typescript
// Schema addition
model Chunk {
  id         String   @id @default(cuid())
  documentId String
  content    String
  chunkIndex Int
  vectorized Boolean  @default(false)   // flipped to true after Qdrant upsert confirms
  document   Document @relation(fields: [documentId], references: [id], onDelete: Cascade)
}
```

**Phase 1:** Write all chunks to PostgreSQL with `vectorized: false`.

**Phase 2:** Batch upsert to Qdrant. On success, flip `vectorized: true` for confirmed chunk IDs. On failure, delete the PostgreSQL chunk rows for any chunk whose Qdrant upsert did not confirm.

Chunks with `vectorized: false` older than a configurable TTL (e.g. 1 hour) are detectable as orphans and can be retried or cleaned up by a background job.

---

### 5. Authentication

**Problem:** The multi-tenancy design (userId in Qdrant payload, SQL WHERE clause isolation) is described in V1 but has nothing to stand on — there is no authentication layer issuing or verifying a userId anywhere in the system. POST /api/query and POST /api/ingest are fully open across V1–V2.

**Fix:** Add authentication before the multi-tenancy filters can function.

**Provider:** NextAuth.js or Clerk (drop-in for Next.js App Router).

**Pattern:** userId is extracted from the verified session token on every request — never trusted from the request body.

```typescript
// app/api/query/route.ts
export async function POST(req: Request) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return new Response("Unauthorized", { status: 401 })

  const userId = session.user.id
  // userId now flows into Qdrant payload filter and Prisma WHERE clause
}
```

All existing multi-tenancy design described in V1 (`filter: { must: [{ key: "userId", match: { value: userId } }] }`) activates once this is in place. No changes to the storage layer are required — the design was correct, the enforcement was missing.

---

### 6. Rate Limiting

**Problem:** Every query call hits Qdrant, PostgreSQL, and an external LLM API with no throttle. A single user can exhaust the OpenAI budget in minutes. Ingestion is more expensive than querying — a large GitHub repo triggers hundreds of embedding API calls — and has no limit at all across any version.

**Fix:** Redis sliding window rate limiter on both routes, with separate limits per operation type.

```typescript
// Separate limits — ingestion is far more expensive than querying
const LIMITS = {
  query:  { requests: 30,  windowSeconds: 60  },
  ingest: { requests: 5,   windowSeconds: 300 }
}
```

Implementation: `@upstash/ratelimit` (Redis-backed, edge-compatible with Next.js). Returns `429` with a `Retry-After` header on breach.

Limit keys are scoped per `userId` once auth is in place. Before auth, scope to IP address as a baseline.

---

### 7. Conversational Query Rewriting ✅ Done

**Problem:** Follow-up queries like "how does it compare to sessions?" or "can you elaborate on that?" go to Qdrant verbatim. Qdrant embeds "it" and "that" — terms with no semantic meaning in isolation — and returns garbage retrieval results.

**Fix:** Merged into the query analyzer — single LLM call does both rewriting and intent classification. No separate rewriter file, no extra LLM call, no extra node in the graph.

```
History:    "Q: What is JWT? A: JWT is a stateless token..."
Raw query:  "How does it compare to sessions?"
Rewritten:  "How does JWT compare to session-based authentication?"
```

The prompt instructs the LLM to first resolve any references using conversation history, then classify the (resolved) intent. If no history exists or the query is already standalone, `rewrittenQuery` equals the original query unchanged.

**Implementation:**
- `queryIntentPrompt` — two-job prompt with `MessagesPlaceholder("history")`. Returns `rewrittenQuery`, `strategy`, `confidence`, `reasoning` in one JSON response.
- `queryAnalyzer(query, history)` — accepts `BaseMessage[]`, passes history to invoke. Zod schema captures all four fields.
- `analyzerNode` — destructures and writes `rewrittenQuery` to graph state.
- `retrieverNode` — uses `rewrittenQuery` for Qdrant embedding and search (not raw query).
- `generatorNode` — uses `rewrittenQuery` as the query passed to the LLM for answer generation.
- `QueryIntent` interface — `rewrittenQuery: string` added.
- Graph state — `rewrittenQuery: Annotation<string>()` added.
- `QueryLog` — `rewrittenQuery` now populated from graph output in `query.ts`.

**Updated query flow:**

```
Raw user query + conversation history
        │
        ▼
   [ analyzerNode ]             — rewrites query + classifies intent in one LLM call
   Returns: rewrittenQuery, strategy, queryReasoning
        │
        ▼ (if documentIds)
   [ retrieverNode ]            — searches Qdrant using rewrittenQuery
        │
        ▼
   [ rerankerNode ]             — cross-encoder rescores candidates
        │
        ▼
   [ evaluatorNode ]            — CRAG three-state classification
        │
        ├── correct   → generatorNode (vector chunks, rewrittenQuery)
        ├── incorrect → webSearchNode → generatorNode (web chunks only)
        └── ambiguous → webSearchNode → generatorNode (vector + web chunks combined)
        │
        ▼
   [ Response + persisted QueryLog ]
```

---

### 8. Ingestion Input Validation

**Problem:** POST /api/ingest accepts any source string across all versions. No size limits, no URL sanitization, no file type verification. A 2GB PDF, a private GitHub repo URL, or a malicious redirect URL is accepted and processed identically to a valid source.

**Fix:** Validate before the loader runs. Reject early — do not let invalid input reach the embedding pipeline.

```typescript
const VALIDATION = {
  pdf:     { maxSizeBytes: 50 * 1024 * 1024 },   // 50MB
  website: { allowedProtocols: ["https:"] },
  github:  { allowedHosts: ["github.com"] }
}
```

Checks applied in order: source type is in allowlist → URL/path is well-formed → file size is within limit (for PDFs, checked before loading) → URL does not resolve to a private/internal IP range (SSRF protection for website loader).

Returns `400` with a structured error message on any validation failure.

---

### 9. Persistent Query Logs and Observability ✅ Done

**Problem:** The debug layer in V1 captures rich data — retrieval scores, token usage, latency, selected strategy — but none of it is ever stored. Across all versions, this data exists only in the API response and the frontend debug panel. There is no ability to answer: which queries are failing? What is average retrieval score over time? Which documents get queried most? Which chunks are never retrieved and may indicate chunking problems?

**Fix:** Persist every query execution to a `QueryLog` table.

```prisma
model QueryLog {
  id               String   @id @default(uuid())
  userId           String
  query            String
  rewrittenQuery   String?
  strategy         String
  retrievedChunks  Int
  topScore         Float
  avgScore         Float
  rerankerTopScore Float?
  promptTokens     Int
  completionTokens Int
  estimatedCost    String
  executionTimeMs  Int
  ragUsed          Boolean
  createdAt        DateTime @default(now())
}
```

This table powers a real feedback loop: low `avgScore` queries reveal knowledge base gaps. High `executionTimeMs` outliers identify bottlenecks. Zero-retrieval queries (`ragUsed: false`) reveal when the query analyzer is misrouting.

**Implementation:**
- `src/lib/query-logger.ts` — `logQuery(data: QueryLog)` writes the row. Wrapped in try/catch — a logging failure never breaks the query response.
- `src/workflows/query.ts` — builds `logData` after `compiledGraph.invoke` completes. `topScore` and `avgScore` are guarded against empty chunk arrays (`ragUsed: false` path).
- `rewrittenQuery` and `rerankerTopScore` are nullable — populated when query rewriting (#30) and reranker scores are available.

**Drop-in alternative:** Langfuse or Helicone — both integrate via a single wrapper around the LLM call and capture the full trace automatically.

---

### 10. Error Handling Strategy

**Problem:** The architecture describes happy-path flows only across all versions. No version defines what happens when Qdrant is unavailable, the LLM provider rate-limits, or PostgreSQL times out mid-ingestion. In production, these failures happen regularly.

**Fix:** Typed errors, exponential backoff, and graceful degradation per external dependency.

**LLM provider (rate limits):**
```typescript
// Exponential backoff with jitter on 429 responses
// Max 3 retries before returning a structured error to the client
```

**Qdrant (availability):**
```typescript
// Circuit breaker — after 3 consecutive failures, open the circuit for 30s
// During open circuit: return a degraded response explaining retrieval is unavailable
// Do not hallucinate an answer when retrieval fails — surface the failure explicitly
```

**PostgreSQL (timeouts):**
```typescript
// Query timeout: 5s for reads, 30s for ingestion writes
// On timeout: surface error, do not leave ingestion in a partial state
// Relies on the vectorized flag from Fix 4 to detect and recover partial ingestions
```

**Principle:** When retrieval fails, tell the user. Never silently fall back to an LLM answer with no retrieval context — that is hallucination by default, which is the exact problem RAG exists to prevent.