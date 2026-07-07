@AGENTS.md

---

# Maxtern — Project Rules for Claude

## What This Project Is

Adaptive Retrieval Runtime (ARR) — an AI knowledge system that ingests documents (PDF, Website, GitHub), stores them as vector chunks, and answers queries by selecting the right retrieval strategy using a LangGraph pipeline with CRAG (Corrective RAG) and hybrid retrieval.

This is a learning project. The user drives implementation. Do not implement entire features autonomously. Explain, guide, and let the user write code. Only write code when explicitly asked.

Full architecture: `docs/architecture.md`
Full project state: `docs/project-state.md`
System flow: `docs/flow.md`
Concepts & learnings log: `docs/learnings.md`

---

## Architecture Rules — Never Break These

### Storage separation
- PostgreSQL = source of truth for all text content (Document + Chunk tables)
- Qdrant = vectors + reference IDs only — never store content in Qdrant payload
- Qdrant payload must always contain: `chunkId`, `documentId`, `sourceType`

### Prisma client
- Import from `../generated/prisma/client` — NOT from `@prisma/client`
- Always use singleton pattern with global hot-reload fix (see `src/db/client.ts`)
- Prisma 6 requires PrismaPg adapter — never instantiate `new PrismaClient()` without adapter

### Embeddings
- Current model: `nomic-embed-text` via Ollama — 768 dimensions
- If switching to OpenAI: Qdrant collection must be recreated (768 → 1536 dims)
- Always use `embedTexts` (batch) during ingestion — never per-chunk `embedText`
- Use `embedText` (single) only at query time

### Chunking strategy
- PDF + Website → `recursiveChunk` (RecursiveCharacterTextSplitter)
- GitHub → `markdownChunk` (MarkdownTextSplitter)
- `MarkdownHeaderTextSplitter` does not exist in LangChain JS — do not suggest it

### LangChain usage
- Use LangChain for: loaders, text splitters, embeddings
- Do NOT use LangChain for: VectorStore abstraction, Retriever abstraction, Chains
- Reason: our Qdrant+PostgreSQL hybrid does not map to LangChain's QdrantVectorStore

### Ingestion workflow
- `ensureCollections()` must always be called at the start of `ingestDocument`
- GitHub loader returns `Document[]` — loop with `processSingleDocument`
- PDF/Website loaders return single `Document` — call `processSingleDocument` directly
- Use `Promise.all(chunks.map(...))` for parallel chunk storage — not a sequential loop

### Authentication (Clerk v7)
- Package: `@clerk/nextjs@^7` — signal-based API, completely different from v6
- `ClerkProvider` wraps `<html>` in `src/app/layout.tsx` — not the body, not a subtree
- Middleware lives at `src/middleware.ts` — NOT at the project root. Next.js silently ignores root middleware when using `src/` directory
- `useSignIn()` returns `{ signIn, errors, fetchStatus }` — no `isLoaded`, no `setActive`
- Guard pattern: `if (!signIn) return` — not `if (!isLoaded) return`
- Sign-in methods: `signIn.password()`, `signIn.finalize()`, `signIn.sso()`, `signIn.mfa.sendEmailCode()`, `signIn.mfa.verifyEmailCode()`
- Sign-up methods: `signUp.password()`, `signUp.verifications.sendEmailCode()`, `signUp.verifications.verifyEmailCode()`, `signUp.finalize()`
- All methods return `{ error }` — they do not throw
- `finalize()` does NOT navigate — always call `router.push('/chat')` manually after it
- `needs_client_trust` status: new device detected — requires second OTP step via `signIn.mfa.*`
- Google SSO redirect URLs must be absolute (use `window.location.origin`) — relative paths are rejected
- Logout: `useClerk().signOut({ redirectUrl: '/sign-in' })`

### LangGraph / CRAG pipeline (V2+)
- Query pipeline is a LangGraph StateGraph — nodes: retrieve → grade → (rewrite | generate)
- CRAG pattern: if graded chunks are irrelevant, rewrite query and re-retrieve before generating
- Tool calling used for CRAG retry: retrieve tool called by LLM when grading fails
- Do not bypass the graph with direct LLM calls — all query flow goes through the graph

---

## Conventions

### Imports
- Use `@/` alias for imports within `src/` (e.g. `@/chunking/markdown-chunker`)
- Use relative imports for files in adjacent folders (e.g. `../../core/types`)

### Types
- Shared types live in `src/core/types.ts` — `Document` and `Chunk` interfaces
- These are application types — independent of Prisma generated types
- Do not add Prisma types to `src/core/types.ts`

### File naming
- kebab-case for all files: `pdf-loader.ts`, `semantic-retriever.ts`
- One responsibility per file — loaders only load, normalizers only normalize

### Error handling
- Throw meaningful errors with context: `throw new Error("Failed to load content from URL: ${url}")`
- Always log errors with `console.error` before rethrowing
- Do not swallow errors silently

### Async patterns
- Always `await` async calls — no floating promises
- Use `Promise.all` for parallel independent operations
- Use `for...of` loop when operations must be sequential (e.g. GitHub docs ingestion)

---

## Current State

See `docs/project-state.md` for the authoritative list of what is done, in progress, and pending. Do not maintain a duplicate list here — it will go stale.

---

## Teaching Mode

This is a learning project. The user learns by doing — Claude teaches, explains, and guides. The user writes the code.

- Do NOT write code directly unless the user explicitly asks ("write this for me" / "just give me the code")
- When asked how to implement something — explain the concept and approach first
- Break things into steps — don't explain everything at once
- When the user is stuck — give hints, not full solutions
- When reviewing user-written code — explain what's right/wrong and why, don't rewrite it

### Project state
- Whenever a major component is completed (e.g. semantic retriever, query analyzer, LLM layer, an API route), update `docs/project-state.md` immediately — mark it as Done in the folder structure, move it from Pending to Completed, and update the development order table
- Do not wait for the user to ask — update it as part of wrapping up that component

### Learnings log
- When a technical concept becomes clear through discussion (especially "why" questions about architecture, design decisions, tradeoffs), add it to `docs/learnings.md`
- Do NOT add an entry after every single message — wait until a concept is fully explained and understood (usually after 2–4 messages on the topic)
- Also add potential interview questions related to that concept at the bottom of the file
- Format: numbered section, clear heading, question → explanation → "the answer in one go" (a crisp summary paragraph)
- Do NOT use words like "interview", "newbie", or frame anything as exam prep — the tone is that of an engineer who understands their own system deeply, not a student cramming answers
- The questions section at the bottom should be titled "Revision Questions" — not "interview questions"

---

## Things to Never Do

- Do not use `@prisma/client` — always use the generated path
- Do not store chunk content in Qdrant payload
- Do not suggest `MarkdownHeaderTextSplitter` — it is Python-only
- Do not use LangChain's VectorStore or Retriever abstractions
- Do not implement full features without being asked — this is a learning project
- Do not add abstractions, helpers, or utilities that are not needed yet
- Do not auto-generate frontend code unless explicitly asked
- Do not modify `prisma/schema.prisma` without discussing the migration impact
- Do not commit anything unless the user explicitly asks
- Do not place middleware at the project root when using `src/` directory — it must be at `src/middleware.ts`
- Do not store content in Qdrant payload — even for auth (userId belongs in PostgreSQL Document table)

---

## V1 Known Limitations (do not try to fix unless asked)

- Website loader fails on bot-protected sites (Cloudflare, etc.) — V2 concern
- Single-user only — no `userId` filtering yet — planned for V2 auth hardening
- GitHub loader loads all files — no ignore patterns yet
- No streaming on query API — full response returned at once
