"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import * as Y from "yjs";
import { saveDocument, getDocument, type Document } from "@/lib/indexeddb";

const AUTO_SAVE_DELAY = 1000;

interface UseYjsDocumentOptions {
  documentId: string;
}

export function useYjsDocument({ documentId }: UseYjsDocumentOptions) {
  const ydocRef = useRef<Y.Doc | null>(null);
  const yTitleRef = useRef<Y.Text | null>(null);
  const yContentRef = useRef<Y.Text | null>(null);

  const [title, setTitle] = useState("Untitled Document");
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);

  // Initialize Y.Doc and load from IndexedDB
  useEffect(() => {
    async function initDocument() {
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
        const savedDoc = await getDocument(documentId);
        if (savedDoc && savedDoc.yjsState) {
          // Apply saved Yjs state
          Y.applyUpdate(ydoc, savedDoc.yjsState);
          setLastSaved(new Date(savedDoc.updatedAt));
        } else {
          // Initialize with default title
          yTitle.insert(0, "Untitled Document");
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

      // Subscribe to Y.Doc changes
      yTitle.observe(() => {
        setTitle(yTitle.toString());
      });

      yContent.observe(() => {
        setContent(yContent.toString());
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
  }, [documentId]);

  // Save function - persists Yjs state to IndexedDB
  const save = useCallback(async () => {
    if (!ydocRef.current || !yTitleRef.current) return;

    setSaveStatus("saving");
    try {
      const state = Y.encodeStateAsUpdate(ydocRef.current);
      const doc: Document = {
        id: documentId,
        title: yTitleRef.current.toString(),
        yjsState: state,
        updatedAt: Date.now(),
      };
      await saveDocument(doc);
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

  return {
    title,
    content,
    isLoading,
    saveStatus,
    lastSaved,
    updateTitle,
    updateContent,
    manualSave,
    getYDoc,
  };
}
