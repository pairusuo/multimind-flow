# Long-Term Memory Progress

## Goal

Implement the first usable long-term memory foundation for MultiMind Flow:

- Markdown authorized-directory inbox
- user-confirmed import into local SQLite memory snapshots
- FTS5 search
- minimal memory library UI

## Architecture Decision

Long-term memory follows the Source / Inbox / Memory model:

- Source: Markdown files, pasted Markdown, embedded-website discussions, and future API multi-model discussions are candidate inputs.
- Inbox: scanned candidates from user-authorized directories are reviewed before import.
- Memory: confirmed document snapshots are stored in the app data SQLite database and indexed for search.

The authorized directory is not the memory database and is not a live mirror. Source file deletion must not delete confirmed memory documents.

## Product Intent

Long-term memory is not only an archive or search page. Its core value is to let the future MultiMind Flow Agent reuse user-confirmed context from earlier deep discussions.

Example: after a long investment discussion, the final imported memory may describe the user's risk tolerance, investing experience, position-sizing rules, time available for research, and constraints such as avoiding leverage or short-term speculation. When the user later asks the built-in Agent to analyze a stock, MultiMind Flow should be able to recall this memory and provide it to the Agent as hidden working context, so the Agent answers for this user instead of giving a generic investment answer.

The intended loop is:

1. Discuss a topic deeply with one or more AIs.
2. Summarize the useful outcome into a clean Markdown document.
3. Import the document into local long-term memory after user confirmation.
4. On later Agent tasks, retrieve relevant memories from the local store.
5. Provide a concise memory context to the Agent as internal working context.
6. Let the user inspect, disable, or exclude unsuitable memories when needed.

This keeps memory explicit and controllable while still allowing future answers to become personalized.

The embedded AI websites are one discussion and memory-production surface, not the only one. API-based multi-model answering is another discussion entry: MultiMind Flow can send the same question to multiple model APIs, collect answers, compare or summarize them, and then produce a candidate Markdown memory. Both entry points should feed the same memory pipeline: candidate source -> user review -> confirmed local memory -> Agent recall. Automatically prepending memory text into website input boxes is only a possible debug/validation technique, not the default product behavior.

The first API conversation implementation is intentionally narrow: one OpenAI-compatible service configuration, local API Key storage, a comma-separated model list, and non-streaming parallel chat-completions requests. It is a main workspace entry mode, not a separate settings tool: the same split cells show either embedded AI websites or API model responses. This validates the API discussion surface before adding streaming output, multiple provider-specific key managers, hosted billing, automatic summary generation, or direct memory-candidate creation.

## Current Usage Model

Current implementation covers the storage foundation:

- authorized directories act as inboxes for candidate Markdown files;
- only confirmed documents become active memory snapshots;
- active memories can be searched and viewed locally;
- disabled memories are excluded from search and future recall;
- source files are not treated as the memory database, so deleting or moving a source file does not delete imported memory.

The current UI should be used to collect stable, user-confirmed conclusions:

- personal preferences and constraints;
- reusable decision rules;
- project background and architecture decisions;
- refined conclusions from multi-AI discussions;
- article, podcast, or meeting summaries that are worth reusing later.

It should not be used as a high-weight store for raw AI answer dumps, full intermediate debate logs, temporary task status, or unreviewed automatic summaries.

## Confirmed Artifact Handoff

Discussion output needs an explicit review boundary before it becomes memory. Embedded-site
discussions and API multi-model discussions should first produce a Markdown discussion artifact,
then enter the existing confirmation pipeline:

```text
discussion/task run
  -> Markdown artifact draft
  -> user review or revision
  -> confirmed artifact version
  -> memory candidate
  -> confirmed local memory
```

The artifact layer and memory layer have different responsibilities:

- an artifact is a deliverable from one discussion and may have drafts or superseded versions;
- memory is stable, reusable background explicitly confirmed for future recall;
- task status, retries, timeouts, and raw intermediate debate logs stay outside both;
- provenance should retain the source task, participating cells or API models, creation time, and
  artifact version without embedding internal orchestration prompts into memory content;
- creating a new artifact version must not silently rewrite an already imported memory snapshot;
- importing a confirmed artifact should reuse the same normalization, deduplication, type, scope,
  disable, restore, and source-missing behavior as file-based Markdown imports.

The first version should support Markdown only. A universal artifact store or automatic indexing of
HTML, CSV, presentations, audio, and arbitrary attachments is outside the current memory scope.

## Recall Strategy Boundaries

Current recall is still a conservative local keyword strategy, not semantic memory. It should be treated as an inspectable first version:

- title, tags, original question, and body text are the primary relevance signals;
- memory type, scope, and recency can only boost a document after textual relevance is already present;
- generic task words such as "plan", "recommend", "analyze", or "how" must not create relevance by themselves;
- CJK single-character fallback is only a temporary weak signal for user-profile memories, mainly to catch short personal constraints such as "吃/喝" matching "不吃辣/不喝酒";
- reference, project, and decision-rule memories must not be recalled from scattered CJK character overlap alone;
- domain-specific synonym expansion must not be added to core recall logic.

Good recall quality depends on confirmed metadata. Import should encourage useful tags such as `饮食`, `旅行`, `不吃辣`, `不喝酒`, `投资`, `风险厌恶`, `本金安全`, and project names. These tags are not a replacement for semantic retrieval, but they make the current local recall less brittle and easier to inspect.

The recall debug UI should show both the recalled documents and why they scored: matched title/tag/body signals, score increments, CJK fallback markers, type/scope boosts, and the final hidden Agent context. This keeps the system debuggable while vector retrieval is not yet implemented.

## Agent Recall Direction

The next major product step is not more library management. The next step is making memory available to the built-in Agent.

Recommended first Agent recall version:

1. When the user gives the Agent a task, search active memory with the current task text.
2. Retrieve a small number of relevant memory documents or snippets.
3. Build a short memory context block, clearly marked as user-confirmed long-term background.
4. Provide that block to the Agent as internal working context, not as visible user text in embedded AI websites.
5. Show optional traceability such as "Agent used 3 memories" and allow the user to inspect which memories were included.
6. Provide a per-task option to run without memory when the user wants a neutral answer.

The recall service should stay source-agnostic. It should not care whether a memory came from an embedded website conversation, a pasted Markdown note, a saved local file, or a future API multi-model discussion. Import metadata should record provenance, but ranking and Agent context generation should operate on confirmed memory content and metadata.

Agent internal context shape:

```md
# User Long-Term Memory

The following memories were explicitly confirmed by the user. Use them only when relevant to the current request.

## Stable User Profile

### 1. Investment Preferences
The user is a conservative retail investor and prioritizes capital preservation.

## Relevant Decision Rules

### 1. Retail Stock Investment Rules
A single stock position should not exceed the user's agreed position limit. Avoid leverage and short-term momentum trading.

# Current Agent Task

Analyze this stock and give a buy/sell view.
```

Recall should stay conservative:

- return only a few memories by default;
- avoid injecting whole long documents unless the user explicitly selects them;
- exclude disabled memories;
- prefer memories with matching tags, domains, titles, or strong search relevance;
- make used memories inspectable so the user can catch bad recall without turning memory into visible prompt clutter by default.

## Memory Type Taxonomy

Each imported memory document has a lightweight type. The type is metadata for recall and context injection, not a replacement for tags.

- `profile`: stable user facts, preferences, constraints, habits, risk tolerance, long-term goals.
- `decision_rule`: reusable rules, checklists, criteria, operating principles, and decision standards.
- `project`: durable background for a project, product, architecture, research direction, or ongoing work.
- `event`: time-bound discussions, meetings, retrospectives, experiences, and episodic records.
- `reference`: reusable reference material, article summaries, podcast notes, external facts, or general documents.

Import UI should allow "Auto" so the user does not need to classify every document manually. Auto classification should remain conservative and can be corrected by manually selecting a type before import.

Agent recall should use memory type to organize context:

- profile memories become stable user background;
- decision rules become applicable constraints or judgment criteria;
- project memories become task background;
- event memories provide recent or episodic context;
- reference memories provide supporting material only when clearly relevant.

## Scope And Lifecycle Metadata

Memory type only describes what a memory contains. It must not be overloaded to describe where the memory applies, whether it is still valid, or how certain the content is.

The next durable metadata layer should be kept separate:

- `memory_scope`: where the memory applies. The first version uses `global` and `project`.
- lifecycle status: whether the memory is active, disabled, deleted, or later superseded.
- validity window: optional future `valid_from` and `valid_until` for time-sensitive memories.
- epistemic type: optional future marker for explicit user facts, AI inference, or behavior-derived patterns.
- confidence: optional future signal for inferred or behavior-derived memories.

The current implementation should only add the low-risk `memory_scope` field. It defaults to `global`; users can mark a memory as `project` when it should mainly apply to a specific project or task family. Agent recall can then prefer global memories plus clearly relevant project memories without treating every imported note as universal user context.

Agent context must state that the current user instruction takes priority over long-term memory. Memories are background, not commands.

## Vector Search Consideration

Vector search can improve automatic recall, but it is not the memory feature itself. It is a retrieval technique.

FTS5 keyword search is good for exact terms such as stock names, project names, tags, and explicit words in a document. Vector search is useful when the later prompt is semantically related but does not share the same words as the memory. For example, a question about whether to "buy the dip" may need to recall memories about capital preservation, risk tolerance, and avoiding short-term speculation even if those exact words are not in the prompt.

Recommended path:

1. First implement Agent task recall using the existing SQLite + FTS5 store.
2. Add UI visibility for which memories were used.
3. Split long memory documents into smaller retrievable snippets.
4. Add embeddings only after the recall loop is usable and the limits of keyword search are visible.
5. Prefer local-first storage for embeddings. If an external embedding API is used later, make the privacy tradeoff explicit.

Long-term architecture should use hybrid retrieval:

- FTS5 for exact keyword and title/tag matches;
- tags, memory type, scope, and source metadata for filtering;
- vector similarity for semantic matches;
- recency and user-confirmed status for ranking;
- disabled state as a hard exclusion.

An external vector database service is not required for the next version. A local SQLite-compatible vector extension or local vector store can be evaluated later after the product loop proves useful.

Vector-search PoC should be planned but not rushed into production:

1. Split each confirmed memory into stable snippets with document id, type, scope, tags, and source metadata.
2. Generate embeddings locally if practical; if an external embedding API is used, make the privacy tradeoff explicit.
3. Compare keyword-only recall, vector-only recall, and hybrid recall in the debug UI for the same Agent task.
4. Keep current user instruction priority and disabled-memory exclusion as hard rules.
5. Promote vector retrieval only after it reduces real false negatives without increasing unrelated recalls.

The project should not adopt a broad external RAG or vector-store abstraction only to prepare for
possible future providers. The current local SQLite + FTS5 path remains the default until measured
recall failures justify a small hybrid-retrieval PoC. Any later embedding path must preserve local
source ownership, disabled-memory exclusion, user confirmation, and inspectable ranking.

## Progress Log

- 2026-07-14: Confirmed architecture and updated `MultiMind_设计文档_v0.2.md` and `AGENTS.md`.
- 2026-07-14: Started implementation. Existing IPC/UI patterns inspected; `docs/` already contained unrelated proposal files, so this dedicated progress file was added without touching them.
- 2026-07-14: Installed `better-sqlite3` and `@types/better-sqlite3`.
- 2026-07-14: Added main-process `MemoryStore` with schema migration, import sources, Markdown inbox scanning, hash deduplication, document version rows, FTS5 search, and source-missing markers.
- 2026-07-14: Added memory IPC channels, preload bridge methods, directory picker handler, and `better-sqlite3` `asarUnpack` packaging config.
- 2026-07-14: Added first renderer memory UI: authorized-directory inbox, Markdown preview/edit, confirm import, search, view, and disable memory.
- 2026-07-14: Build passed. Initial Electron runtime failed because `better-sqlite3` was compiled for Node ABI 127; rebuilt it for Electron ABI 130 and added dynamic `rebuild:native` / `postinstall` scripts that read the installed Electron version.
- 2026-07-14: `npm run dev` starts without SQLite/native module errors.
- 2026-07-14: Moved the memory library entry out of the top toolbar and into Settings, keeping the toolbar consolidated behind the existing settings button.
- 2026-07-14: Removed the ignore candidate flow and moved the Memory Library close button back to the panel header.
- 2026-07-14: Added authorized-directory removal. Removing a directory only revokes the scan source; it does not delete imported memory snapshots or user files.
- 2026-07-15: Manual memory workflow was reported as passed: add directory, scan Markdown, preview, confirm import, search, disable, restore, remove directory, source-missing check, and restart persistence.
- 2026-07-15: Duplicate candidate behavior was reported as passed for the main scenarios: same Markdown across multiple directories, same content under different filenames, and near-identical content with whitespace changes.
- 2026-07-15: Packaged macOS smoke test was reported as passed: packaged app opens the memory library and can import/search Markdown using the local app data directory.
- 2026-07-15: Added `npm run test:memory` and `scripts/test-memory-store.mjs` to cover the core `MemoryStore` flow with a temporary scan directory.
- 2026-07-16: Clarified the product purpose of long-term memory: future Agent tasks should be able to reuse user-confirmed memories for personalized answers, not only archive and search imported documents.
- 2026-07-16: Recorded the recommended recall roadmap: start with a local recall service over SQLite + FTS5, expose it to the future Agent as hidden working context, then evaluate hybrid vector retrieval after the basic loop is validated.
- 2026-07-16: Implemented the first local memory recall service in `MemoryStore`. Embedded AI website sending remains unchanged and does not automatically prepend memory context.
- 2026-07-16: Updated the summary-document prompt to request raw Markdown inside one `markdown` code block, and normalized imported memories by stripping an outer full-document Markdown code fence when present.
- 2026-07-16: Increased forwarded discussion context from 7,000 to 20,000 characters and changed truncation to preserve recent complete user/AI message blocks instead of slicing the raw tail.
- 2026-07-16: Tightened the summary-document prompt to require exactly one top-level title and normalized imported memories by removing consecutive duplicate leading H1 titles.
- 2026-07-17: Added memory document types for user profile, project background, decision rules, event memories, and reference material. Import can auto-classify or accept a manual type.
- 2026-07-17: Updated Agent recall context to group recalled memories by type, so future Agent prompts can distinguish stable user background from decision rules and supporting references.
- 2026-07-17: Split memory content type from applicability metadata. Added the first `memory_scope` plan and implementation target, with current user instruction taking priority over recalled memories.
- 2026-07-19: Added a local Agent recall test entry in the memory library. It lets the user inspect recalled memories and the hidden Agent context without sending anything to embedded AI websites.
- 2026-07-19: Added explainable recall ranking. Recall items now include a score and structured match reasons such as title match, tag match, body match, type priority, and scope match.
- 2026-07-19: Improved recall debugging usability: recalled items can open the source memory, Agent context can be copied, and low-score recall results show a quality warning.
- 2026-07-19: Tightened recall relevance after manual testing. Generic words such as "plan" and "recommend" no longer create enough body-match score by themselves. Domain-specific synonym expansion was removed from core recall logic; recall now requires real title, tag, original-question, or body relevance before applying type, scope, or recency boosts.
- 2026-07-19: Clarified that API-based multi-model answering is a parallel memory-production entry alongside embedded website discussions. Both routes should produce candidate Markdown memories and reuse the same confirmation, storage, and Agent recall pipeline.
- 2026-07-19: Split long-term-memory rules from storage orchestration. `memoryStore.ts` now delegates recall/type heuristics to `memoryRecallRules.ts` and Agent hidden-context text to `agentMemoryContext.ts`, so Chinese retrieval rules and Agent templates are no longer mixed into the SQLite store implementation.
- 2026-07-19: Added import metadata suggestions and recall score details. Inbox preview now proposes conservative tags, import preserves/merges metadata tags, and recall debug results expose per-reason score increments plus matched words or CJK fallback markers.
- 2026-07-19: Started the API conversation line. Added a first OpenAI-compatible API conversation MVP with local config storage, model-list configuration, non-streaming parallel model calls, and a workspace mode switch. API mode reuses the split-cell UI so the bottom input still means one question fan-out to multiple AIs. Automatic summary and memory-candidate generation are still future work.

## Implementation Checklist

- [x] Add `better-sqlite3` dependency.
- [x] Add shared memory types and IPC channels.
- [x] Implement main-process memory store and schema migrations.
- [x] Implement authorized directory selection and Markdown inbox scanning.
- [x] Implement confirm import, search, list, read, and disable-memory APIs.
- [x] Implement restore flow for disabled memory found again in authorized-directory inbox.
- [x] Add preload bridge methods.
- [x] Add minimal renderer UI for inbox and memory search.
- [x] Add lightweight automated `MemoryStore` workflow test.
- [x] Add first local memory recall service for future Agent use.
- [x] Add memory document type metadata and auto-classification.
- [x] Group Agent recall context by memory type.
- [x] Add memory scope metadata for global/project applicability.
- [x] Add a local Agent recall debug entry for inspecting recalled memories and context.
- [x] Add recall scores and match reasons for ranking inspection.
- [x] Add recall result open/copy actions and low-quality recall warning.
- [x] Run TypeScript/build verification.

## Verification

- `npm run build` passes.
- `npm run dev` starts Vite and Electron without `better-sqlite3` ABI errors after native rebuild.
- `npm run test:memory` passes after rebuilding `better-sqlite3` for the local Electron ABI.
- `npm run test:memory` covers local memory recall, disabled-memory exclusion, and restore-to-recall behavior.
- `npm run test:memory` covers Markdown code-fence normalization for copied AI outputs.
- `npm run test:memory` covers duplicate leading H1 normalization.
- `npm run test:memory` covers memory type inference, manually assigned profile memories, and grouped Agent recall context.
- `npm run test:memory` covers default global scope, manually assigned project scope, and scope metadata in Agent recall context.
- `npm run test:memory` covers recall scores, match reasons, decision-rule priority, profile priority, and project-scoped ranking.
- `npm run test:memory` covers the travel/food recall case so unrelated investment rules are not recalled for a Chongqing food/travel task.
- `npm run build` passes after memory scope implementation.
- `npm test` covers shared preset logic, forward prompt text/cropping, and the memory store workflow.
- Manual UI workflow has been validated with a real Markdown directory: add folder, scan, preview, import, search, disable, restore, remove source, source-missing recovery, and restart persistence.
- macOS packaged-app smoke test has been validated locally. Packaging does not include the developer's app data; development and installed builds only appeared to share data because they use the same Electron app data directory on this machine.

## Open Decisions

- First UI will start as a modal/panel to avoid changing the browser grid architecture.
- Schema supports multiple authorized directories; the first UI can expose the same capability without adding a separate settings page.
- Current "Disable memory" keeps the SQLite record but removes it from active search/FTS and future AI context recall.
- Disabled memory can be restored from the inbox when scanning finds the same source file or same content hash again.
- Next product milestone is Agent memory consumption: retrieve relevant active memories during Agent tasks, pass a concise context block as hidden working context, and make used memories inspectable.
- Library management additions such as imported-memory editing, source path display/opening, and tag filtering remain useful, but should not outrank the recall loop.
- Vector retrieval is a later enhancement to recall quality, not a prerequisite for the first recall version.
- Discussion and API outputs should enter memory through a reviewed Markdown artifact, not by
  automatically importing raw answers or task logs.
- Embedded AI website sending should not automatically consume long-term memory by default because website input boxes cannot receive hidden context.
- Hard-delete memory records is a separate future operation and is not implemented yet.
