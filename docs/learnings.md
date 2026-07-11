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
