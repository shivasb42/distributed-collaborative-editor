"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import { OfflineQueue, compareStates } from "@/lib/offline-queue";

type TabSyncMessage =
  | { type: "announce"; tabId: string; documentId: string }
  | { type: "leave"; tabId: string }
  | { type: "update"; tabId: string; documentId: string; update: number[] }
  | { type: "sync-request"; tabId: string; documentId: string; stateVector: number[] }
  | { type: "sync-response"; tabId: string; documentId: string; update: number[]; stateVector: number[] }
  | { type: "reconcile-request"; tabId: string; documentId: string; stateVector: number[] }
  | { type: "reconcile-response"; tabId: string; documentId: string; missingUpdates: number[]; theirStateVector: number[] };

interface UseTabSyncOptions {
  ydoc: Y.Doc | null;
  documentId: string | null;
  enabled?: boolean;
  isOffline?: boolean;
}

interface SyncStatus {
  state: "synced" | "syncing" | "offline" | "reconnecting" | "diverged";
  pendingUpdates: number;
  lastSyncTime: Date | null;
}

/**
 * Tab-to-tab sync using BroadcastChannel API with offline support
 * and state vector reconciliation.
 */
export function useTabSync({ ydoc, documentId, enabled = true, isOffline = false }: UseTabSyncOptions) {
  const channelRef = useRef<BroadcastChannel | null>(null);
  const tabIdRef = useRef<string>(generateTabId());
  const connectedTabsRef = useRef<Map<string, { lastSeen: number }>>(new Map());
  const isApplyingRemoteRef = useRef(false);
  const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const offlineQueueRef = useRef<OfflineQueue | null>(null);
  const wasOfflineRef = useRef(false);

  const [connectedTabs, setConnectedTabs] = useState(0);
  const [isActive, setIsActive] = useState(false);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>({
    state: "synced",
    pendingUpdates: 0,
    lastSyncTime: null,
  });

  function generateTabId(): string {
    return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  }

  // Initialize offline queue when documentId is available
  useEffect(() => {
    if (documentId) {
      offlineQueueRef.current = new OfflineQueue(documentId);
      setSyncStatus((prev) => ({
        ...prev,
        pendingUpdates: offlineQueueRef.current?.size() || 0,
      }));
    }
  }, [documentId]);

  // Handle offline/online transitions
  useEffect(() => {
    if (isOffline) {
      wasOfflineRef.current = true;
      setSyncStatus((prev) => ({ ...prev, state: "offline" }));
    } else if (wasOfflineRef.current && !isOffline) {
      // Coming back online - trigger reconciliation
      wasOfflineRef.current = false;
      setSyncStatus((prev) => ({ ...prev, state: "reconnecting" }));
      // Reconciliation will be triggered below
    }
  }, [isOffline]);

  // Reconciliation: request what we're missing from other tabs
  const requestReconciliation = useCallback(() => {
    if (!channelRef.current || !ydoc || !documentId || isOffline) return;

    const stateVector = Y.encodeStateVector(ydoc);
    const message: TabSyncMessage = {
      type: "reconcile-request",
      tabId: tabIdRef.current,
      documentId,
      stateVector: Array.from(stateVector),
    };
    channelRef.current.postMessage(message);

    setSyncStatus((prev) => ({ ...prev, state: "syncing" }));
  }, [ydoc, documentId, isOffline]);

  // Flush offline queue when coming back online
  const flushOfflineQueue = useCallback(() => {
    if (!channelRef.current || !documentId || !offlineQueueRef.current) return;

    const unsynced = offlineQueueRef.current.getUnsynced();
    if (unsynced.length === 0) return;

    // Send all queued updates
    const idsToMark: string[] = [];
    for (const item of unsynced) {
      const message: TabSyncMessage = {
        type: "update",
        tabId: tabIdRef.current,
        documentId,
        update: Array.from(item.update),
      };
      channelRef.current.postMessage(message);
      idsToMark.push(item.id);
    }

    // Mark as synced
    offlineQueueRef.current.markSynced(idsToMark);
    setSyncStatus((prev) => ({
      ...prev,
      pendingUpdates: offlineQueueRef.current?.size() || 0,
      lastSyncTime: new Date(),
    }));
  }, [documentId]);

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
          if (message.tabId !== tabIdRef.current && message.documentId === documentId) {
            connectedTabsRef.current.set(message.tabId, { lastSeen: Date.now() });
            setConnectedTabs(connectedTabsRef.current.size);

            // If we were offline and just saw another tab, reconcile
            if (syncStatus.state === "reconnecting") {
              requestReconciliation();
              flushOfflineQueue();
            }
          }
          break;

        case "leave":
          connectedTabsRef.current.delete(message.tabId);
          setConnectedTabs(connectedTabsRef.current.size);
          break;

        case "update":
          if (message.tabId !== tabIdRef.current && message.documentId === documentId) {
            isApplyingRemoteRef.current = true;
            try {
              Y.applyUpdate(ydoc, new Uint8Array(message.update), "tab-sync");
              setSyncStatus((prev) => ({ ...prev, lastSyncTime: new Date() }));
            } catch (error) {
              console.error("[TabSync] Failed to apply update:", error);
            }
            isApplyingRemoteRef.current = false;
          }
          break;

        case "sync-request":
          if (message.tabId !== tabIdRef.current && message.documentId === documentId) {
            // Send our full state as update diff from their state vector
            const theirStateVector = new Uint8Array(message.stateVector);
            const update = Y.encodeStateAsUpdate(ydoc, theirStateVector);
            const ourStateVector = Y.encodeStateVector(ydoc);

            const response: TabSyncMessage = {
              type: "sync-response",
              tabId: tabIdRef.current,
              documentId,
              update: Array.from(update),
              stateVector: Array.from(ourStateVector),
            };
            channel.postMessage(response);
          }
          break;

        case "sync-response":
          if (message.tabId !== tabIdRef.current && message.documentId === documentId) {
            isApplyingRemoteRef.current = true;
            try {
              Y.applyUpdate(ydoc, new Uint8Array(message.update), "tab-sync");
              connectedTabsRef.current.set(message.tabId, { lastSeen: Date.now() });
              setConnectedTabs(connectedTabsRef.current.size);
              setSyncStatus((prev) => ({
                ...prev,
                state: "synced",
                lastSyncTime: new Date(),
              }));
            } catch (error) {
              console.error("[TabSync] Failed to apply sync response:", error);
            }
            isApplyingRemoteRef.current = false;
          }
          break;

        case "reconcile-request":
          // Another tab is asking what they're missing
          if (message.tabId !== tabIdRef.current && message.documentId === documentId) {
            const theirStateVector = new Uint8Array(message.stateVector);
            const ourStateVector = Y.encodeStateVector(ydoc);

            // Calculate what updates they're missing
            const missingUpdates = Y.encodeStateAsUpdate(ydoc, theirStateVector);

            const response: TabSyncMessage = {
              type: "reconcile-response",
              tabId: tabIdRef.current,
              documentId,
              missingUpdates: Array.from(missingUpdates),
              theirStateVector: Array.from(ourStateVector),
            };
            channel.postMessage(response);
          }
          break;

        case "reconcile-response":
          // Received missing updates from another tab
          if (message.tabId !== tabIdRef.current && message.documentId === documentId) {
            isApplyingRemoteRef.current = true;
            try {
              // Apply what we were missing
              Y.applyUpdate(ydoc, new Uint8Array(message.missingUpdates), "tab-sync");

              // Check sync status
              const ourStateVector = Y.encodeStateVector(ydoc);
              const theirStateVector = new Uint8Array(message.theirStateVector);
              const comparison = compareStates(ourStateVector, theirStateVector);

              if (comparison === "synced" || comparison === "ahead") {
                setSyncStatus((prev) => ({
                  ...prev,
                  state: "synced",
                  lastSyncTime: new Date(),
                }));
              } else if (comparison === "diverged") {
                // We need to send our updates too
                flushOfflineQueue();
                setSyncStatus((prev) => ({ ...prev, state: "synced" }));
              }
            } catch (error) {
              console.error("[TabSync] Failed to apply reconcile response:", error);
            }
            isApplyingRemoteRef.current = false;
          }
          break;
      }
    };

    // Announce ourselves
    const announceMessage: TabSyncMessage = {
      type: "announce",
      tabId: tabIdRef.current,
      documentId,
    };
    channel.postMessage(announceMessage);

    // Request sync from other tabs with our state vector
    const stateVector = Y.encodeStateVector(ydoc);
    const syncRequest: TabSyncMessage = {
      type: "sync-request",
      tabId: tabIdRef.current,
      documentId,
      stateVector: Array.from(stateVector),
    };
    channel.postMessage(syncRequest);

    // Heartbeat and cleanup stale tabs
    heartbeatIntervalRef.current = setInterval(() => {
      // Announce
      const heartbeat: TabSyncMessage = {
        type: "announce",
        tabId: tabIdRef.current,
        documentId,
      };
      channel.postMessage(heartbeat);

      // Remove stale tabs (not seen in 15 seconds)
      const now = Date.now();
      let changed = false;
      connectedTabsRef.current.forEach((data, tabId) => {
        if (now - data.lastSeen > 15000) {
          connectedTabsRef.current.delete(tabId);
          changed = true;
        }
      });
      if (changed) {
        setConnectedTabs(connectedTabsRef.current.size);
      }
    }, 5000);

    // Cleanup
    return () => {
      if (heartbeatIntervalRef.current) {
        clearInterval(heartbeatIntervalRef.current);
      }

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
  }, [enabled, ydoc, documentId, syncStatus.state, requestReconciliation, flushOfflineQueue]);

  // Send local updates to other tabs (or queue if offline)
  useEffect(() => {
    if (!enabled || !ydoc || !documentId) return;

    const handleUpdate = (update: Uint8Array, origin: unknown) => {
      if (origin === "tab-sync" || isApplyingRemoteRef.current) return;

      if (isOffline) {
        // Queue update for later
        if (offlineQueueRef.current) {
          offlineQueueRef.current.enqueue(update);
          setSyncStatus((prev) => ({
            ...prev,
            pendingUpdates: offlineQueueRef.current?.size() || 0,
          }));
        }
      } else {
        // Send immediately
        if (channelRef.current) {
          const message: TabSyncMessage = {
            type: "update",
            tabId: tabIdRef.current,
            documentId,
            update: Array.from(update),
          };
          channelRef.current.postMessage(message);
        }
      }
    };

    ydoc.on("update", handleUpdate);
    return () => {
      ydoc.off("update", handleUpdate);
    };
  }, [enabled, ydoc, documentId, isOffline]);

  // Request sync from other tabs
  const requestSync = useCallback(() => {
    if (channelRef.current && documentId && ydoc) {
      const stateVector = Y.encodeStateVector(ydoc);
      const message: TabSyncMessage = {
        type: "sync-request",
        tabId: tabIdRef.current,
        documentId,
        stateVector: Array.from(stateVector),
      };
      channelRef.current.postMessage(message);
    }
  }, [documentId, ydoc]);

  return {
    isActive,
    connectedTabs,
    tabId: tabIdRef.current,
    syncStatus,
    requestSync,
    requestReconciliation,
    flushOfflineQueue,
  };
}
