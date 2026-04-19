"use client";

import { useEffect, useRef } from "react";
import { useYjsDocument } from "@/hooks/use-yjs-document";
import {
  Save,
  FileText,
  Check,
  Loader2,
  Wifi,
  WifiOff,
  CloudOff,
  Users,
  Circle,
} from "lucide-react";

export function DocumentEditor() {
  const {
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
    // Sync status
    syncStatus,
    connectedClients,
    isConnected,
  } = useYjsDocument();

  const contentRef = useRef<HTMLTextAreaElement>(null);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateTitle(e.target.value);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const cursorPosition = e.target.selectionStart;
    updateContent(e.target.value, cursorPosition);
  };

  // Handle keyboard shortcut for save
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        manualSave();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [manualSave]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const getSyncStatusColor = () => {
    switch (syncStatus) {
      case "connected":
        return "bg-green-500";
      case "connecting":
        return "bg-amber-500 animate-pulse";
      case "error":
        return "bg-red-500";
      default:
        return "bg-muted-foreground";
    }
  };

  const getSyncStatusText = () => {
    switch (syncStatus) {
      case "connected":
        return "Synced";
      case "connecting":
        return "Connecting...";
      case "error":
        return "Sync error";
      default:
        return "Disconnected";
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <FileText className="h-5 w-5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={title}
              onChange={handleTitleChange}
              className="flex-1 bg-transparent text-lg font-medium text-foreground border-none outline-none focus:ring-0 min-w-0"
              placeholder="Document title..."
            />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {/* Connected clients indicator */}
            {isConnected && connectedClients > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-muted rounded text-xs text-muted-foreground">
                <Users className="h-3 w-3" />
                <span>
                  {connectedClients} {connectedClients === 1 ? "user" : "users"}
                </span>
              </div>
            )}

            {/* Sync status indicator */}
            <div
              className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                syncStatus === "connected"
                  ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                  : syncStatus === "connecting"
                  ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  : syncStatus === "error"
                  ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <Circle className={`h-2 w-2 ${getSyncStatusColor()}`} />
              <span>{getSyncStatusText()}</span>
            </div>

            {/* Online/Offline indicator */}
            <div
              className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                isOnline
                  ? "bg-muted text-muted-foreground"
                  : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
              }`}
            >
              {isOnline ? (
                <>
                  <Wifi className="h-3 w-3" />
                  <span>Online</span>
                </>
              ) : (
                <>
                  <WifiOff className="h-3 w-3" />
                  <span>Offline</span>
                </>
              )}
            </div>

            {/* Unsynced indicator */}
            {unsyncedCount > 0 && (
              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded text-xs">
                <CloudOff className="h-3 w-3" />
                <span>{unsyncedCount} pending</span>
              </div>
            )}

            {/* CRDT indicator */}
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-muted rounded text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span>CRDT</span>
            </div>

            {/* Save status indicator */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {saveStatus === "saving" && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>Saving...</span>
                </>
              )}
              {saveStatus === "saved" && (
                <>
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="text-green-600">Saved</span>
                </>
              )}
              {saveStatus === "idle" && lastSaved && (
                <span className="hidden sm:inline">
                  Last saved: {lastSaved.toLocaleTimeString()}
                </span>
              )}
            </div>

            {/* Manual save button */}
            <button
              onClick={manualSave}
              className="flex items-center gap-2 px-3 py-1.5 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
            >
              <Save className="h-4 w-4" />
              <span className="hidden sm:inline">Save</span>
            </button>
          </div>
        </div>
      </header>

      {/* Editor */}
      <main className="flex-1 max-w-4xl mx-auto w-full px-4 py-8">
        <textarea
          ref={contentRef}
          value={content}
          onChange={handleContentChange}
          className="w-full h-full min-h-[calc(100vh-200px)] bg-transparent text-foreground text-base leading-relaxed resize-none border-none outline-none focus:ring-0"
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
            {isConnected && (
              <span className="text-xs text-green-600 dark:text-green-400">
                Real-time sync active
              </span>
            )}
            {documentId && (
              <span
                className="text-xs font-mono truncate max-w-[200px]"
                title={documentId}
              >
                ID: {documentId}
              </span>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
