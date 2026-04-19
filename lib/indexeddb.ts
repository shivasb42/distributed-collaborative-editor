const DB_NAME = "documents-db";
const DB_VERSION = 3;
const DOCUMENTS_STORE = "documents";
const UNSYNCED_STORE = "unsynced-updates";
const META_STORE = "meta";

export interface Document {
  id: string;
  title: string;
  // Yjs state is stored as Uint8Array
  yjsState: Uint8Array;
  updatedAt: number;
  createdAt: number;
}

export interface UnsyncedUpdate {
  id: string;
  documentId: string;
  update: Uint8Array;
  timestamp: number;
}

export interface MetaData {
  key: string;
  value: string | number | boolean;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      
      // Documents store
      if (!db.objectStoreNames.contains(DOCUMENTS_STORE)) {
        db.createObjectStore(DOCUMENTS_STORE, { keyPath: "id" });
      }
      
      // Unsynced updates store - for offline support
      if (!db.objectStoreNames.contains(UNSYNCED_STORE)) {
        const unsyncedStore = db.createObjectStore(UNSYNCED_STORE, { keyPath: "id" });
        unsyncedStore.createIndex("documentId", "documentId", { unique: false });
        unsyncedStore.createIndex("timestamp", "timestamp", { unique: false });
      }
      
      // Meta store - for storing app state like current document ID
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
  });
}

// Document operations
export async function saveDocument(doc: Document): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOCUMENTS_STORE, "readwrite");
    const store = transaction.objectStore(DOCUMENTS_STORE);
    const request = store.put(doc);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getDocument(id: string): Promise<Document | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOCUMENTS_STORE, "readonly");
    const store = transaction.objectStore(DOCUMENTS_STORE);
    const request = store.get(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

export async function getAllDocuments(): Promise<Document[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(DOCUMENTS_STORE, "readonly");
    const store = transaction.objectStore(DOCUMENTS_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result || []);
  });
}

export async function deleteDocument(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction([DOCUMENTS_STORE, UNSYNCED_STORE], "readwrite");
    
    // Delete document
    const docStore = transaction.objectStore(DOCUMENTS_STORE);
    docStore.delete(id);
    
    // Delete associated unsynced updates
    const unsyncedStore = transaction.objectStore(UNSYNCED_STORE);
    const index = unsyncedStore.index("documentId");
    const cursorRequest = index.openCursor(IDBKeyRange.only(id));
    
    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

// Unsynced updates operations - for offline support
export async function addUnsyncedUpdate(
  documentId: string,
  update: Uint8Array
): Promise<string> {
  const db = await openDB();
  const id = `${documentId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(UNSYNCED_STORE, "readwrite");
    const store = transaction.objectStore(UNSYNCED_STORE);
    const request = store.put({
      id,
      documentId,
      update,
      timestamp: Date.now(),
    });

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(id);
  });
}

export async function getUnsyncedUpdates(
  documentId: string
): Promise<UnsyncedUpdate[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(UNSYNCED_STORE, "readonly");
    const store = transaction.objectStore(UNSYNCED_STORE);
    const index = store.index("documentId");
    const request = index.getAll(IDBKeyRange.only(documentId));

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const results = request.result || [];
      // Sort by timestamp
      results.sort((a, b) => a.timestamp - b.timestamp);
      resolve(results);
    };
  });
}

export async function getAllUnsyncedUpdates(): Promise<UnsyncedUpdate[]> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(UNSYNCED_STORE, "readonly");
    const store = transaction.objectStore(UNSYNCED_STORE);
    const request = store.getAll();

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const results = request.result || [];
      results.sort((a, b) => a.timestamp - b.timestamp);
      resolve(results);
    };
  });
}

export async function clearUnsyncedUpdates(documentId: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(UNSYNCED_STORE, "readwrite");
    const store = transaction.objectStore(UNSYNCED_STORE);
    const index = store.index("documentId");
    const cursorRequest = index.openCursor(IDBKeyRange.only(documentId));

    cursorRequest.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest<IDBCursorWithValue>).result;
      if (cursor) {
        cursor.delete();
        cursor.continue();
      }
    };

    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

export async function removeUnsyncedUpdate(id: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(UNSYNCED_STORE, "readwrite");
    const store = transaction.objectStore(UNSYNCED_STORE);
    const request = store.delete(id);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// Meta operations - for app state persistence
export async function setMeta(key: string, value: string | number | boolean): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(META_STORE, "readwrite");
    const store = transaction.objectStore(META_STORE);
    const request = store.put({ key, value });

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

export async function getMeta(key: string): Promise<string | number | boolean | undefined> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(META_STORE, "readonly");
    const store = transaction.objectStore(META_STORE);
    const request = store.get(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      resolve(request.result?.value);
    };
  });
}

export async function deleteMeta(key: string): Promise<void> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(META_STORE, "readwrite");
    const store = transaction.objectStore(META_STORE);
    const request = store.delete(key);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve();
  });
}

// Helper to get or create current document ID
export async function getCurrentDocumentId(): Promise<string> {
  const existingId = await getMeta("currentDocumentId");
  if (existingId && typeof existingId === "string") {
    return existingId;
  }
  
  // Generate new document ID
  const newId = `doc-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  await setMeta("currentDocumentId", newId);
  return newId;
}

export async function setCurrentDocumentId(id: string): Promise<void> {
  await setMeta("currentDocumentId", id);
}

// Count unsynced updates for a document
export async function getUnsyncedCount(documentId: string): Promise<number> {
  const updates = await getUnsyncedUpdates(documentId);
  return updates.length;
}
