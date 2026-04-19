import { handleConnection } from "@/lib/sync-server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  // Check if this is a WebSocket upgrade request
  const upgradeHeader = request.headers.get("upgrade");
  
  if (upgradeHeader !== "websocket") {
    return new Response("Expected WebSocket connection", { status: 426 });
  }

  // Use the WebSocket upgrade API
  // @ts-expect-error - Vercel's WebSocket support
  const { socket, response } = Reflect.get(globalThis, "Deno")
    ? // Deno runtime
      Deno.upgradeWebSocket(request)
    : // Node.js runtime with custom upgrade
      await upgradeWebSocket(request);

  handleConnection(socket);

  return response;
}

// WebSocket upgrade helper for environments that support it
async function upgradeWebSocket(request: Request): Promise<{
  socket: WebSocket;
  response: Response;
}> {
  // This is a placeholder - actual implementation depends on runtime
  // For Vercel Edge/Node, we need to handle this differently
  
  // For development, we'll use a different approach with ws package
  throw new Error(
    "WebSocket upgrade not supported in this runtime. Use the standalone server."
  );
}
