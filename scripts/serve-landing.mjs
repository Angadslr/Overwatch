import { createServer } from "node:http";
import { readFile } from "node:fs/promises";

const root = new URL("../landing/", import.meta.url);
const port = Number(process.env.PORT ?? 4173);
const files = new Map([
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/eye.js", ["eye.js", "text/javascript; charset=utf-8"]],
  ["/demo.js", ["demo.js", "text/javascript; charset=utf-8"]],
  ["/assets/eye.svg", ["assets/eye.svg", "image/svg+xml"]],
  ["/assets/space-grotesk.ttf", ["assets/space-grotesk.ttf", "font/ttf"]],
]);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://localhost").pathname;
  const file = files.get(pathname);

  if (!file || !["GET", "HEAD"].includes(request.method)) {
    response.writeHead(404).end("Not found");
    return;
  }

  try {
    const body = await readFile(new URL(file[0], root));
    response.writeHead(200, {
      "Content-Type": file[1],
      "Content-Length": body.length,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    console.error("Could not serve landing page:", error.message);
    response.writeHead(500).end("Could not load this file");
  }
});

server.on("error", (error) => {
  console.error(`Landing page preview: ${error.message}`);
  process.exitCode = 1;
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Overwatch landing page: http://127.0.0.1:${port}`);
});
