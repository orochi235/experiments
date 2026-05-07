# Firehose Axis Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refactor `firehose/index.html` from the monolithic `interactionMode` + `density` axes to six orthogonal axes — visibility, navigation, approval, grouping, context, and presentation — each independently configurable.

**Architecture:** The key insight is that axes split into two tiers: *renderer props* (presentation, context, errorVisibility) determine what gets rendered per field; *orchestrator axes* (visibility, navigation, approval, grouping) determine how the list is driven. The renderer receives a stable props contract `{ field, fieldState, isCursor, onDecide, neighbors?, source? }` regardless of which orchestration axes are active. All changes are in the single file `firehose/index.html` — no build step, no new files.

**Tech Stack:** Vanilla JS, inline CSS/HTML, single file. No tests (browser-only project) — each task verifies behavior by opening `firehose/index.html` in a browser and checking the described behavior.

---

## Axis model reference

**New axes (replace interactionMode + density):**

| Axis | Options | Tier |
|------|---------|------|
| `visibility` | `all` · `windowed` · `one` | orchestrator |
| `navigation` | `free` · `cursor` · `auto` | orchestrator |
| `approval` | `click-cycle` · `keyboard` · `swipe` · `bulk` | orchestrator |
| `grouping` | `flat` · `by-category` | orchestrator |
| `context` | `none` · `neighbors` · `source` | renderer prop |
| `presentation` | `row` · `card` | renderer choice |

**Kept axes (unchanged):** `dataset`, `defaultState`, `errorVisibility`
**Lab harness (not an experiment axis):** `controlLayout`

**Default on load:** `visibility=all`, `navigation=free`, `approval=click-cycle`, `grouping=flat`, `context=none`, `presentation=row`, `defaultState=approved`, `errorVisibility=confidence`, `controlLayout=sidebar`.

This default reproduces the former `scroll-flag` + `comfortable` + `approved` + `confidence` + `sidebar` experience.

---

## Task 1: State model + controls UI

**Files:**
- Modify: `firehose/index.html` — state object, onAxisChange, buildControlsHTML

Replace the old state keys and controls with the new axis model.

- [ ] **Step 1: Replace the state object**

Find the `const state = { ... }` block (around line 422) and replace it:

```js
const state = {
  datasetId: 'legal',
  visibility: 'all',        // 'all' | 'windowed' | 'one'
  navigation: 'free',       // 'free' | 'cursor' | 'auto'
  approval: 'click-cycle',  // 'click-cycle' | 'keyboard' | 'swipe' | 'bulk'
  grouping: 'flat',         // 'flat' | 'by-category'
  context: 'none',          // 'none' | 'neighbors' | 'source'
  presentation: 'row',      // 'row' | 'card'
  defaultState: 'approved',
  errorVisibility: 'confidence',
  controlLayout: 'sidebar',
  fieldStates: {},
  cursor: 0,
  collapsedGroups: new Set(),
  floatingOpen: false,
};
```

- [ ] **Step 2: Update onAxisChange**

Find the `onAxisChange` function and replace it:

```js
function onAxisChange(key, value) {
  if (key === 'datasetId') {
    state[key] = value;
    FIELDS = DATASETS.find(d => d.id === value).fields;
    state.cursor = 0;
    state.collapsedGroups = new Set();
    initFieldStates();
  } else if (key === 'defaultState') {
    state[key] = value;
    initFieldStates();
  } else {
    state[key] = value;
    if (key === 'navigation' || key === 'visibility') state.cursor = 0;
  }
  render();
}
```

- [ ] **Step 3: Rewrite buildControlsHTML**

Replace the `buildControlsHTML` function entirely:

```js
function buildControlsHTML() {
  return [
    buildAxisGroup('datasetId', 'Dataset', DATASETS.map(d => ({v: d.id, l: d.name}))),
    buildAxisGroup('visibility', 'Visibility', [
      {v:'all',      l:'All'},
      {v:'windowed', l:'Windowed'},
      {v:'one',      l:'One'},
    ]),
    buildAxisGroup('navigation', 'Navigation', [
      {v:'free',   l:'Free'},
      {v:'cursor', l:'Cursor'},
      {v:'auto',   l:'Auto'},
    ]),
    buildAxisGroup('approval', 'Approval', [
      {v:'click-cycle', l:'Click-cycle'},
      {v:'keyboard',    l:'Keyboard'},
      {v:'swipe',       l:'Swipe'},
      {v:'bulk',        l:'Bulk'},
    ]),
    buildAxisGroup('grouping', 'Grouping', [
      {v:'flat',        l:'Flat'},
      {v:'by-category', l:'By Category'},
    ]),
    buildAxisGroup('context', 'Context', [
      {v:'none',      l:'None'},
      {v:'neighbors', l:'Neighbors'},
      {v:'source',    l:'Source'},
    ]),
    buildAxisGroup('presentation', 'Presentation', [
      {v:'row',  l:'Row'},
      {v:'card', l:'Card'},
    ]),
    buildAxisGroup('defaultState', 'Default State', [
      {v:'approved', l:'All Approved'},
      {v:'pending',  l:'All Pending'},
    ]),
    buildAxisGroup('errorVisibility', 'Error Visibility', [
      {v:'none',       l:'None'},
      {v:'confidence', l:'Confidence'},
      {v:'heat',       l:'Color Heat'},
    ]),
    buildAxisGroup('controlLayout', 'Panel Layout', [
      {v:'sidebar',  l:'Sidebar'},
      {v:'topbar',   l:'Top Bar'},
      {v:'floating', l:'Floating'},
    ]),
    `<button class="reset-btn" onclick="resetFieldStates()">Reset field states</button>`,
  ].join('');
}
```

- [ ] **Step 4: Verify in browser**

Open `firehose/index.html`. The sidebar should show the 10 new axis groups (Dataset, Visibility, Navigation, Approval, Grouping, Context, Presentation, Default State, Error Visibility, Panel Layout). The field list may render oddly — that's fine, later tasks fix the rendering logic. Confirm no JS errors in the console.

- [ ] **Step 5: Commit**

```bash
git add firehose/index.html
git commit -m "refactor(firehose): replace interactionMode+density with new axis model in state and controls"
```

---

## Task 2: Renderer interface — renderRow, renderCard, getRendererProps

**Files:**
- Modify: `firehose/index.html` — replace `buildFieldRow`, add `renderRow`, `renderCard`, `getRendererProps`, `renderField`; add card CSS

Extract the old `buildFieldRow` function into a clean renderer props contract with two implementations.

- [ ] **Step 1: Add CSS for card renderer and context annotations**

Inside the `<style>` block, after the `.group-section.collapsed .group-fields { display: none; }` rule (last CSS rule), add:

```css
/* Card renderer */
.field-card {
  border-radius: 6px;
  border: 1px solid transparent;
  cursor: pointer;
  user-select: none;
  transition: background 0.1s, border-color 0.1s;
  padding: 12px 16px;
  margin-bottom: 8px;
}
.field-card:hover { border-color: var(--border); }
.field-card.state-approved { background: rgba(72,187,120,0.08); border-color: rgba(72,187,120,0.25); }
.field-card.state-flagged  { background: rgba(252,129,74,0.12); border-color: rgba(252,129,74,0.5); }
.field-card.state-pending  { background: rgba(255,255,255,0.03); }
.field-card.cursor { border-color: var(--accent) !important; background: rgba(126,200,227,0.1) !important; }
.field-card-label { font-size: 11px; color: var(--muted); margin-bottom: 6px; display: flex; align-items: center; gap: 6px; }
.field-card-value { font-size: 15px; color: var(--text); }
.field-card.state-flagged .field-card-value { color: var(--flagged); }

/* Context annotations */
.field-context {
  font-size: 10px;
  color: #555;
  margin-bottom: 4px;
  line-height: 1.4;
}
```

- [ ] **Step 2: Replace buildFieldRow with the renderer system**

Find and delete the `buildFieldRow` function. In its place, add:

```js
function getRendererProps(field, isCursor) {
  const props = {
    field,
    fieldState: state.fieldStates[field.id],
    isCursor,
    onDecide(newState) {
      state.fieldStates[field.id] = newState;
      renderFieldList();
      renderStatusBar();
    },
  };
  if (state.context === 'neighbors') {
    const idx = FIELDS.indexOf(field);
    props.neighbors = {
      prev: idx > 0 ? FIELDS[idx - 1] : null,
      next: idx < FIELDS.length - 1 ? FIELDS[idx + 1] : null,
    };
  }
  if (state.context === 'source') {
    props.source = field.category;
  }
  return props;
}

function renderRow(props) {
  const { field, fieldState, isCursor, neighbors, source } = props;
  const heatStyle = state.errorVisibility === 'heat'
    ? `background-color:${heatColor(field.confidence)};` : '';
  const pct = Math.round(field.confidence * 100);
  const badgeClass = field.confidence < 0.7 ? 'confidence-badge low' : 'confidence-badge';
  const badge = state.errorVisibility === 'confidence'
    ? `<span class="${badgeClass}">${pct}%</span>` : '';
  const flag = fieldState === 'flagged' ? '<span class="flag-icon">⚑</span>' : '';
  const cursorClass = isCursor ? ' cursor' : '';
  let ctx = '';
  if (neighbors) {
    const p = neighbors.prev ? neighbors.prev.label : '—';
    const n = neighbors.next ? neighbors.next.label : '—';
    ctx = `<div class="field-context">↑ ${p} &nbsp;·&nbsp; ↓ ${n}</div>`;
  } else if (source) {
    ctx = `<div class="field-context">§ ${source}</div>`;
  }
  return `<div class="field-row state-${fieldState}${cursorClass}" data-id="${field.id}" style="${heatStyle}" onclick="onFieldClick(${field.id})">
    ${ctx}<span class="field-label">${field.label}</span><span class="field-value">${field.value}</span>${badge}${flag}
  </div>`;
}

function renderCard(props) {
  const { field, fieldState, isCursor, neighbors, source } = props;
  const heatStyle = state.errorVisibility === 'heat'
    ? `background-color:${heatColor(field.confidence)};` : '';
  const pct = Math.round(field.confidence * 100);
  const badgeClass = field.confidence < 0.7 ? 'confidence-badge low' : 'confidence-badge';
  const badge = state.errorVisibility === 'confidence'
    ? `<span class="${badgeClass}">${pct}%</span>` : '';
  const flag = fieldState === 'flagged' ? '<span class="flag-icon">⚑</span>' : '';
  const cursorClass = isCursor ? ' cursor' : '';
  let ctx = '';
  if (neighbors) {
    const p = neighbors.prev ? neighbors.prev.label : '—';
    const n = neighbors.next ? neighbors.next.label : '—';
    ctx = `<div class="field-context">↑ ${p} &nbsp;·&nbsp; ↓ ${n}</div>`;
  } else if (source) {
    ctx = `<div class="field-context">§ ${source}</div>`;
  }
  return `<div class="field-card state-${fieldState}${cursorClass}" data-id="${field.id}" style="${heatStyle}" onclick="onFieldClick(${field.id})">
    ${ctx}<div class="field-card-label">${field.label}${badge}${flag}</div>
    <div class="field-card-value">${field.value}</div>
  </div>`;
}

function renderField(field, isCursor) {
  const props = getRendererProps(field, isCursor);
  return state.presentation === 'card' ? renderCard(props) : renderRow(props);
}
```

- [ ] **Step 3: Update all callers of buildFieldRow**

Search for every call to `buildFieldRow` in the file. There are two in `buildGroupedView` and one in `buildTriageView`. Replace each with `renderField`:

In `buildGroupedView`, change:
```js
${fields.map(f => buildFieldRow(f, false)).join('')}
```
to:
```js
${fields.map(f => renderField(f, false)).join('')}
```

In `buildTriageView`, change:
```js
return buildFieldRow(f, isCursor);
```
to:
```js
return renderField(f, isCursor);
```

- [ ] **Step 4: Verify in browser**

Open `firehose/index.html`. Default (presentation=row) should look identical to before. Switch presentation to "Card" — fields should render as card blocks with label on top and value below. Context=neighbors should show "↑ prev · ↓ next" above each row. No console errors.

- [ ] **Step 5: Commit**

```bash
git add firehose/index.html
git commit -m "refactor(firehose): renderer interface — renderRow, renderCard, getRendererProps"
```

---

## Task 3: Visibility + navigation orchestration

**Files:**
- Modify: `firehose/index.html` — `renderFieldList`, `renderProgressBar`, add `getVisibleFields`, `moveCursor`; remove `buildTriageView`

Wire the visibility and navigation axes to the field list rendering.

- [ ] **Step 1: Add getVisibleFields helper**

After the `scrollCursorIntoView` function, add:

```js
function getVisibleFields() {
  if (state.visibility === 'one') {
    return FIELDS[state.cursor] ? [FIELDS[state.cursor]] : [];
  }
  if (state.visibility === 'windowed') {
    const half = 3;
    const start = Math.max(0, state.cursor - half);
    const end = Math.min(FIELDS.length, start + 7);
    return FIELDS.slice(start, end);
  }
  return FIELDS; // 'all'
}
```

- [ ] **Step 2: Add moveCursor helper**

After `getVisibleFields`, add:

```js
function moveCursor(delta) {
  state.cursor = Math.max(0, Math.min(FIELDS.length - 1, state.cursor + delta));
  renderProgressBar();
  renderFieldList();
}
```

- [ ] **Step 3: Rewrite renderFieldList**

Replace the entire `renderFieldList` function:

```js
function renderFieldList() {
  const list = document.getElementById('field-list');
  list.className = '';

  const hasCursor = state.navigation !== 'free';
  const fields = getVisibleFields();

  if (state.grouping === 'by-category') {
    list.innerHTML = buildGroupedView(FIELDS); // grouping always shows all
  } else {
    list.innerHTML = fields.map(f => {
      const isCursor = hasCursor && FIELDS.indexOf(f) === state.cursor;
      return renderField(f, isCursor);
    }).join('');
  }

  if (hasCursor) scrollCursorIntoView();
}
```

- [ ] **Step 4: Update renderProgressBar**

Replace the `renderProgressBar` function:

```js
function renderProgressBar() {
  const bar = document.getElementById('progress-bar');
  if (state.navigation === 'free') { bar.style.display = 'none'; return; }
  bar.style.display = 'block';
  const pct = Math.round(((state.cursor + 1) / FIELDS.length) * 100);
  bar.querySelector('.fill').style.width = pct + '%';
}
```

- [ ] **Step 5: Delete buildTriageView**

Remove the entire `buildTriageView` function — it is fully replaced by `getVisibleFields` + the new `renderFieldList`. Also remove the progress text it generated (that context now comes from the status bar).

- [ ] **Step 6: Verify in browser**

Test these combinations:
- `visibility=all, navigation=free` → all fields, no cursor, no progress bar
- `visibility=windowed, navigation=cursor` → 7-field window around cursor, progress bar, j/k don't yet work (task 4)
- `visibility=one, navigation=cursor` → single field visible, progress bar
- `visibility=all, navigation=cursor` → all fields, progress bar, cursor row highlighted
- `grouping=by-category` → all fields in category groups regardless of visibility setting

No console errors.

- [ ] **Step 7: Commit**

```bash
git add firehose/index.html
git commit -m "refactor(firehose): visibility + navigation axes — getVisibleFields, moveCursor, renderFieldList"
```

---

## Task 4: Approval orchestration + keyboard handler

**Files:**
- Modify: `firehose/index.html` — `onFieldClick`, `handleKeyDown`, `triageAction`, `triageAdvance`, `triageBack`; add `applyApproval`; remove stale triage functions

Wire the approval and navigation axes to keyboard and click events.

- [ ] **Step 1: Update onFieldClick**

Replace `onFieldClick`:

```js
function onFieldClick(id) {
  if (state.approval === 'keyboard') return;
  // swipe placeholder: same behavior as click-cycle in the lab
  if (state.approval === 'click-cycle' || state.approval === 'swipe') {
    cycleFieldState(id);
  }
  // bulk: individual field clicks do nothing; only group/global buttons work
}
```

- [ ] **Step 2: Add applyApproval**

After `cycleFieldState`, add:

```js
function applyApproval(newState) {
  const field = FIELDS[state.cursor];
  if (!field) return;
  state.fieldStates[field.id] = newState;
  // auto-advance: keyboard approval or auto navigation always advance
  if (state.approval === 'keyboard' || state.navigation === 'auto') {
    moveCursor(1);
  } else {
    renderFieldList();
    renderStatusBar();
  }
}
```

- [ ] **Step 3: Rewrite handleKeyDown**

Replace the entire `handleKeyDown` function:

```js
function handleKeyDown(e) {
  if (e.target.tagName === 'INPUT') return;

  // Cursor movement (cursor + auto navigation)
  if (state.navigation === 'cursor' || state.navigation === 'auto') {
    if (e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J') { moveCursor(1);  e.preventDefault(); return; }
    if (e.key === 'ArrowUp'   || e.key === 'k' || e.key === 'K') { moveCursor(-1); e.preventDefault(); return; }
  }

  // Keyboard approval
  if (state.approval === 'keyboard') {
    if (e.key === ' ')                    { applyApproval('approved'); e.preventDefault(); return; }
    if (e.key === 'f' || e.key === 'F')  { applyApproval('flagged');  e.preventDefault(); return; }
  }

  // Global shortcuts (always active)
  if (e.key === 'a' || e.key === 'A') { approveAll();        e.preventDefault(); }
  if (e.key === 'F' && e.shiftKey)    { jumpToNextFlagged(); e.preventDefault(); }
}
```

- [ ] **Step 4: Delete stale triage functions**

Remove these functions — they are fully replaced by `moveCursor` and `applyApproval`:
- `triageAction`
- `triageAdvance`
- `triageBack`

- [ ] **Step 5: Verify in browser**

Test these combinations:
- `navigation=cursor, approval=click-cycle` → j/k move cursor, clicking a row cycles its state
- `navigation=cursor, approval=keyboard` → j/k move cursor, space=approve, f=flag, click does nothing
- `navigation=auto, approval=keyboard` → space/f auto-advance to next field
- `navigation=free, approval=click-cycle` → clicking cycles state, j/k do nothing
- `approval=bulk` → clicking fields does nothing (bulk buttons wired in task 5)
- Global: `A` key approves all pending fields in any mode
- Global: `Shift+F` scrolls to next flagged field in any mode

No console errors.

- [ ] **Step 6: Commit**

```bash
git add firehose/index.html
git commit -m "refactor(firehose): approval axis — onFieldClick, applyApproval, keyboard handler rewrite"
```

---

## Task 5: Grouping axis + bulk approval

**Files:**
- Modify: `firehose/index.html` — `buildGroupedView`, `approveGroup`, bulk approval button visibility

Update the grouped view to work correctly with the new axis model, and wire the `bulk` approval mode.

- [ ] **Step 1: Update buildGroupedView signature**

`buildGroupedView` currently reads `FIELDS` directly from module scope. It now receives a `fields` argument but since grouping always shows all fields, the call in `renderFieldList` passes `FIELDS`. Update the function signature and remove the internal `density-${state.density}` class reference:

Find `buildGroupedView`:
```js
function buildGroupedView() {
  const categories = [...new Set(FIELDS.map(f => f.category))];
```

Replace with:
```js
function buildGroupedView(fields) {
  const categories = [...new Set(fields.map(f => f.category))];
```

Then find the inner `FIELDS.filter(...)` call inside `buildGroupedView`:
```js
const fields = FIELDS.filter(f => f.category === cat);
```
Rename that variable to avoid shadowing the parameter:
```js
const catFields = fields.filter(f => f.category === cat);
```

Update all references to `fields` within that map callback to `catFields`:
- `fields.length` → `catFields.length`
- `fields.filter(f => ...)` → `catFields.filter(f => ...)`
- `fields.map(f => ...)` → `catFields.map(f => ...)`

Also update the group fields div — remove the `density-${state.density}` class:
```js
<div class="group-fields">
  ${catFields.map(f => renderField(f, false)).join('')}
</div>
```

The full updated function:

```js
function buildGroupedView(fields) {
  const categories = [...new Set(fields.map(f => f.category))];

  return categories.map(cat => {
    const catFields = fields.filter(f => f.category === cat);
    const flaggedCount = catFields.filter(f => state.fieldStates[f.id] === 'flagged').length;
    const isCollapsed = state.collapsedGroups.has(cat);

    const flaggedBadge = flaggedCount > 0
      ? `<span class="group-flagged">⚑ ${flaggedCount}</span>` : '';

    return `<div class="group-section${isCollapsed ? ' collapsed' : ''}">
      <div class="group-header" data-category="${cat}" onclick="toggleGroup(this.dataset.category)">
        <span class="group-title">${cat}</span>
        <span class="group-count">${catFields.length} fields</span>
        ${flaggedBadge}
        <button class="group-approve-btn" data-category="${cat}" onclick="event.stopPropagation(); approveGroup(this.dataset.category)">Approve All</button>
      </div>
      <div class="group-fields">
        ${catFields.map(f => renderField(f, false)).join('')}
      </div>
    </div>`;
  }).join('');
}
```

- [ ] **Step 2: Show/hide group Approve All buttons based on approval axis**

The "Approve All" button per group should only be visible when `approval=bulk` or `grouping=by-category`. Currently it always shows. Update the `group-approve-btn` rendering to always show it (the button is always useful in grouped view — leave this as-is, it's fine).

Instead, for `approval=bulk` + `grouping=flat`, add a global "Approve All" button in the status bar. Update `renderStatusBar`:

```js
function renderStatusBar() {
  const approved = FIELDS.filter(f => state.fieldStates[f.id] === 'approved').length;
  const flagged  = FIELDS.filter(f => state.fieldStates[f.id] === 'flagged').length;
  const pending  = FIELDS.filter(f => state.fieldStates[f.id] === 'pending').length;
  const parts = [`${FIELDS.length} fields`];
  if (flagged)  parts.push(`<span style="color:var(--flagged)">${flagged} flagged</span>`);
  if (approved) parts.push(`<span style="color:var(--approved)">${approved} approved</span>`);
  if (pending)  parts.push(`${pending} pending`);

  const bulkBtn = (state.approval === 'bulk')
    ? `<button onclick="approveAll()" style="margin-left:12px;padding:2px 10px;background:rgba(72,187,120,0.12);border:1px solid rgba(72,187,120,0.3);border-radius:3px;color:var(--approved);font-size:11px;cursor:pointer;">Approve All</button>`
    : '';

  document.getElementById('status-bar').innerHTML = parts.join(' · ') + bulkBtn;
}
```

- [ ] **Step 3: Verify in browser**

Test these combinations:
- `grouping=flat` → flat list, no group headers
- `grouping=by-category` → collapsible category sections with Approve All per group
- `grouping=by-category` + click group header → collapses/expands
- `grouping=by-category` + click "Approve All" on a group → approves pending fields in that group
- `approval=bulk, grouping=flat` → "Approve All" button appears in status bar
- `approval=bulk, grouping=by-category` → per-group Approve All buttons work, plus status bar button

No console errors.

- [ ] **Step 4: Commit**

```bash
git add firehose/index.html
git commit -m "refactor(firehose): grouping axis + bulk approval wiring"
```

---

## Task 6: Cleanup — remove dead code, update topbar summary

**Files:**
- Modify: `firehose/index.html` — remove density CSS, remove interactionMode/density references in topbar summary

Remove all remnants of the old model.

- [ ] **Step 1: Remove density CSS rules**

In the `<style>` block, find and delete these three rules:

```css
/* Density variants */
.density-compact .field-row  { padding: 4px 8px; font-size: 12px; margin-bottom: 2px; }
.density-comfortable .field-row { padding: 8px 12px; font-size: 13px; margin-bottom: 4px; }
.density-focused .field-row  { padding: 14px 16px; font-size: 15px; margin-bottom: 8px; }
```

Also remove these density modifier rules (for label min-width):
```css
.density-compact    .field-label { min-width: 140px; }
.density-focused    .field-label { min-width: 220px; }
```

Set a single default `field-row` padding by updating the `.field-row` rule to include explicit padding:
```css
.field-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  font-size: 13px;
  margin-bottom: 4px;
  border-radius: 4px;
  border: 1px solid transparent;
  cursor: pointer;
  user-select: none;
  transition: background 0.1s, border-color 0.1s;
}
```

- [ ] **Step 2: Update topbar scroll-collapse summary**

Find the scroll event handler at the bottom of the `<script>` block. The summary line currently reads:

```js
const summary = [state.interactionMode, state.density, state.defaultState,
  state.errorVisibility].join(' · ');
```

Replace it with:

```js
const summary = [
  state.visibility, state.navigation, state.approval, state.grouping,
  state.presentation, state.defaultState, state.errorVisibility
].join(' · ');
```

- [ ] **Step 3: Grep for any remaining interactionMode or density references**

Run in the terminal:
```bash
grep -n "interactionMode\|\.density\b\|density-" firehose/index.html
```

Expected output: zero matches. If any remain, remove them.

- [ ] **Step 4: Verify full behavior in browser**

Run a final smoke test across the following combinations:

| visibility | navigation | approval | grouping | Expected |
|-----------|-----------|---------|---------|---------|
| all | free | click-cycle | flat | scrollable flat list, click cycles state |
| windowed | cursor | keyboard | flat | 7-field window, j/k move, space/f approve |
| one | auto | keyboard | flat | single field, space/f auto-advance |
| all | free | click-cycle | by-category | grouped collapsible sections |
| all | cursor | bulk | flat | all fields, cursor highlight, Approve All in status bar |

Also verify:
- presentation=card renders card layout for all combinations
- context=neighbors shows previous/next field label
- context=source shows category name
- errorVisibility=heat shows color tinting
- errorVisibility=confidence shows % badges
- controlLayout switches between sidebar / topbar / floating correctly
- Topbar collapsed summary shows new axis values
- No console errors in any combination

- [ ] **Step 5: Commit**

```bash
git add firehose/index.html
git commit -m "refactor(firehose): remove density CSS, update topbar summary for new axes"
```
