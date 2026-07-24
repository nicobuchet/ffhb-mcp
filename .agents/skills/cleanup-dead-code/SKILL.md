---
name: cleanup-dead-code
description: >
  Use when looking for unused exports, dead code, orphaned files, or unreachable
  components. Triggers on "unused", "dead code", "cleanup", or when refactoring
  reveals potentially orphaned code.
metadata:
  author: portable
  version: "1.0.0"
---

# Dead Code Cleanup

Finds unused exports, unreferenced files, and orphaned code.

## Workflow

### 1. Find Unused Exports

For each barrel export (`index.ts`) in features:
1. List all exports
2. Search for imports of each export across the codebase
3. Flag exports with zero external imports

### 2. Find Orphaned Files

1. List all `.ts`/`.tsx` files not imported by anything
2. Exclude entry points (`page.tsx`, `layout.tsx`, `route.ts`)
3. Exclude config files (`next.config.*`, `tailwind.config.*`)

### 3. Find Dead Components

1. List all component files
2. Search for JSX usage of each component name
3. Flag components never rendered

### 4. Present Findings

List findings grouped by type. DO NOT auto-delete.
Let the user confirm which items to remove.

## Gotchas

- `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx` are imported by Next.js — they won't appear in grep results
- Dynamic imports (`import()`) don't appear in static grep
- Components used only in tests are not "dead"
- Barrel re-exports may re-export for external package consumers
