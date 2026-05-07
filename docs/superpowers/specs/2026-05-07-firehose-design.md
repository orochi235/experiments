# Firehose — design spec

## Purpose

A lab page for exploring UX patterns for reviewing large lists of extracted data fields. Users scan through dozens of heterogeneous legal case fields, spot the ~10% that are wrong, and flag them. The lab exposes all configurable axes independently so combinations can be discovered empirically.

## Data

~50 fake legal case fields. Categories: Case Info, Parties, Counsel, Key Dates, Financials, Documents. Each field:

```js
{ id, category, label, value, confidence }
```

- `confidence`: 0.6–0.99; error fields seeded at 0.4–0.7
- ~5 fields are seeded errors (wrong dates, misspelled names, transposed amounts)
- No external data source; all inline in the HTML

## State

Per-field: `'pending' | 'approved' | 'flagged'`

Global axes (each independently configurable, any combination valid):

| Axis | Options |
|------|---------|
| `interactionMode` | `scroll-flag` · `keyboard-triage` · `grouped` |
| `density` | `compact` · `comfortable` · `focused` |
| `defaultState` | `approved` · `pending` |
| `errorVisibility` | `none` · `confidence` · `heat` |
| `controlLayout` | `sidebar` · `topbar` · `floating` |

Changing any axis re-renders the field list immediately. Field states persist across axis changes, except changing `defaultState` resets all field states to the new default.

`cursor` (integer): tracks focused field index in keyboard-triage mode only.

## Interaction modes

**scroll-flag**: All fields rendered as a scrollable list. Click a field to cycle its state (`pending → approved → flagged → pending`). Global shortcuts: `A` approve all visible, `Shift+F` jump to next flagged.

**keyboard-triage**: Cursor moves through the list one field at a time. Progress bar shows X / N reviewed.
- `Space` — approve and advance
- `↓` / `J` — advance without changing state
- `F` — flag and advance
- `↑` / `K` — go back one

In compact density: 5–7 fields visible, cursor row highlighted. Comfortable: 3 fields visible, current slightly enlarged. Focused: 1 field fills the pane.

**grouped**: Fields in collapsible sections by category. Section header shows field count, flagged count, and an Approve All button. Individual fields clickable (same cycle as scroll-flag). Click header to collapse/expand.

## Error visibility modes

**none**: All fields visually identical regardless of confidence.

**confidence**: Small badge on each field showing confidence as a percentage (e.g. `94%`).

**heat**: Background tint from neutral (high confidence) to red-orange (low confidence). No text badge.

## Control panel layouts

All three layouts expose the same five axes as radio groups. Changing `controlLayout` switches the panel layout live.

**sidebar**: Fixed left panel, ~220px. Always visible alongside the field list. Reset field states button at the bottom.

**topbar**: Horizontal strip above the field list. Axes arranged in a row with compact labels. Collapses to a single summary line when scrolled past.

**floating**: Fixed bottom-right corner. Collapsed to a small tab by default; expands on click. Does not overlap the field list when collapsed.

## Layout

Single HTML file (`firehose/index.html`), inline CSS and JS, no build step, CDN dependencies allowed. Dark theme (`#1a1a2e` background family), consistent with other experiments.

Default on load: `scroll-flag` · `comfortable` · `approved` · `confidence` · `sidebar`.
