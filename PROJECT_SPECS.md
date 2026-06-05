# Adaptive Retrieval Runtime (ARR)

## Product Requirements & Architecture Specification

### Version: V1 Foundation + V2/V3 Roadmap

---

# 1. Vision

Build an AI-native knowledge system that can ingest information from multiple sources, understand user queries, intelligently select retrieval strategies, and generate grounded responses with full observability.

This project is NOT intended to be a simple RAG chatbot.

The goal is to demonstrate:

- LangChain
- LangGraph
- RAG
- Multiple Chunking Strategies
- Retrieval Routing
- Adaptive Retrieval
- Tool Calling
- Agents
- MCP Integration
- Observability
- AI Workflow Orchestration

The system should evolve progressively from a simple retrieval system into a sophisticated AI runtime.

---

# 2. High-Level Product Flow

```text
User Uploads Source
    ↓
Ingestion Pipeline
    ↓
Normalization
    ↓
Chunking
    ↓
Embeddings
    ↓
Vector Storage
    ↓

User Query
    ↓
Query Analysis
    ↓
Retrieval Strategy Selection
    ↓
Retrieval Execution
    ↓
Answer Generation
    ↓
Response + Debug Information
```

---

# 3. V1 Scope

V1 focuses only on:

### Supported Sources

- PDF Documents
- Website URLs
- Public GitHub Repositories

### Supported Retrieval Strategies

- Semantic Retrieval
- Summary Retrieval

### Query Types

- Precise Questions
- Broad Summary Questions

### Deliverables

- Ingestion Pipeline
- Chunking Pipeline
- Embedding Pipeline
- Vector Search
- Adaptive Retrieval Routing
- Answer Generation
- Observability Logs

No Agents.\
No MCP.\
No LangGraph.\
No Multi-Agent Systems.

---

# 4. Technical Stack

Frontend:

- Next.js

Backend:

- Next.js Route Handlers

Language:

- TypeScript

AI Framework:

- LangChain JS

Vector Database:

- Qdrant

Relational Database:

- PostgreSQL

ORM:

- Prisma

LLM Provider:

- OpenAI / Anthropic / Gemini

Observability:

- Custom Debug Layer

---

# 5. Folder Structure

```text
app/
  api/
    ingest/
    query/
    documents/

src/

  core/

  ingestion/
    loaders/
    normalizers/

  chunking/

  embeddings/

  vector/

  retrieval/
    retrievers/

  llm/

  workflows/

  prompts/

  db/

  observability/

docs/

specs/
```

---

# 6. Core Data Models

## Document

Represents a normalized source.

Fields:

- id
- title
- content
- sourceType
- metadata

Supported sourceType:

- pdf
- github
- website

---

## Chunk

Represents a searchable document segment.

Fields:

- id
- documentId
- content
- metadata
- chunkIndex

---

## RetrievalResult

Fields:

- chunks
- strategy
- confidence
- reasoning

---

# 7. Ingestion System

## Purpose

Convert raw external sources into normalized documents.

---

## PDF Loader

Input:

PDF file

Output:

Document[]

Responsibilities:

- Extract text
- Extract metadata
- Normalize formatting

---

## Website Loader

Input:

Website URL

V1 Behavior:

Only crawl the provided page.

No domain crawling.

No recursive crawling.

Output:

Document[]

---

## GitHub Loader

Input:

Public GitHub Repository URL

V1 Behavior:

Process:

- README
- markdown files
- documentation
- source files

Ignore:

- binaries
- node\_modules
- build folders

Output:

Document[]

---

## Normalization

All sources should be transformed into a common Document format.

Goal:

Every downstream system should consume identical document structures.

---

# 8. Chunking System

## Purpose

Convert large documents into searchable chunks.

---

## Recursive Chunking

Used for:

- PDFs
- Websites

Characteristics:

- fixed chunk size
- overlap support

Recommended:

Chunk Size:\
1000

Overlap:\
200

---

## Markdown Chunking

Used for:

- GitHub documentation
- Markdown files

Characteristics:

- preserve headings
- preserve sections

---

# 9. Embedding Pipeline

Purpose:

Convert chunks into vectors.

Flow:

```text
Chunk
 ↓
Embedding Model
 ↓
Vector
 ↓
Qdrant
```

Metadata stored:

- documentId
- sourceType
- chunkIndex
- title

---

# 10. Vector Storage

Database:

Qdrant

Responsibilities:

- Store vectors
- Similarity search
- Delete vectors
- Filter vectors

---

# 11. Retrieval Layer

The retrieval layer is the heart of the system.

---

## Semantic Retriever

Purpose:

Handle precise user questions.

Examples:

- What is JWT?
- How does login work?
- Explain middleware.

Behavior:

```text
Query
 ↓
Embedding
 ↓
Similarity Search
 ↓
Top K Chunks
```

Recommended:

Top K = 5

---

## Summary Retriever

Purpose:

Handle broad questions.

Examples:

- Summarize this document.
- Explain the architecture.
- Give an overview.

Behavior:

```text
Query
 ↓
Retrieve Larger Chunk Set
 ↓
Coverage Selection
 ↓
Summarization
```

Recommended:

Top K = 20-30

---

# 12. Query Analysis

Purpose:

Determine retrieval requirements.

V1:

Simple rule-based analysis.

Examples:

If query contains:

- summarize
- overview
- architecture

Route to:

Summary Retriever

Otherwise:

Semantic Retriever

---

# 13. Retrieval Router

Purpose:

Select retrieval strategy.

Input:

QueryAnalysis

Output:

Retriever

Examples:

```text
Summary Query
 ↓
Summary Retriever

Precise Query
 ↓
Semantic Retriever
```

---

# 14. Answer Generation

Input:

- User Query
- Retrieved Chunks

Output:

Grounded Answer

Rules:

- Use only retrieved context.
- Avoid hallucination.
- Cite source chunks when possible.

---

# 15. Workflow Layer

Workflows orchestrate system behavior.

---

## QA Workflow

```text
Query
 ↓
Analyze
 ↓
Semantic Retrieval
 ↓
Generate Answer
```

---

## Summary Workflow

```text
Query
 ↓
Analyze
 ↓
Summary Retrieval
 ↓
Generate Summary
```

---

# 16. Observability System

This is a first-class feature.

Every query execution should be explainable.

---

## Debug Response

Include:

```json
{
  "selectedRetriever": "semantic",
  "retrievalReason": [
    "precise question detected"
  ],
  "retrievedChunks": 5,
  "executionTime": 1200
}
```

---

## Future Debug Fields

- Similarity scores
- Chunk ranking
- Retrieval confidence
- Retry attempts

---

# 17. API Contracts

## POST /api/ingest

Input:

```json
{
  "type": "pdf",
  "source": "..."
}
```

Output:

```json
{
  "documentId": "...",
  "status": "completed"
}
```

---

## POST /api/query

Input:

```json
{
  "query": "What is JWT?"
}
```

Output:

```json
{
  "answer": "...",
  "debug": {}
}
```

---

# 18. V2 Roadmap

After V1 is stable.

---

## LangGraph Integration

Replace simple workflows with graph-based execution.

Examples:

```text
Query
 ↓
Analyzer
 ↓
Retriever Selection
 ↓
Retrieval
 ↓
Generation
```

---

## Hybrid Retrieval

Combine:

- Semantic Search
- Keyword Search

Useful for:

- API names
- Function names
- Error codes

---

## Multi Query Retrieval

Generate multiple retrieval queries.

Example:

```text
Authentication Flow
 ↓
Login
JWT
Middleware
Sessions
```

Retrieve independently.

Combine results.

---

## CRAG

Corrective Retrieval-Augmented Generation.

Flow:

```text
Retrieve
 ↓
Evaluate Retrieval Quality
 ↓
If Poor
    Retry Retrieval
```

---

## Queue-Based Ingestion

Required for:

- Large PDFs
- Large repositories

Components:

- BullMQ
- Redis

---

# 19. V3 Roadmap

---

## Tool Calling

Tools:

- Web Search
- Repository Search
- Documentation Search

---

## MCP Integration

Support external MCP servers.

Examples:

- GitHub MCP
- Filesystem MCP
- Browser MCP

---

## Planner Agent

Purpose:

Break complex tasks into subtasks.

---

## Research Agent

Purpose:

Perform iterative retrieval.

---

## Report Generation Agent

Purpose:

Generate structured reports.

---

# 20. V4 Roadmap

---

## Multi-Agent Architecture

Agents:

- Planner
- Retriever
- Researcher
- Reviewer

---

## Self-RAG

System evaluates:

- retrieval quality
- answer quality

before responding.

---

## Long-Term Memory

Conversation-level memory.

---

# 21. Development Order

Phase 1

1. Qdrant Setup
2. PostgreSQL Setup
3. PDF Loader
4. Website Loader
5. GitHub Loader
6. Recursive Chunking
7. Markdown Chunking
8. Embeddings
9. Semantic Retriever
10. Query API
11. Answer Generation

Phase 2

12. Summary Retriever
13. Query Analyzer
14. Retrieval Router
15. Observability

Phase 3

16. LangGraph
17. Hybrid Retrieval
18. CRAG

Phase 4

19. Tool Calling
20. MCP
21. Agents

---

# Success Criteria

A successful V1 should:

- Ingest PDFs
- Ingest Websites
- Ingest Public GitHub Repositories
- Store chunks in Qdrant
- Answer questions using RAG
- Support summary-style queries
- Dynamically choose retrieval strategy
- Return observability/debug information
- Be extensible for LangGraph, MCP, Agents and CRAG
