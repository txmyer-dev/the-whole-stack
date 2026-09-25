#!/usr/bin/env bun
/**
 * serve.ts — static server with clean URLs for a scaffolded site (or any folder).
 *   bun serve.ts --dir ./site [--port 4173]
 * /slug → slug.html, / → index.html. Used to verify path-routed builds locally.
 */
import { join, extname } from "node:path";
import { stat } from "node:fs/promises";

const argv = process.argv.slice(2);
const flag = (n: string) => { const i = argv.indexOf(`--${n}`); return i === -1 ? undefined : argv[i + 1]; };
const dir = flag("dir") ?? ".";
const port = Number(flag("port") ?? 4173);

async function exists(p: string) { try { return (await stat(p)).isFile(); } catch { return false; } }

Bun.serve({
  port,
  async fetch(req) {
    const url = new URL(req.url);
    let path = decodeURIComponent(url.pathname);
    if (path.endsWith("/")) path += "index.html";
    const candidates = [join(dir, path), join(dir, path + ".html")];
    for (const c of candidates) if (await exists(c)) return new Response(Bun.file(c));
    return new Response("Not found: " + path, { status: 404 });
  },
});
console.log(`Serving ${dir} at http://localhost:${port}/ (clean URLs: /slug → slug.html)`);
