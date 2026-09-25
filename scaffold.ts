#!/usr/bin/env bun
/**
 * scaffold.ts — build a sliding-column note site from a folder of notes.
 *
 *   bun scaffold.ts --notes ./notes --out ./site            # one HTML per note + assets (path routing)
 *   bun scaffold.ts --notes ./notes --out ./site/index.html --single-file   # everything inline (hash routing)
 *   bun scaffold.ts --demo --out ./demo.html                # three sample notes, single file
 *   bun scaffold.ts --emit-assets ./site/assets             # just copy sliding-columns.js + .css
 *
 * Notes are .md (minimal Markdown + [[wiki links]]) or .html fragments. Slug = filename without extension.
 * Wiki links: [[slug:::Display text]]  or  [[Note title]]  (resolved by title, then by slug).
 * Run with --help for every flag.
 */
import { readdir, readFile, writeFile, mkdir, stat } from "node:fs/promises";
import { join, basename, extname, dirname, resolve } from "node:path";

const HERE = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

type Note = { slug: string; title: string; html: string; links: string[]; backlinks: string[] };

/* ---------- args ---------- */

const HELP = `scaffold.ts — build a sliding-column note site from a folder of notes

  bun scaffold.ts --notes ./notes --out ./site              one HTML per note + assets/ (path routing)
  bun scaffold.ts --notes ./notes --out ./site/index.html   single self-contained file (hash routing)
  bun scaffold.ts --demo --out ./demo.html                  the sample notes in examples/notes
  bun scaffold.ts --emit-assets ./site/assets               just copy sliding-columns.js + .css

Flags
  --notes <dir>            folder of .md / .html notes; slug = filename without extension
  --out <path>             .html → single file; directory → multi-page build
  --single-file            force single-file output
  --routing path|hash      URL scheme (default: hash for single file, path for multi-page)
  --base-path </prefix/>   path prefix when the site is not at the domain root (default /)
  --root <slug>            note shown at the root (default: index, then home, then first file)
  --title <text>           site title suffix (default: Notes)
  --column-width <px>      column width (default 625)
  --collapsed-width <px>   collapsed strip width (default 40)
  --demo                   use examples/notes
  --emit-assets <dir>      copy the browser assets only

Wiki links: [[Note title]] or [[slug:::Display text]]. See README.md for details.`;

const argv = process.argv.slice(2);
function flag(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = argv[i + 1];
  return v === undefined || v.startsWith("--") ? "" : v;
}
const has = (name: string) => argv.includes(`--${name}`);

if (has("help") || argv.length === 0) {
  console.log(HELP);
  process.exit(0);
}

const outArg = flag("out");
const notesDir = flag("notes");
const demo = has("demo");
const singleFile = has("single-file") || (outArg ?? "").endsWith(".html") || (demo && !flag("routing"));
const routing = (flag("routing") as "path" | "hash") ?? (singleFile ? "hash" : "path");
const basePath = flag("base-path") ?? "/";
const siteTitle = flag("title") ?? "Notes";
const columnWidth = Number(flag("column-width") ?? 625);
const collapsedWidth = Number(flag("collapsed-width") ?? 40);
const emitAssets = flag("emit-assets");

const JS = (await readFile(join(HERE, "src", "sliding-columns.js"), "utf8")).replace(/<\/script/gi, "<\/script");
const CSS = await readFile(join(HERE, "src", "sliding-columns.css"), "utf8");

if (emitAssets !== undefined) {
  const dir = emitAssets || "./assets";
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, "sliding-columns.js"), JS);
  await writeFile(join(dir, "sliding-columns.css"), CSS);
  console.log(`Wrote ${join(dir, "sliding-columns.js")} and ${join(dir, "sliding-columns.css")}`);
  if (!notesDir && !demo) process.exit(0);
}

if (!outArg) { console.error("--out is required"); process.exit(1); }

/* ---------- markdown (deliberately minimal; swap in a real parser for anything richer) ---------- */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function inline(text: string, resolveLink: (target: string) => { href: string; label: string; slug?: string }, links: string[]): string {
  const codes: string[] = [];
  text = text.replace(/`([^`]+)`/g, (_, c) => { codes.push(`<code>${esc(c)}</code>`); return `\u0000${codes.length - 1}\u0000`; });
  text = esc(text);
  text = text.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
    const r = resolveLink(inner);
    if (r.slug) links.push(r.slug);
    return `<a href="${r.href}"${r.slug ? "" : ' class="sc-missing"'}>${esc(r.label)}</a>`;
  });
  text = text.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, l, u) => `<a href="${u}">${l}</a>`);
  text = text.replace(/&lt;(https?:\/\/[^&\s]+)&gt;/g, (_, u) => `<a href="${u}">${u}</a>`);
  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  return text.replace(/\u0000(\d+)\u0000/g, (_, i) => codes[Number(i)]);
}

function markdownToHtml(md: string, resolveLink: (t: string) => { href: string; label: string; slug?: string }, links: string[]): string {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: string[] = [];
  const listStack: { indent: number; tag: string }[] = [];
  let para: string[] = [];
  let quote: string[] = [];
  let code: string[] | null = null;

  const closeLists = (toIndent = -1) => {
    while (listStack.length && listStack[listStack.length - 1].indent > toIndent) out.push(`</li></${listStack.pop()!.tag}>`);
  };
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(" "), resolveLink, links)}</p>`); para = []; } };
  const flushQuote = () => { if (quote.length) { out.push(`<blockquote><p>${inline(quote.join(" "), resolveLink, links)}</p></blockquote>`); quote = []; } };

  for (const raw of lines) {
    if (code) { if (/^```/.test(raw)) { out.push(`<pre><code>${esc(code.join("\n"))}</code></pre>`); code = null; } else code.push(raw); continue; }
    if (/^```/.test(raw)) { flushPara(); flushQuote(); closeLists(); code = []; continue; }
    const line = raw.replace(/\s+$/, "");
    if (!line.trim()) { flushPara(); flushQuote(); closeLists(); continue; }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) { flushPara(); flushQuote(); closeLists(); out.push(`<h${h[1].length}>${inline(h[2], resolveLink, links)}</h${h[1].length}>`); continue; }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { flushPara(); flushQuote(); closeLists(); out.push("<hr>"); continue; }
    const q = /^>\s?(.*)$/.exec(line);
    if (q) { flushPara(); closeLists(); quote.push(q[1]); continue; }

    const li = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line);
    if (li) {
      flushPara(); flushQuote();
      const indent = li[1].replace(/\t/g, "    ").length;
      const tag = /^\d/.test(li[2]) ? "ol" : "ul";
      const top = listStack[listStack.length - 1];
      if (!top || indent > top.indent) { out.push(`<${tag}><li>`); listStack.push({ indent, tag }); }
      else { closeLists(indent); out.push(`</li><li>`); }
      out.push(inline(li[3], resolveLink, links));
      continue;
    }
    if (listStack.length && /^\s+\S/.test(line)) { out.push(" " + inline(line.trim(), resolveLink, links)); continue; }
    closeLists();
    para.push(line.trim());
  }
  flushPara(); flushQuote(); closeLists();
  return out.join("\n");
}

/* ---------- load notes ---------- */

async function loadNotes(dir: string): Promise<Note[]> {
  const files = (await readdir(dir)).filter((f) => /\.(md|markdown|html?)$/i.test(f)).sort();
  const raw = await Promise.all(files.map(async (f) => ({ file: f, text: await readFile(join(dir, f), "utf8") })));
  const slugOf = (f: string) => basename(f, extname(f));
  const titleOf = (f: string, text: string) => {
    const m = /^#\s+(.+)$/m.exec(text) ?? /<h1[^>]*>(.*?)<\/h1>/i.exec(text);
    return (m ? m[1].replace(/<[^>]+>/g, "") : slugOf(f)).trim();
  };
  const bySlug = new Map(raw.map((r) => [slugOf(r.file), r]));
  const byTitle = new Map(raw.map((r) => [titleOf(r.file, r.text).toLowerCase(), slugOf(r.file)]));
  const hrefFor = (slug: string) => (routing === "hash" ? `#/${encodeURIComponent(slug)}` : `${basePath}${encodeURIComponent(slug)}`);
  const resolveLink = (inner: string) => {
    const [a, b] = inner.split(":::");
    if (b !== undefined) return bySlug.has(a) ? { href: hrefFor(a), label: b, slug: a } : { href: "#", label: b };
    const slug = byTitle.get(a.toLowerCase()) ?? (bySlug.has(a) ? a : undefined);
    return slug ? { href: hrefFor(slug), label: bySlug.has(slug) ? titleOf(bySlug.get(slug)!.file, bySlug.get(slug)!.text) : a, slug } : { href: "#", label: a };
  };

  const notes: Note[] = raw.map((r) => {
    const slug = slugOf(r.file);
    const links: string[] = [];
    const isMd = /\.(md|markdown)$/i.test(r.file);
    const html = isMd ? markdownToHtml(r.text, resolveLink, links) : r.text;
    return { slug, title: titleOf(r.file, r.text), html, links: [...new Set(links)], backlinks: [] };
  });
  for (const n of notes) for (const l of n.links) notes.find((m) => m.slug === l)?.backlinks.push(n.slug);
  return notes;
}

const notes: Note[] = await loadNotes(demo ? join(HERE, "examples", "notes") : resolve(notesDir!));

if (!notes.length) { console.error("No .md or .html notes found"); process.exit(1); }
const rootSlug = flag("root") ?? (notes.find((n) => n.slug === "index" || n.slug === "home")?.slug ?? notes[0].slug);

/* ---------- render ---------- */

function noteBody(n: Note): string {
  const back = n.backlinks.length
    ? `<footer class="sc-backlinks"><h4>Links to this note</h4><ul>${n.backlinks.map((s) => { const b = notes.find((m) => m.slug === s)!; return `<li><a href="${routing === "hash" ? `#/${s}` : basePath + s}">${esc(b.title)}</a></li>`; }).join("")}</ul></footer>`
    : "";
  return `${n.html}
${back}`;
}
function noteColumn(n: Note): string {
  return `<div class="sc-column" data-slug="${esc(n.slug)}"><div class="sc-label">${esc(n.title)}</div><div class="sc-note">${noteBody(n)}</div></div>`;
}

const PAGE_CSS = `
body { margin: 0; font-family: Georgia, "Times New Roman", serif; font-size: 17px; line-height: 1.55; color: #222; }
.sc-note h1 { font-family: var(--sc-font); font-size: 26px; line-height: 1.2; margin: 0 0 16px; letter-spacing: -0.01em; }
.sc-note h2, .sc-note h3 { font-family: var(--sc-font); margin-top: 1.5em; }
.sc-note a { color: #0a84ff; text-decoration: none; border-bottom: 1px solid rgba(10,132,255,.35); }
.sc-note a:hover { border-bottom-color: #0a84ff; }
.sc-note a.sc-missing { color: #999; border-bottom-style: dashed; }
.sc-note blockquote { margin: 1em 0; padding-left: 16px; border-left: 3px solid #ddd; color: #555; }
.sc-note code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 0.9em; background: #f4f4f6; padding: 1px 4px; border-radius: 3px; }
.sc-note pre { background: #f4f4f6; padding: 12px; border-radius: 8px; overflow-x: auto; }
.sc-backlinks { margin-top: 48px; padding: 16px; background: #fafafc; border-radius: 12px; font-family: var(--sc-font); font-size: 14px; }
.sc-backlinks h4 { margin: 0 0 8px; color: #888; font-weight: 500; }
.sc-backlinks ul { margin: 0; padding-left: 18px; }
`;

function shell(preRendered: Note, opts: { inlineAssets: boolean; assetPrefix: string; embedAll: boolean }): string {
  const head = opts.inlineAssets
    ? `<style>${CSS}</style>`
    : `<link rel="stylesheet" href="${opts.assetPrefix}sliding-columns.css">`;
  const script = opts.inlineAssets ? `<script>${JS}</script>` : `<script src="${opts.assetPrefix}sliding-columns.js"></script>`;
  const data = opts.embedAll
    ? `<script id="sc-notes" type="application/json">${JSON.stringify(Object.fromEntries(notes.map((n) => [n.slug, { title: n.title, html: noteBody(n) }]))).replace(/<\//g, "<\\/")}</script>`
    : "";
  const loader = opts.embedAll
    ? `var NOTES = JSON.parse(document.getElementById('sc-notes').textContent);
  SlidingColumns.init({ rootSlug: ${JSON.stringify(rootSlug)}, routing: ${JSON.stringify(routing)}, basePath: ${JSON.stringify(basePath)},
    columnWidth: ${columnWidth}, collapsedWidth: ${collapsedWidth},
    loadNote: function (slug) { var n = NOTES[slug]; return n ? Promise.resolve(n) : Promise.reject(new Error('no such note')); } });`
    : `SlidingColumns.init({ rootSlug: ${JSON.stringify(rootSlug)}, routing: ${JSON.stringify(routing)}, basePath: ${JSON.stringify(basePath)},
    columnWidth: ${columnWidth}, collapsedWidth: ${collapsedWidth},
    noteUrl: function (slug) { return ${JSON.stringify(basePath)} + encodeURIComponent(slug) + '.html'; },
    contentSelector: '.sc-note' });`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(preRendered.title)} · ${esc(siteTitle)}</title>
${head}
<style>${PAGE_CSS}</style>
</head>
<body>
<div id="sliding-columns">${noteColumn(preRendered)}</div>
${data}
${script}
<script>
  ${loader}
</script>
</body>
</html>
`;
}

if (singleFile) {
  const out = resolve(outArg);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, shell(notes.find((n) => n.slug === rootSlug)!, { inlineAssets: true, assetPrefix: "", embedAll: true }));
  console.log(`Wrote ${out} (${notes.length} notes, root "${rootSlug}", ${routing} routing)`);
} else {
  const dir = resolve(outArg);
  await mkdir(join(dir, "assets"), { recursive: true });
  await writeFile(join(dir, "assets", "sliding-columns.js"), JS);
  await writeFile(join(dir, "assets", "sliding-columns.css"), CSS);
  for (const n of notes) await writeFile(join(dir, `${n.slug}.html`), shell(n, { inlineAssets: false, assetPrefix: `${basePath}assets/`, embedAll: false }));
  await writeFile(join(dir, "index.html"), shell(notes.find((n) => n.slug === rootSlug)!, { inlineAssets: false, assetPrefix: `${basePath}assets/`, embedAll: false }));
  console.log(`Wrote ${notes.length + 1} pages to ${dir} (root "${rootSlug}", path routing under ${basePath}).`);
  console.log(`Serve with clean URLs (/slug → /slug.html) or a SPA fallback to index.html; e.g. Netlify: "/* /index.html 200" is NOT enough — use "/:slug /:slug.html 200".`);
}
