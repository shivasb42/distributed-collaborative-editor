import * as Y from "yjs";

// In-memory storage for document states (would use Redis/DB in production)
const documentStates = new Map<string, Uint8Array>();

// Connected clients grouped by document ID
const documentClients = new Map<string, Set<WebSocket>>();

// Message types for the sync protocol
export type SyncMessage =
  | { type: "join"; documentId: string }
  | { type: "update"; documentId: string; update: number[] }
  | { type: "sync-request"; documentId: string }
  | { type: "sync-response"; documentId: string; state: number[] }
  | { type: "awareness"; documentId: string; clientId: number; state: object }
  | { type: "client-joined"; clientCount: number }
  | { type: "client-left"; clientCount: number }
  | { type: "error"; message: string };

export function handleConnection(ws: WebSocket) {
  let currentDocumentId: string | null = null;

  ws.addEventListener("message", async (event) => {
    try {
      const data =
        typeof event.data === "string"
          ? event.data
          : await (event.data as Blob).text();
      const message: SyncMessage = JSON.parse(data);

      switch (message.type) {
        case "join":
          handleJoin(ws, message.documentId);
          currentDocumentId = message.documentId;
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

  ws.addEventListener("close", () => {
    if (currentDocumentId) {
      handleLeave(ws, currentDocumentId);
    }
  });

  ws.addEventListener("error", (error) => {
    console.error("WebSocket error:", error);
    if (currentDocumentId) {
      handleLeave(ws, currentDocumentId);
    }
  });
}

function handleJoin(ws: WebSocket, documentId: string) {
  // Add client to document room
  if (!documentClients.has(documentId)) {
    documentClients.set(documentId, new Set());
  }
  const clients = documentClients.get(documentId)!;
  clients.add(ws);

  // Notify client of join and current client count
  sendMessage(ws, { type: "client-joined", clientCount: clients.size });

  // Send existing document state if available
  const existingState = documentStates.get(documentId);
  if (existingState) {
    sendMessage(ws, {
      type: "sync-response",
      documentId,
      state: Array.from(existingState),
    });
  }

  // Notify other clients
  broadcastToOthers(ws, documentId, {
    type: "client-joined",
    clientCount: clients.size,
  });

  console.log(
    `Client joined document ${documentId}. Total clients: ${clients.size}`
  );
}

function handleLeave(ws: WebSocket, documentId: string) {
  const clients = documentClients.get(documentId);
  if (clients) {
    clients.delete(ws);

    // Notify remaining clients
    broadcastToOthers(ws, documentId, {
      type: "client-left",
      clientCount: clients.size,
    });

    // Clean up empty rooms
    if (clients.size === 0) {
      documentClients.delete(documentId);
      // Optionally keep state for a while for reconnecting clients
      // documentStates.delete(documentId);
    }

    console.log(
      `Client left document ${documentId}. Remaining clients: ${clients.size}`
    );
  }
}

function handleUpdate(
  ws: WebSocket,
  documentId: string,
  update: Uint8Array
) {
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
  } else {
    // First update for this document
    documentStates.set(documentId, update);
  }

  // Broadcast update to all other clients in the same document
  broadcastToOthers(ws, documentId, {
    type: "update",
    documentId,
    update: Array.from(update),
  });
}

function handleSyncRequest(ws: WebSocket, documentId: string) {
  const state = documentStates.get(documentId);
  if (state) {
    sendMessage(ws, {
      type: "sync-response",
      documentId,
      state: Array.from(state),
    });
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

// Get connected client count for a document
export function getClientCount(documentId: string): number {
  return documentClients.get(documentId)?.size || 0;
}

// Get all document IDs with active connections
export function getActiveDocuments(): string[] {
  return Array.from(documentClients.keys());
}
