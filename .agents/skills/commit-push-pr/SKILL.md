---
name: commit-push-pr
description: >
  Commit staged changes, push to remote, and create a PR/MR. Detects platform
  (GitHub/GitLab) automatically.
disable-model-invocation: true
metadata:
  author: portable
  version: "1.0.0"
---

# Commit, Push & PR/MR

## Workflow

### 1. Detect Platform

```bash
REMOTE=$(git remote get-url origin)
```
- Contains `github.com` → use `gh`
- Contains `gitlab` → use `glab`
- Otherwise → git push only, manual PR

### 2. Detect Commit Style

Read last 10 commit messages to detect convention:
```bash
git log --oneline -10
```
- Conventional commits? (`feat:`, `fix:`, `chore:`)
- Free-form?
- Match the existing style.

### 3. Create Branch (if needed)

If on `main`, `master`, or `dev`:
```bash
git checkout -b feat/<descriptive-name>
```

### 4. Stage & Commit

- Check `git status` for changes
- Stage relevant files (not `.env`, not `node_modules`)
- Commit following detected convention

### 5. Push

```bash
git push -u origin HEAD
```

### 6. Create PR/MR

**GitHub:**
```bash
gh pr create --title "..." --body "$(cat <<'EOF'
## Summary
- ...

## Test plan
- [ ] ...
EOF
)"
```

**GitLab:**
```bash
glab mr create --title "..." --description "$(cat <<'EOF'
## Summary
- ...

## Test plan
- [ ] ...
EOF
)"
```
