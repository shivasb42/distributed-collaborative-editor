"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, FileText, Clock, Users, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface SharedDocumentSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export default function HomePage() {
  const router = useRouter();
  const [documents, setDocuments] = useState<SharedDocumentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadDocuments = useCallback(async () => {
    try {
      setError(null);
      const response = await fetch("/api/documents", { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`Failed to load documents (${response.status})`);
      }

      const data = (await response.json()) as { documents?: SharedDocumentSummary[] };
      setDocuments(Array.isArray(data.documents) ? data.documents : []);
    } catch (error) {
      console.error("Failed to load documents:", error);
      setError("Could not load shared documents.");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDocuments();
    const interval = window.setInterval(() => {
      void loadDocuments();
    }, 5000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void loadDocuments();
      }
    };

    window.addEventListener("focus", handleVisibilityChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", handleVisibilityChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [loadDocuments]);

  function createNewDocument() {
    const newId = `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    router.push(`/doc/${newId}`);
  }

  function formatDate(timestamp: number) {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="max-w-5xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold text-foreground">Documents</h1>
              <p className="text-muted-foreground mt-1">
                Collaborative documents with real-time sync
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={loadDocuments} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <Button onClick={createNewDocument} className="gap-2">
                <Plus className="h-4 w-4" />
                New Document
              </Button>
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-5xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
          </div>
        ) : error ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h2 className="text-lg font-medium text-foreground mb-2">
                Shared documents unavailable
              </h2>
              <p className="text-muted-foreground mb-4 text-center">
                {error}
              </p>
              <Button onClick={loadDocuments} className="gap-2">
                <RefreshCw className="h-4 w-4" />
                Retry
              </Button>
            </CardContent>
          </Card>
        ) : documents.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h2 className="text-lg font-medium text-foreground mb-2">
                No shared documents yet
              </h2>
              <p className="text-muted-foreground mb-4 text-center">
                Create a document on any device and it will show up here for everyone.
              </p>
              <Button onClick={createNewDocument} className="gap-2">
                <Plus className="h-4 w-4" />
                Create Shared Document
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {documents.map((doc) => (
              <Card
                key={doc.id}
                className="cursor-pointer hover:border-primary transition-colors group"
                onClick={() => router.push(`/doc/${doc.id}`)}
              >
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                        <h3 className="font-medium text-foreground truncate">
                          {doc.title || "Untitled Document"}
                        </h3>
                      </div>
                      <div className="flex items-center gap-3 mt-2 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDate(doc.updatedAt)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-3 w-3" />
                          Share link
                        </span>
                      </div>
                    </div>
                  </div>
                  <p className="text-sm text-muted-foreground mt-3 line-clamp-2 font-mono">
                    {doc.id.slice(0, 24)}...
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {/* Info section */}
        <div className="mt-12 border-t border-border pt-8">
          <h2 className="text-lg font-medium text-foreground mb-4">
            How it works
          </h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="flex gap-3">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-medium text-primary">1</span>
              </div>
              <div>
                <h3 className="font-medium text-foreground">Create</h3>
                <p className="text-sm text-muted-foreground">
                  Start a new document and get a shareable link
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-medium text-primary">2</span>
              </div>
              <div>
                <h3 className="font-medium text-foreground">Share</h3>
                <p className="text-sm text-muted-foreground">
                  Share the document URL with collaborators
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="text-sm font-medium text-primary">3</span>
              </div>
              <div>
                <h3 className="font-medium text-foreground">Collaborate</h3>
                <p className="text-sm text-muted-foreground">
                  Edit together in real-time with CRDT sync
                </p>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
