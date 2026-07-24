# FFHB MCP

TypeScript MCP server for helping AI agents fetch, index, and search content from the FFHandball website.

## Architecture

- `src/index.ts`: stdio entrypoint for local MCP clients.
- `src/mcp/`: MCP server creation plus tool/resource registration.
- `src/config/`: environment-driven runtime configuration.
- `src/ffhb/`: FFHandball website client and HTML parsing.
- `src/indexing/`: page indexing and search use cases.
- `src/storage/`: persistence implementations for indexed pages.
- `src/domain/`: shared domain types and URL policy.
- `data/index/`: default local JSON index location.
- `data/cache/`: reserved for future HTTP/page cache implementations.

## MCP Surface

Tools:

- `ffhb_list_seasons`: list live FFHandball seasons and the competition type URLs available under each one.
- `ffhb_search_competitions`: search live FFHandball competitions with optional query, season URL, competition type, and limit filters.
- `ffhb_get_competition`: inspect one competition and expose metadata plus available phase navigation items.
- `ffhb_list_poules`: list poules for a competition, optionally restricted to a phase URL returned by `ffhb_get_competition`.
- `ffhb_list_journees`: list journees for a poule URL returned by `ffhb_list_poules`.
- `ffhb_list_matches`: list matches for a poule, optionally restricted to a journee URL returned by `ffhb_list_journees`.
- `ffhb_fetch_page`: fetch and parse a single FFHandball page.
- `ffhb_index_url`: fetch one page and optionally shallow-index same-site links found on it.
- `ffhb_search_index`: search the local page index.

Resources:

- `ffhb://index/stats`: index metadata and counts.
- `ffhb://page/{encodedUrl}`: indexed page content by encoded URL.

Prompt:

- `ffhb-research-plan`: starts a focused research workflow around the indexed FFHandball data.

## Setup

```bash
npm install
npm run build
```

Run as a local stdio MCP server:

```bash
npm run dev
```

For MCP clients that accept a command, use:

```bash
node /absolute/path/to/ffhb-mcp/dist/src/index.js
```

## Configuration

Copy `.env.example` values into your MCP client environment as needed:

- `FFHB_BASE_URL`: default FFHandball base URL.
- `FFHB_ALLOWED_HOSTS`: comma-separated host allowlist.
- `FFHB_USER_AGENT`: HTTP user agent used by the fetch client.
- `FFHB_REQUEST_TIMEOUT_MS`: request timeout.
- `FFHB_INDEX_PATH`: JSON file used by the local index store.

## Development

```bash
npm run test
```

The first implementation intentionally uses a JSON-file store. That keeps the MCP usable immediately while leaving a clear boundary for replacing storage with SQLite, Meilisearch, Typesense, or another search backend later.
