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
  Monitor,
  Circle,
  RefreshCw,
  AlertCircle,
  CloudUpload,
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
    // Tab sync status
    isTabSyncActive,
    connectedTabs,
    tabId,
    syncStatus,
    requestReconciliation,
    flushOfflineQueue,
  } = useYjsDocument();

  const contentRef = useRef<HTMLTextAreaElement>(null);

  const handleTitleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    updateTitle(e.target.value);
  };

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const cursorPosition = e.target.selectionStart;
    updateContent(e.target.value, cursorPosition);
  };

  // Keyboard shortcut for save
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

  const getSyncStatusBadge = () => {
    switch (syncStatus.state) {
      case "offline":
        return (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded text-xs">
            <WifiOff className="h-3 w-3" />
            <span>Offline</span>
          </div>
        );
      case "syncing":
        return (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded text-xs">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>Syncing...</span>
          </div>
        );
      case "reconnecting":
        return (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400 rounded text-xs">
            <RefreshCw className="h-3 w-3 animate-spin" />
            <span>Reconnecting...</span>
          </div>
        );
      case "diverged":
        return (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400 rounded text-xs">
            <AlertCircle className="h-3 w-3" />
            <span>Diverged</span>
          </div>
        );
      case "synced":
      default:
        if (connectedTabs > 0) {
          return (
            <div className="flex items-center gap-1.5 px-2 py-1 bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400 rounded text-xs">
              <Circle className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
              <span>Live</span>
            </div>
          );
        }
        return null;
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
          <div className="flex items-center gap-2 shrink-0">
            {/* Connected tabs */}
            {isTabSyncActive && (
              <div
                className={`hidden sm:flex items-center gap-1.5 px-2 py-1 rounded text-xs ${
                  connectedTabs > 0
                    ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                <Monitor className="h-3 w-3" />
                <span>
                  {connectedTabs > 0
                    ? `${connectedTabs + 1} tabs`
                    : "1 tab"}
                </span>
              </div>
            )}

            {/* Sync status */}
            <div className="hidden sm:block">{getSyncStatusBadge()}</div>

            {/* Online/Offline */}
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

            {/* Pending updates */}
            {(syncStatus.pendingUpdates > 0 || unsyncedCount > 0) && (
              <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400 rounded text-xs">
                <CloudOff className="h-3 w-3" />
                <span>{syncStatus.pendingUpdates || unsyncedCount} pending</span>
              </div>
            )}

            {/* CRDT badge */}
            <div className="hidden sm:flex items-center gap-1.5 px-2 py-1 bg-muted rounded text-xs text-muted-foreground">
              <span className="w-2 h-2 rounded-full bg-green-500" />
              <span>CRDT</span>
            </div>

            {/* Save status */}
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              {saveStatus === "saving" && (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span className="hidden sm:inline">Saving...</span>
                </>
              )}
              {saveStatus === "saved" && (
                <>
                  <Check className="h-4 w-4 text-green-500" />
                  <span className="hidden sm:inline text-green-600">Saved</span>
                </>
              )}
              {saveStatus === "idle" && lastSaved && (
                <span className="hidden md:inline text-xs">
                  {lastSaved.toLocaleTimeString()}
                </span>
              )}
            </div>

            {/* Sync button (when offline with pending) */}
            {!isOnline && syncStatus.pendingUpdates > 0 && (
              <button
                onClick={() => {
                  requestReconciliation();
                  flushOfflineQueue();
                }}
                disabled={!isOnline}
                className="flex items-center gap-2 px-3 py-1.5 bg-amber-600 text-white rounded-md text-sm font-medium hover:bg-amber-700 transition-colors disabled:opacity-50"
              >
                <CloudUpload className="h-4 w-4" />
                <span className="hidden sm:inline">Sync</span>
              </button>
            )}

            {/* Save button */}
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

      {/* Sync Banner */}
      {isTabSyncActive && connectedTabs > 0 && syncStatus.state === "synced" && (
        <div className="bg-green-50 dark:bg-green-900/20 border-b border-green-200 dark:border-green-800">
          <div className="max-w-4xl mx-auto px-4 py-2 flex items-center justify-center gap-2 text-sm text-green-700 dark:text-green-400">
            <Circle className="h-2 w-2 bg-green-500 rounded-full animate-pulse" />
            <span>
              Real-time sync with {connectedTabs} other{" "}
              {connectedTabs === 1 ? "tab" : "tabs"}
            </span>
            {syncStatus.lastSyncTime && (
              <span className="text-xs opacity-75">
                - Last sync: {syncStatus.lastSyncTime.toLocaleTimeString()}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Offline Banner */}
      {!isOnline && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border-b border-amber-200 dark:border-amber-800">
          <div className="max-w-4xl mx-auto px-4 py-2 flex items-center justify-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <WifiOff className="h-4 w-4" />
            <span>
              You are offline. Changes are saved locally and will sync when you
              reconnect.
            </span>
            {syncStatus.pendingUpdates > 0 && (
              <span className="font-medium">
                ({syncStatus.pendingUpdates} updates queued)
              </span>
            )}
          </div>
        </div>
      )}

      {/* Reconnecting Banner */}
      {syncStatus.state === "reconnecting" && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border-b border-blue-200 dark:border-blue-800">
          <div className="max-w-4xl mx-auto px-4 py-2 flex items-center justify-center gap-2 text-sm text-blue-700 dark:text-blue-400">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Reconnecting and syncing missed updates...</span>
          </div>
        </div>
      )}

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
            {isTabSyncActive && (
              <span
                className="text-xs font-mono truncate max-w-[120px]"
                title={tabId}
              >
                Tab: {tabId.slice(0, 10)}...
              </span>
            )}
            {documentId && (
              <span
                className="text-xs font-mono truncate max-w-[120px]"
                title={documentId}
              >
                Doc: {documentId.slice(0, 8)}...
              </span>
            )}
            {syncStatus.state !== "synced" && (
              <span className="text-xs">
                Status: {syncStatus.state}
              </span>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}
