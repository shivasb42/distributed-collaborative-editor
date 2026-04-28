import type { WebSocketServer, WebSocket } from "ws";
import * as Y from "yjs";
import {
  getSharedDocumentState,
  scheduleSharedDocumentUpdate,
} from "../lib/shared-documents";

type SyncMessage =
  | { type: "join"; documentId: string }
  | { type: "update"; documentId: string; update: number[] }
  | { type: "sync-request"; documentId: string }
  | { type: "sync-response"; documentId: string; state: number[] }
  | { type: "client-joined"; clientCount: number }
  | { type: "client-left"; clientCount: number }
  | { type: "error"; message: string };

const documentStates = new Map<string, Uint8Array>();
const documentClients = new Map<string, Set<WebSocket>>();

export function setupWsHandlers(wss: WebSocketServer) {
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
}

function handleJoin(ws: WebSocket, documentId: string) {
  if (!documentClients.has(documentId)) {
    documentClients.set(documentId, new Set());
  }
  const clients = documentClients.get(documentId)!;
  clients.add(ws);

  console.log(
    `Client joined document ${documentId}. Total clients: ${clients.size}`
  );

  sendMessage(ws, { type: "client-joined", clientCount: clients.size });

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
  } else {
    void (async () => {
      const persistedState = await getSharedDocumentState(documentId);
      if (persistedState && !documentStates.has(documentId)) {
        documentStates.set(documentId, persistedState);
        console.log(
          `Loaded persisted state for ${documentId} (${persistedState.length} bytes)`
        );
        sendMessage(ws, {
          type: "sync-response",
          documentId,
          state: Array.from(persistedState),
        });
      }
    })();
  }

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

    broadcastToOthers(ws, documentId, {
      type: "client-left",
      clientCount: clients.size,
    });

    if (clients.size === 0) {
      documentClients.delete(documentId);
    }
  }
}

function handleUpdate(ws: WebSocket, documentId: string, update: Uint8Array) {
  console.log(
    `Received update for document ${documentId} (${update.length} bytes)`
  );

  let currentState = documentStates.get(documentId);

  if (currentState) {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, currentState);
    Y.applyUpdate(ydoc, update);
    const mergedState = Y.encodeStateAsUpdate(ydoc);
    documentStates.set(documentId, mergedState);
    scheduleSharedDocumentUpdate(documentId, mergedState);
    ydoc.destroy();
    console.log(`Merged state, new size: ${mergedState.length} bytes`);
  } else {
    documentStates.set(documentId, update);
    scheduleSharedDocumentUpdate(documentId, update);
    console.log(`Stored initial state: ${update.length} bytes`);
  }

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
  if (ws.readyState === 1) {
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
      if (client !== sender && client.readyState === 1) {
        client.send(messageStr);
      }
    }
  }
}
