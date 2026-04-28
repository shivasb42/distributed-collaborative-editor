import { createServer } from "node:http";
import { parse } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";
import { setupWsHandlers } from "./ws-handlers";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT) || 3000;
const hostname = "0.0.0.0";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url || "/", true);
    handle(req, res, parsedUrl);
  });

  const wss = new WebSocketServer({ noServer: true });
  setupWsHandlers(wss);

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url || "/");
    if (pathname === "/_ws") {
      wss.handleUpgrade(req, socket, head, (ws) => {
        wss.emit("connection", ws, req);
      });
    } else {
      socket.destroy();
    }
  });

  server.listen(port, hostname, () => {
    console.log(`> Ready on http://${hostname}:${port} (ws path /_ws)`);
  });
});
