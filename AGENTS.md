# KinetiText AGENTS.md

KinetiText is a modular and extensible web crawler designed to scrape novels and books via Bun. It features a clean separation between the crawling engine, site-specific scrapers (adapters), and output storage formats.

## 🚀 Development Environment (Bun Priority)

This project uses **Bun** exclusively. Do NOT use Node.js, npm, yarn, or pnpm.

- **Installation**: `bun install`
- **Execution**: `bun run src/index.ts` or `bun <file>`
- **Testing**: `bun test`
- **Building**: `bun build <file>`
- **Shell**: Use `bunx <package>` instead of `npx`.
- **Environment**: Bun automatically loads `.env`, do not use `dotenv`.

## 🏗️ Architecture Overview

- **Core Engine (`src/core/`)**: `CrawlerEngine.ts` orchestrates the workflow: metadata fetching, chapter list retrieval, and downloading content with concurrency control.
- **Adapters (`src/adapters/`)**: Site-specific scraping logic.
    - All adapters must implement the `NovelSiteAdapter` interface.
    - Register new adapters in `src/index.ts`.
- **Storage (`src/storage/`)**: Persistence handlers.
    - All storage handlers must implement the `StorageAdapter` interface.
    - Supports `TxtStorageAdapter.ts` (structured directory format).

## 🛠️ Tech Stack & Preferred APIs

- **Runtime**: [Bun](https://bun.sh) (TypeScript)
- **Scraping**: `axios` + `cheerio`.
- **Concurrency**: `p-limit`.
- **Encoding**: `iconv-lite` for legacy character sets.

### ⚡ Prefer Bun Built-ins
- **I/O**: Use `Bun.file()` instead of `node:fs` for reading/writing.
- **Server**: Use `Bun.serve()` for any web interface or API needs.
- **Database**: Use `bun:sqlite` for SQLite or `Bun.sql` for Postgres.
- **Shell**: Use `Bun.$` for executing shell commands.

## 📏 Development Conventions

- **Modular Design**: Keep site-specific logic in `adapters/` and storage-specific logic in `storage/`.
- **Respect Sites**: Use the built-in `p-limit` and random delays in `CrawlerEngine` to avoid rate limits.
- **Error Handling**: Adapters should throw descriptive errors so the engine can log and continue.
- **Testing**: Add unit tests for all new adapters using `bun:test`.

## 🧪 Testing Workflow

Run all tests:
```bash
bun test
```

Example test structure (`test/example.test.ts`):
```ts
import { test, expect } from "bun:test";

test("feature works", () => {
  expect(true).toBe(true);
});
```

## 📝 PR & Commits

- Always run `bun test` before merging.
- Ensure type-checks pass (Bun handles this during execution, but manual checks are good).
- Title format: `[<adapter_name>|<core>] <Action description>`
