# The Whole Stack

Stacked, sliding-column navigation for note sites and digital gardens. Click a link and the target opens in a new column to the right instead of replacing the page. The URL carries the whole stack, so any view is a shareable link and the back button just works. Scroll sideways and the columns you have passed collapse to a narrow strip showing their titles.

It is the navigation pattern from [Andy Matuschak's working notes](https://notes.andymatuschak.org), rebuilt as a dependency-free drop-in you can put on any page, plus a one-command generator that turns a folder of Markdown into a finished site.

```
┌──┬──┬────────────────────────────┬────────────────────────────┐
│H │W │ Why a stack                │ Mobile                     │
│o │h │                            │                            │
│m │y │ Reading dense, interlinked │ Under 800px the page shows │
│e │  │ notes means chasing        │ one note at a time…        │
│  │i │ references without losing  │                            │
│  │t │ your place…                │                            │
└──┴──┴────────────────────────────┴────────────────────────────┘
   /home?stackedNotes=how-it-works&stackedNotes=why-a-stack&stackedNotes=mobile
```

## What you get

- **`src/sliding-columns.js` + `src/sliding-columns.css`** — the drop-in. ~9 KB, no framework, no build step. Works from `file://`, GitHub Pages, or any server.
- **`scaffold.ts`** — builds a site from a folder of `.md` or `.html` notes. Resolves `[[wiki links]]`, computes backlinks, pre-renders the first note, and emits either one self-contained HTML file or one page per note.
- **`serve.ts`** — a tiny static server with clean URLs for checking multi-page builds locally.
- **`docs/pattern.md`** — a teardown of how the original implementation works, if you want to build it yourself in another framework.
- **`docs/api.md`** — every option, the DOM contract, and the CSS variables.

## Try it in thirty seconds

Requires [Bun](https://bun.sh) for the scripts. The browser files need nothing.

```bash
git clone https://github.com/txmyer-dev/the-whole-stack
cd the-whole-stack
bun scaffold.ts --demo --out demo.html
```

Open `demo.html`. Click "How it works", then "Why a stack", then scroll left and press back.

## Build a site from your notes

Put your notes in a folder. One file per note; the filename is the slug.

```
notes/
  index.md
  evergreen-notes.md
  spaced-repetition.md
```

Link between them with wiki links:

```markdown
# Evergreen notes

Evergreen notes should be [[Atomic]] and [[Densely linked]].
See also [[spaced-repetition:::the spaced repetition note]].
```

`[[Note title]]` resolves by title (case-insensitive) and then by slug. `[[slug:::Display text]]` links to a slug with custom text. Unresolved links render greyed out so you can spot them.

Then build:

```bash
# One self-contained file. Opens from disk, deploys anywhere, no server config.
bun scaffold.ts --notes ./notes --out ./site.html --title "My notes"

# One page per note with clean URLs. Better for search engines and no-JS readers.
bun scaffold.ts --notes ./notes --out ./site --title "My notes"
bun serve.ts --dir ./site        # http://localhost:4173/
```

### Flags

| Flag | Default | Effect |
|---|---|---|
| `--notes <dir>` | | Folder of notes. |
| `--out <path>` | required | `.html` path → single file. Directory → multi-page. |
| `--routing path\|hash` | `hash` single, `path` multi | `path` gives `/root?stackedNotes=a`; `hash` gives `#/root?stackedNotes=a`. |
| `--base-path </prefix/>` | `/` | When the site lives under a sub-path. |
| `--root <slug>` | `index`, `home`, or first file | Note shown at the root. |
| `--title <text>` | `Notes` | Suffix for `<title>`. |
| `--column-width <px>` | `625` | Column width. |
| `--collapsed-width <px>` | `40` | Width of a collapsed column strip. |
| `--single-file` | | Force single-file output for a directory `--out`. |
| `--demo` | | Use `examples/notes`. |
| `--emit-assets <dir>` | | Copy only the JS and CSS (for retrofits). |

### Hosting a multi-page build

The client fetches `<slug>.html` for each stacked column, so the host must serve `/slug` from `/slug.html`. A single-page-app fallback to `index.html` is not enough.

| Host | Setting |
|---|---|
| Netlify | `_redirects`: `/:slug  /:slug.html  200` |
| Cloudflare Pages, Vercel | Clean URLs are on by default. |
| nginx | `try_files $uri $uri.html /index.html;` |
| GitHub Pages | Use the single-file build, or `--routing hash`. |

### Markdown support

Deliberately minimal: headings, paragraphs, nested lists, block quotes, fenced code, horizontal rules, bold, italic, inline code, `[text](url)`, `<https://…>`, and wiki links. If your notes need tables, footnotes, or math, render them to `.html` fragments with your own pipeline and point `--notes` at those. HTML notes are used verbatim; their title is the first `<h1>`.

## Add it to an existing site

Three steps. Your anchors stay ordinary `<a href>` tags, so nothing breaks without JavaScript and modifier-clicks, middle-clicks, and external links behave as before.

**1. Include the assets** in the layout that renders a note.

```html
<link rel="stylesheet" href="/assets/sliding-columns.css">
<script src="/assets/sliding-columns.js"></script>
```

**2. Wrap the note body** so the first paint needs no fetch. Keep site chrome outside the container.

```html
<div id="sliding-columns">
  <div class="sc-column" data-slug="{{slug}}">
    <div class="sc-label">{{title}}</div>
    <div class="sc-note">{{body}}</div>
  </div>
</div>
```

**3. Initialise** with the facts about your site.

```js
SlidingColumns.init({
  basePath: '/notes/',                          // where note URLs live
  linkSelector: '.sc-note a[href^="/notes/"]',  // only note-to-note links become columns
  contentSelector: '.sc-note',                  // what to extract from a fetched page
  noteUrl: s => '/notes/' + s + '.html'         // only if pages are not at basePath + slug
});
```

With no `loadNote` supplied, the script fetches the target page, parses it, and lifts out the first element matching `contentSelector`. That is enough for most static sites. If your notes are Markdown served raw, or come from an API, pass `loadNote: async slug => ({ title, html })` instead.

If a header sits above the container, give `.sc-root` a height: `height: calc(100vh - 56px)`.

## How it works

Four ideas carry the whole thing. The rest is polish.

1. **The stack lives in the URL.** `/<root>?stackedNotes=<a>&stackedNotes=<b>`. Every click computes a new stack and calls `pushState`. Reload, share, back, forward all fall out of that.
2. **Truncate, then append.** Clicking a link in column *i* drops every column to its right and appends the target. If the target is already open, it scrolls there instead.
3. **A flex row of sticky columns with staggered offsets.** Each column is `position: sticky` with `left: 40px × index`. As you scroll, passed columns pile up at the left edge, each one 40px further in, so every earlier note stays reachable as a strip. A negative `right` lets later columns peek in from the right.
4. **Three states from `scrollLeft`.** A scroll listener classifies each column as *resting* (fully visible), *overlay* (pinned with a shadow), or *obscured* (collapsed; body fades out, vertical title fades in).

Below 800px it shows one note at a time with ordinary navigation.

The full teardown, with the exact formulas, is in [`docs/pattern.md`](docs/pattern.md). Every option and the DOM contract for styling is in [`docs/api.md`](docs/api.md).

## Styling

Everything is CSS variables on `.sc-root`:

```css
.sc-root {
  --sc-column-width: 625px;
  --sc-collapsed-width: 40px;
  --sc-bg: #fff;
  --sc-page-bg: #fafafc;
  --sc-accent: #0a84ff;
  --sc-font: system-ui, sans-serif;
}
```

Column state is exposed as `data-state="resting|overlay|obscured"` on `.sc-column`, plus `sc-hover-target` and `sc-would-exit` while hovering a link, and `sc-link-open` on anchors whose target is already open.

## Browser support

Any browser with `position: sticky`, `fetch`, `URLSearchParams`, and `Element.closest`. That is everything since 2017.

## Credits

The pattern and its details are Andy Matuschak's. This is an independent reimplementation; nothing here is his code.

## License

MIT
