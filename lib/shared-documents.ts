import fs from "node:fs/promises";
import path from "node:path";
import * as Y from "yjs";

export interface SharedDocumentSummary {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}

interface SharedDocumentRecord extends SharedDocumentSummary {
  stateBase64: string;
}

interface SharedDocumentsFile {
  documents: SharedDocumentRecord[];
}

const DATA_DIR = path.join(process.cwd(), "data");
const DOCUMENTS_FILE = path.join(DATA_DIR, "shared-documents.json");

const pendingStates = new Map<string, Uint8Array>();
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
let writeQueue: Promise<void> = Promise.resolve();

function defaultFile(): SharedDocumentsFile {
  return { documents: [] };
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readFile(): Promise<SharedDocumentsFile> {
  try {
    const raw = await fs.readFile(DOCUMENTS_FILE, "utf8");
    const parsed = JSON.parse(raw) as Partial<SharedDocumentsFile>;
    if (!parsed.documents || !Array.isArray(parsed.documents)) {
      return defaultFile();
    }

    return {
      documents: parsed.documents
        .filter((document): document is SharedDocumentRecord => {
          return (
            typeof document?.id === "string" &&
            typeof document?.title === "string" &&
            typeof document?.createdAt === "number" &&
            typeof document?.updatedAt === "number" &&
            typeof document?.stateBase64 === "string"
          );
        })
        .map((document) => ({ ...document })),
    };
  } catch {
    return defaultFile();
  }
}

async function writeFile(file: SharedDocumentsFile) {
  await ensureDataDir();
  await fs.writeFile(DOCUMENTS_FILE, JSON.stringify(file, null, 2), "utf8");
}

async function queueWrite(task: () => Promise<void>) {
  writeQueue = writeQueue.then(task, task);
  return writeQueue;
}

function summarizeDocument(
  id: string,
  state: Uint8Array,
  existing?: SharedDocumentRecord
): SharedDocumentRecord {
  const ydoc = new Y.Doc();
  let title = existing?.title || "Untitled Document";

  try {
    Y.applyUpdate(ydoc, state);
    const nextTitle = ydoc.getText("title").toString().trim();
    if (nextTitle) {
      title = nextTitle;
    }
  } catch {
    // Keep the previous title if the state cannot be parsed.
  } finally {
    ydoc.destroy();
  }

  const now = Date.now();

  return {
    id,
    title,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    stateBase64: Buffer.from(state).toString("base64"),
  };
}

function scheduleFlush(documentId: string) {
  const existingTimer = pendingTimers.get(documentId);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }

  pendingTimers.set(
    documentId,
    setTimeout(() => {
      void flushDocument(documentId);
    }, 250)
  );
}

async function flushDocument(documentId: string) {
  const state = pendingStates.get(documentId);
  if (!state) {
    return;
  }

  pendingStates.delete(documentId);
  const existingTimer = pendingTimers.get(documentId);
  if (existingTimer) {
    clearTimeout(existingTimer);
    pendingTimers.delete(documentId);
  }

  await queueWrite(async () => {
    const file = await readFile();
    const existing = file.documents.find((document) => document.id === documentId);
    const record = summarizeDocument(documentId, state, existing);
    const documents = file.documents.filter((document) => document.id !== documentId);

    documents.push(record);
    documents.sort((a, b) => b.updatedAt - a.updatedAt);

    await writeFile({ documents });
  });
}

export async function listSharedDocuments(): Promise<SharedDocumentSummary[]> {
  const file = await readFile();
  return file.documents
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .map(({ stateBase64: _stateBase64, ...summary }) => summary);
}

export async function getSharedDocumentState(
  documentId: string
): Promise<Uint8Array | null> {
  const file = await readFile();
  const record = file.documents.find((document) => document.id === documentId);
  if (!record) {
    return null;
  }

  return new Uint8Array(Buffer.from(record.stateBase64, "base64"));
}

export function scheduleSharedDocumentUpdate(
  documentId: string,
  state: Uint8Array
) {
  pendingStates.set(documentId, state);
  scheduleFlush(documentId);
}
