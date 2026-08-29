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
    - Register new adapters in `src/adapters/index.ts` (matched by URL in registration order).
    - Currently registered sites: `8novel`, `wfxs`, `xsw`, `czbooks`, `hjwzw`, `twkan`, `uukanshu`, `zhys`, `novel543` (plus `SampleNovelSite` as a reference implementation).
- **TTS (`src/tts/`)**: `MicrosoftEdgeTTSProvider` synthesizes text → MP3 over a WebSocket to Microsoft Edge's online TTS endpoint (online, free, no key). CLI: `bun run audiobook`.
- **Storage (`src/storage/`)**: Persistence handlers.
    - All storage handlers must implement the `StorageAdapter` interface.
    - Supports `TxtStorageAdapter.ts` (structured directory format).
- **TUI (`src/tui/`)**: 互動式控制台（`bun run menu`）。只負責互動問答 → 組參數 → 子程序呼叫現有 script，不含任何爬取/轉檔邏輯。狀態檢視由 `books.ts` 純函式掃描 `output/` 推導。
- **YT Pipeline (`scripts/yt_pipeline.ts`)**: 一鍵串接 爬取→TTS→時長合併→封面+MP4，產出 YouTube-ready mp4。CLI: `bun run yt-pipeline <url>`。
  支援爬取重試/併發/延遲旗標（`--crawl-retries/concurrency/delay`）、合併容差（`--tolerance`）與爬後自動補抓（`--no-retry-failed` 關閉）。

## 🛠️ Tech Stack & Preferred APIs

- **Runtime**: [Bun](https://bun.sh) (TypeScript)
- **Scraping**: `axios` + `cheerio`.
- **Concurrency**: `p-limit`.
- **Encoding**: fetch as `arraybuffer` and decode with the built-in `Buffer` (UTF-8); no third-party encoding library.

### ⚡ Prefer Bun Built-ins
- **I/O**: Use `Bun.file()` instead of `node:fs` for reading/writing.
- **Server**: Use `Bun.serve()` for any web interface or API needs.
- **Database**: Use `bun:sqlite` for SQLite or `Bun.sql` for Postgres.
- **Shell**: Use `Bun.$` for executing shell commands.

## 🗺️ Graft usage

For repository orientation, feature discovery, cross-file changes, dependency analysis, and refactoring:

- Use `graft_repo_map` before exploring an unfamiliar area.
- Use `graft_find_code` before broad manual file searches.
- Use `graft_file_api` before reading an entire large file.
- Use `graft_trace_calls` before changing public symbols or contracts.
- Use `graft_find_all` when exhaustive matching is required.
- Run `graft_check_freshness` after code changes.
- Fall back to native file search when Graft results are incomplete.

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

## Agent skills

### Issue tracker

GitHub Issues on `CarlLee1983/KinetText`, operated via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

The five canonical roles, each label string equal to its name. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: `CONTEXT.md` and `docs/adr/` at the repo root. See `docs/agents/domain.md`.
