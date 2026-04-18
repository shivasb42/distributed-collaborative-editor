"use client";

import { useEffect, useRef } from "react";
import { useYjsDocument } from "@/hooks/use-yjs-document";
import { Save, FileText, Check, Loader2 } from "lucide-react";

const DOCUMENT_ID = "main-document";

export function DocumentEditor() {
  const {
    title,
    content,
    isLoading,
    saveStatus,
    lastSaved,
    updateTitle,
    updateContent,
    manualSave,
  } = useYjsDocument({ documentId: DOCUMENT_ID });

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
          <span>{content.length} characters</span>
          <span>{content.split(/\s+/).filter(Boolean).length} words</span>
        </div>
      </footer>
    </div>
  );
}
