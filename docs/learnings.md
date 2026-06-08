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
