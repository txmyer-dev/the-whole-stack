# The sliding-column pattern — reference teardown

Source: the public notes site at notes.andymatuschak.org (a React app the author calls "notetower"), inspected 2026-09-25. Everything below is what its markup, CSS, and bundle actually do. `src/sliding-columns.js` in this repo reimplements it without React.

## 1. The stack lives in the URL

```
/<root-slug>?stackedNotes=<slug2>&stackedNotes=<slug3>
```

Route state is `{ note, stackedNotes[] }`, parsed on load and on `popstate`. A click computes the new stack and calls `history.pushState`. Consequences: back/forward work, any view is a shareable link, and reload restores the columns. The root path `/` is `replaceState`d to the home note's slug so there is always a real root.

## 2. Click semantics: truncate, then append

Let `g = [root, ...stackedNotes]`. Clicking a link in column `i` to note `W`:

- If `W` is already in `g`: scroll to it. No URL change.
- Otherwise: `g' = [...g.slice(0, i + 1), W]`. Everything right of the clicking column is dropped.

Then, if the stack overflows the viewport, smooth-scroll the container so the new column is centred:

```js
container.scrollTo({ left: index * W - (viewport - W) / 2, behavior: 'smooth' })
```

Links stay ordinary `<a href="/slug">`. Modifier-clicks, middle-clicks, and no-JS all degrade to plain navigation.

## 3. Layout: horizontal flex + staggered sticky

```css
.NoteColumnsScrollingContainer { display: flex; overflow-x: auto; overflow-y: hidden; }
.NoteColumnsContainer            { display: flex; width: calc(625px * N); }   /* set inline */
.NoteContainer {
  position: sticky; top: 0;
  flex-shrink: 0; width: 625px; max-width: 625px;
  overflow-y: auto;                      /* each column scrolls vertically on its own */
  border-left: 1px solid rgba(0,0,0,.05);
}
/* per column, inline: */  left: calc(40px * index);  right: -585px;   /* 585 = 625 - 40 */
```

Why it works: a sticky element pins when its natural position would cross the container's edge minus its `left`/`right` inset. Giving column `i` `left: 40px * i` means scrolled-past columns pile up on the left, each 40px further in, so every earlier column stays visible as a 40px strip. The negative `right` lets later columns pin at the right edge with 40px peeking in. The track's explicit width (`N × 625`) is what gives the sticky columns room to move.

Constants: `sa = 625` (column width), `Hu = 40` (collapsed strip width).

## 4. Three column states, computed from `scrollLeft`

For column `q` with scroll position `x`, viewport width `vw`:

```
start         = max(0, (sa − Hu) · (q − 1))
collapseLeft  = max(0, (sa − Hu) · (q + 1) − 80)
collapseRight = min(scrollWidth, (sa − Hu) · q − (vw − (q − 1) · Hu) + 80)

state = x > start      ? (x > collapseLeft ? "obscured" : "overlay")
      : x < collapseRight ? "obscured" : "resting"
```

- **resting**: fully visible, no shadow.
- **overlay**: pinned on the left, still readable, drop shadow (`0 0 15px 3px rgba(0,0,0,.1)`).
- **obscured**: collapsed to the 40px strip on either edge. The note body fades to `opacity: 0; pointer-events: none` and a vertical label appears:

```css
.ObscuredLabel { writing-mode: vertical-lr; position: absolute; top: 0; bottom: 0; left: 0;
                 width: 40px; margin-top: 36px; font: 500 17px/40px system-ui; overflow: hidden; }
```

The listener is a scroll subscription on the container; states are diffed so React only re-renders on change.

## 5. Hover affordances

- Hovering a link whose target is already open colours that column's label blue (`HoveredDestination`).
- Hovering a link whose target is not open marks every column right of the source as `PendingExit` (background turns page-grey) to preview what a click will drop.
- Links whose target is open get an "active" class.

## 6. Data loading

- Notes are static files at `/notes/<id>.md`, fetched on demand and cached client-side. A `manifest.json` maps legacy slugs to IDs.
- The first note is server-rendered and its data embedded in `<script id="notetower-initial-data" type="application/json">`, so the page hydrates without a blank first paint.
- Markdown is rendered client-side with remark; a plugin turns `[[id:::Title]]` into note links.
- Each column renders the note, timestamps, and a backlinks footer.

## 7. Transitions

Columns mount/unmount through a 150ms opacity transition (`FadeTransition-*` classes), plus `transform: scale(0.95)` on hidden columns. Track width animates with `cubic-bezier(0.19, 1, 0.22, 1)`.

## 8. Mobile

At `max-width: 800px`: only the last note in the stack renders, the container stops being a horizontal scroller, and clicks navigate to `/slug` directly. The stack is a desktop feature.

## Essential vs. polish

| Essential | Polish |
|---|---|
| Stack in the URL + pushState | Hover previews of destination and would-exit columns |
| Truncate-and-append click rule | Fade / scale transitions |
| Flex track + sticky columns with staggered `left` | Vertical labels on collapsed columns |
| Three-state scroll classification | Smooth-scroll centring on push |
| Mobile fallback to a single note | Backlinks footer, timestamps |

## Lineage

The same idea appears in Roam Research's sidebar, Obsidian's Sliding Panes plugin, and `gatsby-theme-andy`. This teardown is of the original.
