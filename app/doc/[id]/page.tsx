"use client";

import { use } from "react";
import { DocumentEditorWithSync } from "@/components/document-editor-sync";

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function DocumentPage({ params }: PageProps) {
  const { id } = use(params);
  return <DocumentEditorWithSync documentId={id} />;
}
