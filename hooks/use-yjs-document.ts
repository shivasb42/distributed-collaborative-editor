"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import {
  saveDocument,
  getDocument,
  getCurrentDocumentId,
  addUnsyncedUpdate,
  getUnsyncedUpdates,
  clearUnsyncedUpdates,
  getUnsyncedCount,
  type Document,
} from "@/lib/indexeddb";
import { useTabSync } from "./use-tab-sync";

const AUTO_SAVE_DELAY = 1000;

export function useYjsDocument() {
  const ydocRef = useRef<Y.Doc | null>(null);
  const yTitleRef = useRef<Y.Text | null>(null);
  const yContentRef = useRef<Y.Text | null>(null);

  const [documentId, setDocumentId] = useState<string | null>(null);
  const [title, setTitle] = useState("Untitled Document");
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [isDocReady, setIsDocReady] = useState(false);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);

  // Track online/offline status
  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    setIsOnline(navigator.onLine);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Tab sync for real-time collaboration between browser tabs
  const {
    isActive: isTabSyncActive,
    connectedTabs,
    tabId,
    syncStatus,
    requestReconciliation,
    flushOfflineQueue,
  } = useTabSync({
    ydoc: isDocReady ? ydocRef.current : null,
    documentId,
    enabled: true,
    isOffline: !isOnline,
  });

  // Trigger reconciliation when coming back online
  useEffect(() => {
    if (isOnline && syncStatus.state === "reconnecting") {
      requestReconciliation();
      flushOfflineQueue();
    }
  }, [isOnline, syncStatus.state, requestReconciliation, flushOfflineQueue]);

  // Initialize Y.Doc and load from IndexedDB
  useEffect(() => {
    async function initDocument() {
      const docId = await getCurrentDocumentId();
      setDocumentId(docId);

      const ydoc = new Y.Doc();
      ydocRef.current = ydoc;

      const yTitle = ydoc.getText("title");
      const yContent = ydoc.getText("content");
      yTitleRef.current = yTitle;
      yContentRef.current = yContent;

      try {
        const savedDoc = await getDocument(docId);
        if (savedDoc && savedDoc.yjsState) {
          Y.applyUpdate(ydoc, savedDoc.yjsState, "load");
          setLastSaved(new Date(savedDoc.updatedAt));

          // Crash recovery: apply unsynced updates
          const unsyncedUpdates = await getUnsyncedUpdates(docId);
          if (unsyncedUpdates.length > 0) {
            for (const update of unsyncedUpdates) {
              Y.applyUpdate(ydoc, update.update, "load");
            }
            const mergedState = Y.encodeStateAsUpdate(ydoc);
            await saveDocument({
              id: docId,
              title: yTitle.toString(),
              yjsState: mergedState,
              updatedAt: Date.now(),
              createdAt: savedDoc.createdAt,
            });
            await clearUnsyncedUpdates(docId);
          }
        } else {
          yTitle.insert(0, "Untitled Document");
          const initialState = Y.encodeStateAsUpdate(ydoc);
          await saveDocument({
            id: docId,
            title: "Untitled Document",
            yjsState: initialState,
            updatedAt: Date.now(),
            createdAt: Date.now(),
          });
        }
      } catch (error) {
        console.error("Failed to load document:", error);
        yTitle.insert(0, "Untitled Document");
      }

      setTitle(yTitle.toString());
      setContent(yContent.toString());
      isInitializedRef.current = true;
      setIsLoading(false);
      setIsDocReady(true);

      const count = await getUnsyncedCount(docId);
      setUnsyncedCount(count);

      // Subscribe to changes
      yTitle.observe(() => {
        setTitle(yTitle.toString());
      });

      yContent.observe(() => {
        setContent(yContent.toString());
      });

      // Track updates for persistence
      ydoc.on("update", async (update: Uint8Array, origin: unknown) => {
        if (origin !== "load" && origin !== "tab-sync" && isInitializedRef.current) {
          try {
            await addUnsyncedUpdate(docId, update);
            const count = await getUnsyncedCount(docId);
            setUnsyncedCount(count);
          } catch (error) {
            console.error("Failed to track unsynced update:", error);
          }
        }
      });
    }

    initDocument();

    return () => {
      if (ydocRef.current) {
        ydocRef.current.destroy();
      }
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Save to IndexedDB
  const save = useCallback(async () => {
    if (!ydocRef.current || !yTitleRef.current || !documentId) return;

    setSaveStatus("saving");
    try {
      const state = Y.encodeStateAsUpdate(ydocRef.current);
      const existingDoc = await getDocument(documentId);
      const doc: Document = {
        id: documentId,
        title: yTitleRef.current.toString(),
        yjsState: state,
        updatedAt: Date.now(),
        createdAt: existingDoc?.createdAt || Date.now(),
      };
      await saveDocument(doc);
      await clearUnsyncedUpdates(documentId);
      setUnsyncedCount(0);
      setLastSaved(new Date());
      setSaveStatus("saved");
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (error) {
      console.error("Failed to save document:", error);
      setSaveStatus("idle");
    }
  }, [documentId]);

  // Debounced auto-save
  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(() => {
      save();
    }, AUTO_SAVE_DELAY);
  }, [save]);

  // Update title
  const updateTitle = useCallback(
    (newTitle: string) => {
      if (!yTitleRef.current || !isInitializedRef.current) return;

      const yTitle = yTitleRef.current;
      ydocRef.current?.transact(() => {
        yTitle.delete(0, yTitle.length);
        yTitle.insert(0, newTitle);
      });
      scheduleSave();
    },
    [scheduleSave]
  );

  // Update content with cursor-aware edits
  const updateContent = useCallback(
    (newContent: string, cursorPosition?: number) => {
      if (!yContentRef.current || !isInitializedRef.current) return;

      const yContent = yContentRef.current;
      const currentContent = yContent.toString();

      if (cursorPosition !== undefined) {
        const lengthDiff = newContent.length - currentContent.length;

        if (lengthDiff === 1) {
          const insertPos = cursorPosition - 1;
          const insertedChar = newContent[insertPos];
          if (insertedChar !== undefined) {
            yContent.insert(insertPos, insertedChar);
            scheduleSave();
            return;
          }
        } else if (lengthDiff === -1) {
          const deletePos = cursorPosition;
          if (deletePos >= 0 && deletePos < currentContent.length) {
            yContent.delete(deletePos, 1);
            scheduleSave();
            return;
          }
        }
      }

      ydocRef.current?.transact(() => {
        yContent.delete(0, yContent.length);
        yContent.insert(0, newContent);
      });
      scheduleSave();
    },
    [scheduleSave]
  );

  // Manual save
  const manualSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    save();
  }, [save]);

  // Get Y.Doc
  const getYDoc = useCallback(() => ydocRef.current, []);

  // Get state vector for sync
  const getStateVector = useCallback(() => {
    if (!ydocRef.current) return null;
    return Y.encodeStateVector(ydocRef.current);
  }, []);

  // Apply remote update
  const applyRemoteUpdate = useCallback((update: Uint8Array) => {
    if (!ydocRef.current) return;
    Y.applyUpdate(ydocRef.current, update, "remote");
  }, []);

  // Get updates since a state vector
  const getUpdatesSince = useCallback((stateVector: Uint8Array) => {
    if (!ydocRef.current) return null;
    return Y.encodeStateAsUpdate(ydocRef.current, stateVector);
  }, []);

  // Save before page unload
  useEffect(() => {
    const handleBeforeUnload = () => {
      if (ydocRef.current && documentId) {
        const state = Y.encodeStateAsUpdate(ydocRef.current);
        const title = yTitleRef.current?.toString() || "Untitled Document";

        const data = JSON.stringify({
          id: documentId,
          title,
          yjsState: Array.from(state),
          updatedAt: Date.now(),
        });

        try {
          sessionStorage.setItem(`backup-${documentId}`, data);
        } catch {
          // Ignore
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [documentId]);

  // Recover from sessionStorage
  useEffect(() => {
    if (!documentId || isLoading) return;

    const recoverFromBackup = async () => {
      try {
        const backup = sessionStorage.getItem(`backup-${documentId}`);
        if (backup) {
          const data = JSON.parse(backup);
          const backupTime = data.updatedAt;
          const currentDoc = await getDocument(documentId);

          if (!currentDoc || backupTime > currentDoc.updatedAt) {
            const yjsState = new Uint8Array(data.yjsState);
            if (ydocRef.current) {
              Y.applyUpdate(ydocRef.current, yjsState, "recovery");
              await save();
            }
          }

          sessionStorage.removeItem(`backup-${documentId}`);
        }
      } catch {
        // Ignore
      }
    };

    recoverFromBackup();
  }, [documentId, isLoading, save]);

  return {
    documentId,
    title,
    content,
    isLoading,
    saveStatus,
    lastSaved,
    unsyncedCount,
    isOnline,
    updateTitle,
    updateContent,
    manualSave,
    getYDoc,
    // Sync utilities
    getStateVector,
    applyRemoteUpdate,
    getUpdatesSince,
    // Tab sync status
    isTabSyncActive,
    connectedTabs,
    tabId,
    syncStatus,
    requestReconciliation,
    flushOfflineQueue,
  };
}
