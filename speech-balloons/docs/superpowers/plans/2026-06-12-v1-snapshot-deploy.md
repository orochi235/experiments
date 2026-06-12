# v1 Snapshot Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Freeze the speech-balloons app as currently deployed (built from `main`) and serve it at `/experiments/speech-balloons/v1/`, via a rerunnable snapshot script.

**Architecture:** A shell script builds any git ref of the app in a temporary git worktree with a *relative* vite base (`--base=./`), then installs the output at `speech-balloons/public/<version>/`. Vite copies `public/` verbatim into `dist/`, so the snapshot rides along into every future build with zero CI or vite-config changes, and the relative base makes it work at any URL prefix (Pages and local dev server alike).

**Tech Stack:** bash, git worktree, npm, vite 8.

**Spec:** `speech-balloons/docs/superpowers/specs/2026-06-11-v1-snapshot-deploy-design.md`

**Deviation from spec as written:** The spec originally said to build with `--base=/experiments/speech-balloons/<version>/`. That base only resolves on GH Pages; on the dev server the snapshot's assets would 404. We build with `--base=./` instead, which works at both URLs. The spec is amended in Task 1.

---

### Task 1: Snapshot script

**Files:**
- Create: `speech-balloons/scripts/snapshot.sh`
- Modify: `speech-balloons/docs/superpowers/specs/2026-06-11-v1-snapshot-deploy-design.md` (amend base-path mechanism)

- [ ] **Step 1: Write the script**

Create `speech-balloons/scripts/snapshot.sh` with exactly this content:

```bash
#!/usr/bin/env bash
# Freeze a build of the speech-balloons app from a git ref into
# public/<version>/, so it deploys at /experiments/speech-balloons/<version>/
# alongside the live app (and serves at /<version>/ on the dev server).
#
# Usage: scripts/snapshot.sh <version> [ref] [--force]
#   version   v<N>, e.g. v1
#   ref       git ref to build (default: main)
#   --force   overwrite an existing public/<version>/

set -euo pipefail

usage() { echo "usage: $(basename "$0") <version> [ref] [--force]" >&2; exit 2; }

VERSION="${1:-}"
[[ -n "$VERSION" ]] || usage
shift
REF="main"
FORCE=0
for arg in "$@"; do
  case "$arg" in
    --force) FORCE=1 ;;
    -*) usage ;;
    *) REF="$arg" ;;
  esac
done

[[ "$VERSION" =~ ^v[0-9]+$ ]] \
  || { echo "error: version must match v<number>, got '$VERSION'" >&2; exit 2; }

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(git -C "$APP_DIR" rev-parse --show-toplevel)"
DEST="$APP_DIR/public/$VERSION"

if [[ -e "$DEST" && $FORCE -ne 1 ]]; then
  echo "error: ${DEST} already exists; pass --force to overwrite" >&2
  exit 1
fi

git -C "$REPO_ROOT" rev-parse --verify --quiet "${REF}^{commit}" >/dev/null \
  || { echo "error: unknown git ref '$REF'" >&2; exit 2; }

# The worktree must sit directly beside the repo root (in ~/src): refs after
# the labkit port resolve ../../labkit and ../../weasel relative to the
# checkout, so only a true sibling checkout finds them.
WORKTREE="$(dirname "$REPO_ROOT")/.speech-balloons-snapshot-$VERSION-$$"
[[ ! -e "$WORKTREE" ]] || { echo "error: $WORKTREE already exists" >&2; exit 1; }
cleanup() {
  git -C "$REPO_ROOT" worktree remove --force "$WORKTREE" >/dev/null 2>&1 || true
  rm -rf "$WORKTREE"
}
trap cleanup EXIT

git -C "$REPO_ROOT" worktree add --detach "$WORKTREE" "$REF"

cd "$WORKTREE/speech-balloons"
# NODE_ENV must be unset during install or npm ci skips devDependencies
# (vite lives there).
env -u NODE_ENV npm ci
# Relative base makes the frozen build location-independent: it works at
# /experiments/speech-balloons/<version>/ on Pages AND /<version>/ on the
# dev server. The CLI flag overrides the base hardcoded in vite.config.
# vite is invoked directly (not `npm run build`) so the flag applies.
NODE_ENV=production npx vite build --base=./

# public/ is copied verbatim into dist/, so a ref that already contains
# earlier snapshots would nest them inside this one; strip them.
rm -rf dist/v[0-9]*

rm -rf "$DEST"
mkdir -p "$DEST"
cp -R dist/. "$DEST/"

echo
echo "Snapshot of '$REF' installed at ${DEST#"$REPO_ROOT"/}"
echo "Review it, then: git add '${DEST#"$REPO_ROOT"/}' && git commit"
```

- [ ] **Step 2: Make it executable**

Run: `chmod +x speech-balloons/scripts/snapshot.sh`

- [ ] **Step 3: Verify argument validation fails correctly**

Run each of these from the repo root and confirm the expected failure:

```bash
speech-balloons/scripts/snapshot.sh
# Expected: "usage: snapshot.sh <version> [ref] [--force]", exit code 2

speech-balloons/scripts/snapshot.sh 1.0
# Expected: "error: version must match v<number>, got '1.0'", exit code 2

speech-balloons/scripts/snapshot.sh v1 no-such-ref
# Expected: "error: unknown git ref 'no-such-ref'", exit code 2
```

Check exit codes with `echo $?` after each.

- [ ] **Step 4: Amend the spec for the relative base**

In `speech-balloons/docs/superpowers/specs/2026-06-11-v1-snapshot-deploy-design.md`, replace step 4 of the Mechanism section:

```markdown
4. **Build with relative base.**
   `NODE_ENV=production npx vite build --base=./`
   — a relative base makes the frozen build location-independent, so it
   works both at `/experiments/speech-balloons/<version>/` on Pages and
   at `/<version>/` on the local dev server. (An absolute versioned base
   was originally specified, but its asset URLs only resolve on Pages.)
   The CLI flag overrides the base hardcoded in `vite.config.ts`, so the
   script works against both pre- and post-labkit refs without editing
   the checked-out config.
```

And in the Testing section, replace the first bullet with:

```markdown
- Run `scripts/snapshot.sh v1 main`; verify `public/v1/index.html`
  references assets via relative `./assets/...` URLs.
```

- [ ] **Step 5: Commit**

```bash
git add speech-balloons/scripts/snapshot.sh \
        speech-balloons/docs/superpowers/specs/2026-06-11-v1-snapshot-deploy-design.md
git commit -m "feat(speech-balloons): rerunnable snapshot script for frozen version deploys"
```

---

### Task 2: npm run snapshot

**Files:**
- Modify: `speech-balloons/package.json` (scripts block)

- [ ] **Step 1: Add the script entry**

In `speech-balloons/package.json`, add to `"scripts"` after `"typecheck"`:

```json
    "typecheck": "tsc -b",
    "snapshot": "scripts/snapshot.sh"
```

- [ ] **Step 2: Verify it dispatches**

Run: `cd speech-balloons && npm run snapshot`
Expected: the usage error from Task 1 Step 3 (`usage: snapshot.sh <version> [ref] [--force]`), nonzero exit.

- [ ] **Step 3: Commit**

```bash
git add speech-balloons/package.json
git commit -m "chore(speech-balloons): expose snapshot script as npm run snapshot"
```

---

### Task 3: Cut the v1 snapshot

**Files:**
- Create: `speech-balloons/public/v1/` (generated by the script)

- [ ] **Step 1: Run the snapshot**

Run: `speech-balloons/scripts/snapshot.sh v1 main`
Expected: worktree created, `npm ci` and vite build succeed, final lines:

```
Snapshot of 'main' installed at speech-balloons/public/v1
Review it, then: git add 'speech-balloons/public/v1' && git commit
```

- [ ] **Step 2: Verify the build output**

```bash
ls speech-balloons/public/v1/
# Expected: index.html and an assets/ directory

grep -o 'src="[^"]*"' speech-balloons/public/v1/index.html
# Expected: relative URLs like src="./assets/index-<hash>.js" — no
# absolute /experiments/... paths

ls ~/src/ | grep speech-balloons-snapshot
# Expected: no output (temp worktree cleaned up)

git -C . worktree list
# Expected: only the repo's own checkouts, no .speech-balloons-snapshot-* entry
```

- [ ] **Step 3: Verify it boots in a browser**

With the dev server running (`npm run dev` in `speech-balloons/`, currently on port 5181), load `http://localhost:5181/v1/index.html` in a headless browser session and screenshot. Expected: the speech-balloon lab renders (balloon visible on canvas, controls populated) — the pre-labkit UI, since this is main's build. No console errors other than favicon 404.

- [ ] **Step 4: Commit**

```bash
git add speech-balloons/public/v1
git commit -m "feat(speech-balloons): freeze main as v1 snapshot at /v1"
```

---

### Post-merge verification (manual, after this branch deploys)

Once the branch merges to `main` and the Pages deploy runs, spot-check
`https://orochi235.github.io/experiments/speech-balloons/v1/` renders the
frozen app. (Not part of this plan's tasks — the deploy of the labkit-ported
config is a known separate problem.)
