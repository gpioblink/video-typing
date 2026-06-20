import type { StoredLocalPlayerSession } from '../types';

const DB_NAME = 'videoTypingLocalPlayer';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';

export function createLocalPlayerStorageKey(sessionId: string) {
  return `local-player:${sessionId}`;
}

export async function saveLocalPlayerSession(session: StoredLocalPlayerSession) {
  const db = await openLocalPlayerDb();

  return runTransaction(db, 'readwrite', async (store) => {
    await requestToPromise(store.put(session));
  });
}

export async function getLocalPlayerSession(id: string) {
  const db = await openLocalPlayerDb();

  return runTransaction(db, 'readonly', async (store) => {
    const session = await requestToPromise<StoredLocalPlayerSession | undefined>(store.get(id));
    return session || null;
  });
}

export async function listLocalPlayerSessions() {
  const db = await openLocalPlayerDb();

  return runTransaction(db, 'readonly', async (store) => {
    const sessions = await requestToPromise<StoredLocalPlayerSession[]>(store.getAll());
    return sessions.sort((left, right) => right.updatedAt - left.updatedAt);
  });
}

export async function touchLocalPlayerSession(id: string) {
  const session = await getLocalPlayerSession(id);

  if (!session) {
    return;
  }

  await saveLocalPlayerSession({
    ...session,
    updatedAt: Date.now(),
  });
}

export async function ensureFileHandlePermission(handle: FileSystemFileHandle) {
  const descriptor = { mode: 'read' } as const;
  const currentPermission = await handle.queryPermission(descriptor);

  if (currentPermission === 'granted') {
    return true;
  }

  return await handle.requestPermission(descriptor) === 'granted';
}

function openLocalPlayerDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function runTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const transaction = db.transaction(STORE_NAME, mode);
  const store = transaction.objectStore(STORE_NAME);

  try {
    const result = await callback(store);
    await transactionToPromise(transaction);
    return result;
  } finally {
    db.close();
  }
}

function requestToPromise<T = unknown>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}
