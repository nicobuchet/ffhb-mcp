---
name: adversarial-review
description: >
  Spawns a fresh-eyes subagent to critique code, implements fixes, and iterates
  until findings degrade to nitpicks. Use /adversarial-review after completing a
  feature, before committing, or when you want a thorough code review.
disable-model-invocation: true
metadata:
  author: portable
  version: "1.0.0"
---

# Adversarial Review

Iterative code review by a fresh-eyes subagent that has no context of your
implementation decisions.

## Workflow

### 1. Collect the Diff

```bash
# If changes are staged:
git diff --cached

# If comparing to base branch:
git diff main...HEAD
```

### 2. Spawn Fresh-Eyes Reviewer

Launch a subagent with:
- The diff
- The contents of changed files (full file for context)
- The review prompt from `review-prompt.md`
- NO conversation history — the reviewer must judge the code as-is

### 3. Classify Findings

The reviewer classifies each finding as:
- **ERROR** — bug, security issue, data loss risk, incorrect behavior
- **WARNING** — performance issue, maintainability concern, missing edge case
- **NITPICK** — style preference, naming suggestion, minor improvement

### 4. Fix or Dismiss

- **ERROR** findings → must fix
- **WARNING** findings → fix unless there's a good reason not to
- **NITPICK** findings → note but don't fix (these signal we're done)

### 5. Iterate

If any ERROR or WARNING was fixed, go back to step 2 with a fresh subagent.
The new reviewer has no memory of previous rounds — truly fresh eyes.

### 6. Stop Condition

Stop when:
- All findings are NITPICK, OR
- Max iterations reached (see `config.json`), OR
- No findings at all (clean)

### 7. Report

Summarize:
- Number of iterations performed
- Findings fixed per round
- Final state (clean / nitpicks only)
