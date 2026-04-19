/**
 * Standalone WebSocket server for Yjs sync
 * Run with: npx tsx server/websocket-server.ts
 */

import { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";

const PORT = Number(process.env.WS_PORT) || 1234;

// In-memory storage for document states
const documentStates = new Map<string, Uint8Array>();

// Connected clients grouped by document ID
const documentClients = new Map<string, Set<WebSocket>>();

// Message types
type SyncMessage =
  | { type: "join"; documentId: string }
  | { type: "update"; documentId: string; update: number[] }
  | { type: "sync-request"; documentId: string }
  | { type: "sync-response"; documentId: string; state: number[] }
  | { type: "client-joined"; clientCount: number }
  | { type: "client-left"; clientCount: number }
  | { type: "error"; message: string };

const wss = new WebSocketServer({ port: PORT });

console.log(`WebSocket sync server running on ws://localhost:${PORT}`);

wss.on("connection", (ws: WebSocket) => {
  let currentDocumentId: string | null = null;

  console.log("New client connected");

  ws.on("message", (data: Buffer) => {
    try {
      const message: SyncMessage = JSON.parse(data.toString());

      switch (message.type) {
        case "join":
          currentDocumentId = message.documentId;
          handleJoin(ws, message.documentId);
          break;

        case "update":
          handleUpdate(ws, message.documentId, new Uint8Array(message.update));
          break;

        case "sync-request":
          handleSyncRequest(ws, message.documentId);
          break;

        default:
          console.log("Unknown message type:", message);
      }
    } catch (error) {
      console.error("Error handling message:", error);
      sendMessage(ws, { type: "error", message: "Invalid message format" });
    }
  });

  ws.on("close", () => {
    console.log("Client disconnected");
    if (currentDocumentId) {
      handleLeave(ws, currentDocumentId);
    }
  });

  ws.on("error", (error) => {
    console.error("WebSocket error:", error);
    if (currentDocumentId) {
      handleLeave(ws, currentDocumentId);
    }
  });
});

function handleJoin(ws: WebSocket, documentId: string) {
  // Add client to document room
  if (!documentClients.has(documentId)) {
    documentClients.set(documentId, new Set());
  }
  const clients = documentClients.get(documentId)!;
  clients.add(ws);

  console.log(
    `Client joined document ${documentId}. Total clients: ${clients.size}`
  );

  // Notify client of successful join
  sendMessage(ws, { type: "client-joined", clientCount: clients.size });

  // Send existing document state if available
  const existingState = documentStates.get(documentId);
  if (existingState) {
    console.log(
      `Sending existing state to client (${existingState.length} bytes)`
    );
    sendMessage(ws, {
      type: "sync-response",
      documentId,
      state: Array.from(existingState),
    });
  }

  // Notify other clients about the new peer
  broadcastToOthers(ws, documentId, {
    type: "client-joined",
    clientCount: clients.size,
  });
}

function handleLeave(ws: WebSocket, documentId: string) {
  const clients = documentClients.get(documentId);
  if (clients) {
    clients.delete(ws);

    console.log(
      `Client left document ${documentId}. Remaining clients: ${clients.size}`
    );

    // Notify remaining clients
    broadcastToOthers(ws, documentId, {
      type: "client-left",
      clientCount: clients.size,
    });

    // Clean up empty rooms (but keep state for future connections)
    if (clients.size === 0) {
      documentClients.delete(documentId);
    }
  }
}

function handleUpdate(ws: WebSocket, documentId: string, update: Uint8Array) {
  console.log(
    `Received update for document ${documentId} (${update.length} bytes)`
  );

  // Merge update into stored document state
  let currentState = documentStates.get(documentId);

  if (currentState) {
    // Create a Y.Doc to merge states
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, currentState);
    Y.applyUpdate(ydoc, update);
    const mergedState = Y.encodeStateAsUpdate(ydoc);
    documentStates.set(documentId, mergedState);
    ydoc.destroy();
    console.log(`Merged state, new size: ${mergedState.length} bytes`);
  } else {
    // First update for this document
    documentStates.set(documentId, update);
    console.log(`Stored initial state: ${update.length} bytes`);
  }

  // Broadcast update to all other clients
  const clients = documentClients.get(documentId);
  if (clients) {
    console.log(`Broadcasting to ${clients.size - 1} other clients`);
  }

  broadcastToOthers(ws, documentId, {
    type: "update",
    documentId,
    update: Array.from(update),
  });
}

function handleSyncRequest(ws: WebSocket, documentId: string) {
  const state = documentStates.get(documentId);
  if (state) {
    console.log(`Sync request: sending ${state.length} bytes`);
    sendMessage(ws, {
      type: "sync-response",
      documentId,
      state: Array.from(state),
    });
  } else {
    console.log(`Sync request: no state found for ${documentId}`);
  }
}

function sendMessage(ws: WebSocket, message: SyncMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcastToOthers(
  sender: WebSocket,
  documentId: string,
  message: SyncMessage
) {
  const clients = documentClients.get(documentId);
  if (clients) {
    const messageStr = JSON.stringify(message);
    for (const client of clients) {
      if (client !== sender && client.readyState === WebSocket.OPEN) {
        client.send(messageStr);
      }
    }
  }
}

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down server...");
  wss.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

// Log stats periodically
setInterval(() => {
  const docCount = documentStates.size;
  const clientCount = Array.from(documentClients.values()).reduce(
    (sum, clients) => sum + clients.size,
    0
  );
  if (docCount > 0 || clientCount > 0) {
    console.log(`Stats: ${docCount} documents, ${clientCount} clients`);
  }
}, 30000);
