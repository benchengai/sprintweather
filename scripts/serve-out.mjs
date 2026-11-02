// Serve the static demo build (out/) on http://localhost:4173 with no dependencies.
// For a build made with DEMO_BASE_PATH, pass the same variable here.
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";

const root = path.resolve("out");
const port = Number(process.env.PORT ?? 4173);
const base = (process.env.DEMO_BASE_PATH ?? "").replace(/\/$/, "");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".txt": "text/plain", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2" };

createServer((req, res) => {
  let url = decodeURIComponent((req.url ?? "/").split("?")[0]);
  if (base) {
    if (url !== base && !url.startsWith(`${base}/`)) return res.writeHead(302, { Location: `${base}/` }).end();
    url = url.slice(base.length) || "/";
  }
  let file = path.join(root, url);
  if (!file.startsWith(root)) return res.writeHead(403).end();
  if (existsSync(file) && statSync(file).isDirectory()) file = path.join(file, "index.html");
  if (!existsSync(file)) file = existsSync(`${file}.html`) ? `${file}.html` : path.join(root, "404.html");
  res.writeHead(existsSync(file) ? 200 : 404, { "Content-Type": types[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, () => console.log(`serving ${root} on http://localhost:${port}${base}/`));
