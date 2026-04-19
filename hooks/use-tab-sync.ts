"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";

type TabSyncMessage =
  | { type: "announce"; tabId: string; documentId: string }
  | { type: "leave"; tabId: string }
  | { type: "update"; tabId: string; documentId: string; update: number[] }
  | { type: "sync-request"; tabId: string; documentId: string }
  | { type: "sync-response"; tabId: string; documentId: string; state: number[] };

interface UseTabSyncOptions {
  ydoc: Y.Doc | null;
  documentId: string | null;
  enabled?: boolean;
}

/**
 * Tab-to-tab sync using BroadcastChannel API.
 * This enables real-time collaboration between browser tabs on the same origin.
 */
export function useTabSync({ ydoc, documentId, enabled = true }: UseTabSyncOptions) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef<string>(generateTabId());
  const connectedTabsRef = useRef<Set<string>>(new Set());
  const isApplyingRemoteRef = useRef(false);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);

  const [connectedTabs, setConnectedTabs] = useState(0);
  const [isActive, setIsActive] = useState(false);

  // Generate unique tab ID
  function generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  // Initialize BroadcastChannel
  useEffect(() => {
    if (!enabled || !ydoc || !documentId) return;

    const channelName = `yjs-sync-${documentId}`;
    const channel = new BroadcastChannel(channelName);
    channelRef.current = channel;
    setIsActive(true);

    // Handle incoming messages
    channel.onmessage = (event: MessageEvent<TabSyncMessage>) => {
      const message = event.data;
      
      switch (message.type) {
        case "announce":
          // Another tab joined
          if (message.tabId !== tabIdRef.current && message.documentId === documentId) {
            connectedTabsRef.current.add(message.tabId);
            setConnectedTabs(connectedTabsRef.current.size);
            
            // Send our current state to the new tab
            if (ydoc.store.clients.size > 0) {
              const state = Y.encodeStateAsUpdate(ydoc);
              const response: TabSyncMessage = {
                type: "sync-response",
                tabId: tabIdRef.current,
                documentId,
                state: Array.from(state),
              };
              channel.postMessage(response);
            }
          }
          break;

        case "leave":
          // A tab left
          connectedTabsRef.current.delete(message.tabId);
          setConnectedTabs(connectedTabsRef.current.size);
          break;

        case "update":
          // Received an update from another tab
          if (message.tabId !== tabIdRef.current && message.documentId === documentId) {
            isApplyingRemoteRef.current = true;
            try {
              Y.applyUpdate(ydoc, new Uint8Array(message.update), "tab-sync");
            } catch (error) {
              console.error("[TabSync] Failed to apply update:", error);
            }
            isApplyingRemoteRef.current = false;
          }
          break;

        case "sync-request":
          // Another tab is requesting our state
          if (message.tabId !== tabIdRef.current && message.documentId === documentId) {
            const state = Y.encodeStateAsUpdate(ydoc);
            const response: TabSyncMessage = {
              type: "sync-response",
              tabId: tabIdRef.current,
              documentId,
              state: Array.from(state),
            };
            channel.postMessage(response);
          }
          break;

        case "sync-response":
          // Received state from another tab
          if (message.tabId !== tabIdRef.current && message.documentId === documentId) {
            isApplyingRemoteRef.current = true;
            try {
              Y.applyUpdate(ydoc, new Uint8Array(message.state), "tab-sync");
            } catch (error) {
              console.error("[TabSync] Failed to apply sync response:", error);
            }
            isApplyingRemoteRef.current = false;
            
            // Track this tab as connected
            connectedTabsRef.current.add(message.tabId);
            setConnectedTabs(connectedTabsRef.current.size);
          }
          break;
      }
    };

    // Announce ourselves to other tabs
    const announceMessage: TabSyncMessage = {
      type: "announce",
      tabId: tabIdRef.current,
      documentId,
    };
    channel.postMessage(announceMessage);

    // Send periodic heartbeats to keep track of active tabs
    heartbeatIntervalRef.current = setInterval(() => {
      const heartbeat: TabSyncMessage = {
        type: "announce",
        tabId: tabIdRef.current,
        documentId,
      };
      channel.postMessage(heartbeat);
    }, 5000);

    // Cleanup on unmount
    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }
      
      // Announce leaving
      const leaveMessage: TabSyncMessage = {
        type: "leave",
        tabId: tabIdRef.current,
      };
      channel.postMessage(leaveMessage);
      
      channel.close();
      channelRef.current = null;
      setIsActive(false);
      connectedTabsRef.current.clear();
      setConnectedTabs(0);
    };
  }, [enabled, ydoc, documentId]);

  // Send local updates to other tabs
  useEffect(() => {
    if (!enabled || !ydoc || !documentId) return;

    const handleUpdate = (update: Uint8Array, origin: unknown) => {
      // Don't broadcast updates that came from other tabs
      if (origin === "tab-sync" || isApplyingRemoteRef.current) return;

      // Broadcast update to other tabs
      if (channelRef.current) {
        const message: TabSyncMessage = {
          type: "update",
          tabId: tabIdRef.current,
          documentId,
          update: Array.from(update),
        };
        channelRef.current.postMessage(message);
      }
    };

    ydoc.on("update", handleUpdate);

    return () => {
      ydoc.off("update", handleUpdate);
    };
  }, [enabled, ydoc, documentId]);

  // Request sync from other tabs
  const requestSync = useCallback(() => {
    if (channelRef.current && documentId) {
      const message: TabSyncMessage = {
        type: "sync-request",
        tabId: tabIdRef.current,
        documentId,
      };
      channelRef.current.postMessage(message);
    }
  }, [documentId]);

  return {
    isActive,
    connectedTabs,
    tabId: tabIdRef.current,
    requestSync,
  };
}
