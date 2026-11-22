import { triggerBlobDownload } from './exporters';

export interface SavedFolderFileInfo {
  name: string;
  size: number;
  lastModified: number;
}

interface WritableStreamLike {
  write: (data: Blob) => Promise<void>;
  close: () => Promise<void>;
}

interface FileHandleLike {
  kind: 'file';
  name: string;
  getFile: () => Promise<File>;
  createWritable: () => Promise<WritableStreamLike>;
}

export interface DirectoryHandleLike {
  kind: 'directory';
  name: string;
  queryPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  requestPermission?: (descriptor: { mode: 'read' | 'readwrite' }) => Promise<'granted' | 'denied' | 'prompt'>;
  getFileHandle: (name: string, options?: { create?: boolean }) => Promise<FileHandleLike>;
  values: () => AsyncIterable<FileHandleLike | DirectoryHandleLike>;
}

const DB_NAME = 'madar_local_archive_db';
const STORE_NAME = 'handles';
const HANDLE_KEY = 'dawlind_directory_handle';

function openArchiveDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function isDirectoryPickerSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'showDirectoryPicker' in window &&
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function'
  );
}

export function isRunningInIframe(): boolean {
  try {
    return typeof window !== 'undefined' && window.self !== window.top;
  } catch {
    return true;
  }
}

export async function getStoredDirectoryHandle(): Promise<DirectoryHandleLike | null> {
  try {
    const db = await openArchiveDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as DirectoryHandleLike | undefined) || null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

export async function storeDirectoryHandle(handle: DirectoryHandleLike): Promise<void> {
  const db = await openArchiveDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const req = store.put(handle, HANDLE_KEY);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function clearStoredDirectoryHandle(): Promise<void> {
  try {
    const db = await openArchiveDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(HANDLE_KEY);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {
    // Ignore storage cleanup errors
  }
}

export async function pickDawlindDirectory(): Promise<{
  handle?: DirectoryHandleLike;
  blockedByIframe?: boolean;
  cancelled?: boolean;
  error?: string;
}> {
  if (!isDirectoryPickerSupported()) {
    return { error: 'unsupported' };
  }

  try {
    const picker = (
      window as unknown as {
        showDirectoryPicker: (options?: {
          id?: string;
          mode?: 'read' | 'readwrite';
        }) => Promise<DirectoryHandleLike>;
      }
    ).showDirectoryPicker;
    const handle = await picker({
      id: 'dawlind-archive',
      mode: 'readwrite',
    });
    await storeDirectoryHandle(handle);
    return { handle };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const msg = err instanceof Error ? err.message : '';
    if (name === 'AbortError') {
      return { cancelled: true };
    }
    if (name === 'SecurityError' || msg.toLowerCase().includes('cross origin sub frame')) {
      return { blockedByIframe: true };
    }
    return { error: msg || 'picker_failed' };
  }
}

export async function ensureReadWritePermission(
  handle: DirectoryHandleLike,
  promptIfNeeded: boolean
): Promise<boolean> {
  try {
    if (handle.queryPermission) {
      const state = await handle.queryPermission({ mode: 'readwrite' });
      if (state === 'granted') return true;
    }
    if (promptIfNeeded && handle.requestPermission) {
      const state = await handle.requestPermission({ mode: 'readwrite' });
      return state === 'granted';
    }
    return false;
  } catch {
    return false;
  }
}

export async function writeBlobToDirectory(
  handle: DirectoryHandleLike,
  filename: string,
  blob: Blob
): Promise<void> {
  const fileHandle = await handle.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function listDirectoryFiles(
  handle: DirectoryHandleLike
): Promise<SavedFolderFileInfo[]> {
  const files: SavedFolderFileInfo[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === 'file') {
      const file = await entry.getFile();
      files.push({
        name: entry.name,
        size: file.size,
        lastModified: file.lastModified,
      });
    }
  }
  files.sort((a, b) => b.lastModified - a.lastModified);
  return files;
}

export async function downloadFileFromDirectory(
  handle: DirectoryHandleLike,
  filename: string
): Promise<void> {
  const fileHandle = await handle.getFileHandle(filename);
  const file = await fileHandle.getFile();
  triggerBlobDownload(file, filename);
}

export function sanitizeArchiveFilename(rawTitle: string): string {
  const cleaned = rawTitle
    .trim()
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 60);
  return cleaned || 'DAWLIND_Report';
}
