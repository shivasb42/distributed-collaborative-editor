"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import * as Y from "yjs";
import {
  saveDocument,
  getDocument,
  addUnsyncedUpdate,
  getUnsyncedUpdates,
  clearUnsyncedUpdates,
  type Document,
} from "@/lib/indexeddb";
import { useTabSync } from "@/hooks/use-tab-sync";
import { useWebSocketSync } from "@/hooks/use-websocket-sync";
import { usePresence } from "@/hooks/use-presence";
import { PresenceAvatars, EditingIndicator } from "@/components/presence-avatars";
import { TestPanel } from "@/components/test-panel";
import {
  Save,
  FileText,
  Check,
  Loader2,
  Wifi,
  WifiOff,
  CloudOff,
  Circle,
  RefreshCw,
  AlertCircle,
  ArrowLeft,
  Copy,
  Share2,
} from "lucide-react";
import { Button } from "@/components/ui/button";

interface DocumentEditorWithSyncProps {
  documentId: string;
}

const AUTO_SAVE_DELAY = 1000;

export function DocumentEditorWithSync({ documentId }: DocumentEditorWithSyncProps) {
  const router = useRouter();
  
  // Y.js refs
  const ydocRef = useRef<Y.Doc | null>(null);
  const yTitleRef = useRef<Y.Text | null>(null);
  const yContentRef = useRef<Y.Text | null>(null);
  
  // State
  const [title, setTitle] = useState("Untitled Document");
  const [content, setContent] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isDocReady, setIsDocReady] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [unsyncedCount, setUnsyncedCount] = useState(0);
  const [isOnline, setIsOnline] = useState(true);
  const [simulatedOffline, setSimulatedOffline] = useState(false);
  const [copied, setCopied] = useState(false);
  
  const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isInitializedRef = useRef(false);
  const contentRef = useRef<HTMLTextAreaElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const effectiveOnline = isOnline && !simulatedOffline;

  // Track online/offline status
  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);
    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  // Initialize Y.Doc
  useEffect(() => {
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;
    
    const yTitle = ydoc.getText("title");
    const yContent = ydoc.getText("content");
    yTitleRef.current = yTitle;
    yContentRef.current = yContent;

    // Load from IndexedDB
    async function loadDocument() {
      try {
        const savedDoc = await getDocument(documentId);
        
        if (savedDoc?.yjsState) {
          Y.applyUpdate(ydoc, savedDoc.yjsState, "load");
          setLastSaved(new Date(savedDoc.updatedAt));
          
          // Apply unsynced updates
          const unsyncedUpdates = await getUnsyncedUpdates(documentId);
          for (const update of unsyncedUpdates) {
            Y.applyUpdate(ydoc, update.update, "load");
          }
          if (unsyncedUpdates.length > 0) {
            await clearUnsyncedUpdates(documentId);
          }
        } else {
          // New document
          yTitle.insert(0, "Untitled Document");
        }
        
        setTitle(yTitle.toString());
        setContent(yContent.toString());
        isInitializedRef.current = true;
        setIsDocReady(true);
      } catch (error) {
        console.error("Failed to load document:", error);
        yTitle.insert(0, "Untitled Document");
        isInitializedRef.current = true;
        setIsDocReady(true);
      } finally {
        setIsLoading(false);
      }
    }
    
    loadDocument();

    // Subscribe to Y.js changes
    yTitle.observe(() => setTitle(yTitle.toString()));
    yContent.observe(() => setContent(yContent.toString()));
    
    // Track updates for persistence
    ydoc.on("update", async (update: Uint8Array, origin: unknown) => {
      if (origin !== "load" && origin !== "tab-sync" && origin !== "websocket" && isInitializedRef.current) {
        try {
          await addUnsyncedUpdate(documentId, update);
          const updates = await getUnsyncedUpdates(documentId);
          setUnsyncedCount(updates.length);
        } catch (error) {
          console.error("Failed to track update:", error);
        }
      }
    });

    return () => {
      ydoc.destroy();
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, [documentId]);

  // Tab sync (for same browser)
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
    isOffline: !effectiveOnline,
  });

  // WebSocket sync (for cross-device)
  const {
    status: wsStatus,
    connectedClients,
    error: wsError,
    reconnect: wsReconnect,
  } = useWebSocketSync({
    ydoc: isDocReady ? ydocRef.current : null,
    documentId,
    enabled: effectiveOnline,
  });

  // Presence
  const {
    currentUser,
    remoteUsers,
    updateCursor,
    updateSelection,
    clearEditing,
  } = usePresence({
    documentId,
    enabled: isDocReady,
  });

  // Save function
  const save = useCallback(async () => {
    if (!ydocRef.current || !yTitleRef.current) return;
    
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
      console.error("Failed to save:", error);
      setSaveStatus("idle");
    }
  }, [documentId]);

  // Debounced save
  const scheduleSave = useCallback(() => {
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }
    saveTimeoutRef.current = setTimeout(save, AUTO_SAVE_DELAY);
  }, [save]);

  // Update functions
  const updateTitle = useCallback((newTitle: string) => {
    if (!yTitleRef.current || !isInitializedRef.current) return;
    const yTitle = yTitleRef.current;
    ydocRef.current?.transact(() => {
      yTitle.delete(0, yTitle.length);
      yTitle.insert(0, newTitle);
    });
    scheduleSave();
  }, [scheduleSave]);

  const updateContent = useCallback((newContent: string, cursorPosition?: number) => {
    if (!yContentRef.current || !isInitializedRef.current) return;
    const yContent = yContentRef.current;
    const currentContent = yContent.toString();

    if (cursorPosition !== undefined) {
      const lengthDiff = newContent.length - currentContent.length;
      if (lengthDiff === 1) {
        const insertPos = cursorPosition - 1;
        const char = newContent[insertPos];
        if (char !== undefined) {
          yContent.insert(insertPos, char);
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
  }, [scheduleSave]);

  // Handlers
  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateTitle(e.target.value);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    updateContent(e.target.value, e.target.selectionStart);
  };

  const handleTitleFocus = () => {
    if (titleRef.current) updateCursor(titleRef.current.selectionStart, "title");
  };

  const handleTitleSelect = () => {
    if (titleRef.current) {
      updateSelection(titleRef.current.selectionStart, titleRef.current.selectionEnd, "title");
    }
  };

  const handleContentFocus = () => {
    if (contentRef.current) updateCursor(contentRef.current.selectionStart, "content");
  };

  const handleContentSelect = () => {
    if (contentRef.current) {
      updateSelection(contentRef.current.selectionStart, contentRef.current.selectionEnd, "content");
    }
  };

  const handleBlur = () => clearEditing();

  const manualSave = () => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    save();
  };

  const copyShareLink = async () => {
    const url = window.location.href;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        manualSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Test panel callbacks
  const handleSimulateOffline = useCallback(() => setSimulatedOffline(true), []);
  const handleSimulateOnline = useCallback(() => {
    setSimulatedOffline(false);
    setTimeout(() => {
      requestReconciliation();
      flushOfflineQueue();
    }, 100);
  }, [requestReconciliation, flushOfflineQueue]);

  const handleForceSync = useCallback(() => {
    requestReconciliation();
    flushOfflineQueue();
    wsReconnect();
  }, [requestReconciliation, flushOfflineQueue, wsReconnect]);

  const handleClearLocalData = useCallback(async () => {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (db.name) indexedDB.deleteDatabase(db.name);
    }
    localStorage.clear();
    window.location.reload();
  }, []);

  const handleDuplicateUpdate = useCallback(() => {
    if (ydocRef.current) {
      const state = Y.encodeStateAsUpdate(ydocRef.current);
      Y.applyUpdate(ydocRef.current, state, "test-duplicate");
    }
  }, []);

  const getStateVector = useCallback(() => {
    return ydocRef.current ? Y.encodeStateVector(ydocRef.current) : null;
  }, []);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const totalConnected = connectedTabs + connectedClients;

  const getSyncBadge = () => {
    if (simulatedOffline) {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded text-xs">
          <WifiOff className="h-3 w-3" />
          <span>Simulated Offline</span>
        </div>
      );
    }

    if (wsStatus === "connected" || connectedTabs > 0) {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded text-xs">
          <Circle className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
          <span>Live</span>
        </div>
      );
    }

    if (wsStatus === "connecting" || syncStatus.state === "syncing") {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded text-xs">
          <RefreshCw className="h-3 w-3 animate-spin" />
          <span>Connecting...</span>
        </div>
      );
    }

    if (wsStatus === "error") {
      return (
        <div className="flex items-center gap-1.5 px-2 py-1 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded text-xs">
          <AlertCircle className="h-3 w-3" />
          <span>Error</span>
        </div>
      );
    }

    return null;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => router.push("/")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
            <div className="relative flex-1 min-w-0">
              <input
                ref={titleRef}
                type="text"
                value={title}
                onChange={handleTitleChange}
                onFocus={handleTitleFocus}
                onSelect={handleTitleSelect}
                onBlur={handleBlur}
                className="w-full bg-transparent text-lg font-medium text-foreground border-none outline-none focus:ring-0"
                placeholder="Document title..."
              />
              <EditingIndicator remoteUsers={remoteUsers} field="title" />
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <PresenceAvatars currentUser={currentUser} remoteUsers={remoteUsers} />
            
            <div className="hidden sm:block">{getSyncBadge()}</div>

            {totalConnected > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-muted rounded text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                <span>{totalConnected + 1}</span>
              </div>
            )}

            {(unsyncedCount > 0 || syncStatus.pendingUpdates > 0) && (
              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded text-xs">
                <CloudOff className="h-3 w-3" />
                <span>{unsyncedCount || syncStatus.pendingUpdates} pending</span>
              </div>
            )}

            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {saveStatus === "saving" && <Loader2 className="h-4 w-4 animate-spin" />}
              {saveStatus === "saved" && <Check className="h-4 w-4 text-green-500" />}
            </div>

            <Button variant="outline" size="sm" onClick={copyShareLink} className="gap-1.5">
              {copied ? <Check className="h-3 w-3" /> : <Share2 className="h-3 w-3" />}
              <span className="hidden sm:inline">{copied ? "Copied!" : "Share"}</span>
            </Button>

            <Button size="sm" onClick={manualSave} className="gap-1.5">
              <Save className="h-3 w-3" />
              <span className="hidden sm:inline">Save</span>
            </Button>
          </div>
        </div>
      </header>

      {/* Sync Banner */}
      {effectiveOnline && totalConnected > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800">
          <div className="max-w-4xl mx-auto px-4 py-2 flex items-center justify-center gap-2 text-sm text-green-700 dark:text-green-400">
            <Circle className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
            <span>
              Real-time sync with {totalConnected} {totalConnected === 1 ? "user" : "users"}
            </span>
          </div>
        </div>
      )}

      {/* Offline Banner */}
      {!effectiveOnline && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
          <div className="max-w-4xl mx-auto px-4 py-2 flex items-center justify-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <WifiOff className="h-4 w-4" />
            <span>Offline mode. Changes saved locally.</span>
          </div>
        </div>
      )}

      {/* Editor */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8 relative">
        <EditingIndicator remoteUsers={remoteUsers} field="content" />
        <textarea
          ref={contentRef}
          value={content}
          onChange={handleContentChange}
          onFocus={handleContentFocus}
          onSelect={handleContentSelect}
          onBlur={handleBlur}
          className="w-full h-full min-h-[calc(100vh-250px)] bg-transparent text-foreground text-base leading-relaxed resize-none border-none outline-none focus:ring-0"
          placeholder="Start writing your document..."
          spellCheck
        />
      </main>

      {/* Footer */}
      <footer className="border-t border-border bg-card">
        <div className="max-w-4xl mx-auto px-4 py-2 flex items-center justify-between text-sm text-muted-foreground">
          <div className="flex items-center gap-4">
            <span>{content.length} characters</span>
            <span>{content.split(/\s+/).filter(Boolean).length} words</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-mono truncate max-w-[200px]" title={documentId}>
              {documentId}
            </span>
            <span className="text-xs">User: {currentUser.name}</span>
          </div>
        </div>
      </footer>

      {/* Test Panel */}
      <TestPanel
        documentId={documentId}
        isOnline={effectiveOnline}
        connectedTabs={totalConnected}
        unsyncedCount={unsyncedCount}
        syncStatus={syncStatus}
        onSimulateOffline={handleSimulateOffline}
        onSimulateOnline={handleSimulateOnline}
        onForceSync={handleForceSync}
        onClearLocalData={handleClearLocalData}
        onDuplicateUpdate={handleDuplicateUpdate}
        getStateVector={getStateVector}
      />
    </div>
  );
}

// Import Users icon
function Users(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}
