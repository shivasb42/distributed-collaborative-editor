"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";

type SyncStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseWebSocketSyncOptions {
  ydoc: Y.Doc | null;
  documentId: string | null;
  serverUrl?: string;
  enabled?: boolean;
}

interface SyncMessage {
  type: string;
  documentId?: string;
  update?: number[];
  state?: number[];
  stateVector?: number[];
  clientCount?: number;
  message?: string;
}

// Auto-detect WebSocket URL based on current page hostname
function getDefaultWsUrl() {
  if (typeof window === "undefined") return "ws://localhost:1234";
  const hostname = window.location.hostname;
  return `ws://${hostname}:1234`;
}

export function useWebSocketSync({
  ydoc,
  documentId,
  serverUrl = process.env.NEXT_PUBLIC_WS_URL || getDefaultWsUrl(),
  enabled = true,
  onDebugLog,
}: UseWebSocketSyncOptions & { onDebugLog?: (msg: string) => void }) {
  const log = (msg: string) => {
    console.log("[v0]", msg);
    onDebugLog?.(msg);
  };
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);
  
  const [status, setStatus] = useState<SyncStatus>("disconnected");
  const [connectedClients, setConnectedClients] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Send message helper
  const sendMessage = useCallback((message: SyncMessage) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify(message));
    }
  }, []);

  // Handle incoming Yjs update
  const handleRemoteUpdate = useCallback((update: Uint8Array) => {
    if (ydoc) {
      console.log("[v0] Applying remote update to Y.Doc, size:", update.length);
      Y.applyUpdate(ydoc, update, "websocket");
      console.log("[v0] Y.Doc after update - title:", ydoc.getText("title").toString(), "content length:", ydoc.getText("content").toString().length);
    }
  }, [ydoc]);

  // Connect to WebSocket server
  const connect = useCallback(() => {
    if (!enabled || !documentId || !ydoc || wsRef.current) return;

    setStatus("connecting");
    setError(null);

    try {
      const ws = new WebSocket(serverUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        log(`WS connected to ${serverUrl}`);
        setStatus("connected");
        reconnectAttemptsRef.current = 0;
        
        // Join the document room
        log(`Joining room: ${documentId}`);
        sendMessage({ type: "join", documentId });
        
        // Send our FULL STATE to the server so it can store it
        // This ensures the server has our document even if we're the first client
        const fullState = Y.encodeStateAsUpdate(ydoc);
        console.log("[v0] Sending full state to server:", fullState.length, "bytes");
        sendMessage({
          type: "update",
          documentId,
          update: Array.from(fullState),
        });
        
        // Also request any state the server has (in case others edited while we were offline)
        sendMessage({
          type: "sync-request",
          documentId,
        });
      };

      ws.onmessage = (event) => {
        try {
          const message: SyncMessage = JSON.parse(event.data);
          log(`WS received: ${message.type}`);

          switch (message.type) {
            case "update":
              log(`Remote update: ${message.update?.length} bytes`);
              if (message.update) {
                handleRemoteUpdate(new Uint8Array(message.update));
              }
              break;

            case "sync-response":
              log(`Sync response: ${message.state?.length} bytes`);
              if (message.state) {
                handleRemoteUpdate(new Uint8Array(message.state));
              }
              break;

            case "client-joined":
            case "client-left":
              log(`Client count: ${message.clientCount}`);
              setConnectedClients(message.clientCount || 0);
              break;

            case "error":
              log(`WS error: ${message.message}`);
              setError(message.message || "Unknown error");
              break;
          }
        } catch (err) {
          log(`Parse error: ${err}`);
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        setStatus("disconnected");
        setConnectedClients(0);

        // Reconnect with exponential backoff
        if (enabled && reconnectAttemptsRef.current < 5) {
          const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 30000);
          reconnectAttemptsRef.current++;
          reconnectTimeoutRef.current = setTimeout(connect, delay);
        }
      };

      ws.onerror = (e) => {
        console.log("[v0] WebSocket error:", e);
        setStatus("error");
        setError("Connection failed");
      };
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Connection failed");
    }
  }, [enabled, documentId, ydoc, serverUrl, sendMessage, handleRemoteUpdate]);

  // Disconnect from WebSocket server
  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    setStatus("disconnected");
    setConnectedClients(0);
  }, []);

  // Send local updates to server
  useEffect(() => {
    if (!ydoc || !documentId || status !== "connected") return;

    const handleUpdate = (update: Uint8Array, origin: unknown) => {
      // Don't send back updates that came from the server
      if (origin === "websocket" || origin === "load") return;
      
      sendMessage({
        type: "update",
        documentId,
        update: Array.from(update),
      });
    };

    ydoc.on("update", handleUpdate);
    return () => {
      ydoc.off("update", handleUpdate);
    };
  }, [ydoc, documentId, status, sendMessage]);

  // Connect when enabled and we have required data
  useEffect(() => {
    if (enabled && documentId && ydoc) {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [enabled, documentId, ydoc, connect, disconnect]);

  return {
    status,
    connectedClients,
    error,
    reconnect: connect,
    disconnect,
  };
}
