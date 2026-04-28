"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";

type SyncMessage =
  | { type: "join"; documentId: string }
  | { type: "update"; documentId: string; update: number[] }
  | { type: "sync-request"; documentId: string }
  | { type: "sync-response"; documentId: string; state: number[] }
  | { type: "client-joined"; clientCount: number }
  | { type: "client-left"; clientCount: number }
  | { type: "error"; message: string };

type ConnectionStatus = "disconnected" | "connecting" | "connected" | "error";

interface UseSyncProviderOptions {
  ydoc: Y.Doc | null;
  documentId: string | null;
  serverUrl?: string;
  autoConnect?: boolean;
}

function getDefaultWsUrl() {
  if (typeof window === "undefined") return "ws://localhost:3000/_ws";
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/_ws`;
}

export function useSyncProvider({
  ydoc,
  documentId,
  serverUrl,
  autoConnect = true,
}: UseSyncProviderOptions) {
  const resolvedUrl = serverUrl ?? (process.env.NEXT_PUBLIC_WS_URL || getDefaultWsUrl());
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttemptsRef = useRef(0);

  const [status, setStatus] = useState<ConnectionStatus>("disconnected");
  const [connectedClients, setConnectedClients] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Track if we've synced initial state
  const hasSyncedRef = useRef(false);
  // Track if update is from remote to avoid loops
  const isApplyingRemoteRef = useRef(false);

  const connect = useCallback(() => {
    if (!ydoc || !documentId) return;
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    setStatus("connecting");
    setError(null);

    try {
      const ws = new WebSocket(resolvedUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log("[v0] WebSocket connected");
        setStatus("connected");
        reconnectAttemptsRef.current = 0;

        // Join the document room
        const joinMessage: SyncMessage = { type: "join", documentId };
        ws.send(JSON.stringify(joinMessage));

        // If we have local state, send it to the server
        if (ydoc.store.clients.size > 0) {
          const localState = Y.encodeStateAsUpdate(ydoc);
          const updateMessage: SyncMessage = {
            type: "update",
            documentId,
            update: Array.from(localState),
          };
          ws.send(JSON.stringify(updateMessage));
        }
      };

      ws.onmessage = (event) => {
        try {
          const message: SyncMessage = JSON.parse(event.data);

          switch (message.type) {
            case "sync-response":
              // Apply server state
              if (message.state.length > 0) {
                isApplyingRemoteRef.current = true;
                Y.applyUpdate(ydoc, new Uint8Array(message.state), "remote");
                isApplyingRemoteRef.current = false;
                hasSyncedRef.current = true;
                console.log("[v0] Applied server state");
              }
              break;

            case "update":
              // Apply remote update from another client
              isApplyingRemoteRef.current = true;
              Y.applyUpdate(ydoc, new Uint8Array(message.update), "remote");
              isApplyingRemoteRef.current = false;
              console.log("[v0] Applied remote update");
              break;

            case "client-joined":
              setConnectedClients(message.clientCount);
              console.log(`[v0] Clients connected: ${message.clientCount}`);
              break;

            case "client-left":
              setConnectedClients(message.clientCount);
              console.log(`[v0] Clients remaining: ${message.clientCount}`);
              break;

            case "error":
              console.error("[v0] Server error:", message.message);
              setError(message.message);
              break;
          }
        } catch (err) {
          console.error("[v0] Error parsing message:", err);
        }
      };

      ws.onclose = () => {
        console.log("[v0] WebSocket disconnected");
        setStatus("disconnected");
        wsRef.current = null;

        // Attempt to reconnect with exponential backoff
        if (autoConnect) {
          const delay = Math.min(
            1000 * Math.pow(2, reconnectAttemptsRef.current),
            30000
          );
          reconnectAttemptsRef.current++;
          console.log(`[v0] Reconnecting in ${delay}ms...`);

          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          }, delay);
        }
      };

      ws.onerror = (err) => {
        console.error("[v0] WebSocket error:", err);
        setStatus("error");
        setError("Connection failed");
      };
    } catch (err) {
      console.error("[v0] Failed to create WebSocket:", err);
      setStatus("error");
      setError("Failed to connect");
    }
  }, [ydoc, documentId, resolvedUrl, autoConnect]);

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
  }, []);

  // Send local updates to the server
  useEffect(() => {
    if (!ydoc || !documentId) return;

    const handleUpdate = (update: Uint8Array, origin: unknown) => {
      // Don't send updates that came from the server
      if (origin === "remote" || isApplyingRemoteRef.current) return;

      // Send update to server
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        const message: SyncMessage = {
          type: "update",
          documentId,
          update: Array.from(update),
        };
        wsRef.current.send(JSON.stringify(message));
        console.log("[v0] Sent local update to server");
      }
    };

    ydoc.on("update", handleUpdate);

    return () => {
      ydoc.off("update", handleUpdate);
    };
  }, [ydoc, documentId]);

  // Auto-connect when ready
  useEffect(() => {
    if (autoConnect && ydoc && documentId) {
      connect();
    }

    return () => {
      disconnect();
    };
  }, [autoConnect, ydoc, documentId, connect, disconnect]);

  return {
    status,
    connectedClients,
    error,
    connect,
    disconnect,
    isConnected: status === "connected",
  };
}
