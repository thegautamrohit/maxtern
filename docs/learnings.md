# Maxtern — Concepts & Learnings

This file documents technical concepts, architectural decisions, and their reasoning as they come up during the project.

---

## 1. Why not LangChain's QdrantVectorStore? Why PostgreSQL as content DB?

### The question
LangChain provides `QdrantVectorStore` which also has `.asRetriever({ searchType, k })`. Why did we not use it?

### What QdrantVectorStore actually does
When you call `.addDocuments()` on LangChain's `QdrantVectorStore`, it stores the **chunk content inside Qdrant's payload**:

```
Qdrant payload (LangChain default):
{
  pageContent: "JWT is a token format...",   ← full text here
  metadata: { ... }
}
```

So Qdrant becomes both the **vector store** AND the **content store**.

When `.asRetriever()` or `.similaritySearch()` is called, LangChain reads the content directly from Qdrant payload — PostgreSQL is never involved.

### Our approach instead
```
Qdrant payload (this project):
{
  chunkId:    "clx...",   ← reference only
  documentId: "clx...",
  sourceType: "pdf"
}
```

Qdrant does similarity search → returns chunkIds → PostgreSQL fetches content.

### Why this matters in production

**1. No cascade delete with LangChain's approach**
PostgreSQL has FK with cascade delete: `Chunk.documentId → Document.id`. Delete the document → all chunks gone automatically.
Qdrant has no such relationship. If content lives in Qdrant, you have to manually track and delete each chunk vector. Miss one → orphan vectors forever → wrong search results.

**2. No reliable multi-tenancy**
Multiple users need isolated retrieval. PostgreSQL: `WHERE userId = ?`. Done.
LangChain's `.asRetriever()` does not easily expose Qdrant's payload filter for per-user isolation. You end up bypassing the abstraction anyway — so what was the point?

**3. No SQL queries on your own content**
Production needs: "How many chunks does this document have?", "When was this ingested?", admin dashboards, analytics.
These are trivial SQL queries. If content is in Qdrant, none of this is possible — Qdrant is not a relational DB.

**4. Two sources of truth**
Content in Qdrant payload + content in PostgreSQL = inconsistency risk. One gets updated, the other doesn't. Single source of truth (PostgreSQL) eliminates this class of bugs entirely.

**5. Qdrant payload bloat**
Qdrant is optimized for vectors — payload is for small metadata, not large text content. Storing chunk text in payload increases memory pressure, slows vector search, and increases cloud costs.

**6. No full-text search fallback**
Vector search misses exact terms — API names, function names, error codes. PostgreSQL has `ILIKE` and `tsvector` for full-text search as a fallback. Qdrant with content in payload loses this option entirely.

### The tradeoff in one line
LangChain abstraction = convenient but you lose relational integrity, multi-tenancy, SQL access, and content ownership.
Manual Qdrant + PostgreSQL = more code upfront, but full control in production.

### The answer in one go
> "LangChain's QdrantVectorStore stores content inside Qdrant's payload, making Qdrant both the vector store and the content store. In a production app this means you lose cascade deletes, per-user filtering, SQL queries on your own data, and you end up with two sources of truth. We keep PostgreSQL as the single source of truth for content — Qdrant stores only vectors and reference IDs. This gives us relational integrity, multi-tenancy, full-text search fallback, and a storage layer that is fully extensible."

---

## 2. Why batch embedding (`embedTexts`) during ingestion, not per-chunk (`embedText`)?

### The question
Why call `embedTexts([all chunk contents])` once during ingestion instead of calling `embedText(chunk)` for each chunk in a loop?

### The reason
A single document can produce 50–200 chunks after splitting. If you embed each chunk individually:
- 100 chunks = 100 separate HTTP calls to the embedding model (Ollama or OpenAI)
- Each call has network latency + model overhead
- OpenAI charges per token — more API calls = higher overhead

`embedTexts` sends all chunk texts in a **single batch call**. The model processes them together — one network round trip, one billing event, dramatically faster.

### The rule
- `embedTexts([...])` → batch, used at **ingestion time** (many chunks at once)
- `embedText(query)` → single, used at **query time** (one query string)

---

## 3. Why `MarkdownTextSplitter` and not `MarkdownHeaderTextSplitter`?

### The question
`MarkdownHeaderTextSplitter` sounds more appropriate for GitHub markdown files. Why use `MarkdownTextSplitter`?

### The reason
`MarkdownHeaderTextSplitter` is **Python-only**. It does not exist in LangChain JS.
`MarkdownTextSplitter` is the JavaScript equivalent — it is aware of markdown structure (headings, sections) and preserves it during splitting.

This is a common gotcha when reading LangChain docs — Python and JS SDKs are not 1:1 in class availability.

---

## 4. Why is `ensureCollections()` called at the start of every ingestion?

### The question
Why call `ensureCollections()` every time `ingestDocument` is called? Isn't the collection created once and that's it?

### The reason
`ensureCollections()` is **idempotent** — it checks if the "chunks" collection exists in Qdrant first, and only creates it if it doesn't. So calling it multiple times has no side effect.

The reason to call it on every ingestion: defensive programming. If Qdrant was restarted, volume was wiped, or this is the first ingestion ever — the collection is guaranteed to exist before any upsert happens. You never get a "collection not found" error mid-ingestion.

---

## 5. Why `Promise.all` for chunk storage instead of a sequential loop?

### The question
Why use `Promise.all(chunks.map(...storeChunk...))` and not a `for...of` loop?

### The reason
Each `storeChunk` call does two independent things:
1. Write to PostgreSQL
2. Upsert to Qdrant

These operations per chunk are **independent of each other** — chunk 2 doesn't need chunk 1 to finish first. `Promise.all` fires all of them simultaneously, so all chunks are stored in parallel. A sequential loop would do them one by one — significantly slower for documents with 100+ chunks.

`for...of` is used when operations **must be sequential** (e.g., GitHub ingestion loops over `Document[]` — each document's ingestion should complete before the next starts to avoid DB race conditions at the document level).

### The rule
- Independent operations → `Promise.all`
- Operations that depend on order / must not race → `for...of`

---

## 6. Why is the Normalizer a separate step and not part of the Loader?

### The question
The PDF Loader could clean up HTML entities itself. Why have a separate Normalizer?

### The reason
**Single Responsibility Principle** in the pipeline context.

- Loaders are responsible for one thing: extracting raw content from a source
- Normalizers are responsible for one thing: cleaning that content uniformly

If normalization was inside each loader:
- PDF Loader normalizes differently from Website Loader → inconsistent output
- Adding a new source (say, Notion) means re-implementing normalization again
- Testing becomes harder — you can't test normalization in isolation

With a separate Normalizer, every source gets the same cleaning pass. One place to update, one place to test.

---

## 7. Prisma 6 — Why PrismaPg adapter? Why singleton?

### The question
Why can't we just do `new PrismaClient()`? Why the adapter and singleton pattern?

### The PrismaPg adapter
Prisma 6 introduced a new driver adapter model. For PostgreSQL specifically, `PrismaPg` is required as the adapter — it handles the actual DB connection pooling and protocol. Without it, Prisma 6 cannot connect to PostgreSQL.

### The singleton
In Next.js dev mode, **hot reload** re-runs module-level code on every file save. Without a singleton, each reload creates a new `PrismaClient` instance — each instance opens its own connection pool. After a few reloads, you exhaust the PostgreSQL connection limit.

The singleton pattern stores the instance on `global` so hot reload reuses the existing connection instead of creating a new one.

---

## 8. Cosine Similarity — Why does Qdrant use it for this use case?

### The question
Qdrant supports multiple distance metrics — Cosine, Dot Product, Euclidean. Why Cosine?

### The reason
Cosine similarity measures the **angle** between two vectors, not their magnitude. For text embeddings, what matters is the **direction** (meaning) of the vector, not its length. Two chunks that mean the same thing should have similar direction regardless of how long the text is.

Euclidean distance measures absolute distance between points — longer texts naturally produce larger magnitude vectors, which skews results. Cosine normalizes for this.

For semantic search on text, **Cosine similarity is the standard choice**.

---

## 9. Semantic Retriever — how the pieces connect

### The flow
```
query string
  ↓
embedText(query)                        → 768-dim vector
  ↓
qdrant.search("chunks", { vector, limit: 5 })   → top 5 similar points
  ↓
extract chunkIds from payload           → string[]
  ↓
prisma.chunk.findMany({ id: { in: chunkIds } })  → content from PostgreSQL
  ↓
combine score + sourceType from Qdrant with content from Prisma
  ↓
return RetrievedChunk[]
```

### Why two passes — Qdrant first, then PostgreSQL?
Qdrant does similarity search but does not store content. PostgreSQL stores content but cannot do vector search. Each does what it's built for — Qdrant finds the right chunkIds, PostgreSQL fetches their text.

### The O(n²) trap
Naively, you might do a `.filter` inside `.map` to find the score for each chunk — but that's O(n²). For every chunk, you scan all searchResults to find its score.

The fix: build a `Map<chunkId, { score, sourceType }>` from searchResults once — O(n). Then each lookup inside `.map` is O(1). Total: O(n) instead of O(n²).

```typescript
// slow — filter inside map
score: searchResults.filter(item => item.payload?.chunkId === chunk.id)[0]?.score

// fast — map lookup
const scoreMap = new Map(searchResults.map(item => [item.payload?.chunkId, item]))
score: scoreMap.get(chunk.id)?.score
```

### Where score lives vs. where sourceType lives
- `score` is a **top-level field** on the Qdrant point — `item.score`
- `sourceType` is inside the **payload** — `item.payload.sourceType`

Common mistake: looking for `item.payload.score` — it doesn't exist there.

### The answer in one go
> "The semantic retriever embeds the query into a vector, searches Qdrant for the top-5 similar chunks, extracts chunkIds from the payload, fetches content from PostgreSQL, then combines score and sourceType from Qdrant with content from Prisma. A Map is used for O(1) score lookup instead of filtering inside map which would be O(n²)."

---

## 10. Query Analyzer — rule-based vs LLM-based

### Why no LLM here?
Simple keyword matching does not need an LLM. Using an LLM to classify "summarize this" vs "what is JWT" would add ~500ms latency and API cost on every single query — for a decision that a few `.includes()` checks can make in microseconds.

Rule: **use code where code is sufficient. Use LLM only where judgment is required.**

### Why `.some()` and not `.map()` or `.forEach()`?
`.some()` short-circuits — it stops as soon as one keyword matches. `.map()` always iterates the full array regardless. For a small keywords array this doesn't matter much, but the intent is clearer with `.some()` — "does any keyword match?"

### The answer in one go
> "The query analyzer is intentionally rule-based — no LLM involved. Adding an LLM for a binary classification that a few string checks can handle would add latency and cost on every query. `.some()` is used over `.map()` because it short-circuits on first match and clearly expresses the intent."

---

## 11. Summary vs Semantic Retriever — why keep them separate?

### The question
Both retrievers do the same thing — embed query, search Qdrant, fetch from PostgreSQL. Only `limit` is different (5 vs 20). Why not one shared function?

### Why separate files make sense here
They look the same now but will diverge in V2:
- Summary retriever will add **document-level filtering** — retrieve chunks from a specific document, not just top-N globally
- Semantic retriever will get **hybrid search** — dense + sparse vectors combined
- Different scoring, re-ranking, or post-processing logic may apply to each

If they were a single shared function with a `limit` parameter, any V2 change to one would risk affecting the other. Separate files = isolated changes.

### The rule
DRY (Don't Repeat Yourself) is a good principle, but not when two things are **accidentally similar** rather than **fundamentally the same**. These two retrievers share implementation today but have different responsibilities and different futures.

### The answer in one go
> "Both retrievers share the same flow today — the only difference is limit (5 vs 20). They're kept separate because they will diverge in V2: summary retriever needs document-scoped filtering, semantic retriever gets hybrid search. Premature unification would couple two independently evolving pieces."

---

## 12. LangChain LCEL — pipe pattern for chaining

### What is LCEL?
LCEL (LangChain Expression Language) is LangChain's way of composing chains using the `|` pipe operator — same concept as Unix pipes.

```typescript
const chain = qaPrompt | llm | new StringOutputParser()
const result = await chain.invoke({ userQuery, context })
```

Each step's output becomes the next step's input. LangChain handles the type conversion internally.

### Why use it over manual chaining?
Without LCEL:
```typescript
const formatted = await qaPrompt.format({ userQuery, context })
const response = await llm.invoke(formatted)
const text = response.content as string
```

With LCEL — same result, less boilerplate, and the chain is composable/reusable.

### `StringOutputParser` — what it does
`ChatOllama.invoke()` returns a `BaseMessage` object — not a plain string. `StringOutputParser` extracts `.content` and returns it as `string`. Without it, you'd manually cast `response.content as string`.

### The answer in one go
> "LCEL's pipe operator composes LangChain runnables — prompt → LLM → parser. Each step's output flows into the next. StringOutputParser at the end extracts the content string from the LLM's message object, so the chain returns a plain string directly."

---

## 13. N+1 query problem — and how to avoid it

### What is N+1?
If you have N chunks and for each chunk you make a separate DB query to get the document title — that's N+1 queries (1 for retrieval + N for titles). With 20 chunks in summary retrieval, that's 21 DB round trips.

### The fix — fetch once, lookup via Map
```typescript
// fetch all document titles in one query
const docs = await prisma.document.findMany({
  where: { id: { in: documentIds } },
  select: { id: true, title: true }
})

// build a Map for O(1) lookup
const titleMap = new Map(docs.map(d => [d.id, d.title]))

// use in .map() — no DB call per chunk
sourceTitle: titleMap.get(chunk.documentId) ?? "Unknown"
```

This pattern appears twice in this project — once for `scoreMap` in the retrievers, once for `titleMap` in `query.ts`. Same idea: batch fetch → Map → O(1) lookup.

### The answer in one go
> "N+1 happens when you make one DB query per item in a loop. Fix: collect all IDs, fetch in one `findMany`, build a Map keyed by ID, then look up in O(1) during the loop. Total: 1 DB query instead of N."

---

## 14. Session Isolation — why filter at Qdrant, not at Prisma

### The problem
Without isolation, every query searches all chunks across all ingested documents — regardless of which session ingested them. Session A ingests React docs, Session B ingests Python docs, Session A's query now returns Python chunks too.

### Why the filter goes in Qdrant, not Prisma

The naive fix might be: fetch chunk IDs from Qdrant, then filter by `documentId` in the Prisma `findMany`. But this is wrong — Qdrant has already done similarity ranking at that point. If you filter after retrieval, you might discard the most relevant chunks and keep irrelevant ones just because they belong to the right document.

The filter must go **inside the Qdrant search call** — before scoring and ranking — so Qdrant only considers chunks from the current session's documents:

```typescript
qdrant.search("chunks", {
  vector: queryVector,
  limit: 5,
  filter: {
    must: [
      { key: "documentId", match: { any: documentIds } }
    ]
  }
})
```

Prisma's `findMany` after this is just a content fetch — the filtering is already done.

### `match: { any: [...] }` vs `match: { value: "..." }`
- `match: { value: "x" }` — exact single value match (SQL `= 'x'`)
- `match: { any: ["a", "b"] }` — matches if payload field equals any value in the array (SQL `IN (...)`)

`any` is used here because a session can have multiple documentIds (e.g. a GitHub repo produces one documentId per file).

### No documentIds → no filter → general LLM
If `documentIds` is undefined or empty (user skipped source selection), the filter is skipped entirely and the LLM answers directly — no retrieval. This is the "just ask anything" path.

### The answer in one go
> "Session isolation is enforced at the Qdrant search level — not in Prisma. Filtering after vector search would discard high-ranking chunks that don't belong to the session, keeping low-ranking ones that do. The Qdrant `filter.must` clause scopes the vector search to only the session's documentIds before any ranking happens. Prisma then just fetches content for the already-correct IDs."

---

## 15. Qdrant Point ID constraint — UUID only, not cuid

### The problem
Qdrant point IDs must be either a **UUID** or an **unsigned integer**. Arbitrary strings (including Prisma's default `cuid()`) are rejected with a `Bad Request` error.

### Why this matters
Prisma's default `@default(cuid())` generates IDs like `clx3m8k9f0000abc123`. We used the Chunk's PostgreSQL `id` directly as the Qdrant point ID — which broke because cuid is not a valid Qdrant ID format.

### The fix
Changed Prisma schema for both `Document` and `Chunk` models:
```prisma
id  String  @id @default(uuid())
```

Ran `prisma generate` + `prisma migrate`. Now PostgreSQL IDs are valid UUIDs → usable as Qdrant point IDs directly.

### Why this is the right approach
Using the same ID in both PostgreSQL and Qdrant is intentional — it makes the `chunkId` in Qdrant payload and the `id` in PostgreSQL the same value, so there's no mapping layer needed. The constraint just means the shared ID must be UUID format.

### The answer in one go
> "Qdrant only accepts UUID or unsigned integer as point IDs — cuid strings are rejected. Switching Prisma's `@default(cuid())` to `@default(uuid())` makes PostgreSQL IDs valid Qdrant point IDs, allowing us to use the same ID across both stores without any translation layer."

---

## 16. ChatPromptTemplate + MessagesPlaceholder — multi-turn conversation

### Why not `PromptTemplate` for chat?

`PromptTemplate` produces a single string — designed for completion models. `ChatOllama` (and OpenAI, Gemini) are **chat models** — they expect a list of typed message objects, not a single string.

```
PromptTemplate      →  single string       →  completion models
ChatPromptTemplate  →  list of messages    →  chat models
```

### `ChatPromptTemplate.fromMessages()`

Defines the message structure sent to the LLM on every invoke:

```typescript
import { ChatPromptTemplate, MessagesPlaceholder } from "@langchain/core/prompts";

const prompt = ChatPromptTemplate.fromMessages([
  ["system", "You are a helpful assistant. Context: {context}"],
  new MessagesPlaceholder("history"),
  ["human", "{userQuery}"],
]);
```

Tuple syntax `["role", "content"]` — role can be `"system"`, `"human"`, or `"ai"`.

### What `MessagesPlaceholder` does

Reserves a slot in the prompt where an **array of message objects** (`HumanMessage[]`, `AIMessage[]`) gets injected at runtime. A normal `{variable}` injects a string — `MessagesPlaceholder` injects typed message objects that the chat model understands as actual conversation turns.

```typescript
chain.invoke({
  history: [
    new HumanMessage("What is JWT?"),
    new AIMessage("JWT is a signed token format..."),
  ],
  userQuery: "How is it different from sessions?",
  context: "...",
})

// What the LLM receives:
// system:  You are helpful. Context: ...
// human:   What is JWT?
// ai:      JWT is a signed token format...
// human:   How is it different from sessions?
```

### The key name

`MessagesPlaceholder("history")` — `"history"` is just a key name. The invoke object's property must match it. `"chatHistory"`, `"messages"`, anything works — just keep it consistent between the prompt definition and the invoke call.

### Empty history on first message

`MessagesPlaceholder` accepts an empty array. Pass `history: []` on the first message — nothing gets injected, the prompt behaves normally. No special case needed.

### Multiple placeholders

```typescript
ChatPromptTemplate.fromMessages([
  ["system", "..."],
  new MessagesPlaceholder("examples"),   // few-shot examples
  new MessagesPlaceholder("history"),    // conversation turns
  ["human", "{userQuery}"],
])
```

This project uses only `"history"`.

### The answer in one go
> "`PromptTemplate` produces a single string — wrong for chat models. `ChatPromptTemplate.fromMessages()` produces a list of typed message objects that chat models natively understand as conversation turns. `MessagesPlaceholder` reserves a slot in the prompt where `HumanMessage[]` and `AIMessage[]` are injected at runtime. An empty array on the first message requires no special handling — nothing is injected and the prompt behaves normally."

---

## 17. File uploads in Next.js — multipart/form-data vs JSON

### The problem with JSON for file uploads
JSON is text — it cannot carry binary data (PDF bytes) directly. File uploads require `multipart/form-data`, which encodes binary chunks alongside metadata in a single HTTP request.

### Frontend — FormData
```typescript
const formData = new FormData();
formData.append("file", file);   // File object from <input type="file">
formData.append("type", "pdf");

fetch("/api/ingest", { method: "POST", body: formData });
// Browser sets Content-Type: multipart/form-data automatically
```
No `Content-Type` header set manually — browser handles it and adds the boundary string that separates parts.

### Backend — detecting and parsing
One route handles both JSON and multipart:
```typescript
const contentType = request.headers.get("content-type") ?? "";

if (contentType.includes("multipart/form-data")) {
  const formData = await request.formData();
  const file = formData.get("file") as File | null;
}
```
`request.formData()` parses the binary stream into a `File` object — still in memory at this point.

### Why save to disk?
`PDFLoader` (LangChain) requires a file path — it cannot accept an in-memory `File` object. The only option is to write the file to disk temporarily:

```typescript
const buffer = Buffer.from(await file.arrayBuffer());
const tmpPath = join(tmpdir(), `${randomUUID()}.pdf`);
writeFileSync(tmpPath, buffer);
```

- `file.arrayBuffer()` — raw bytes from the in-memory File object
- `Buffer.from()` — converts to Node.js Buffer format (what `writeFileSync` expects)
- `tmpdir()` — OS temp directory (`/tmp` on macOS/Linux), platform-independent
- `randomUUID()` — unique filename prevents concurrent upload collisions

### Cleanup with finally
```typescript
try {
  const documentIds = await ingestDocument("pdf", tmpPath);
  return NextResponse.json({ documentIds });
} finally {
  unlinkSync(tmpPath);  // always runs — success or error
}
```
`finally` guarantees cleanup even if `ingestDocument` throws. Without it, failed uploads leave orphan files in `/tmp`.

### The answer in one go
> "JSON cannot carry binary data — file uploads use `multipart/form-data`. The server detects this via the `Content-Type` header and parses with `request.formData()`. Since `PDFLoader` needs a file path, the in-memory `File` object is converted to a Node.js `Buffer` and written to `/tmp/`. A `finally` block guarantees the temp file is deleted regardless of success or failure."

---

## 18. LangGraph — replacing a linear pipeline with a graph

### Why LangGraph?
A linear pipeline (`query → analyzer → retriever → LLM`) cannot handle retry logic, conditional routing, or loops without turning into a deeply nested, hard-to-test god function. Adding CRAG to `query.ts` would mean a `while` loop with manual state tracking — every new feature adds more nesting.

LangGraph models the pipeline as a **graph** — nodes do work, edges define flow, conditional edges make runtime decisions. Each concern is isolated and independently testable.

### Three core concepts

**State** — a shared object that flows through the entire graph. Every node reads from it and returns a partial update. LangGraph merges the update — nodes never mutate state directly.

```typescript
const GraphState = Annotation.Root({
  query: Annotation<string>(),
  chunks: Annotation<RetrievedChunk[]>({ reducer: (p, c) => c, default: () => [] }),
  attempts: Annotation<number>({ reducer: (p, c) => c, default: () => 0 }),
  // ...
})
```

**Nodes** — async functions that take state and return a partial update:
```typescript
const retrieverNode = async (state: GraphStateType) => {
  const chunks = await retrievalRouter(state.strategy, state.query, state.documentIds)
  return { chunks, attempts: state.attempts + 1 }
}
```

**Conditional edges** — functions that read state and return a string key, mapped to the next node:
```typescript
const routeAfterEval = (state: GraphStateType) => {
  if (state.score < 0.5 && state.attempts < 3) return "retry"
  return "generate"
}
```

### Builder pattern — why method chaining matters
LangGraph uses a builder pattern for TypeScript type safety. Calling `addNode` and `addEdge` as separate statements loses type tracking — TypeScript doesn't know which nodes exist. Method chaining fixes this:

```typescript
export const compiledGraph = new StateGraph(GraphState)
  .addNode("analyzer", analyzerNode)
  .addNode("retriever", retrieverNode)
  // ...
  .compile()
```

### Termination condition in retry loops
Any retry loop in LangGraph **must** have a termination condition in state. Without `attempts < 3`, the evaluator returns `"retry"` forever — infinite loop. The counter must live in state so each node that increments it persists the value across iterations.

### Derived state — don't store what you can compute
`isRagUsed` does not need to be a state field. It is always derivable: `chunks.length > 0`. Storing redundant computed values in state adds bloat and potential inconsistency.

### Default annotations — undefined vs empty
When a node is skipped (e.g., retriever skipped on no-RAG path), its state fields are never set — they remain `undefined`. If downstream code calls `.map()` on an undefined field, it crashes. Fix: add `default: () => []` to fields that should always have a safe fallback.

### The answer in one go
> "LangGraph replaces a linear pipeline with a graph of nodes and edges. State is a shared object that flows through nodes — each node returns a partial update, never mutates directly. Conditional edges make runtime routing decisions (RAG vs no-RAG, retry vs generate). The builder pattern with method chaining is required for TypeScript to track node names correctly. Any retry loop needs a counter in state as a termination condition, and fields that may be skipped need default values to prevent undefined crashes downstream."

---

## 19. Hybrid Retrieval — Dense + Sparse (BM25)

### The problem with dense-only retrieval
Dense vector search finds semantically similar chunks — it understands meaning and synonyms. But it misses exact terms: API names, error codes, function names, version numbers.

Query: `"TypeError: Cannot read properties of undefined"` — dense search returns "error handling" and "null checks" chunks (semantically similar) but may miss the exact error string. BM25 finds it directly.

### BM25 — how it works
BM25 is a keyword scoring algorithm — no neural network, pure math.

**TF (Term Frequency):** How many times does a word appear in a chunk? More = more relevant.

**IDF (Inverse Document Frequency):** How many documents contain this word? Common words ("is", "the", "a") appear everywhere — low IDF, low weight. Rare words ("JWT", "TypeError") — high IDF, high weight.

BM25 combines TF × IDF with length normalization → sparse vector.

### Dense vs Sparse

| | Dense | Sparse (BM25) |
|---|---|---|
| How | Neural network embedding | TF-IDF math |
| Good at | Meaning, synonyms, paraphrasing | Exact terms, API names, error codes |
| Misses | Exact keyword matches | Semantic meaning |
| Vector format | 768 floats (all non-zero) | `{ indices: [...], values: [...] }` (mostly zero) |

### Sparse vector format
Dense: `[0.1, 0.3, 0.0, 0.8, ...]` — 768 numbers, all present.

Sparse: `{ indices: [42, 1337, 8901], values: [3, 2, 1] }` — only non-zero positions stored. A chunk uses only a small subset of the full vocabulary — storing zeros is wasteful. Sparse format stores only meaningful positions.

Reading a sparse vector:
```
indices: [42,           1337,         8901       ]
values:  [3,            2,            1          ]
          ↑              ↑             ↑
     word "apple"   word "juice"  word "recipe"
     appeared 3x    appeared 2x   appeared 1x
```

`42`, `1337`, `8901` are hash values of the actual words — the word itself is not stored, just its unique number. `values` are term frequencies — how many times that word appeared in the text.

### Dot product — how sparse vectors are compared

Sparse vectors are always compared using dot product. There is no other option — unlike dense vectors where you choose Cosine, Dot, or Euclid.

Dot product on sparse vectors means: **only words that appear in both the query and the chunk contribute to the score. Everything else is ignored.**

Example — query: `"apple juice recipe"`:
```
Query sparse:   { indices: [42, 1337, 8901], values: [1, 1, 1] }

Chunk A (apple juice article):
  indices: [42, 1337, 8901, 500]
  values:  [3,  2,    1,    1  ]

Chunk B (car repair manual):
  indices: [77, 200, 300]
  values:  [2,  1,   1  ]
```

**Chunk A score:**
```
index 42   → query:1 × chunkA:3 = 3   ✅ "apple" in both
index 1337 → query:1 × chunkA:2 = 2   ✅ "juice" in both
index 8901 → query:1 × chunkA:1 = 1   ✅ "recipe" in both
index 500  → not in query, skip

score = 3 + 2 + 1 = 6
```

**Chunk B score:**
```
index 77, 200, 300 → none in query, skip

score = 0
```

Chunk A wins — it contains all three query words multiple times. Chunk B scores zero — no shared words with the query, completely irrelevant regardless of any semantic meaning.

This is why `sparse: {}` has no distance metric in the Qdrant collection config — dot product is hardcoded for sparse vectors, there is nothing to configure.

### `computeSparseVector` — how it works step by step

```ts
computeSparseVector("Apple Juice Recipe apple")
```

**Step 1 — Tokenize:** split text into individual words
```
"apple juice recipe apple" → ["apple", "juice", "recipe", "apple"]
```

**Step 2 — Remove stopwords:** drop useless words like "the", "is", "a"
```
["apple", "juice", "recipe", "apple"]  ← nothing removed here
```

**Step 3 — Count term frequency (TF):** how many times each word appeared
```
{ apple: 2, juice: 1, recipe: 1 }
```

**Step 4 — Hash each word to a number:**
```
"apple"  → hashWord("apple")  → 42
"juice"  → hashWord("juice")  → 1337
"recipe" → hashWord("recipe") → 999
```
Same word always produces same number. `% 100000` means max 100,000 possible values — two different words can occasionally get the same number (hash collision).

**Step 5 — Handle collisions:** if two words hash to the same number, sum their counts
```
"apple" → 42 → count: 2
"mango" → 42 → same hash! → count: 2 + 1 = 3  (combined)
```
This prevents duplicate indices which Qdrant rejects.

**Step 6 — Return sparse vector:**
```ts
{ indices: [42, 1337, 999], values: [2, 1, 1] }
//           ↑               ↑
//      word numbers      word counts
```

**Full flow in one line:**
```
text → words → remove stopwords → count each word → hash words to numbers → { indices, values }
```

### RRF — Reciprocal Rank Fusion
Dense search returns top-20 ranked results. Sparse search returns top-20 ranked results (different order). RRF merges both lists:

```
RRF score = 1/(k + rank_dense) + 1/(k + rank_sparse)
```

Where `k = 60` (smoothing constant). A chunk that appears high in **both** lists gets a very high RRF score. A chunk that appears in only one list scores lower.

This means: chunks relevant by both meaning AND keywords float to the top.

### RRF formula — why `1 / (K + index + 1)`

The formula applied per result:

```
score += 1 / (K + rank)
```

Where:
- **rank** is 1-based (1st result = rank 1, not 0). `forEach` gives a 0-based `index` → `index + 1` converts it
- **K = 60** is a smoothing constant — prevents a single very high rank from dominating. Without K, rank 1 would score `1/1 = 1.0`, rank 2 would score `1/2 = 0.5` — a huge gap. With K=60, rank 1 scores `1/61 ≈ 0.016`, rank 2 scores `1/62 ≈ 0.016` — differences are compressed
- **Numerator is always 1** — RRF only cares about rank position, not about the raw similarity score (cosine similarity or BM25 score). A score of 0.99 at rank 5 and a score of 0.51 at rank 5 both contribute `1/(60+5)`. Raw scores are discarded

Why discard raw scores? Dense and sparse scores are not on the same scale — cosine similarity (0–1) and BM25 scores are incomparable. Using rank makes the merge scale-invariant.

A chunk appearing in both lists accumulates two contributions:
```
total = 1/(K + rank_dense) + 1/(K + rank_sparse)
```
This is why chunks relevant to both meaning AND keywords float to the top.

### Qdrant hybrid search
Qdrant supports storing two named vectors per point:

```
point:
  id: "uuid"
  vector:
    dense: [0.1, 0.3, ...]          ← 768 dims
    sparse: { indices, values }      ← BM25
  payload: { chunkId, documentId, sourceType }
```

At query time, we run two **separate** Qdrant searches — one against `"dense"`, one against `"sparse"` — and apply RRF ourselves in code. Qdrant does not merge or apply RRF automatically when using the JS client's `search()` method.

### Why named vectors are required in Qdrant

When a collection has only one vector, Qdrant knows which one to use — no ambiguity.

When a collection has **two vectors** (dense + sparse), Qdrant needs a name to refer to each one — at collection creation, at ingestion, and at search time.

**Collection creation:**
```typescript
vectors: {
  dense: { size: 768, distance: "Cosine" }  // named "dense"
},
sparse_vectors: {
  sparse: {}   // named "sparse"
}
```

**Ingestion — upsert with named vectors:**
```typescript
vector: {
  dense: [0.1, 0.3, ...],             // stored under "dense"
  sparse: { indices: [...], values: [...] }  // stored under "sparse"
}
```

**Search — refer by name:**
```typescript
// dense search
qdrant.search("chunks", {
  vector: { name: "dense", vector: queryDenseVec }
})

// sparse search
qdrant.search("chunks", {
  vector: { name: "sparse", vector: querySparseVec }
})
```

Without names, Qdrant cannot distinguish which vector to use for which operation. The name is just a string key — `"dense"` and `"sparse"` are convention, not reserved words.

### `with_payload` — JS client vs HTTP API behavior

Qdrant HTTP API default for `with_payload` is **`false`** — payload must be explicitly requested, otherwise only `id` and `score` are returned.

Qdrant **JS client** default for `with_payload` is **`true`** — payload is included automatically, no need to specify it explicitly.

```typescript
// JS client — both are equivalent
qdrant.search("chunks", { vector: { name: "dense", vector: vec }, limit: 5 })
qdrant.search("chunks", { vector: { name: "dense", vector: vec }, limit: 5, with_payload: true })
```

This is a common gotcha — Qdrant docs are written against the HTTP API (default false), but the JS client sets it to true by default for developer convenience. If you ever use the HTTP API directly, `with_payload: true` must be passed explicitly.

### sourceType map must cover both results

After RRF, `topChunks` contains IDs from both dense and sparse searches. Some IDs may only appear in sparse results — not in dense. If the sourceType map is built only from `denseResults`, those sparse-only chunks will have no sourceType and get filtered out silently.

Fix: build the sourceType map from `[...denseResults, ...sparseResults]` — covers all possible IDs in `topChunks`.

Similarly, score should come from `rrfScores` (the Map built during RRF), not from `denseResults`'s `item.score`. Qdrant's raw cosine/BM25 scores are used during the two searches but discarded after RRF — only RRF scores are meaningful at output time.

### What changes in the codebase
- **Qdrant collection** — must be recreated with both `dense` and `sparse` vector config
- **Ingestion** — generate BM25 sparse vector per chunk alongside dense embedding, store both
- **Retriever** — query time: generate dense embedding + BM25 sparse vector, run hybrid search

### Cross-encoder reranker (future — V3/V4)
After RRF gives top-30 candidates, a cross-encoder model (Cohere Rerank, BGE-Reranker) re-scores each query-chunk pair with full attention — more accurate than vector similarity. Truncate to final top-5 before generation. Deferred — implement after Hybrid Retrieval is stable.

### Proven difference — dense vs hybrid on a codebase query

Query: `"computeSparseVector indices value"` against the maxtern codebase ingested as a GitHub repo.

**Dense result:**
> "The indices are hash values of tokens (words) filtered for stopwords, and the values are term frequencies."

Chunks retrieved: [1, 0, 44, 47, 43] — general explanatory content that semantically talks about sparse vectors and term frequencies.

**Hybrid result:**
> "In the `computeSparseVector` function, indices are hash values of tokens (words) and values are term frequencies (integer counts of how many times each token appears). The function generates these by tokenizing text, filtering out stopwords, counting term frequencies, and then hashing each unique token to create indices."

Chunks retrieved: [42, 8, 10, 0, 0] — chunk 42 is the actual `sparse-embedder.ts` source file, surfaced because the exact token `computeSparseVector` appears in it.

**Why this happened:**
- Dense understood the semantic meaning of the query — found chunks that explain the concept of sparse vectors
- Sparse found the exact function by token match — `computeSparseVector` as a string exists in the source file
- Dense deprioritized the source code chunk because code is less semantically "similar" to a natural language query than explanatory text is
- Hybrid rescued that source chunk and ranked it first

**The rule:**
```
Dense  → finds chunks that MEAN the same thing as your query
Sparse → finds chunks that CONTAIN the exact words in your query
```

For code-heavy knowledge bases (GitHub repos, API docs), hybrid retrieval wins significantly over dense-only — especially when querying exact function names, class names, or parameter names that dense has no special training signal for.

For general concept queries on focused documents (Wikipedia article on RAG), both approaches return nearly identical results — the document is semantically uniform so dense already finds everything relevant.

### The answer in one go
> "Dense retrieval finds semantically similar chunks but misses exact keyword matches. BM25 sparse retrieval scores chunks by keyword frequency (TF-IDF) and finds exact terms but misses semantic meaning. Hybrid retrieval combines both — Qdrant stores a dense and a sparse vector per chunk, runs both searches at query time, and merges results using RRF (Reciprocal Rank Fusion). Chunks that rank high in both lists float to the top. This gives best-of-both-worlds retrieval — meaning AND keywords. The difference is most visible on code repositories with exact function/class names, and least visible on semantically uniform documents like encyclopedia articles."

---

## 20. CRAG — Corrective RAG with Tool Calling

### What is CRAG?

CRAG (Corrective RAG) is a pattern that adds a **quality gate** between retrieval and generation. Instead of blindly passing retrieved chunks to the LLM, CRAG first evaluates whether those chunks are actually relevant to the query. If not, it corrects the context by falling back to an external source (web search) before generating.

### Three confidence states (original paper)

| State | Condition | Action |
|---|---|---|
| Correct | High confidence | Use retrieved chunks → generate |
| Incorrect | Low confidence | Discard chunks → web search → generate |
| Ambiguous | Medium confidence | Retrieved chunks + web search → generate |

This project implements the binary version (Correct / Incorrect only).

### Why score-based evaluation fails here

The naive approach: average the RRF scores of retrieved chunks and compare to a threshold (`score < 0.5`). This is broken because RRF scores are not relevance scores — they are rank-based:

```
rank 0 → 1/(60+0+1) = 0.0164
rank 4 → 1/(60+4+1) = 0.0153
```

Average is always ~0.015 — always below any reasonable threshold. RRF tells you "which chunk ranked highest" not "is this chunk relevant to the query." Normalizing RRF scores also doesn't help — it just amplifies tiny rank differences into 0–1 range, which is misleading noise.

### LLM as evaluator — the correct approach

The evaluator sends the query + all retrieved chunks to an LLM in a single call and asks: "Is this context sufficient to answer the query?" The LLM reads the actual content and makes a judgment — something a score cannot do.

```typescript
const chain = evaluationPrompt.pipe(LLM.withStructuredOutput(schema));
const result = await chain.invoke({ query, chunksContext });
// result: { relevant: true | false }
```

Key decisions:
- **All chunks in one call** — the generator also receives all chunks together, so the evaluator should ask the same question the generator faces
- **Temperature 0** — deterministic judgment, no creativity needed
- **Structured output** — `z.object({ relevant: z.boolean() })` prevents free-text responses that need parsing

### Tool definition pattern

A LangChain `tool()` packages a function with a name, description, and Zod schema — the standard format that LLMs use to understand when and how to call a tool:

```typescript
export const webSearchTool = tool(
  async ({ query }) => {
    // implementation
    return JSON.stringify(results);  // tools must return strings
  },
  {
    name: "web_search",
    description: "Search the web when the knowledge base doesn't have relevant results",
    schema: z.object({
      query: z.string().describe("The search query"),
    }),
  }
);
```

In Approach 3 (used here), the graph routes to the web search node — the LLM doesn't decide when to call the tool. The tool is still defined properly for consistency and to prepare for full LLM-driven tool calling in the Agents phase.

### Graph changes for CRAG

State additions:
- `relevant: Annotation<boolean>()` — evaluator output
- Removed `score` (was RRF average — meaningless) and `attempts` (no more retry loop)

New node — `webSearchNode`:
- Calls `webSearchTool.invoke({ query })`
- `JSON.parse` the string result
- Maps to `RetrievedChunk[]` with `sourceType: "web"`, `chunkId: url`, `score: 1`
- Returns `{ chunks: webChunks }` — replaces state chunks

New edge:
```
evaluator → relevant: false → webSearch → generator
evaluator → relevant: true  → generator
```

### `SourceType` — union type extraction

Web results introduced `"web"` as a new source type. Rather than updating `sourceType: "pdf" | "website" | "github"` in three interfaces separately, the union was extracted into a named type:

```typescript
type SourceType = "pdf" | "website" | "github" | "web";
```

One place to change, all interfaces stay consistent. `as const` is needed when assigning string literals in mapped objects to prevent TypeScript from widening `"web"` to `string`.

### `{{` and `}}` — escaping braces in LangChain templates

`ChatPromptTemplate.fromMessages` interprets `{word}` as a template variable. A standalone `{` or `}` (e.g., in a JSON example inside the prompt) throws: `"Single '}' in template"`. Escape with double braces: `{{` renders as `{`, `}}` renders as `}` at runtime.

### The answer in one go
> "CRAG adds a quality gate after retrieval — an LLM evaluates whether retrieved chunks are actually relevant to the query. If not relevant, chunks are discarded and web search is used instead. Score-based evaluation fails because RRF scores are rank-based, not relevance-based. An LLM evaluator reads the actual content and makes a binary judgment. The web search is wrapped in a LangChain `tool()` — a function with name, description, and schema — and the graph routes to it when the evaluator returns false. The generator then receives either vector-retrieved chunks or web search chunks and generates an answer the same way regardless of source."

---

## 28. Persistent Query Logs — Observability Without Noise

### Why log query executions

The debug panel in the frontend shows retrieval scores, chunk counts, and latency per query — but only while that response is on screen. Once the page refreshes or the session ends, that data is gone. Without persistence you cannot answer:

- Which queries consistently get low retrieval scores (knowledge base gaps)?
- Which queries trigger the CRAG web search fallback (retrieval failing)?
- What is average latency over time (performance regressions)?
- Which users are making the most queries (usage patterns)?

Persisting to a `QueryLog` table turns ephemeral response data into a queryable history.

### The never-throw pattern for logging

Logging is a side effect — it must never affect the primary operation. If `logQuery` throws (e.g. Prisma connection blip), the user's query response should still be returned. The fix is to wrap the DB write in try/catch and only `console.error` on failure:

```typescript
export const logQuery = async (data: QueryLog): Promise<void> => {
  try {
    await prisma.queryLog.create({ data })
  } catch (error) {
    console.error("Error logging query:", error)
  }
}
```

This is a general principle: any non-critical side effect (analytics, audit logs, metrics) should be fire-and-forget. Fail silently, surface via logs, never propagate to the caller.

### Guard computed fields against empty arrays

`topScore` and `avgScore` are computed from the retrieved chunks array. When `ragUsed` is false (no retrieval happened), the array is empty — `.sort()[0].score` crashes with `Cannot read properties of undefined`, and `reduce() / 0` gives `NaN`.

Always guard score computations behind the `isRagUsed` check:

```typescript
topScore: isRagUsed
  ? retrievedChunks.sort((a, b) => b.score - a.score)[0].score
  : 0,
avgScore: isRagUsed
  ? retrievedChunks.reduce((acc, c) => acc + c.score, 0) / retrievedChunks.length
  : 0,
```

Zero is a valid sentinel value here — a query with no retrieval genuinely has a score of zero.

### Nullable fields for future features

`rewrittenQuery` and `rerankerTopScore` are `String?` and `Float?` in the schema. They're null now — `rewrittenQuery` gets populated when query rewriting (#30) is wired in, `rerankerTopScore` when reranker scores are surfaced. Designing nullable columns upfront avoids schema migrations later when those features land.

### The answer in one go
> "Query logs persist the execution trace of every query to PostgreSQL — retrieval scores, strategy, latency, token usage, ragUsed flag. The logger wraps the DB write in try/catch so a logging failure never breaks the query response. Score fields are guarded against empty chunk arrays on the no-retrieval path. Nullable columns for rewrittenQuery and rerankerTopScore are left as null stubs until those features are implemented, avoiding future migrations."

### Revision Questions

- Why should a logging function never throw? What is the principle behind this?
- What happens if you compute `arr.sort()[0].score` on an empty array? How do you guard against it?
- Why use `0` as the sentinel value for `topScore`/`avgScore` when no retrieval happened?
- What does `ragUsed: false` in a QueryLog row tell you about the query flow?
- Why are `rewrittenQuery` and `rerankerTopScore` nullable in the schema from the start?
- What is the difference between `logQuery` failing silently vs the query handler failing silently? Why is one acceptable and the other not?

---

## 27. Rate Limiting — Redis Sliding Window and Why In-Memory Doesn't Work

### The problem with in-memory counters

Next.js runs on multiple server instances in production (Vercel, AWS, etc. load balance across workers). Each instance has its own memory — they do not share state. If each instance tracks its own counter, a user can hit instance A 30 times and instance B 30 times — each instance thinks the limit hasn't been reached, the user effectively has no limit.

Rate limiting state must live outside the process, in a shared store all instances can read and write. That's Redis.

### The sliding window algorithm

Three algorithms exist for rate limiting:

**Fixed window:** Divide time into fixed slots (e.g., every 60s). Count requests per slot. Problem: a user can fire 30 requests at second 59 and 30 more at second 61 — 60 requests in 2 seconds, both windows allow it.

**Token bucket:** Each user has a bucket of tokens, refilled at a constant rate. Allows controlled bursting. Complex to implement correctly in a distributed system.

**Sliding window:** The window follows the current time. At any moment, look back exactly N seconds and count. No boundary exploit. This is what `@upstash/ratelimit` implements.

### How Redis implements sliding window — sorted sets

Redis stores each user's request history in a **sorted set** — a data structure where every item (member) has a numeric score. For rate limiting:

- **Key** = `ratelimit:query:userId` — one sorted set per user per endpoint
- **Member** = unique request ID (random string)
- **Score** = Unix timestamp in milliseconds when that request happened

On every request, three operations happen atomically:

1. **Remove expired entries** — delete all members with score < `(now - windowMs)`. These are outside the window.
2. **Add new request** — insert a new member with score = current timestamp.
3. **Count** — `ZCOUNT key min max` counts all members in the window. If count > limit → 429.

The count is never stored explicitly — it's always derived from how many members currently exist in the window. The sorted set is a log of timestamps, not a counter.

### Why one sorted set per user per endpoint

Two routes have different limits — query (30/min) and ingest (5/5min). Using a separate key prefix per endpoint (`ratelimit:query:userId` vs `ratelimit:ingest:userId`) means each endpoint tracks independently. Two different users also get completely separate sorted sets — User A's count never affects User B's.

The key encodes identity. The sorted set contents encode history.

### Retry-After header — operator precedence matters

When returning 429, include a `Retry-After` header telling the client how many seconds to wait:

```typescript
// WRONG — divides only Date.now(), then subtracts
Math.ceil(reset - Date.now() / 1000)

// CORRECT — converts both to seconds first, then subtracts
Math.ceil((reset - Date.now()) / 1000)
```

`reset` is a Unix timestamp in milliseconds. `Date.now()` is also in milliseconds. Dividing by 1000 converts the difference to seconds. Missing the parentheses means you're subtracting milliseconds from milliseconds-then-divided-by-1000 — mixing units, wrong result.

### Upstash — why not self-hosted Redis

Next.js serverless functions (Vercel, etc.) cannot maintain persistent TCP connections — they are stateless, short-lived processes. Traditional Redis clients use persistent TCP sockets. Upstash provides an HTTP-based Redis API that works in serverless environments. `@upstash/redis` communicates via REST instead of TCP — each call is a stateless HTTP request. Functionally identical to Redis from the application's perspective.

### The answer in one go
> "Rate limiting state must be shared across all server instances — in-memory counters break under load balancing. Redis sliding window stores each user's request timestamps in a sorted set keyed by userId and endpoint. On every request: remove expired entries, add current timestamp, count what's left. If count exceeds the limit, return 429 with a Retry-After header computed as `Math.ceil((reset - Date.now()) / 1000)`. Upstash Redis is used instead of self-hosted Redis because serverless environments cannot maintain persistent TCP connections — Upstash provides an HTTP-based API. Separate sorted set keys per endpoint and per userId ensure each limit operates independently."

### Revision Questions

- Why does in-memory rate limiting break under horizontal scaling?
- What is the difference between fixed window and sliding window rate limiting? What attack does sliding window prevent?
- How does Redis implement a sliding window — what data structure and what three operations?
- Why is the count derived from the sorted set rather than stored explicitly?
- Why is `ratelimit:query:userId` a separate key from `ratelimit:ingest:userId`?
- What is the operator precedence bug in `Math.ceil(reset - Date.now() / 1000)` and how do you fix it?
- Why does Upstash exist and why can't you use a standard Redis client in a serverless Next.js function?
- What should a 429 response include beyond the status code?

---

## Revision Questions

### RAG Architecture
- What is RAG? How does the retrieval step work?
- Why split documents into chunks before embedding? Why not embed the whole document?
- What is chunk overlap and why is it important?
- How do you handle documents from multiple sources with different formats?

### Vector Databases
- What is a vector embedding? What does it represent?
- What is cosine similarity? Why is it preferred over Euclidean distance for text?
- What is the difference between semantic search and keyword search?
- How would you add per-user document isolation in a vector DB?

### Hybrid Storage (Qdrant + PostgreSQL)
- Why use two databases? What does each one do?
- Why not store content in Qdrant payload?
- How do you handle cascade deletes in a system with a vector DB + relational DB?
- What happens if PostgreSQL and Qdrant go out of sync?

### LangChain
- What does LangChain's TextSplitter do?
- What is the difference between RecursiveCharacterTextSplitter and MarkdownTextSplitter?
- Why would you avoid LangChain's VectorStore abstraction in a production system?
- What are LangChain loaders and what is their responsibility?
- What is the difference between `PromptTemplate` and `ChatPromptTemplate`?
- What does `MessagesPlaceholder` do and why is it needed for conversation history?
- How would you pass few-shot examples alongside conversation history in a single prompt?

### Session Isolation & Filtering
- How do you scope vector search to a specific user's documents?
- Why should you filter at the vector DB level and not after retrieval?
- What is the difference between `match: { value }` and `match: { any }` in Qdrant filters?
- What happens if no documentIds are passed — what should the system do?

### File Uploads
- Why can't you send a file as JSON? What encoding is used instead?
- What does `multipart/form-data` mean and how does the server detect it?
- Why is a temp file needed when uploading a PDF? Can you pass the File object directly to PDFLoader?
- Why use `finally` for temp file cleanup instead of putting `unlinkSync` after the return?

### Hybrid Retrieval
- What is the limitation of dense-only vector search?
- What does BM25 stand for and how does it score a chunk?
- What is TF-IDF and why do common words get low weight?
- What is a sparse vector? How is it different from a dense vector in format?
- What is RRF and how does it merge two ranked lists?
- Why does a chunk ranking high in both dense and sparse lists get a higher RRF score?
- What changes are needed in Qdrant collection, ingestion, and retrieval for hybrid search?
- What is a cross-encoder reranker and how does it differ from vector similarity scoring?
- When would you use a reranker vs relying on RRF alone?
- What is the default behavior of `with_payload` in Qdrant JS client vs HTTP API? Why does it differ?

### LangGraph
- What is LangGraph and why use it over a linear pipeline?
- What are the three core concepts in LangGraph?
- What does a node return — full state or partial update?
- Why should nodes never mutate state directly?
- What is a conditional edge and how does it differ from a normal edge?
- Why does LangGraph require method chaining for TypeScript type safety?
- Why does a retry loop need a counter in state? What happens without it?
- When should you add a field to state vs derive it from existing state?
- What happens to state fields that belong to skipped nodes? How do you handle it?

### Production Concerns
- How would you scale the ingestion pipeline for large files?
- What is the risk of embedding each chunk individually vs. in batch?
- How would you handle re-ingestion of a document (updated version)?
- What is idempotency and where does it matter in this system?
- What ID format constraints does Qdrant impose and why does it matter when sharing IDs across databases?

---

## 21. Clerk Authentication — Custom Flows with Clerk v7

### The question
How does Clerk v7's custom flow API differ from v6, and why does `useSignIn()` behave differently?

### What Clerk v7 changed

Clerk v7 (`@clerk/nextjs@^7`) introduced a Signal-based API called `SignInFutureResource` and `SignUpFutureResource`. The hooks and method signatures changed significantly from v6.

**Hook return shapes:**
```typescript
// v6 (old)
const { signIn, setActive, isLoaded } = useSignIn()
const { signUp, setActive, isLoaded } = useSignUp()

// v7 (new)
const { signIn, errors, fetchStatus } = useSignIn()  // no setActive, no isLoaded
const { signUp, errors, fetchStatus } = useSignUp()
```

**Method signatures — v6 vs v7:**

| Action | v6 | v7 |
|---|---|---|
| Email + password sign-in | `signIn.create({ identifier, password })` — throws on error | `signIn.password({ emailAddress, password })` — returns `{ error }` |
| Email + password sign-up | `signUp.create({ emailAddress, password, ... })` — throws | `signUp.password({ emailAddress, password, ... })` — returns `{ error }` |
| Send email verification | `signUp.prepareEmailAddressVerification({ strategy: 'email_code' })` | `signUp.verifications.sendEmailCode()` |
| Verify email OTP | `signUp.attemptEmailAddressVerification({ code })` | `signUp.verifications.verifyEmailCode({ code })` |
| Set session active | `setActive({ session: createdSessionId })` | `signIn.finalize()` / `signUp.finalize()` |
| Google OAuth | `signIn.authenticateWithRedirect({ strategy, redirectUrl, redirectUrlComplete })` | `signIn.sso({ strategy, redirectUrl, redirectCallbackUrl })` |

**Error handling changed:** v6 methods throw — wrap in try/catch. v7 methods return `{ error: ClerkError | null }` — check the return value.

**`finalize()` does not navigate automatically.** After calling `signIn.finalize()` or `signUp.finalize()`, you must manually redirect using `router.push('/chat')`.

### The `needs_client_trust` status

When a user signs in from a new/unrecognized device, Clerk returns `status: 'needs_client_trust'` instead of `'complete'` after password verification. This requires a second step:

1. `signIn.mfa.sendEmailCode()` — Clerk sends a code to the user's email
2. `signIn.mfa.verifyEmailCode({ code })` — verify the code
3. `signIn.status` becomes `'complete'` → call `signIn.finalize()`

This is Clerk's Client Trust feature — it prevents session hijacking when signing in from an unfamiliar device. On subsequent sign-ins from the same device, the status goes straight to `'complete'`.

### Where middleware lives in a `src/` project

In Next.js, `middleware.ts` must be placed at the same level as your `app/` or `pages/` directory:
- Without `src/`: middleware at project root (next to `package.json`)
- With `src/`: middleware at `src/middleware.ts`

Placing it at the project root when using `src/` means Next.js silently ignores it — no error, no warning, just no middleware running.

### The answer in one go

Clerk v7 replaced the promise-based, throw-on-error API with a Signal-based API where methods return `{ error }` instead of throwing. `setActive()` was removed — use `signIn.finalize()` / `signUp.finalize()` to activate a session, then manually navigate. Google OAuth now uses `signIn.sso({ strategy, redirectUrl, redirectCallbackUrl })`. When signing in from a new device, Clerk returns `needs_client_trust` status after password verification, requiring a second email code step via `signIn.mfa`. In a `src/`-based Next.js project, `middleware.ts` must live inside `src/`, not at the root.

---

### Revision Questions

#### Auth
- What does `ClerkProvider` do and where does it go in a Next.js App Router app?
- What is `clerkMiddleware` and what does `createRouteMatcher` help with?
- What is the difference between a public route and a protected route in Clerk middleware?
- Why does `finalize()` not navigate automatically, and how do you handle redirection after sign-in/sign-up?
- What is `needs_client_trust` and when does Clerk return it?
- What changed between Clerk v6 and v7 in custom flow hooks?
- Where must `middleware.ts` live in a Next.js project that uses the `src/` directory? What happens if you put it at the root?
- What is the SSO callback page and why does Google OAuth require it?

---

## 22. Ingestion Deduplication — SHA-256 Hash + Prisma Compound Unique Constraints

### The problem
Without deduplication, ingesting the same document twice creates two `Document` rows in PostgreSQL and two full sets of chunk vectors in Qdrant. Retrieval then returns duplicate chunks for every query, wastes context window tokens, and inflates LLM cost. There is no way for the system to detect or recover from this state.

### The fix — content hash on the Document table

SHA-256 the document content after normalization. Store the hash on the `Document` row. Before writing anything, check if that `(userId, contentHash)` pair already exists. If it does, return the existing documentId and skip all storage.

```typescript
const contentHash = createHash("sha256").update(normalisedDoc.content).digest("hex")
const existing = await prisma.document.findUnique({
  where: { userId_contentHash: { userId, contentHash } }
})
if (existing) return [existing.id]
```

### Why `@@unique([userId, contentHash])` and not `@unique` on `contentHash` alone

`@unique` on `contentHash` alone would prevent two different users from ingesting the same document independently — User A ingest the React docs, then User B tries to ingest the same React docs and gets blocked. That's wrong. Each user's document space is independent.

`@@unique([userId, contentHash])` enforces uniqueness on the **combination** — the same content can exist once per user, but not twice for the same user. This is the correct multi-tenancy constraint.

### What `userId_contentHash` is — Prisma-generated compound key

`@@unique([userId, contentHash])` in Prisma generates a named input type for that constraint at client-gen time, named by joining the field names with underscores: `userId_contentHash`.

It is **not a column**. It is a lookup key that maps to the unique constraint:

```sql
-- what Prisma translates it to:
SELECT * FROM "Document"
WHERE "userId" = $1 AND "contentHash" = $2
LIMIT 1
```

`findUnique` requires the `where` clause to reference a unique constraint. Your `Document` table has two: `id` (primary key) and `(userId, contentHash)` (composite). The generated key lets you select which constraint to look up by.

For a single-field `@unique`, you reference the field directly — `where: { contentHash: "..." }`. The compound key syntax only appears for multi-field `@@unique`.

### Why `LIMIT 1` on a unique constraint

`findUnique` adds `LIMIT 1` to every query even though the unique constraint guarantees at most one row. PostgreSQL uses the index to find the match instantly — `LIMIT 1` stops any further scanning once it's found. It's a defensive addition: if something went wrong and duplicates existed, only one row comes back. It also signals intent — this is a single-row lookup, not a scan.

The contrast is with `findFirst` — which also returns one row but accepts non-unique `where` clauses. `findFirst` genuinely relies on `LIMIT 1` to stop scanning when multiple rows could match. `findUnique` doesn't strictly need it, but Prisma adds it anyway for correctness and consistency.

### Why hash after normalization, not after loading

Hashing after normalization means two documents that differ only in whitespace or HTML entities (e.g., same content, slightly different raw encoding) produce the same hash — they're treated as the same document. Hashing before normalization would treat them as different, creating unnecessary duplicates.

### The answer in one go
> "Deduplication prevents the same document from being ingested twice by SHA-256 hashing its normalized content and storing the hash on the Document row with a `@@unique([userId, contentHash])` constraint. Before any storage, a `findUnique` lookup checks if that hash already exists for that user — if so, the existing documentId is returned immediately. The composite constraint (not single-field) is correct for multi-tenancy: each user independently owns their version of the document. Prisma generates a compound key `userId_contentHash` from the `@@unique` declaration, which maps to a SQL WHERE clause on both fields with LIMIT 1."

### Revision Questions

- Why hash after normalization rather than immediately after loading?
- Why use `@@unique([userId, contentHash])` instead of `@unique` on `contentHash` alone?
- What does Prisma generate from `@@unique([userId, contentHash])` and how do you use it in a query?
- What is the difference between `findUnique` and `findFirst`? When would you use each?
- Why does `findUnique` add `LIMIT 1` even though the constraint guarantees at most one row?
- What happens if you ingest the same GitHub repo twice — will all files be deduplicated or just some?

---

## 23. LLM-Based Query Analyzer — Replacing Rule-Based Classification

### The problem with keyword matching

The V1 query analyzer used string matching:

```typescript
const summaryKeywords = ["summary", "summarise", "overview"]
return summaryKeywords.some(kw => query.toLowerCase().includes(kw))
  ? "summary" : "semantic"
```

This breaks on any phrasing that doesn't contain the exact trigger words. "Give me the gist of this", "walk me through the architecture", "high level explanation" — all route to `semantic` because none contain `"summary"` or `"overview"`. The keyword list becomes a maintenance burden with no ceiling on edge cases.

### The fix — a single cheap LLM classification call

Replace keyword matching with a structured LLM call that reads the actual query and returns a typed intent:

```typescript
interface QueryIntent {
  strategy: RetrievalStrategy   // "semantic" | "summary"
  confidence: number            // 0–1
  reasoning: string             // one sentence — why this strategy was chosen
}
```

The LLM receives the query plus a prompt explaining both strategies with examples, and returns JSON conforming to this shape. `withStructuredOutput(zodSchema)` enforces the shape at runtime — the LLM cannot return free text.

### Why Zod schema, not TypeScript type

`withStructuredOutput` runs at runtime — TypeScript types are erased at compile time and don't exist at runtime. Zod schemas exist at runtime and are used by LangChain to validate and coerce the LLM's JSON output. The two are separate systems:

```typescript
// Zod — runtime enforcement
const schema = z.object({
  strategy: z.enum(["semantic", "summary"]),
  confidence: z.number(),
  reasoning: z.string(),
})

// TypeScript — compile-time only, derived from Zod or defined separately
type QueryIntent = z.infer<typeof schema>
```

`z.enum(["semantic", "summary"])` is stricter than `z.string()` — it rejects any value outside the allowed set, which prevents the LLM from returning unexpected strings.

### Temperature 0 for classification

Classification is a deterministic judgment — there is no creative value in randomness. Temperature 0 makes the model pick the highest-probability token at each step. The same query will always produce the same classification. For tasks like routing, evaluation, and structured extraction, always use temperature 0.

### `reasoning` as a first-class field

The `reasoning` field replaces the hardcoded `retrievalReason` strings in `DebugInfo`. Instead of `"Summary keywords detected in query"` — a string that was always wrong for queries like "give me the gist" — the debug panel now shows what the LLM actually said: `"The user is asking for a broad overview of the ingestion pipeline rather than a specific fact."` Real signal, not a canned label.

### Wiring `reasoning` through the graph

`reasoning` from `QueryIntent` is mapped to `queryReasoning` in graph state (to avoid naming collisions), flows through `compiledGraph.invoke`, is destructured in `query.ts`, and fed into `debugInfo.retrievalReason`. The rename to `queryReasoning` is intentional — "reasoning" is too generic a name for a shared state object.

### Where curly braces need escaping in LangChain prompts

`ChatPromptTemplate` interprets `{word}` as a template variable. Any literal `{` or `}` in the prompt — such as in a JSON example — must be doubled: `{{` renders as `{`, `}}` renders as `}` at invoke time. Missing this causes a `"Single '}' in template"` error at runtime.

### The answer in one go
> "The rule-based query analyzer is replaced with a single cheap LLM call that returns a structured `QueryIntent` — strategy, confidence, and reasoning. `withStructuredOutput` enforces the shape using a Zod schema at runtime. Temperature 0 makes the classification deterministic. The `reasoning` field flows through graph state as `queryReasoning` and replaces hardcoded retrieval reason strings in the debug panel — so the UI shows the LLM's actual explanation for why it chose semantic or summary."

### Revision Questions

- Why can't you use a TypeScript type directly with `withStructuredOutput`? What do you use instead?
- Why use `z.enum(["semantic", "summary"])` instead of `z.string()` for the strategy field?
- Why temperature 0 for a classifier but not for an answer generator?
- What happens to `{` and `}` in a LangChain prompt template? How do you include literal braces?
- Why is `reasoning` renamed to `queryReasoning` in graph state?
- What was wrong with the keyword-based analyzer for queries like "walk me through the architecture"?
- How does `reasoning` from the LLM improve the debug panel over the previous hardcoded strings?

---

## 24. Cross-Encoder Reranker — Raw Logits and Why `pipeline` Was Wrong

### The problem with bi-encoder retrieval alone

RRF fusion gives you the best-ranked chunks from dense + sparse search — but "best ranked" means "highest in both lists," not "most relevant to this specific query." A chunk can rank #1 in both lists because it shares many tokens with the query without actually answering it. The bi-encoder encodes query and chunk separately — they never attend to each other.

### Bi-encoder vs cross-encoder

| | Bi-encoder (retriever) | Cross-encoder (reranker) |
|---|---|---|
| How it scores | Query and chunk encoded separately, compared via cosine | Query and chunk encoded together in one forward pass |
| Attends across | Query alone, chunk alone | Query AND chunk simultaneously |
| Speed | Fast — chunk vectors precomputed at ingestion | Slower — forward pass per query-chunk pair at query time |
| Accuracy | Good but approximate | Significantly more accurate |
| Scale | Works over millions of chunks | Only feasible over small candidate sets (20–30) |

This is why reranking is a second-stage filter. You cannot run a cross-encoder over all of Qdrant, but you can run it over the 20–30 candidates RRF already narrowed down.

### Why the `pipeline` abstraction was wrong

`@xenova/transformers` has a `pipeline("text-classification", model)` convenience wrapper. For `ms-marco-MiniLM-L-6-v2`, this was the wrong choice — the model is a **regression model** with a single output neuron, not a binary classifier. The pipeline applies softmax to that single value, and softmax of one value always equals 1.0. Every chunk scored 100% regardless of actual relevance.

The fix: bypass the pipeline and use the model directly via `AutoTokenizer` + `AutoModelForSequenceClassification` to access the raw logit before any normalization.

### How the implementation works

**Tokenization — both texts together:**
```typescript
const input = tokenizer(query, {
  text_pair: chunk.content,
  truncation: true,
  max_length: 512,
  return_tensors: "pt"
})
```
The cross-encoder receives query and chunk as a single concatenated input — `text_pair` tells the tokenizer to pack them together. The model's attention can then flow across both texts simultaneously. `truncation: true` + `max_length: 512` — BERT-based models have a fixed context window, excess tokens are cut off rather than crashing.

**Forward pass — raw logit:**
```typescript
const output = await model(input)
return output.logits.data[0]
```
One number per query-chunk pair. This is the raw relevance score before softmax. Higher = more relevant. There is no fixed range — scores are unbounded.

**Running all pairs in parallel:**
```typescript
const scores = await Promise.all(
  chunks.map(async (chunk) => {
    const input = tokenizer(query, { text_pair: chunk.content, ... })
    const output = await model(input)
    return output.logits.data[0]
  })
)
```
One forward pass per chunk, all fired in parallel via `Promise.all`. For 20 chunks — 20 forward passes, results collected into `scores[]`.

### Raw logit range — not 0 to 1

Cross-encoder logits are unbounded — they can be large positive or large negative numbers. The absolute values don't matter — only relative ordering does.

```
chunk 1:  7.22   ← highly relevant
chunk 2:  3.27   ← relevant
chunk 3:  0.42   ← borderline
chunk 4: -2.02   ← not relevant
chunk 5: -3.88   ← not relevant
```

Threshold `score > 0` is used (not `> 0.5`) because zero is the natural midpoint for logits — positive = model thinks relevant, negative = model thinks not relevant. `0.5` is the midpoint for softmax probabilities, which is a different thing entirely.

If you want 0–1 for display purposes, you can apply sigmoid: `1 / (1 + Math.exp(-score))`. But this is cosmetic only — the ranking does not change.

### Singleton pattern for the model

```typescript
let tokenizer: any = null
let model: any = null

async function getReranker() {
  if (!tokenizer || !model) {
    tokenizer = await AutoTokenizer.from_pretrained("Xenova/ms-marco-MiniLM-L-6-v2")
    model = await AutoModelForSequenceClassification.from_pretrained("Xenova/ms-marco-MiniLM-L-6-v2")
  }
  return { tokenizer, model }
}
```

Loading the model reads hundreds of MB from disk and allocates memory. Same reason as the Prisma singleton — do it once, reuse across all requests.

### Fallback when all chunks score negative

```typescript
const filtered = sorted.filter(chunk => chunk.score > 0)
return filtered.length > 0 ? filtered : sorted.slice(0, 3)
```

If every chunk scores negative, the filter would return an empty array — the evaluator and generator would receive nothing and the graph would break. The fallback returns the top 3 regardless of score so the graph always has something to work with.

### Why errors should not be silently caught in nodes

The reranker initially had a `try-catch` that caught errors and returned `undefined`. When `rerankerNode` returned `{ chunks: undefined }`, LangGraph's state reducer skipped the update and kept the previous chunks from `retrieverNode`. The query appeared to work but the reranker was never actually running. Silent failures are worse than crashes — they give you false confidence that the system is working when it isn't.

### The answer in one go
> "A cross-encoder reranker rescores RRF candidates by encoding query and chunk together in a single forward pass — full attention across both. This is more accurate than bi-encoder cosine similarity but only feasible over small candidate sets (20–30). The `pipeline` abstraction was wrong for this model because it applied softmax to a single regression output, always producing 1.0. Using `AutoTokenizer` + `AutoModelForSequenceClassification` directly gives the raw logit — an unbounded relevance score where positive means relevant and negative means not. The model is loaded once via a singleton and reused. Threshold is `> 0` not `> 0.5` because logits are not softmax probabilities."

### Revision Questions

- What is the difference between a bi-encoder and a cross-encoder? When would you use each?
- Why can't you run a cross-encoder over the entire Qdrant index?
- Why does the `pipeline` abstraction give wrong results for `ms-marco-MiniLM-L-6-v2`?
- What does `text_pair` do in the tokenizer call?
- What is `max_length: 512` protecting against? What happens to tokens beyond the limit?
- Why are cross-encoder logits unbounded? What range would softmax probabilities be in?
- Why is the threshold `score > 0` instead of `score > 0.5`?
- What happens if you apply sigmoid to a logit? Does the ranking change?
- Why does the reranker use a singleton pattern for the model?
- What happens when the reranker silently catches errors and returns `undefined`? Why is this worse than crashing?

---

## 25. Transactional Ingestion — Two-Phase Write and Compensating Rollback

### The problem

The original ingestion loop wrote each chunk to PostgreSQL and Qdrant inside the same `Promise.all`:

```typescript
await Promise.all(chunks.map(async (chunk, i) => {
  await prisma.chunk.create(...)   // PG write
  await qdrant.upsert(...)         // Qdrant write
}))
```

Two failure scenarios, two different problems:

| Failure | Result |
|---|---|
| PostgreSQL fails mid-batch (e.g. chunk 4 of 10 throws) | Chunks 1–3 committed in PG, 4–10 never written. Orphaned partial data |
| Qdrant fails after all PG writes commit | All chunk rows in PG, no vectors in Qdrant. Content stored but unretrievable |

There is no rollback in either case. The system has no way to detect or recover from either state.

### Why Prisma transactions fix the PostgreSQL problem

`prisma.$transaction` wraps multiple writes in a single PostgreSQL transaction. All operations either commit together or roll back together:

```typescript
const savedChunks = await prisma.$transaction(async (tx) => {
  return Promise.all(
    chunks.map(chunk => tx.chunk.create({ data: { ...chunk, vectorized: false } }))
  )
})
```

Key points:
- `tx` is a transaction-scoped Prisma client — same API as `prisma`, bound to the transaction
- Use `tx.chunk.create` inside the callback, not `prisma.chunk.create` — using `prisma` inside would run outside the transaction boundary
- The callback must `return` the result — without `return`, `savedChunks` is `undefined`
- If any one write throws, PostgreSQL rolls back all writes automatically

A single `deleteMany` or `updateMany` does not need a transaction — it is already atomic in PostgreSQL. Transactions are needed when multiple separate operations must all succeed or all fail together.

### Why transactions cannot fix the Qdrant problem

`prisma.$transaction` is PostgreSQL-only. Qdrant is a separate process with no connection to PostgreSQL's transaction log. Qdrant has no way to "join" a Postgres transaction — if Qdrant fails after the PG transaction commits, there is no shared mechanism to roll back.

This is the cross-system consistency problem. The fix requires a different pattern.

### The `vectorized` flag — compensating rollback

Add `vectorized Boolean @default(false)` to the `Chunk` model. Ingestion becomes two explicit phases:

**Phase 1 — PostgreSQL (inside transaction):**
Write all chunks with `vectorized: false`. If PG fails — transaction rolls back, nothing committed.

**Phase 2 — Qdrant (outside transaction):**
Upsert all vectors. On success: flip `vectorized: true`. On failure: delete the PG rows and re-throw.

```typescript
// Phase 1 — atomic PG write
const savedChunks = await prisma.$transaction(async (tx) => {
  return Promise.all(chunks.map(chunk => tx.chunk.create({ data: { ...chunk, vectorized: false } })))
})

// Phase 2 — Qdrant upsert with compensating rollback
try {
  await Promise.all(chunks.map((chunk, i) => upsertChunksInQdrant(chunk, savedChunks[i].id, ...)))
  await markChunksVectorised(savedChunks.map(c => c.id))
} catch (error) {
  await prisma.chunk.deleteMany({ where: { id: { in: savedChunks.map(c => c.id) } } })
  throw error
}
```

This is a **compensating transaction** — because you can't undo a committed PG write via Qdrant's failure, you compensate by explicitly reversing the PG write after the fact.

### Why `upsertChunksInQdrant` must NOT swallow errors

If `upsertChunksInQdrant` has a try/catch that logs and returns, the outer try/catch never sees the failure. `markChunksVectorised` runs anyway and `deleteMany` never executes. The function returns success. You end up with PG rows that have no vectors — exactly the broken state you were trying to prevent. Silent failures are worse than crashes.

### Outbox Pattern — the production-grade version

The compensating rollback approach is synchronous — the HTTP request blocks until both PG and Qdrant finish. If Qdrant is slow or temporarily down, the request times out.

The production pattern is the **Outbox Pattern**:
1. Write all chunks to PG with `vectorized: false` — return success to the client immediately
2. A background worker (BullMQ + Redis) picks up `vectorized: false` rows, retries Qdrant, flips the flag on success

The `vectorized` flag becomes the retry queue. The ingestion request is decoupled from Qdrant availability. This is #20 (Queue-based Ingestion) in the roadmap — the current compensating rollback is the synchronous version of the same idea.

### The answer in one go
> "Ingestion writes to two independent systems — PostgreSQL and Qdrant. For within-PG partial writes, `prisma.$transaction` solves the problem: all chunks commit or none do. For cross-system failure (PG succeeds, Qdrant fails), a `vectorized` flag enables a compensating rollback: all chunks are written to PG with `vectorized: false`, then Qdrant upserts run. On success, the flag flips to `true`. On failure, the PG rows are deleted and the error re-thrown. The cross-system failure can never be solved with a transaction — Qdrant has no connection to PostgreSQL's transaction boundary. The production version of this pattern is the Outbox Pattern: write to PG, return success, let a background worker handle Qdrant asynchronously."

### Revision Questions

- Why does `prisma.$transaction` not protect against Qdrant failure?
- What does the `tx` parameter in the `$transaction` callback represent? What happens if you use `prisma` instead of `tx` inside the callback?
- Why must the `$transaction` callback `return` its result?
- A single `deleteMany` call — does it need its own transaction? Why or why not?
- What is a compensating transaction? How does it differ from a database rollback?
- What is the Outbox Pattern? How does the `vectorized` flag relate to it?
- Why should `upsertChunksInQdrant` not have a try/catch that swallows errors?
- What is the state of the system if `markChunksVectorised` runs after a Qdrant failure?
- What does `vectorized: false` on a chunk row older than 1 hour tell you in production?

---

## 26. Ingestion Input Validation and SSRF Protection

### Why validate at the API boundary

The ingestion pipeline is expensive — a single request triggers loading, normalization, chunking, embedding, and two database writes. Letting invalid input reach any of those stages wastes compute and can cause unpredictable failures deep in the pipeline. Validation at the route handler level rejects bad input before anything else runs.

### The three validation layers

**PDF — size and type check (sync):**
```typescript
if (!file.name.toLowerCase().endsWith(".pdf")) → 400
if (file.size > 50 * 1024 * 1024) → 400           // 50MB limit
```
Both checked before the file is written to `/tmp`. No disk I/O wasted on invalid uploads.

**GitHub — URL structure check (sync):**
```typescript
new URL(source)               // throws if malformed
parsed.hostname !== "github.com" → 400
parsed.protocol !== "https:" → 400
```
Blocks internal git servers, self-hosted GitLab, and typosquatted domains. Pure string check — no network call needed.

**Website — URL structure + SSRF check (async):**
Same structure check as GitHub, plus two layers of SSRF protection.

### What is SSRF

SSRF (Server-Side Request Forgery) is an attack where a user tricks your server into making a request to an internal resource — your database, your admin panel, AWS metadata endpoint, or any service on your private network that is not exposed to the internet.

Without validation, an attacker can send:
```
POST /api/ingest
{ "type": "website", "source": "http://192.168.1.1/admin" }
```
Your server fetches that URL — from inside your network, bypassing any firewall. The response content gets chunked, embedded, and stored — potentially leaking internal data into the knowledge base.

### Two-layer SSRF protection

**Layer 1 — hostname regex (before any network call):**
```typescript
const PRIVATE_IP_RANGES = [
  /^127\./, /^10\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./, /^::1$/, /^localhost$/i,
]
```
Catches obviously internal hostnames and IPs directly in the URL.

**Layer 2 — DNS resolution check:**
```typescript
const addresses = await dns.lookup(parsed.hostname, { all: true })
for (const { address } of addresses) {
  if (isPrivateHost(address)) → 400
}
```
An attacker can register `evil.com` pointing to `192.168.1.1`. Layer 1 passes — `evil.com` looks public. Layer 2 resolves the DNS and catches the private IP. Without this, Layer 1 is trivially bypassed.

`{ all: true }` returns all DNS records, not just the first — a hostname can have multiple A records, some public, some private.

### Why validation lives in `src/lib/ingest-validation.ts`

Route handlers should only contain routing logic — auth check, parse input, call validation, call service, return response. Embedding validation functions inline stretches the file and makes it harder to test the validation logic independently. A dedicated file keeps responsibilities separate and the route readable.

### The answer in one go
> "Ingestion validation protects against two classes of problems: bad input reaching expensive pipeline stages, and SSRF attacks where an attacker tricks the server into fetching internal resources. PDF validation checks file type and size before any disk I/O. GitHub URLs are validated for hostname and protocol — pure string checks. Website URLs get an additional two-layer SSRF check: a regex against known private IP ranges, and a DNS resolution check that catches public-looking domains that resolve to private IPs. All validation runs before `ingestDocument` is called. Validation logic lives in `src/lib/ingest-validation.ts` to keep the route handler clean."

### Revision Questions

- What is SSRF? Give a concrete example of how it can be exploited via an ingestion endpoint.
- Why is a hostname regex check alone insufficient SSRF protection?
- What does `dns.lookup(hostname, { all: true })` return? Why `all: true`?
- Why is PDF file size checked before writing to `/tmp` rather than after?
- Why does GitHub URL validation not need a DNS check but website URL validation does?
- Where should validation logic live in a Next.js API route? Why not inline in the route handler?

---

## 29. Conversational Query Rewriting — Merging Rewrite + Classify into One LLM Call

### The problem

Follow-up queries contain references that only make sense with conversation context:

```
User: "What is JWT?"
AI:   "JWT is a stateless token format..."
User: "How does it compare to sessions?"
```

Qdrant embeds `"How does it compare to sessions?"` verbatim. `"it"` has no embedding meaning in isolation — the vector search has no idea `"it"` refers to JWT. Retrieval returns garbage.

### Why merge rewriting with classification instead of a separate step

The naive approach is a dedicated rewriter node before the analyzer — two LLM calls per query. But the query analyzer already reads the full query to classify intent. If you give it the history too, it can resolve references AND classify in the same forward pass.

This means:
- One LLM call instead of two — half the latency on conversational queries
- The LLM classifies the *resolved* query, not the raw one — more accurate routing
- No new node, no graph rewiring, no extra file

The key insight: the two tasks are naturally sequenced — you need the resolved query to classify it correctly anyway.

### How it works in the prompt

The `queryIntentPrompt` now has two explicit jobs:

1. **Rewrite** — if history exists and the query has references, produce a standalone version
2. **Classify** — determine retrieval strategy for the (rewritten) query

`MessagesPlaceholder("history")` injects the conversation turns between the system instruction and the human message. If history is empty, the LLM sees no prior turns and returns the query unchanged as `rewrittenQuery`.

### Where `rewrittenQuery` flows through the system

```
analyzerNode → writes rewrittenQuery to graph state
retrieverNode → uses rewrittenQuery for Qdrant embedding (not raw query)
generatorNode → uses rewrittenQuery as the question passed to the LLM
query.ts      → destructures rewrittenQuery, writes to QueryLog
```

The raw `query` stays in state too — it's the original user input. `rewrittenQuery` is what the system actually uses for retrieval and generation.

### What happens when there's no history

`rewrittenQuery` = original query unchanged. The LLM is instructed to return it as-is when no references exist. Zero overhead on stateless queries — same number of LLM calls, same latency.

### The answer in one go
> "Conversational query rewriting resolves pronouns and implicit references in follow-up queries before they reach the retriever. Instead of a dedicated rewriter node, rewriting is merged into the query analyzer — one LLM call receives the raw query plus conversation history and returns both the resolved `rewrittenQuery` and the intent classification. This saves one LLM call per conversational turn. `rewrittenQuery` flows through graph state and is used by the retriever for Qdrant embedding, the generator for answer generation, and the query logger for observability."

### Revision Questions

- Why does Qdrant fail to retrieve relevant chunks for follow-up queries like "how does it work"?
- Why merge rewriting into the analyzer instead of adding a separate rewriter node?
- What does `MessagesPlaceholder("history")` inject into the prompt, and what happens when history is empty?
- Which query does `retrieverNode` use for Qdrant embedding — `query` or `rewrittenQuery`? Why?
- If the rewriter produces a bad standalone query, which downstream steps are affected?
- Why is `rewrittenQuery` stored in `QueryLog` rather than just `query`?
