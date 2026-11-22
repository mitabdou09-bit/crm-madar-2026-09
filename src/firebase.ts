import { initializeApp } from 'firebase/app';
import {
  browserLocalPersistence,
  getAuth,
  GoogleAuthProvider,
  setPersistence,
} from 'firebase/auth';
import {
  doc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  onSnapshotsInSync,
  persistentLocalCache,
  persistentMultipleTabManager,
  waitForPendingWrites,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

function createPersistentFirestore(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        localCache: persistentLocalCache({
          tabManager: persistentMultipleTabManager(),
        }),
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createPersistentFirestore();
export const auth = getAuth(app);
void setPersistence(auth, browserLocalPersistence).catch(() => {
  // Fallback safely if storage is restricted
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export const WORKSPACE_KEY = 'm1256';
export const PRIMARY_ADMIN_EMAIL = 'mitabdou09@gmail.com';

async function testConnection() {
  if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
    return;
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return;
  }
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

export function isTransientOfflineError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return true;
  }
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code || '')
      : '';
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  return (
    code === 'unavailable' ||
    msg.includes('client is offline') ||
    msg.includes('network') ||
    msg.includes('failed to get document because the client is offline')
  );
}

/**
 * Ensures Firestore mutations resolve immediately after local IndexedDB persistence
 * when offline (instead of hanging until reconnection), while awaiting full server
 * confirmation when online and catching delayed rule/validation rejections safely.
 */
export async function commitWriteOfflineSafe(
  writePromise: Promise<unknown>,
  onDelayedError?: (error: unknown) => void
): Promise<'synced' | 'queued_offline'> {
  const onlineNow = typeof navigator === 'undefined' ? true : navigator.onLine;

  if (!onlineNow) {
    writePromise.catch((err) => {
      onDelayedError?.(err);
    });
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        unsub();
        resolve();
      };
      const timer = setTimeout(done, 250);
      const unsub = onSnapshotsInSync(db, () => {
        done();
      });
    });
    return 'queued_offline';
  }

  let serverDone = false;
  const wrappedWrite = writePromise.then(() => {
    serverDone = true;
    return 'synced' as const;
  });

  // Guard against flaky/captive network ("lie-fi"): if local cache committed and server takes > 3s, treat as queued_offline
  const fallbackPromise = new Promise<'queued_offline'>((resolve) => {
    const timer = setTimeout(() => {
      if (!serverDone) {
        resolve('queued_offline');
      }
    }, 3000);
    wrappedWrite.finally(() => clearTimeout(timer)).catch(() => clearTimeout(timer));
  });

  const outcome = await Promise.race([wrappedWrite, fallbackPromise]);
  if (outcome === 'queued_offline') {
    writePromise.catch((err) => {
      onDelayedError?.(err);
    });
  }
  return outcome;
}

export async function syncPendingCloudWrites(): Promise<void> {
  await waitForPendingWrites(db);
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
