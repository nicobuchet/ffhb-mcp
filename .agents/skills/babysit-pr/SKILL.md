---
name: babysit-pr
description: >
  Monitor a PR/MR pipeline, retry flaky CI, resolve merge conflicts, and
  report status. Use /babysit-pr to watch an open PR.
disable-model-invocation: true
metadata:
  author: portable
  version: "1.0.0"
---

# Babysit PR/MR

Monitors an open PR/MR until it's ready to merge.

## Workflow

### 1. Find the PR/MR

```bash
# GitHub
gh pr view --web  # or by number
gh pr checks

# GitLab
glab mr view
glab ci status
```

### 2. Check CI Status

- **Passing** → report ready to merge
- **Pending** → wait and re-check
- **Failed** → investigate (step 3)

### 3. Investigate Failures

```bash
# GitHub: get failed check logs
gh run view <run-id> --log-failed

# GitLab: get failed job logs
glab ci view <job-id>
```

**If flaky test** (test passes locally, known flaky):
- Retry the job
- Note the flaky test for future fix

**If real failure:**
- Read the error
- Fix the code
- Push the fix

### 4. Check for Merge Conflicts

```bash
git fetch origin main
git merge origin/main --no-commit --no-ff
# If conflicts: resolve them
# If clean: abort the merge
git merge --abort
```

### 5. Report Status

Summarize: CI status, any fixes applied, merge readiness.
