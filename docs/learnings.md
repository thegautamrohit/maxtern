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

### Production Concerns
- How would you scale the ingestion pipeline for large files?
- What is the risk of embedding each chunk individually vs. in batch?
- How would you handle re-ingestion of a document (updated version)?
- What is idempotency and where does it matter in this system?
