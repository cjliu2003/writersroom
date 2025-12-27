/**
 * IndexedDB utilities for script-level autosave offline queue management
 *
 * Adapted from scene-level storage to handle script content_blocks instead of
 * scene content strings. Uses the same database for backward compatibility.
 */

export interface PendingScriptSave {
  id: string;
  scriptId: string;
  contentBlocks: any[];  // Changed from content: string
  baseVersion: number;
  timestamp: number;
  retryCount: number;
  opId: string;
}

const DB_NAME = 'writersroom-autosave';
const DB_VERSION = 2;  // Increment for schema change
const SCRIPT_STORE_NAME = 'pending-script-saves';  // Separate store for scripts
const SCENE_STORE_NAME = 'pending-saves';  // Keep scene store for backward compat

/**
 * Check if IndexedDB is available in this environment
 */
export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined';
  } catch {
    return false;
  }
}

/**
 * Initialize IndexedDB database with script store
 */
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Keep scene store for backward compatibility
      if (!db.objectStoreNames.contains(SCENE_STORE_NAME)) {
        const sceneStore = db.createObjectStore(SCENE_STORE_NAME, { keyPath: 'id' });
        sceneStore.createIndex('sceneId', 'sceneId', { unique: false });
        sceneStore.createIndex('timestamp', 'timestamp', { unique: false });
      }

      // Create script store for script-level saves
      if (!db.objectStoreNames.contains(SCRIPT_STORE_NAME)) {
        const scriptStore = db.createObjectStore(SCRIPT_STORE_NAME, { keyPath: 'id' });
        scriptStore.createIndex('scriptId', 'scriptId', { unique: false });
        scriptStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

/**
 * Add a pending script save to the queue
 */
export async function addPendingScriptSave(save: PendingScriptSave): Promise<void> {
  if (!isIndexedDBAvailable()) {
    console.warn('[ScriptStorage] IndexedDB not available, save not queued');
    return;
  }

  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCRIPT_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(SCRIPT_STORE_NAME);

      const request = store.put(save);
      request.onsuccess = () => {
        console.log('[ScriptStorage] Queued save:', save.id);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('[ScriptStorage] Failed to queue save:', err);
    throw err;
  }
}

/**
 * Get all pending saves for a specific script
 */
export async function getPendingScriptSaves(scriptId: string): Promise<PendingScriptSave[]> {
  if (!isIndexedDBAvailable()) {
    return [];
  }

  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCRIPT_STORE_NAME], 'readonly');
      const store = transaction.objectStore(SCRIPT_STORE_NAME);
      const index = store.index('scriptId');

      const request = index.getAll(scriptId);
      request.onsuccess = () => {
        const saves = request.result || [];
        console.log('[ScriptStorage] Retrieved pending saves:', saves.length);
        resolve(saves);
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('[ScriptStorage] Failed to get pending saves:', err);
    return [];
  }
}

/**
 * Get all pending script saves across all scripts
 */
export async function getAllPendingScriptSaves(): Promise<PendingScriptSave[]> {
  if (!isIndexedDBAvailable()) {
    return [];
  }

  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCRIPT_STORE_NAME], 'readonly');
      const store = transaction.objectStore(SCRIPT_STORE_NAME);

      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('[ScriptStorage] Failed to get all pending saves:', err);
    return [];
  }
}

/**
 * Remove a pending script save from the queue
 */
export async function removePendingScriptSave(id: string): Promise<void> {
  if (!isIndexedDBAvailable()) {
    return;
  }

  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCRIPT_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(SCRIPT_STORE_NAME);

      const request = store.delete(id);
      request.onsuccess = () => {
        console.log('[ScriptStorage] Removed save:', id);
        resolve();
      };
      request.onerror = () => reject(request.error);
    });
  } catch (err) {
    console.error('[ScriptStorage] Failed to remove save:', err);
    throw err;
  }
}

/**
 * Clear all pending saves for a specific script
 */
export async function clearPendingScriptSaves(scriptId: string): Promise<void> {
  if (!isIndexedDBAvailable()) {
    return;
  }

  try {
    const saves = await getPendingScriptSaves(scriptId);

    for (const save of saves) {
      await removePendingScriptSave(save.id);
    }

    console.log('[ScriptStorage] Cleared all pending saves for script:', scriptId);
  } catch (err) {
    console.error('[ScriptStorage] Failed to clear pending saves:', err);
    throw err;
  }
}

/**
 * Update retry count for a pending script save
 */
export async function updatePendingScriptSaveRetryCount(
  id: string,
  retryCount: number
): Promise<void> {
  if (!isIndexedDBAvailable()) {
    return;
  }

  try {
    const db = await openDB();

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([SCRIPT_STORE_NAME], 'readwrite');
      const store = transaction.objectStore(SCRIPT_STORE_NAME);

      const getRequest = store.get(id);

      getRequest.onsuccess = () => {
        const save = getRequest.result;

        if (!save) {
          resolve();
          return;
        }

        save.retryCount = retryCount;

        const putRequest = store.put(save);
        putRequest.onsuccess = () => {
          console.log('[ScriptStorage] Updated retry count:', id, retryCount);
          resolve();
        };
        putRequest.onerror = () => reject(putRequest.error);
      };

      getRequest.onerror = () => reject(getRequest.error);
    });
  } catch (err) {
    console.error('[ScriptStorage] Failed to update retry count:', err);
    throw err;
  }
}
