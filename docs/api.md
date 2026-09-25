# API — `sliding-columns.js`

Dependency-free browser script (~9 KB) plus `sliding-columns.css`. Works from `file://`, static hosts, or any server.

## Minimal setup

```html
<link rel="stylesheet" href="/assets/sliding-columns.css">
<div id="sliding-columns"></div>
<script src="/assets/sliding-columns.js"></script>
<script>SlidingColumns.init({ rootSlug: 'home' })</script>
```

With no `loadNote`, the default loader fetches `basePath + slug` (same origin), parses the HTML, and uses the first element matching `contentSelector` as the column body. That is enough to retrofit an existing multi-page site whose pages live at `/slug`.

## Options (`SlidingColumns.init(options)`)

| Option | Default | Meaning |
|---|---|---|
| `container` | `'#sliding-columns'` | Selector or element. Becomes the horizontal scroller. |
| `rootSlug` | `null` | Note shown when the URL has no path. Required unless a `.sc-column[data-slug]` is pre-rendered inside the container. |
| `routing` | `'path'` | `'path'` → `/root?stackedNotes=a&stackedNotes=b`. `'hash'` → `#/root?stackedNotes=a` (works on `file://` and hosts without rewrites). |
| `basePath` | `'/'` | Path prefix for path routing and for the default loader. |
| `paramName` | `'stackedNotes'` | Query param that carries the stack. |
| `columnWidth` | `625` | Column width in px. |
| `collapsedWidth` | `40` | Width of a collapsed column strip in px. Also the stagger between sticky `left` offsets. |
| `mobileBreakpoint` | `800` | At or below this container width, one note at a time, no stacking. |
| `linkSelector` | `'a[href]'` | Which anchors inside the container are intercepted. Narrow this (e.g. `'a.note-link'`) on retrofits. |
| `contentSelector` | `'main, article, .sc-note, body'` | Default loader: element whose innerHTML becomes the note body. |
| `noteUrl` | `null` | `(slug) => url` for the default loader. Use `s => '/notes/' + s + '.html'` for static builds. |
| `slugFromHref` | `null` | `(href, anchor) => slug \| null`. Return `null` to let the browser handle the link normally. Replaces the built-in same-origin path check. |
| `loadNote` | `null` | `async (slug) => ({ title, html })`. Replaces the default fetch loader (e.g. read from an inline JSON bundle, or render Markdown client-side). |
| `onNavigate` | `null` | `(stack) => void` after every render. Useful for analytics or updating `document.title`. |
| `transitionMs` | `150` | Exit animation length before the column node is removed. |

## Returned handle

| Method | Effect |
|---|---|
| `open(slug)` | Push `slug` after the last column (or scroll to it if already open). |
| `navigate(sourceIndex, slug)` | Push from a given column: drops columns after `sourceIndex`, appends `slug`. |
| `setStack([...slugs])` | Replace the whole stack and push history. |
| `getStack()` | Current slugs, root first. |
| `refresh()` | Re-render from the current URL. |
| `destroy()` | Remove listeners. Columns are left in place. |

## DOM contract (for styling)

```
.sc-root                      the container (flex, overflow-x auto, 100vh)
  .sc-track                   flex row, width = columns × columnWidth
    .sc-column[data-slug][data-index][data-state]
      .sc-label               vertical title, visible when data-state="obscured"
      .sc-note                note body
```

`data-state` is `resting` (fully visible), `overlay` (pinned on the left, drop shadow), or `obscured` (collapsed to a strip on either edge). Extra classes: `sc-hover-target` (hovered link points at this column), `sc-would-exit` (this column would be dropped if the hovered link were clicked), `sc-entering` / `sc-exiting`. Anchors whose target is open get `sc-link-open`.

CSS variables on `.sc-root`: `--sc-column-width`, `--sc-collapsed-width`, `--sc-bg`, `--sc-page-bg`, `--sc-border`, `--sc-label-color`, `--sc-accent`, `--sc-shadow`, `--sc-font`.

## Pre-rendering the first column

Server-render or statically emit the root note inside the container so the first paint needs no fetch:

```html
<div id="sliding-columns">
  <div class="sc-column" data-slug="home">
    <div class="sc-label">Home</div>
    <div class="sc-note"><h1>Home</h1>…</div>
  </div>
</div>
```

`init` adopts it into the cache and leaves it in place.

## Behaviour summary

- Left click on an intercepted link: drop every column to the right of the clicking column, append the target, `pushState`, smooth-scroll so the new column is centred when the stack overflows. If the target is already open, scroll to it and leave the URL alone.
- Modifier-clicks, middle clicks, `target="_blank"`, `download`, and cross-origin links fall through to the browser.
- Back / forward re-render from the URL (`popstate`). Resizing re-evaluates the mobile breakpoint.
- On mobile, a click navigates to `/slug` alone; the stack is not kept.
