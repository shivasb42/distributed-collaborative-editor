"use client";

import * as Y from "yjs";

export interface QueuedUpdate {
  id: string;
  documentId: string;
  update: Uint8Array;
  timestamp: number;
  synced: boolean;
}

/**
 * Manages a queue of Yjs updates that need to be synced.
 * Used for offline support - updates are queued when offline
 * and flushed when back online.
 */
export class OfflineQueue {
  private queue: QueuedUpdate[] = [];
  private documentId: string;
  private storageKey: string;

  constructor(documentId: string) {
    this.documentId = documentId;
    this.storageKey = `offline-queue-${documentId}`;
    this.loadFromStorage();
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const parsed = JSON.parse(stored);
        this.queue = parsed.map((item: { id: string; documentId: string; update: number[]; timestamp: number; synced: boolean }) => ({
          ...item,
          update: new Uint8Array(item.update),
        }));
      }
    } catch {
      this.queue = [];
    }
  }

  private saveToStorage(): void {
    try {
      const serialized = this.queue.map((item) => ({
        ...item,
        update: Array.from(item.update),
      }));
      localStorage.setItem(this.storageKey, JSON.stringify(serialized));
    } catch {
      // Storage might be full or unavailable
    }
  }

  /**
   * Add an update to the queue
   */
  enqueue(update: Uint8Array): string {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const queuedUpdate: QueuedUpdate = {
      id,
      documentId: this.documentId,
      update,
      timestamp: Date.now(),
      synced: false,
    };
    this.queue.push(queuedUpdate);
    this.saveToStorage();
    return id;
  }

  /**
   * Get all unsynced updates
   */
  getUnsynced(): QueuedUpdate[] {
    return this.queue.filter((item) => !item.synced);
  }

  /**
   * Mark updates as synced
   */
  markSynced(ids: string[]): void {
    const idSet = new Set(ids);
    this.queue = this.queue.map((item) =>
      idSet.has(item.id) ? { ...item, synced: true } : item
    );
    // Remove old synced updates (keep last 100)
    const synced = this.queue.filter((item) => item.synced);
    const unsynced = this.queue.filter((item) => !item.synced);
    this.queue = [...synced.slice(-100), ...unsynced];
    this.saveToStorage();
  }

  /**
   * Clear all synced updates
   */
  clearSynced(): void {
    this.queue = this.queue.filter((item) => !item.synced);
    this.saveToStorage();
  }

  /**
   * Get queue size
   */
  size(): number {
    return this.getUnsynced().length;
  }

  /**
   * Merge all unsynced updates into a single update
   */
  getMergedUpdate(): Uint8Array | null {
    const unsynced = this.getUnsynced();
    if (unsynced.length === 0) return null;
    return Y.mergeUpdates(unsynced.map((u) => u.update));
  }

  /**
   * Clear entire queue
   */
  clear(): void {
    this.queue = [];
    this.saveToStorage();
  }
}

/**
 * State vector utilities for reconciliation
 */
export function encodeStateVector(doc: Y.Doc): Uint8Array {
  return Y.encodeStateVector(doc);
}

export function encodeStateAsUpdate(doc: Y.Doc, targetStateVector?: Uint8Array): Uint8Array {
  return Y.encodeStateAsUpdate(doc, targetStateVector);
}

/**
 * Compare two state vectors to determine what's missing
 */
export function getMissingUpdates(
  localDoc: Y.Doc,
  remoteStateVector: Uint8Array
): Uint8Array {
  // Get updates that the remote doesn't have
  return Y.encodeStateAsUpdate(localDoc, remoteStateVector);
}

/**
 * Check if local doc is ahead, behind, or in sync with remote
 */
export function compareStates(
  localStateVector: Uint8Array,
  remoteStateVector: Uint8Array
): "ahead" | "behind" | "diverged" | "synced" {
  const localMap = Y.decodeStateVector(localStateVector);
  const remoteMap = Y.decodeStateVector(remoteStateVector);

  let localAhead = false;
  let remoteBehind = false;

  // Check all local clients
  localMap.forEach((localClock, clientId) => {
    const remoteClock = remoteMap.get(clientId) || 0;
    if (localClock > remoteClock) localAhead = true;
    if (localClock < remoteClock) remoteBehind = true;
  });

  // Check remote clients not in local
  remoteMap.forEach((remoteClock, clientId) => {
    if (!localMap.has(clientId) && remoteClock > 0) {
      remoteBehind = true;
    }
  });

  if (localAhead && remoteBehind) return "diverged";
  if (localAhead) return "ahead";
  if (remoteBehind) return "behind";
  return "synced";
}
