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

  // Tab sync for real-time collaboration between browser tabs
  const {
    isActive: isTabSyncActive,
    connectedTabs,
    tabId,
  } = useTabSync({
    ydoc: isDocReady ? ydocRef.current : null,
    documentId,
    enabled: true,
  });

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

  // Initialize Y.Doc and load from IndexedDB
  useEffect(() => {
    async function initDocument() {
      // Get or create document ID
      const docId = await getCurrentDocumentId();
      setDocumentId(docId);

      // Create new Y.Doc
      const ydoc = new Y.Doc();
      ydocRef.current = ydoc;

      // Get shared text types
      const yTitle = ydoc.getText("title");
      const yContent = ydoc.getText("content");
      yTitleRef.current = yTitle;
      yContentRef.current = yContent;

      // Try to load existing document from IndexedDB
      try {
        const savedDoc = await getDocument(docId);
        if (savedDoc && savedDoc.yjsState) {
          // Apply saved Yjs state
          Y.applyUpdate(ydoc, savedDoc.yjsState);
          setLastSaved(new Date(savedDoc.updatedAt));

          // Check for and apply any unsynced updates (crash recovery)
          const unsyncedUpdates = await getUnsyncedUpdates(docId);
          if (unsyncedUpdates.length > 0) {
            for (const update of unsyncedUpdates) {
              Y.applyUpdate(ydoc, update.update);
            }
            // Save the merged state and clear unsynced updates
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
          // Initialize with default title for new document
          yTitle.insert(0, "Untitled Document");
          // Save initial state
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

      // Set initial state from Y.Doc
      setTitle(yTitle.toString());
      setContent(yContent.toString());
      isInitializedRef.current = true;
      setIsLoading(false);
      setIsDocReady(true);

      // Update unsynced count
      const count = await getUnsyncedCount(docId);
      setUnsyncedCount(count);

      // Subscribe to Y.Doc changes (from local AND remote)
      yTitle.observe(() => {
        setTitle(yTitle.toString());
      });

      yContent.observe(() => {
        setContent(yContent.toString());
      });

      // Listen for updates to track unsynced changes (for persistence)
      ydoc.on("update", async (update: Uint8Array, origin: unknown) => {
        // Track local updates only (not from tab-sync or initial load)
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

  // Save function - persists Yjs state to IndexedDB
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
      // Clear unsynced updates after successful save
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

  // Update title in CRDT
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

  // Update content in CRDT - handles cursor-aware text edits
  const updateContent = useCallback(
    (newContent: string, cursorPosition?: number) => {
      if (!yContentRef.current || !isInitializedRef.current) return;

      const yContent = yContentRef.current;
      const currentContent = yContent.toString();

      // Simple diff for single-character operations (optimized for typing)
      if (cursorPosition !== undefined) {
        const lengthDiff = newContent.length - currentContent.length;

        if (lengthDiff === 1) {
          // Single character insertion
          const insertPos = cursorPosition - 1;
          const insertedChar = newContent[insertPos];
          if (insertedChar !== undefined) {
            yContent.insert(insertPos, insertedChar);
            scheduleSave();
            return;
          }
        } else if (lengthDiff === -1) {
          // Single character deletion (backspace)
          const deletePos = cursorPosition;
          if (deletePos >= 0 && deletePos < currentContent.length) {
            yContent.delete(deletePos, 1);
            scheduleSave();
            return;
          }
        }
      }

      // Fallback: replace all content (for paste, cut, etc.)
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

  // Get the Y.Doc for external use (e.g., syncing)
  const getYDoc = useCallback(() => ydocRef.current, []);

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
          // Ignore storage errors
        }
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [documentId]);

  // Recover from sessionStorage backup on mount
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
              Y.applyUpdate(ydocRef.current, yjsState);
              await save();
            }
          }

          sessionStorage.removeItem(`backup-${documentId}`);
        }
      } catch {
        // Ignore recovery errors
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
    // Tab sync status
    isTabSyncActive,
    connectedTabs,
    tabId,
  };
}
