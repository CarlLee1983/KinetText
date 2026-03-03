# KinetiText

KinetiText is a modular and extensible web crawler designed to scrape novels and books from various online sources. It features a clean separation between the crawling engine, site-specific scrapers (adapters), and output storage formats.

## Architecture Overview

The project is structured into several key modules:

### 1. Core Engine (`src/core/`)
- **`CrawlerEngine.ts`**: The main orchestrator. It manages the scraping workflow: fetching metadata, retrieving chapter lists, and downloading chapter content with concurrency control.
- **`types.ts`**: Defines the shared domain models (`Book`, `Chapter`).

### 2. Adapters (`src/adapters/`)
This module handles site-specific scraping logic.
- **`NovelSiteAdapter.ts`**: Interface defining the contract for all site adapters.
- **`SampleAdapter.ts`**: A concrete implementation for a sample novel site.
- **Extensibility**: To support a new site, implement the `NovelSiteAdapter` interface and register it in `index.ts`.

### 3. Storage (`src/storage/`)
This module handles how the scraped data is saved.
- **`StorageAdapter.ts`**: Interface defining the contract for storage handlers.
- **`TxtStorageAdapter.ts`**: Saves the book metadata and chapters as plain text files in a structured directory format.
- **Extensibility**: New storage formats (e.g., EPUB, JSON, Database) can be added by implementing the `StorageAdapter` interface.

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **Language**: TypeScript
- **Libraries**:
  - `axios`: For making HTTP requests.
  - `cheerio`: For parsing HTML and extracting content.
  - `p-limit`: For managing request concurrency.
  - `iconv-lite`: For handling different text encodings (common in legacy novel sites).

## Getting Started

### Prerequisites

Ensure you have [Bun](https://bun.sh) installed on your system.

### Installation

```bash
bun install
```

### Running the Crawler

To start the scraping process:

```bash
bun run src/index.ts
```

## Development Conventions

- **Modular Design**: Always keep site-specific logic in `adapters/` and storage-specific logic in `storage/`.
- **Concurrency & Rate Limiting**: The `CrawlerEngine` uses `p-limit` for concurrency. When implementing adapters, ensure they are respectful of target sites. The engine includes a random delay to mitigate rate-limiting.
- **Error Handling**: Adapters should throw descriptive errors if scraping fails, allowing the engine to log them and continue with other chapters if possible.
- **Testing**: (TODO) Add unit tests for adapters using Bun's built-in test runner.
