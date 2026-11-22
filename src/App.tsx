import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut, type User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocsFromServer,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import {
  Plus,
  Search,
  Printer,
  FileSpreadsheet,
  FileText,
  Share2,
  Pencil,
  Trash2,
  Lock,
  ShieldCheck,
  MessageSquarePlus,
  Moon,
  Sun,
  UserCheck,
  Cloud,
  AlertTriangle,
  Wrench,
  PackageX,
  CheckCircle2,
  Clock,
  LogOut,
  Globe,
  HardDrive,
  RefreshCw,
  ArrowLeftRight,
  UploadCloud,
  DownloadCloud,
} from 'lucide-react';
import {
  auth,
  commitWriteOfflineSafe,
  db,
  handleFirestoreError,
  isTransientOfflineError,
  OperationType,
  PRIMARY_ADMIN_EMAIL,
  syncPendingCloudWrites,
  WORKSPACE_KEY,
} from './firebase';
import {
  CATEGORY_LABELS,
  CONDITION_LABELS,
  T,
  type Language,
} from './i18n';
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CONDITIONS,
  ORG_ASSET_STATUSES,
  type CloudBackupSnapshot,
  type EquipmentCategory,
  type EquipmentCondition,
  type EquipmentInput,
  type EquipmentItem,
  type OrgAssetStatus,
  type OrganizationAsset,
  type OrganizationAssetInput,
  type TeamNote,
} from './types';
import {
  calculateOverdueDays,
  exportToExcel,
  exportToWord,
  hasWorkshopDelay,
} from './utils/exporters';
import { EquipmentModal } from './components/EquipmentModal';
import { EquipmentDetailDrawer } from './components/EquipmentDetailDrawer';
import { PrintSheet } from './components/PrintSheet';
import { ShareModal } from './components/ShareModal';
import { BackupRestoreView } from './components/BackupRestoreView';
import { AdminAuthModal } from './components/AdminAuthModal';
import { LoginGate } from './components/LoginGate';
import { OfflineIndicator, PWAInstallControl } from './components/PWAInstallModal';
import { WorkReportArchivePanel } from './components/WorkReportArchivePanel';
import { OrgInventoryView } from './components/OrgInventoryView';
import { DateReportsCenter } from './components/DateReportsCenter';
import { MonthlyArchiveView } from './components/MonthlyArchiveView';
import { formatMonthYearLabel } from './utils/dateReports';
import { useAppUpdate } from './hooks/useAppUpdate';
import { useOnlineStatus } from './hooks/usePWAInstall';
import { BrandTitle } from './components/BrandTitle';
import {
  fetchWorkspaceSyncLockStatus,
  LOCAL_DELETED_RECORDS_KEY,
  LOCAL_LAST_SYNC_KEY,
  LOCAL_SYNC_LOCK_CACHE_KEY,
  OfflineSyncError,
  syncColleaguesWithCloud,
  SyncLockedError,
  type DeletedRecordsMap,
  type WorkspaceSyncLockStatus,
} from './utils/localCloudSync';
import {
  LOCAL_BACKUPS_KEY,
  LOCAL_ITEMS_KEY,
  LOCAL_ORG_ASSETS_KEY,
  readLocalJson,
  recordAuditLog,
  transferCloudToLocal,
  transferLocalToCloud,
  UNIFIED_WORK_MODE_KEY,
  writeLocalJson,
  type WorkMode,
} from './utils/modeTransfer';

type ActiveTab = 'dashboard' | 'monthlyArchive' | 'inventory' | 'delays' | 'exports' | 'backups';

interface ConfirmActionState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

const UNLOCKED_UID_KEY = 'madar_unlocked_uid';
const ADMIN_CACHE_KEY_PREFIX = 'madar_admin_uid_';
const ACTOR_NAME_KEY = 'madar_actor_name';
const THEME_KEY = 'madar_theme';
const LANG_KEY = 'madar_lang';

function toIsoString(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (
    val &&
    typeof val === 'object' &&
    'toDate' in val &&
    typeof (val as { toDate: () => Date }).toDate === 'function'
  ) {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string' && val) return val;
  return new Date().toISOString();
}

function makeSafeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeDateStr(val: string | undefined): string {
  if (val && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(val)) return val;
  return new Date().toISOString().slice(0, 10);
}

function sanitizeOptionalDateStr(val: unknown): string {
  if (typeof val === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(val)) return val;
  return '';
}

function sanitizeCategory(val: unknown): EquipmentCategory {
  return EQUIPMENT_CATEGORIES.includes(val as EquipmentCategory)
    ? (val as EquipmentCategory)
    : 'أخرى';
}

function sanitizeCondition(val: unknown): EquipmentCondition {
  return EQUIPMENT_CONDITIONS.includes(val as EquipmentCondition)
    ? (val as EquipmentCondition)
    : 'قيد الصيانة';
}

function mapEquipmentDoc(d: QueryDocumentSnapshot): EquipmentItem {
  const data = d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
  return {
    id: d.id,
    workspaceKey: String(data.workspaceKey || WORKSPACE_KEY),
    name: String(data.name || ''),
    equipmentNumber: String(data.equipmentNumber || ''),
    category: sanitizeCategory(data.category),
    condition: sanitizeCondition(data.condition),
    location: String(data.location || ''),
    entryDate: String(data.entryDate || ''),
    expectedExitDate: String(data.expectedExitDate || ''),
    delayServices: Boolean(data.delayServices),
    delayServicesNote: String(data.delayServicesNote || ''),
    delaySpareParts: Boolean(data.delaySpareParts),
    delaySparePartsNote: String(data.delaySparePartsNote || ''),
    delayOther: Boolean(data.delayOther),
    delayOtherNote: String(data.delayOtherNote || ''),
    finalExitDate: sanitizeOptionalDateStr(data.finalExitDate),
    teamNotes: [],
    createdByUid: String(data.createdByUid || ''),
    createdBy: String(data.createdBy || ''),
    lastUpdatedBy: String(data.lastUpdatedBy || ''),
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

function mapBackupDoc(d: QueryDocumentSnapshot): CloudBackupSnapshot {
  const data = d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
  return {
    id: d.id,
    workspaceKey: String(data.workspaceKey || WORKSPACE_KEY),
    label: String(data.label || ''),
    createdByUid: String(data.createdByUid || ''),
    createdBy: String(data.createdBy || ''),
    itemCount: typeof data.itemCount === 'number' ? data.itemCount : 0,
    items: Array.isArray(data.items) ? (data.items as EquipmentItem[]) : [],
    createdAt: toIsoString(data.createdAt),
  };
}

function mapNoteDoc(d: QueryDocumentSnapshot, fallbackEqId: string): TeamNote {
  const data = d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
  return {
    id: d.id,
    workspaceKey: String(data.workspaceKey || WORKSPACE_KEY),
    equipmentId: String(data.equipmentId || fallbackEqId),
    authorUid: String(data.authorUid || ''),
    author: String(data.author || ''),
    role: data.role === 'admin' ? 'admin' : 'member',
    text: String(data.text || ''),
    createdAt: toIsoString(data.createdAt),
  };
}

function sanitizeOrgAssetStatus(val: unknown): OrgAssetStatus {
  return ORG_ASSET_STATUSES.includes(val as OrgAssetStatus)
    ? (val as OrgAssetStatus)
    : 'يعمل - حالة جيدة';
}

function mapOrgAssetDoc(d: QueryDocumentSnapshot): OrganizationAsset {
  const data = d.data({ serverTimestamps: 'estimate' }) as Record<string, unknown>;
  return {
    id: d.id,
    workspaceKey: String(data.workspaceKey || WORKSPACE_KEY),
    name: String(data.name || ''),
    assetNumber: String(data.assetNumber || ''),
    status: sanitizeOrgAssetStatus(data.status),
    createdByUid: String(data.createdByUid || ''),
    createdBy: String(data.createdBy || ''),
    lastUpdatedBy: String(data.lastUpdatedBy || ''),
    createdAt: toIsoString(data.createdAt),
    updatedAt: toIsoString(data.updatedAt),
  };
}

export default function App() {
  const [lang, setLang] = useState<Language>(() => {
    return localStorage.getItem(LANG_KEY) === 'fr' ? 'fr' : 'ar';
  });
  const t = T[lang];
  const locale = lang === 'fr' ? 'fr-FR' : 'ar-SA';

  const { needRefresh, checkForAppUpdate, applyAppUpdate } = useAppUpdate();

  const [workMode, setWorkMode] = useState<WorkMode>(() => {
    return localStorage.getItem(UNIFIED_WORK_MODE_KEY) === 'local' ? 'local' : 'cloud';
  });

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [cloudItems, setCloudItems] = useState<EquipmentItem[]>([]);
  const [cloudOrgAssets, setCloudOrgAssets] = useState<OrganizationAsset[]>([]);
  const [cloudBackups, setCloudBackups] = useState<CloudBackupSnapshot[]>([]);
  const [selectedNotes, setSelectedNotes] = useState<TeamNote[]>([]);
  const [cloudLoading, setCloudLoading] = useState(false);

  // Local Offline Mode state (persistent in localStorage, shared with desktop bundle)
  const [localItems, setLocalItems] = useState<EquipmentItem[]>(() =>
    readLocalJson<EquipmentItem[]>(LOCAL_ITEMS_KEY, [])
  );
  const [localOrgAssets, setLocalOrgAssets] = useState<OrganizationAsset[]>(() =>
    readLocalJson<OrganizationAsset[]>(LOCAL_ORG_ASSETS_KEY, [])
  );
  const [localBackups, setLocalBackups] = useState<CloudBackupSnapshot[]>(() =>
    readLocalJson<CloudBackupSnapshot[]>(LOCAL_BACKUPS_KEY, [])
  );
  const [deletedRecords, setDeletedRecords] = useState<DeletedRecordsMap>(() =>
    readLocalJson<DeletedRecordsMap>(LOCAL_DELETED_RECORDS_KEY, {
      equipment: {},
      orgAssets: {},
    })
  );
  const [lastColleagueSyncAt, setLastColleagueSyncAt] = useState<string>(() => {
    return localStorage.getItem(LOCAL_LAST_SYNC_KEY) || '';
  });
  const [isSyncingColleagues, setIsSyncingColleagues] = useState(false);
  const [isTransferring, setIsTransferring] = useState(false);

  const isOnline = useOnlineStatus();
  const [syncConnected, setSyncConnected] = useState(false);
  const [syncFromCache, setSyncFromCache] = useState(false);
  const [hasPendingWrites, setHasPendingWrites] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<Date | null>(null);

  // Workspace Sync & Refresh Lock state (controlled by Primary Admin)
  const [syncLockState, setSyncLockState] = useState<WorkspaceSyncLockStatus>(() =>
    readLocalJson<WorkspaceSyncLockStatus>(LOCAL_SYNC_LOCK_CACHE_KEY, { locked: false })
  );

  // Firebase Auth & Workspace Unlock state
  const [authReady, setAuthReady] = useState(false);
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [actorName, setActorName] = useState<string>(() => {
    return localStorage.getItem(ACTOR_NAME_KEY) || '';
  });

  // Dark mode
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    return localStorage.getItem(THEME_KEY) === 'dark';
  });

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [conditionFilter, setConditionFilter] = useState<string>('ALL');
  const [onlyDelayed, setOnlyDelayed] = useState(false);
  const [dashboardScope, setDashboardScope] = useState<'active' | 'all'>('active');

  // Modals & Drawers
  const [isEquipmentModalOpen, setIsEquipmentModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<EquipmentItem | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [shareState, setShareState] = useState<{
    isOpen: boolean;
    items: EquipmentItem[];
    title: string;
    subtitle?: string;
  }>({ isOpen: false, items: [], title: '' });
  const [printState, setPrintState] = useState<{
    items: EquipmentItem[];
    title: string;
    subtitle?: string;
  }>({ items: [], title: '' });
  const [confirmState, setConfirmState] = useState<ConfirmActionState | null>(null);
  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const showToast = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
    setTimeout(() => {
      setToast((prev) => (prev?.text === text ? null : prev));
    }, 3500);
  }, []);

  // Sync language & direction on <html>
  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem(LANG_KEY, lang);
  }, [lang]);

  // Sync dark mode class on <html>
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem(THEME_KEY, 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem(THEME_KEY, 'light');
    }
  }, [darkMode]);

  useEffect(() => {
    if (actorName) {
      localStorage.setItem(ACTOR_NAME_KEY, actorName);
    }
  }, [actorName]);

  useEffect(() => {
    localStorage.setItem(UNIFIED_WORK_MODE_KEY, workMode);
  }, [workMode]);

  useEffect(() => {
    writeLocalJson(LOCAL_ITEMS_KEY, localItems);
  }, [localItems]);

  useEffect(() => {
    writeLocalJson(LOCAL_ORG_ASSETS_KEY, localOrgAssets);
  }, [localOrgAssets]);

  useEffect(() => {
    writeLocalJson(LOCAL_BACKUPS_KEY, localBackups);
  }, [localBackups]);

  useEffect(() => {
    writeLocalJson(LOCAL_DELETED_RECORDS_KEY, deletedRecords);
  }, [deletedRecords]);

  useEffect(() => {
    if (lastColleagueSyncAt) {
      localStorage.setItem(LOCAL_LAST_SYNC_KEY, lastColleagueSyncAt);
    }
  }, [lastColleagueSyncAt]);

  useEffect(() => {
    writeLocalJson(LOCAL_SYNC_LOCK_CACHE_KEY, syncLockState);
  }, [syncLockState]);

  // Listen to persistent Firebase Google Auth state & cloud team/admin authorization
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setIsUnlocked(false);
        setIsAdmin(false);
        setCloudItems([]);
        setCloudOrgAssets([]);
        setCloudBackups([]);
        setAuthReady(true);
        return;
      }

      const unlockedUid = localStorage.getItem(UNLOCKED_UID_KEY);
      const normalizedEmail = (user.email || '').trim().toLowerCase();

      // Instant offline startup for already-unlocked Google user
      if (typeof navigator !== 'undefined' && !navigator.onLine && unlockedUid === user.uid) {
        setActorName((prev) => prev || user.displayName || '');
        if (localStorage.getItem(`${ADMIN_CACHE_KEY_PREFIX}${user.uid}`) === '1') {
          setIsAdmin(true);
        }
        setIsUnlocked(true);
        setAuthReady(true);
        return;
      }

      try {
        const memberSnap = await getDoc(doc(db, 'teamMembers', user.uid));
        if (memberSnap.exists()) {
          const data = memberSnap.data() as { displayName?: string };
          setActorName((prev) => prev || data.displayName || user.displayName || '');
          localStorage.setItem(UNLOCKED_UID_KEY, user.uid);
          setIsUnlocked(true);
          setAuthReady(true);
          return;
        }

        const isPrimaryAdmin =
          normalizedEmail === PRIMARY_ADMIN_EMAIL.toLowerCase() && user.emailVerified;

        let isCloudAdmin = isPrimaryAdmin;
        if (!isCloudAdmin) {
          const [uidAdminSnap, emailAdminSnap] = await Promise.all([
            getDoc(doc(db, 'admins', user.uid)),
            normalizedEmail ? getDoc(doc(db, 'adminEmails', normalizedEmail)) : Promise.resolve(null),
          ]);
          isCloudAdmin = Boolean(uidAdminSnap.exists() || emailAdminSnap?.exists());
        }

        if (isCloudAdmin) {
          setActorName((prev) => prev || user.displayName || '');
          localStorage.setItem(UNLOCKED_UID_KEY, user.uid);
          localStorage.setItem(`${ADMIN_CACHE_KEY_PREFIX}${user.uid}`, '1');
          setIsUnlocked(true);
        } else {
          localStorage.removeItem(UNLOCKED_UID_KEY);
          localStorage.removeItem(`${ADMIN_CACHE_KEY_PREFIX}${user.uid}`);
          setIsUnlocked(false);
        }
      } catch {
        // Keep unlocked if this browser previously unlocked this Google UID (offline fallback)
        if (unlockedUid === user.uid) {
          setActorName((prev) => prev || user.displayName || '');
          if (localStorage.getItem(`${ADMIN_CACHE_KEY_PREFIX}${user.uid}`) === '1') {
            setIsAdmin(true);
          }
          setIsUnlocked(true);
        } else {
          setIsUnlocked(false);
        }
      }
      setAuthReady(true);
    });

    return () => unsub();
  }, []);

  // Check Admin status from primary email, /adminEmails/{email}, or legacy /admins/{uid}
  useEffect(() => {
    if (!authReady || !firebaseUser || !isUnlocked) {
      setIsAdmin(false);
      return;
    }

    const normalizedEmail = (firebaseUser.email || '').trim().toLowerCase();
    if (
      normalizedEmail === PRIMARY_ADMIN_EMAIL.toLowerCase() &&
      firebaseUser.emailVerified
    ) {
      setIsAdmin(true);
      localStorage.setItem(`${ADMIN_CACHE_KEY_PREFIX}${firebaseUser.uid}`, '1');
      return;
    }

    if (localStorage.getItem(`${ADMIN_CACHE_KEY_PREFIX}${firebaseUser.uid}`) === '1') {
      setIsAdmin(true);
    }

    let hasUidAdmin = false;
    let hasEmailAdmin = false;

    const updateCachedAdmin = (val: boolean) => {
      setIsAdmin(val);
      if (val) {
        localStorage.setItem(`${ADMIN_CACHE_KEY_PREFIX}${firebaseUser.uid}`, '1');
      } else if (typeof navigator === 'undefined' || navigator.onLine) {
        localStorage.removeItem(`${ADMIN_CACHE_KEY_PREFIX}${firebaseUser.uid}`);
      }
    };

    const adminPath = `admins/${firebaseUser.uid}`;
    const unsubUid = onSnapshot(
      doc(db, 'admins', firebaseUser.uid),
      (snap) => {
        hasUidAdmin = snap.exists();
        updateCachedAdmin(hasUidAdmin || hasEmailAdmin);
      },
      (error) => {
        if (!isTransientOfflineError(error)) {
          handleFirestoreError(error, OperationType.GET, adminPath);
        }
      }
    );

    let unsubEmail = () => {};
    if (normalizedEmail) {
      const emailPath = `adminEmails/${normalizedEmail}`;
      unsubEmail = onSnapshot(
        doc(db, 'adminEmails', normalizedEmail),
        (snap) => {
          hasEmailAdmin = snap.exists();
          updateCachedAdmin(hasUidAdmin || hasEmailAdmin);
        },
        (error) => {
          if (!isTransientOfflineError(error)) {
            handleFirestoreError(error, OperationType.GET, emailPath);
          }
        }
      );
    }

    return () => {
      unsubUid();
      unsubEmail();
    };
  }, [authReady, firebaseUser, isUnlocked]);

  // Derived Unified Mode State
  const effectiveCloudActive =
    workMode === 'cloud' && Boolean(firebaseUser) && isUnlocked;
  const items = effectiveCloudActive ? cloudItems : localItems;
  const orgAssets = effectiveCloudActive ? cloudOrgAssets : localOrgAssets;
  const backups = effectiveCloudActive ? cloudBackups : localBackups;
  const loading = effectiveCloudActive ? cloudLoading : false;
  const isPrimaryAdmin = Boolean(
    firebaseUser?.emailVerified &&
      (firebaseUser.email || '').trim().toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase()
  );
  const effectiveIsAdmin = effectiveCloudActive ? isAdmin : true;
  const isSyncActionBlocked = syncLockState.locked && !isPrimaryAdmin;

  // Real-Time Workspace Sync/Refresh Lock listener (Cloud Mode + REST poll in Local Mode)
  useEffect(() => {
    if (firebaseUser && isUnlocked) {
      const settingsRef = doc(db, 'workspaceSettings', WORKSPACE_KEY);
      const unsub = onSnapshot(
        settingsRef,
        (snap) => {
          if (!snap.exists()) {
            setSyncLockState({ locked: false });
            return;
          }
          const data = snap.data() as Record<string, unknown>;
          setSyncLockState({
            locked: Boolean(data.syncRefreshLocked),
            updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
            lockReason: typeof data.lockReason === 'string' ? data.lockReason : undefined,
            updatedAtIso: toIsoString(data.updatedAt),
          });
        },
        (error) => {
          if (!isTransientOfflineError(error)) {
            handleFirestoreError(error, OperationType.GET, `workspaceSettings/${WORKSPACE_KEY}`);
          }
        }
      );
      return () => unsub();
    }

    if (workMode === 'local' && isOnline) {
      void fetchWorkspaceSyncLockStatus()
        .then((status) => setSyncLockState(status))
        .catch(() => {
          // Keep cached lock state when offline
        });
    }
  }, [firebaseUser, isUnlocked, workMode, isOnline]);

  // Real-Time Cloud Sync via Firestore onSnapshot (runs whenever Google session is unlocked)
  useEffect(() => {
    if (!authReady || !firebaseUser || !isUnlocked) {
      setSyncConnected(false);
      setCloudLoading(false);
      return;
    }

    setCloudLoading(true);
    const eqQuery = query(
      collection(db, 'equipment'),
      where('workspaceKey', '==', WORKSPACE_KEY)
    );
    const bkpQuery = query(
      collection(db, 'backups'),
      where('workspaceKey', '==', WORKSPACE_KEY)
    );
    const orgQuery = query(
      collection(db, 'orgAssets'),
      where('workspaceKey', '==', WORKSPACE_KEY)
    );

    let eqPending = false;
    let bkpPending = false;
    let orgPending = false;
    const syncPendingFlag = () => setHasPendingWrites(eqPending || bkpPending || orgPending);

    const unsubEq = onSnapshot(
      eqQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const nextItems = snapshot.docs.map(mapEquipmentDoc);
        nextItems.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setCloudItems(nextItems);
        setCloudLoading(false);
        setSyncConnected(true);
        setSyncFromCache(snapshot.metadata.fromCache);
        eqPending = snapshot.metadata.hasPendingWrites;
        syncPendingFlag();
        if (!snapshot.metadata.fromCache && !snapshot.metadata.hasPendingWrites) {
          setLastSyncedAt(new Date());
        }
      },
      (error) => {
        setSyncConnected(false);
        setCloudLoading(false);
        if (!isTransientOfflineError(error)) {
          handleFirestoreError(error, OperationType.LIST, 'equipment');
        }
      }
    );

    const unsubBkp = onSnapshot(
      bkpQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const nextBackups = snapshot.docs.map(mapBackupDoc);
        nextBackups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setCloudBackups(nextBackups);
        bkpPending = snapshot.metadata.hasPendingWrites;
        syncPendingFlag();
      },
      (error) => {
        if (!isTransientOfflineError(error)) {
          handleFirestoreError(error, OperationType.LIST, 'backups');
        }
      }
    );

    const unsubOrg = onSnapshot(
      orgQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const nextAssets = snapshot.docs.map(mapOrgAssetDoc);
        nextAssets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setCloudOrgAssets(nextAssets);
        orgPending = snapshot.metadata.hasPendingWrites;
        syncPendingFlag();
      },
      (error) => {
        if (!isTransientOfflineError(error)) {
          handleFirestoreError(error, OperationType.LIST, 'orgAssets');
        }
      }
    );

    return () => {
      unsubEq();
      unsubBkp();
      unsubOrg();
    };
  }, [authReady, firebaseUser, isUnlocked]);

  // Automatic cloud flush notification when internet reconnects after offline work
  useEffect(() => {
    if (!authReady || !firebaseUser || !isUnlocked) return;
    const handleOnlineReconnect = () => {
      void syncPendingCloudWrites()
        .then(() => {
          setHasPendingWrites(false);
          setSyncFromCache(false);
          setSyncConnected(true);
          setLastSyncedAt(new Date());
          showToast('ok', t.backOnlineSyncedToast);
        })
        .catch(() => {
          // Firestore will retry automatically
        });
    };
    window.addEventListener('online', handleOnlineReconnect);
    return () => window.removeEventListener('online', handleOnlineReconnect);
  }, [authReady, firebaseUser, isUnlocked, showToast, t.backOnlineSyncedToast]);

  // Real-time notes subcollection listener for selected equipment drawer in Cloud Mode
  useEffect(() => {
    if (!effectiveCloudActive || !firebaseUser || !selectedItemId) {
      setSelectedNotes([]);
      return;
    }

    const notesPath = `equipment/${selectedItemId}/notes`;
    const notesQuery = query(
      collection(db, 'equipment', selectedItemId, 'notes'),
      where('workspaceKey', '==', WORKSPACE_KEY)
    );

    const unsub = onSnapshot(
      notesQuery,
      { includeMetadataChanges: true },
      (snapshot) => {
        const list = snapshot.docs.map((d) => mapNoteDoc(d, selectedItemId));
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setSelectedNotes(list);
      },
      (error) => {
        if (!isTransientOfflineError(error)) {
          handleFirestoreError(error, OperationType.LIST, notesPath);
        }
      }
    );

    return () => unsub();
  }, [effectiveCloudActive, firebaseUser, selectedItemId]);

  const handleRefreshAll = useCallback(async () => {
    if (!firebaseUser || !isUnlocked || refreshing) return;
    if (isSyncActionBlocked) {
      showToast('err', syncLockState.lockReason || t.transferLockedByAdminMsg);
      return;
    }
    setRefreshing(true);
    try {
      const eqQuery = query(
        collection(db, 'equipment'),
        where('workspaceKey', '==', WORKSPACE_KEY)
      );
      const bkpQuery = query(
        collection(db, 'backups'),
        where('workspaceKey', '==', WORKSPACE_KEY)
      );
      const orgQuery = query(
        collection(db, 'orgAssets'),
        where('workspaceKey', '==', WORKSPACE_KEY)
      );

      const [eqSnap, bkpSnap, orgSnap] = await Promise.all([
        getDocsFromServer(eqQuery),
        getDocsFromServer(bkpQuery),
        getDocsFromServer(orgQuery),
        checkForAppUpdate(),
      ]);

      const nextItems = eqSnap.docs.map(mapEquipmentDoc);
      nextItems.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setCloudItems(nextItems);

      const nextBackups = bkpSnap.docs.map(mapBackupDoc);
      nextBackups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      setCloudBackups(nextBackups);

      const nextAssets = orgSnap.docs.map(mapOrgAssetDoc);
      nextAssets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      setCloudOrgAssets(nextAssets);

      if (selectedItemId) {
        const notesQuery = query(
          collection(db, 'equipment', selectedItemId, 'notes'),
          where('workspaceKey', '==', WORKSPACE_KEY)
        );
        const notesSnap = await getDocsFromServer(notesQuery);
        const list = notesSnap.docs.map((d) => mapNoteDoc(d, selectedItemId));
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setSelectedNotes(list);
      }

      setSyncConnected(true);
      setSyncFromCache(false);
      setLastSyncedAt(new Date());
      showToast('ok', t.refreshSuccessMsg);
    } catch {
      setSyncConnected(false);
      showToast('err', t.refreshErrorMsg);
    } finally {
      setRefreshing(false);
    }
  }, [
    checkForAppUpdate,
    firebaseUser,
    isSyncActionBlocked,
    isUnlocked,
    refreshing,
    selectedItemId,
    showToast,
    syncLockState.lockReason,
    t.refreshErrorMsg,
    t.refreshSuccessMsg,
    t.transferLockedByAdminMsg,
  ]);

  const selectedItem = useMemo(() => {
    const found = items.find((i) => i.id === selectedItemId);
    if (!found) return null;
    if (effectiveCloudActive) {
      return {
        ...found,
        teamNotes: selectedNotes,
      };
    }
    return found;
  }, [items, selectedItemId, effectiveCloudActive, selectedNotes]);

  // Filtered list (active workshop excludes 'جاهزة للعمل' by default since finished items move to their entry month archive)
  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items.filter((item) => {
      if (
        dashboardScope === 'active' &&
        conditionFilter !== 'جاهزة للعمل' &&
        item.condition === 'جاهزة للعمل'
      ) {
        return false;
      }
      if (categoryFilter !== 'ALL' && item.category !== categoryFilter) return false;
      if (conditionFilter !== 'ALL' && item.condition !== conditionFilter) return false;
      if (onlyDelayed && !hasWorkshopDelay(item) && calculateOverdueDays(item) === 0) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.equipmentNumber.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q) ||
        item.delayServicesNote.toLowerCase().includes(q) ||
        item.delaySparePartsNote.toLowerCase().includes(q) ||
        item.delayOtherNote.toLowerCase().includes(q)
      );
    });
  }, [items, dashboardScope, searchQuery, categoryFilter, conditionFilter, onlyDelayed]);

  const delayedItems = useMemo(
    () => items.filter((item) => hasWorkshopDelay(item) || calculateOverdueDays(item) > 0),
    [items]
  );

  const stats = useMemo(() => {
    const ready = items.filter((i) => i.condition === 'جاهزة للعمل').length;
    const inMaint = items.filter(
      (i) => i.condition === 'قيد الصيانة' || i.condition === 'متوقفة - بانتظار'
    ).length;
    return {
      total: items.length,
      ready,
      inMaint,
      delayed: delayedItems.length,
    };
  }, [items, delayedItems]);

  const safeActor = (
    actorName.trim() ||
    firebaseUser?.displayName ||
    (lang === 'fr' ? 'Responsable PC' : 'مشرف الحاسوب')
  ).slice(0, 80);

  // Auth & Mode Handlers
  const handleUnlockSuccess = (memberName: string) => {
    if (firebaseUser) {
      localStorage.setItem(UNLOCKED_UID_KEY, firebaseUser.uid);
    }
    localStorage.setItem(ACTOR_NAME_KEY, memberName);
    setActorName(memberName);
    setIsUnlocked(true);
    setWorkMode('cloud');
  };

  const handleEnterLocalMode = () => {
    setSelectedItemId(null);
    setWorkMode('local');
    showToast('ok', t.localModeBanner);
  };

  const handleSwitchWorkMode = (targetMode: WorkMode) => {
    setSelectedItemId(null);
    setWorkMode(targetMode);
    if (targetMode === 'local') {
      showToast('ok', t.workModeLocalBadge);
    } else if (firebaseUser && isUnlocked) {
      showToast('ok', t.workModeCloudBadge);
    }
  };

  const handleOpenAdminGovernance = () => {
    if (firebaseUser && isUnlocked) {
      setIsAdminModalOpen(true);
      return;
    }
    setSelectedItemId(null);
    setWorkMode('cloud');
    showToast('err', t.primaryAdminOnlyLockNotice);
  };

  const handleAppLogout = async () => {
    localStorage.removeItem(UNLOCKED_UID_KEY);
    setIsUnlocked(false);
    setSelectedItemId(null);
    setWorkMode('cloud');
    await signOut(auth);
  };

  const handleSyncActorName = async () => {
    const trimmed = actorName.trim().slice(0, 80);
    if (!firebaseUser || !trimmed) return;
    try {
      const ref = doc(db, 'teamMembers', firebaseUser.uid);
      const snap = await getDoc(ref);
      if (snap.exists() && (snap.data() as { displayName?: string }).displayName !== trimmed) {
        await updateDoc(ref, { displayName: trimmed });
      }
    } catch {
      // Ignore transient network errors when syncing displayName
    }
  };

  // Colleague Sync (Local Mode REST cloud sync + Lock enforcement)
  const handleSyncWithColleagues = async () => {
    if (isSyncingColleagues) return;
    if (isSyncActionBlocked) {
      showToast('err', syncLockState.lockReason || t.transferLockedByAdminMsg);
      return;
    }

    setIsSyncingColleagues(true);
    try {
      const result = await syncColleaguesWithCloud({
        items: localItems,
        orgAssets: localOrgAssets,
        deletedRecords,
        actorName: safeActor,
        bypassLock: isPrimaryAdmin,
      });

      setLocalItems(result.mergedItems);
      setLocalOrgAssets(result.mergedOrgAssets);
      setDeletedRecords(result.mergedDeleted);
      setLastColleagueSyncAt(result.syncedAtIso);

      writeLocalJson(LOCAL_ITEMS_KEY, result.mergedItems);
      writeLocalJson(LOCAL_ORG_ASSETS_KEY, result.mergedOrgAssets);
      writeLocalJson(LOCAL_DELETED_RECORDS_KEY, result.mergedDeleted);

      if (firebaseUser && isUnlocked) {
        void recordAuditLog({
          db,
          firebaseUser,
          sourceMode: 'local',
          action: 'sync',
          entityType: 'equipment',
          entityId: WORKSPACE_KEY,
          entityLabel: safeActor,
          details: `uploaded=${result.uploadedCount}, downloaded=${result.downloadedCount}`,
          actorName: safeActor,
        });
      }

      showToast(
        'ok',
        lang === 'fr'
          ? `Synchronisation réussie : ${result.uploadedCount} envoyée(s), ${result.downloadedCount} reçue(s).`
          : `تمت المزامنة مع الزملاء بنجاح (تم رفع ${result.uploadedCount} وتنزيل ${result.downloadedCount}).`
      );
    } catch (err) {
      if (err instanceof SyncLockedError) {
        setSyncLockState({ locked: true, lockReason: err.message });
        showToast('err', err.message || t.transferLockedByAdminMsg);
      } else if (err instanceof OfflineSyncError) {
        showToast('err', t.syncColleaguesOffline);
      } else {
        console.error('Colleague sync error:', err);
        showToast('err', t.syncColleaguesError);
      }
    } finally {
      setIsSyncingColleagues(false);
    }
  };

  // Safe Bidirectional Transfer: Local -> Cloud (deduplicated)
  const handleTransferLocalToCloud = async () => {
    if (isTransferring) return;
    if (!firebaseUser || !isUnlocked) {
      setWorkMode('cloud');
      showToast('err', t.errCloudVerify);
      return;
    }
    if (!isOnline) {
      showToast('err', t.googleModeNeedInternet);
      return;
    }
    if (isSyncActionBlocked) {
      showToast('err', syncLockState.lockReason || t.transferLockedByAdminMsg);
      return;
    }

    setIsTransferring(true);
    try {
      const result = await transferLocalToCloud({
        db,
        firebaseUser,
        isAdmin,
        actorName: safeActor,
        localItems,
        localOrgAssets,
        cloudItems,
        cloudOrgAssets,
      });

      void recordAuditLog({
        db,
        firebaseUser,
        sourceMode: 'transfer',
        action: 'transfer_to_cloud',
        entityType: 'equipment',
        entityId: WORKSPACE_KEY,
        entityLabel: 'Local → Cloud',
        details: `+eq=${result.createdEquipment}, ~eq=${result.updatedEquipment}, notes=${result.notesUploaded}, +assets=${result.createdAssets}, ~assets=${result.updatedAssets}`,
        actorName: safeActor,
      });

      showToast(
        'ok',
        `${t.transferLocalToCloudDone} (+${result.createdEquipment + result.createdAssets}, ~${result.updatedEquipment + result.updatedAssets}, ${result.notesUploaded} notes)`
      );
    } catch (err) {
      console.error('Transfer Local->Cloud failed:', err);
      showToast('err', t.refreshErrorMsg);
    } finally {
      setIsTransferring(false);
    }
  };

  // Safe Bidirectional Transfer: Cloud -> Local (deduplicated)
  const handleTransferCloudToLocal = async () => {
    if (isTransferring) return;
    if (!firebaseUser || !isUnlocked) {
      setWorkMode('cloud');
      showToast('err', t.errCloudVerify);
      return;
    }
    if (isSyncActionBlocked) {
      showToast('err', syncLockState.lockReason || t.transferLockedByAdminMsg);
      return;
    }

    setIsTransferring(true);
    try {
      const result = await transferCloudToLocal({
        db,
        cloudItems,
        cloudOrgAssets,
        cloudBackups,
      });

      setLocalItems(result.mergedItems);
      setLocalOrgAssets(result.mergedOrgAssets);
      setLocalBackups(result.mergedBackups);

      void recordAuditLog({
        db,
        firebaseUser,
        sourceMode: 'transfer',
        action: 'transfer_to_local',
        entityType: 'equipment',
        entityId: WORKSPACE_KEY,
        entityLabel: 'Cloud → Local',
        details: `+eq=${result.addedEquipment}, ~eq=${result.updatedEquipment}, notes=${result.notesMerged}, +assets=${result.addedAssets}, ~assets=${result.updatedAssets}`,
        actorName: safeActor,
      });

      showToast(
        'ok',
        `${t.transferCloudToLocalDone} (+${result.addedEquipment + result.addedAssets}, ~${result.updatedEquipment + result.updatedAssets}, ${result.notesMerged} notes)`
      );
    } catch (err) {
      console.error('Transfer Cloud->Local failed:', err);
      showToast('err', t.refreshErrorMsg);
    } finally {
      setIsTransferring(false);
    }
  };

  // Primary Admin: Merge colleague local sync cache into main Firebase Cloud
  const handlePullLocalSyncFromAdminModal = async (
    syncedEq: EquipmentItem[],
    syncedAssets: OrganizationAsset[]
  ) => {
    if (!firebaseUser || !isUnlocked) return;
    const result = await transferLocalToCloud({
      db,
      firebaseUser,
      isAdmin: true,
      actorName: safeActor,
      localItems: syncedEq,
      localOrgAssets: syncedAssets,
      cloudItems,
      cloudOrgAssets,
    });
    await recordAuditLog({
      db,
      firebaseUser,
      sourceMode: 'admin',
      action: 'transfer_to_cloud',
      entityType: 'equipment',
      entityId: WORKSPACE_KEY,
      entityLabel: 'Local Sync Cache → Cloud',
      details: `+eq=${result.createdEquipment}, ~eq=${result.updatedEquipment}, +assets=${result.createdAssets}`,
      actorName: safeActor,
    });
    showToast(
      'ok',
      `${t.transferLocalToCloudDone} (+${result.createdEquipment + result.createdAssets}, ~${result.updatedEquipment + result.updatedAssets})`
    );
  };

  // Equipment handlers (Dual Mode: Cloud Firestore + Local PC Storage)
  const handleSaveEquipment = async (input: EquipmentInput, editingId?: string) => {
    const fallbackLocation = lang === 'fr' ? 'Atelier de maintenance' : 'ورشة الصيانة';
    const payloadBase = {
      name: input.name.trim().slice(0, 200),
      equipmentNumber: input.equipmentNumber.trim().slice(0, 80),
      category: sanitizeCategory(input.category),
      condition: sanitizeCondition(input.condition),
      location: (input.location.trim() || fallbackLocation).slice(0, 200),
      entryDate: sanitizeDateStr(input.entryDate),
      expectedExitDate: sanitizeDateStr(input.expectedExitDate),
      delayServices: Boolean(input.delayServices),
      delayServicesNote: input.delayServices ? input.delayServicesNote.trim().slice(0, 1500) : '',
      delaySpareParts: Boolean(input.delaySpareParts),
      delaySparePartsNote: input.delaySpareParts
        ? input.delaySparePartsNote.trim().slice(0, 1500)
        : '',
      delayOther: Boolean(input.delayOther),
      delayOtherNote: input.delayOther ? input.delayOtherNote.trim().slice(0, 1500) : '',
      finalExitDate: sanitizeOptionalDateStr(input.finalExitDate),
      lastUpdatedBy: safeActor,
    };

    const finishedMonthKey = payloadBase.entryDate.slice(0, 7);
    const finishedMonthLabel = formatMonthYearLabel(finishedMonthKey, lang);

    if (effectiveCloudActive && firebaseUser) {
      if (editingId) {
        const path = `equipment/${editingId}`;
        try {
          const outcome = await commitWriteOfflineSafe(
            updateDoc(doc(db, 'equipment', editingId), {
              ...payloadBase,
              updatedAt: serverTimestamp(),
            }),
            (err) => {
              if (!isTransientOfflineError(err)) {
                console.error('Delayed equipment update error:', path, err);
                showToast('err', t.errCloudVerify);
              }
            }
          );
          if (outcome === 'queued_offline') setHasPendingWrites(true);
          void recordAuditLog({
            db,
            firebaseUser,
            sourceMode: 'cloud',
            action: 'update',
            entityType: 'equipment',
            entityId: editingId,
            entityLabel: `${payloadBase.name} (${payloadBase.equipmentNumber})`,
            details: payloadBase.condition,
            actorName: safeActor,
          });
          showToast(
            'ok',
            outcome === 'queued_offline'
              ? t.offlineSavedQueuedToast
              : payloadBase.condition === 'جاهزة للعمل'
              ? `${t.monthlyArchiveMovedToastPrefix} ${finishedMonthLabel} (${finishedMonthKey}).`
              : lang === 'fr'
              ? 'Données corrigées et synchronisées dans le cloud pour toute l’équipe.'
              : 'تم تصحيح البيانات ومزامنتها سحابياً للجميع.'
          );
        } catch (err) {
          const msg = err instanceof Error && !err.message.startsWith('{') ? err.message : t.errCloudVerify;
          showToast('err', msg);
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        const newId = makeSafeId('eq');
        const path = `equipment/${newId}`;
        try {
          const outcome = await commitWriteOfflineSafe(
            setDoc(doc(db, 'equipment', newId), {
              workspaceKey: WORKSPACE_KEY,
              ...payloadBase,
              createdByUid: firebaseUser.uid,
              createdBy: safeActor,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }),
            (err) => {
              if (!isTransientOfflineError(err)) {
                console.error('Delayed equipment create error:', path, err);
                showToast('err', t.errCloudVerify);
              }
            }
          );
          if (outcome === 'queued_offline') setHasPendingWrites(true);
          void recordAuditLog({
            db,
            firebaseUser,
            sourceMode: 'cloud',
            action: 'create',
            entityType: 'equipment',
            entityId: newId,
            entityLabel: `${payloadBase.name} (${payloadBase.equipmentNumber})`,
            details: payloadBase.condition,
            actorName: safeActor,
          });
          showToast(
            'ok',
            outcome === 'queued_offline'
              ? t.offlineSavedQueuedToast
              : payloadBase.condition === 'جاهزة للعمل'
              ? `${t.monthlyArchiveMovedToastPrefix} ${finishedMonthLabel} (${finishedMonthKey}).`
              : lang === 'fr'
              ? 'Équipement ajouté et synchronisé dans le cloud pour toute l’équipe.'
              : 'تمت إضافة المعدة ومزامنتها سحابياً للجميع.'
          );
        } catch (err) {
          const msg = err instanceof Error && !err.message.startsWith('{') ? err.message : t.errCloudVerify;
          showToast('err', msg);
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      }
      return;
    }

    // Local Offline Mode
    const nowIso = new Date().toISOString();
    if (editingId) {
      setLocalItems((prev) =>
        prev
          .map((item) => (item.id === editingId ? { ...item, ...payloadBase, updatedAt: nowIso } : item))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      );
      showToast(
        'ok',
        payloadBase.condition === 'جاهزة للعمل'
          ? `${t.monthlyArchiveMovedToastPrefix} ${finishedMonthLabel} (${finishedMonthKey}).`
          : lang === 'fr'
          ? 'Données corrigées et enregistrées localement.'
          : 'تم تصحيح البيانات وحفظها محلياً.'
      );
    } else {
      const newItem: EquipmentItem = {
        id: makeSafeId('eq'),
        workspaceKey: WORKSPACE_KEY,
        ...payloadBase,
        teamNotes: [],
        createdByUid: firebaseUser?.uid || 'local_pc_user',
        createdBy: safeActor,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setLocalItems((prev) => [newItem, ...prev]);
      showToast(
        'ok',
        payloadBase.condition === 'جاهزة للعمل'
          ? `${t.monthlyArchiveMovedToastPrefix} ${finishedMonthLabel} (${finishedMonthKey}).`
          : lang === 'fr'
          ? 'Équipement ajouté et enregistré localement.'
          : 'تمت إضافة المعدة وحفظها محلياً.'
      );
    }
  };

  const handleAddNote = async (itemId: string, text: string) => {
    const trimmedText = text.trim().slice(0, 1000);
    if (!trimmedText) return;

    if (effectiveCloudActive && firebaseUser) {
      const noteId = makeSafeId('note');
      const path = `equipment/${itemId}/notes/${noteId}`;
      const targetItem = cloudItems.find((i) => i.id === itemId);
      try {
        const outcome = await commitWriteOfflineSafe(
          setDoc(doc(db, 'equipment', itemId, 'notes', noteId), {
            workspaceKey: WORKSPACE_KEY,
            equipmentId: itemId,
            authorUid: firebaseUser.uid,
            author: safeActor,
            role: isAdmin ? 'admin' : 'member',
            text: trimmedText,
            createdAt: serverTimestamp(),
          }),
          (err) => {
            if (!isTransientOfflineError(err)) handleFirestoreError(err, OperationType.CREATE, path);
          }
        );
        if (outcome === 'queued_offline') setHasPendingWrites(true);
        void recordAuditLog({
          db,
          firebaseUser,
          sourceMode: 'cloud',
          action: 'note',
          entityType: 'note',
          entityId: itemId,
          entityLabel: targetItem ? `${targetItem.name} (${targetItem.equipmentNumber})` : itemId,
          details: trimmedText.slice(0, 200),
          actorName: safeActor,
        });
        showToast(
          'ok',
          outcome === 'queued_offline'
            ? t.offlineSavedQueuedToast
            : lang === 'fr'
            ? 'Note ajoutée et synchronisée avec l’équipe.'
            : 'تمت إضافة الملاحظة ومزامنتها للفريق.'
        );
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
      return;
    }

    const nowIso = new Date().toISOString();
    const note: TeamNote = {
      id: makeSafeId('note'),
      workspaceKey: WORKSPACE_KEY,
      equipmentId: itemId,
      authorUid: firebaseUser?.uid || 'local_pc_user',
      author: safeActor,
      role: 'admin',
      text: trimmedText,
      createdAt: nowIso,
    };
    setLocalItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? {
              ...item,
              lastUpdatedBy: safeActor,
              updatedAt: nowIso,
              teamNotes: [note, ...(item.teamNotes || [])],
            }
          : item
      )
    );
    showToast('ok', lang === 'fr' ? 'Note enregistrée localement.' : 'تم حفظ الملاحظة محلياً.');
  };

  const requestDeleteItem = (item: EquipmentItem) => {
    if (effectiveCloudActive && !isAdmin) {
      setIsAdminModalOpen(true);
      return;
    }
    setConfirmState({
      title: t.deleteConfirmTitle,
      message: effectiveCloudActive
        ? lang === 'fr'
          ? `Voulez-vous supprimer définitivement "${item.name}" (${item.equipmentNumber}) de Firebase ?`
          : `هل تريد حذف "${item.name}" (${item.equipmentNumber}) نهائياً من قاعدة بيانات Firebase؟`
        : lang === 'fr'
          ? `Voulez-vous supprimer définitivement "${item.name}" (${item.equipmentNumber}) du stockage local ?`
          : `هل تريد حذف "${item.name}" (${item.equipmentNumber}) نهائياً من قاعدة البيانات المحلية؟`,
      confirmLabel: t.deleteConfirmBtn,
      onConfirm: async () => {
        if (effectiveCloudActive && firebaseUser) {
          const path = `equipment/${item.id}`;
          try {
            const outcome = await commitWriteOfflineSafe(
              deleteDoc(doc(db, 'equipment', item.id)),
              (err) => {
                if (!isTransientOfflineError(err)) handleFirestoreError(err, OperationType.DELETE, path);
              }
            );
            if (outcome === 'queued_offline') setHasPendingWrites(true);
            void recordAuditLog({
              db,
              firebaseUser,
              sourceMode: 'cloud',
              action: 'delete',
              entityType: 'equipment',
              entityId: item.id,
              entityLabel: `${item.name} (${item.equipmentNumber})`,
              details: 'Deleted from Firebase Cloud',
              actorName: safeActor,
            });
            if (selectedItemId === item.id) setSelectedItemId(null);
            showToast(
              'ok',
              outcome === 'queued_offline'
                ? t.offlineSavedQueuedToast
                : lang === 'fr'
                ? 'Équipement supprimé et synchronisé.'
                : 'تم حذف المعدة ومزامنة التحديث.'
            );
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, path);
          }
          return;
        }

        const deletedAtIso = new Date().toISOString();
        setLocalItems((prev) => prev.filter((x) => x.id !== item.id));
        setDeletedRecords((prev) => ({
          ...prev,
          equipment: { ...prev.equipment, [item.id]: deletedAtIso },
        }));
        if (selectedItemId === item.id) setSelectedItemId(null);
        showToast('ok', lang === 'fr' ? 'Équipement supprimé localement.' : 'تم حذف المعدة محلياً.');
      },
    });
  };

  // Organization Equipment Inventory Handlers (Dual Mode)
  const handleSaveOrgAsset = async (input: OrganizationAssetInput, editingId?: string) => {
    const payloadBase = {
      name: input.name.trim().slice(0, 200),
      assetNumber: input.assetNumber.trim().slice(0, 80),
      status: sanitizeOrgAssetStatus(input.status),
      lastUpdatedBy: safeActor,
    };

    if (effectiveCloudActive && firebaseUser) {
      if (editingId) {
        const path = `orgAssets/${editingId}`;
        try {
          const outcome = await commitWriteOfflineSafe(
            updateDoc(doc(db, 'orgAssets', editingId), {
              ...payloadBase,
              updatedAt: serverTimestamp(),
            }),
            (err) => {
              if (!isTransientOfflineError(err)) {
                console.error('Delayed orgAsset update error:', path, err);
                showToast('err', t.errCloudVerify);
              }
            }
          );
          if (outcome === 'queued_offline') setHasPendingWrites(true);
          void recordAuditLog({
            db,
            firebaseUser,
            sourceMode: 'cloud',
            action: 'update',
            entityType: 'orgAsset',
            entityId: editingId,
            entityLabel: `${payloadBase.name} (${payloadBase.assetNumber})`,
            details: payloadBase.status,
            actorName: safeActor,
          });
          showToast(
            'ok',
            outcome === 'queued_offline'
              ? t.offlineSavedQueuedToast
              : lang === 'fr'
              ? 'Matériel corrigé et synchronisé.'
              : 'تم تصحيح العتاد ومزامنته للجميع.'
          );
        } catch (err) {
          const msg = err instanceof Error && !err.message.startsWith('{') ? err.message : t.errCloudVerify;
          showToast('err', msg);
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else {
        const newId = makeSafeId('asset');
        const path = `orgAssets/${newId}`;
        try {
          const outcome = await commitWriteOfflineSafe(
            setDoc(doc(db, 'orgAssets', newId), {
              workspaceKey: WORKSPACE_KEY,
              ...payloadBase,
              createdByUid: firebaseUser.uid,
              createdBy: safeActor,
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
            }),
            (err) => {
              if (!isTransientOfflineError(err)) {
                console.error('Delayed orgAsset create error:', path, err);
                showToast('err', t.errCloudVerify);
              }
            }
          );
          if (outcome === 'queued_offline') setHasPendingWrites(true);
          void recordAuditLog({
            db,
            firebaseUser,
            sourceMode: 'cloud',
            action: 'create',
            entityType: 'orgAsset',
            entityId: newId,
            entityLabel: `${payloadBase.name} (${payloadBase.assetNumber})`,
            details: payloadBase.status,
            actorName: safeActor,
          });
          showToast(
            'ok',
            outcome === 'queued_offline'
              ? t.offlineSavedQueuedToast
              : lang === 'fr'
              ? 'Matériel ajouté à la liste de l’entreprise.'
              : 'تمت إضافة العتاد إلى قائمة المؤسسة.'
          );
        } catch (err) {
          const msg = err instanceof Error && !err.message.startsWith('{') ? err.message : t.errCloudVerify;
          showToast('err', msg);
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      }
      return;
    }

    const nowIso = new Date().toISOString();
    if (editingId) {
      setLocalOrgAssets((prev) =>
        prev
          .map((asset) =>
            asset.id === editingId ? { ...asset, ...payloadBase, updatedAt: nowIso } : asset
          )
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      );
      showToast(
        'ok',
        lang === 'fr' ? 'Matériel corrigé et enregistré localement.' : 'تم تصحيح العتاد وحفظه محلياً.'
      );
    } else {
      const created: OrganizationAsset = {
        id: makeSafeId('asset'),
        workspaceKey: WORKSPACE_KEY,
        ...payloadBase,
        createdByUid: firebaseUser?.uid || 'local_pc_user',
        createdBy: safeActor,
        createdAt: nowIso,
        updatedAt: nowIso,
      };
      setLocalOrgAssets((prev) => [created, ...prev]);
      showToast(
        'ok',
        lang === 'fr' ? 'Matériel ajouté à la liste locale.' : 'تمت إضافة العتاد إلى القائمة المحلية.'
      );
    }
  };

  const requestDeleteOrgAsset = (asset: OrganizationAsset) => {
    if (effectiveCloudActive && !isAdmin) {
      setIsAdminModalOpen(true);
      return;
    }
    setConfirmState({
      title: t.orgAssetDeleteTitle,
      message: effectiveCloudActive
        ? lang === 'fr'
          ? `Voulez-vous supprimer définitivement "${asset.name}" (${asset.assetNumber}) de l’inventaire ?`
          : `هل تريد حذف "${asset.name}" (${asset.assetNumber}) نهائياً من قائمة عتاد المؤسسة؟`
        : lang === 'fr'
          ? `Voulez-vous supprimer "${asset.name}" (${asset.assetNumber}) de l’inventaire local ?`
          : `هل تريد حذف "${asset.name}" (${asset.assetNumber}) من قائمة عتاد المؤسسة المحلية؟`,
      confirmLabel: t.orgAssetDeleteBtn,
      onConfirm: async () => {
        if (effectiveCloudActive && firebaseUser) {
          const path = `orgAssets/${asset.id}`;
          try {
            const outcome = await commitWriteOfflineSafe(
              deleteDoc(doc(db, 'orgAssets', asset.id)),
              (err) => {
                if (!isTransientOfflineError(err)) handleFirestoreError(err, OperationType.DELETE, path);
              }
            );
            if (outcome === 'queued_offline') setHasPendingWrites(true);
            void recordAuditLog({
              db,
              firebaseUser,
              sourceMode: 'cloud',
              action: 'delete',
              entityType: 'orgAsset',
              entityId: asset.id,
              entityLabel: `${asset.name} (${asset.assetNumber})`,
              details: 'Deleted org asset from Cloud',
              actorName: safeActor,
            });
            showToast(
              'ok',
              outcome === 'queued_offline'
                ? t.offlineSavedQueuedToast
                : lang === 'fr'
                ? 'Matériel supprimé de la liste.'
                : 'تم حذف العتاد من قائمة المؤسسة.'
            );
          } catch (err) {
            handleFirestoreError(err, OperationType.DELETE, path);
          }
          return;
        }

        const deletedAtIso = new Date().toISOString();
        setLocalOrgAssets((prev) => prev.filter((a) => a.id !== asset.id));
        setDeletedRecords((prev) => ({
          ...prev,
          orgAssets: { ...prev.orgAssets, [asset.id]: deletedAtIso },
        }));
        showToast('ok', lang === 'fr' ? 'Matériel supprimé.' : 'تم حذف العتاد.');
      },
    });
  };

  const handleCreateCloudBackup = async (label: string) => {
    const boundedItems = items.slice(0, 500).map((it) => ({
      id: it.id,
      name: it.name.slice(0, 200),
      equipmentNumber: it.equipmentNumber.slice(0, 80),
      category: it.category,
      condition: it.condition,
      location: it.location.slice(0, 200),
      entryDate: sanitizeDateStr(it.entryDate),
      expectedExitDate: sanitizeDateStr(it.expectedExitDate),
      delayServices: Boolean(it.delayServices),
      delayServicesNote: it.delayServicesNote.slice(0, 1500),
      delaySpareParts: Boolean(it.delaySpareParts),
      delaySparePartsNote: it.delaySparePartsNote.slice(0, 1500),
      delayOther: Boolean(it.delayOther),
      delayOtherNote: it.delayOtherNote.slice(0, 1500),
      finalExitDate: sanitizeOptionalDateStr(it.finalExitDate),
      createdBy: it.createdBy.slice(0, 80),
      lastUpdatedBy: it.lastUpdatedBy.slice(0, 80),
    }));

    if (effectiveCloudActive && firebaseUser) {
      const backupId = makeSafeId('bkp');
      const path = `backups/${backupId}`;
      try {
        const outcome = await commitWriteOfflineSafe(
          setDoc(doc(db, 'backups', backupId), {
            workspaceKey: WORKSPACE_KEY,
            label: label.trim().slice(0, 120) || (lang === 'fr' ? 'Sauvegarde cloud' : 'نسخة سحابية'),
            createdByUid: firebaseUser.uid,
            createdBy: safeActor,
            itemCount: boundedItems.length,
            items: boundedItems,
            createdAt: serverTimestamp(),
          }),
          (err) => {
            if (!isTransientOfflineError(err)) handleFirestoreError(err, OperationType.CREATE, path);
          }
        );
        if (outcome === 'queued_offline') {
          setHasPendingWrites(true);
          showToast('ok', t.offlineSavedQueuedToast);
        }
      } catch (err) {
        handleFirestoreError(err, OperationType.CREATE, path);
      }
      return;
    }

    const snapshot: CloudBackupSnapshot = {
      id: makeSafeId('bkp'),
      workspaceKey: WORKSPACE_KEY,
      label: label.trim().slice(0, 120) || (lang === 'fr' ? 'Sauvegarde locale' : 'نسخة محلية'),
      createdByUid: firebaseUser?.uid || 'local_pc_user',
      createdBy: safeActor,
      itemCount: items.length,
      items: items.slice(0, 500),
      createdAt: new Date().toISOString(),
    };
    setLocalBackups((prev) => [snapshot, ...prev]);
    showToast('ok', lang === 'fr' ? 'Sauvegarde locale créée.' : 'تم إنشاء نسخة احتياطية محلية.');
  };

  const applyRestoredItemsBatch = async (
    restoredItems: EquipmentItem[],
    mode: 'replace' | 'merge'
  ) => {
    if (!firebaseUser) return;
    const batch = writeBatch(db);

    if (mode === 'replace') {
      for (const existing of cloudItems) {
        batch.delete(doc(db, 'equipment', existing.id));
      }
    }

    const existingIds = new Set(cloudItems.map((i) => i.id));
    const toWrite =
      mode === 'replace'
        ? restoredItems.slice(0, 400)
        : restoredItems.filter((i) => !existingIds.has(i.id)).slice(0, 400);

    for (const raw of toWrite) {
      const docId =
        typeof raw.id === 'string' && /^[a-zA-Z0-9_-]{1,128}$/.test(raw.id)
          ? raw.id
          : makeSafeId('eq');
      batch.set(doc(db, 'equipment', docId), {
        workspaceKey: WORKSPACE_KEY,
        name: String(raw.name || (lang === 'fr' ? 'Équipement' : 'معدة')).trim().slice(0, 200),
        equipmentNumber: String(raw.equipmentNumber || 'N/A').trim().slice(0, 80),
        category: sanitizeCategory(raw.category),
        condition: sanitizeCondition(raw.condition),
        location: (
          String(raw.location || '').trim() ||
          (lang === 'fr' ? 'Atelier de maintenance' : 'ورشة الصيانة')
        ).slice(0, 200),
        entryDate: sanitizeDateStr(raw.entryDate),
        expectedExitDate: sanitizeDateStr(raw.expectedExitDate),
        delayServices: Boolean(raw.delayServices),
        delayServicesNote: String(raw.delayServicesNote || '').trim().slice(0, 1500),
        delaySpareParts: Boolean(raw.delaySpareParts),
        delaySparePartsNote: String(raw.delaySparePartsNote || '').trim().slice(0, 1500),
        delayOther: Boolean(raw.delayOther),
        delayOtherNote: String(raw.delayOtherNote || '').trim().slice(0, 1500),
        finalExitDate: sanitizeOptionalDateStr(raw.finalExitDate),
        createdByUid: firebaseUser.uid,
        createdBy: (String(raw.createdBy || safeActor).trim() || safeActor).slice(0, 80),
        lastUpdatedBy: safeActor,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    try {
      const outcome = await commitWriteOfflineSafe(batch.commit(), (err) => {
        if (!isTransientOfflineError(err)) handleFirestoreError(err, OperationType.WRITE, 'equipment');
      });
      if (outcome === 'queued_offline') {
        setHasPendingWrites(true);
        showToast('ok', t.offlineSavedQueuedToast);
      }
      void recordAuditLog({
        db,
        firebaseUser,
        sourceMode: 'cloud',
        action: 'backup_restore',
        entityType: 'backup',
        entityId: WORKSPACE_KEY,
        entityLabel: `Restore (${mode})`,
        details: `count=${toWrite.length}`,
        actorName: safeActor,
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'equipment');
    }
  };

  const handleRestoreCloudBackup = async (backupId: string) => {
    const snapshot = backups.find((b) => b.id === backupId);
    if (!snapshot) return;

    if (effectiveCloudActive && !isAdmin) {
      setIsAdminModalOpen(true);
      return;
    }

    setConfirmState({
      title: t.restoreConfirmTitle,
      message: t.restoreConfirmMsg,
      confirmLabel: t.restoreConfirmBtn,
      onConfirm: async () => {
        if (effectiveCloudActive) {
          await applyRestoredItemsBatch(snapshot.items, 'replace');
          showToast(
            'ok',
            lang === 'fr'
              ? 'Sauvegarde restaurée et synchronisée pour toute l’équipe.'
              : 'تم استرجاع النسخة الاحتياطية ومزامنتها للجميع.'
          );
          return;
        }

        const nowIso = new Date().toISOString();
        const restored = snapshot.items.map((item) => ({
          ...item,
          lastUpdatedBy: safeActor,
          updatedAt: nowIso,
        }));
        setDeletedRecords((prev) => {
          const nextEqDeleted = { ...prev.equipment };
          for (const item of restored) {
            delete nextEqDeleted[item.id];
          }
          return { ...prev, equipment: nextEqDeleted };
        });
        setLocalItems(restored);
        showToast(
          'ok',
          lang === 'fr' ? 'Sauvegarde locale restaurée.' : 'تم استرجاع النسخة الاحتياطية المحلية.'
        );
      },
    });
  };

  const handleDeleteCloudBackup = async (backupId: string) => {
    if (effectiveCloudActive) {
      if (!isAdmin) {
        setIsAdminModalOpen(true);
        return;
      }
      const path = `backups/${backupId}`;
      try {
        await deleteDoc(doc(db, 'backups', backupId));
        showToast('ok', lang === 'fr' ? 'Sauvegarde supprimée.' : 'تم حذف النسخة الاحتياطية.');
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, path);
      }
      return;
    }

    setLocalBackups((prev) => prev.filter((b) => b.id !== backupId));
    showToast('ok', lang === 'fr' ? 'Sauvegarde supprimée.' : 'تم حذف النسخة الاحتياطية.');
  };

  const handleImportJsonBackup = async (
    importedItems: EquipmentItem[],
    mode: 'replace' | 'merge'
  ) => {
    if (effectiveCloudActive) {
      if (!isAdmin) {
        setIsAdminModalOpen(true);
        return;
      }
      await applyRestoredItemsBatch(importedItems, mode);
      showToast(
        'ok',
        lang === 'fr'
          ? 'Fichier de sauvegarde restauré avec succès.'
          : 'تم استرجاع ملف النسخة الاحتياطية بنجاح.'
      );
      return;
    }

    const nowIso = new Date().toISOString();
    const normalized: EquipmentItem[] = importedItems.map((raw) => ({
      id: typeof raw.id === 'string' && raw.id ? raw.id : makeSafeId('eq'),
      workspaceKey: WORKSPACE_KEY,
      name: String(raw.name || (lang === 'fr' ? 'Équipement' : 'معدة')).slice(0, 200),
      equipmentNumber: String(raw.equipmentNumber || 'N/A').slice(0, 80),
      category: sanitizeCategory(raw.category),
      condition: sanitizeCondition(raw.condition),
      location: String(raw.location || (lang === 'fr' ? 'Atelier' : 'ورشة الصيانة')).slice(0, 200),
      entryDate: sanitizeDateStr(raw.entryDate),
      expectedExitDate: sanitizeDateStr(raw.expectedExitDate),
      delayServices: Boolean(raw.delayServices),
      delayServicesNote: String(raw.delayServicesNote || '').slice(0, 1500),
      delaySpareParts: Boolean(raw.delaySpareParts),
      delaySparePartsNote: String(raw.delaySparePartsNote || '').slice(0, 1500),
      delayOther: Boolean(raw.delayOther),
      delayOtherNote: String(raw.delayOtherNote || '').slice(0, 1500),
      finalExitDate: sanitizeOptionalDateStr(raw.finalExitDate),
      teamNotes: Array.isArray(raw.teamNotes) ? raw.teamNotes : [],
      createdByUid: firebaseUser?.uid || 'local_pc_user',
      createdBy: String(raw.createdBy || safeActor).slice(0, 80),
      lastUpdatedBy: safeActor,
      createdAt: raw.createdAt || nowIso,
      updatedAt: nowIso,
    }));

    setDeletedRecords((prev) => {
      const nextEqDeleted = { ...prev.equipment };
      for (const item of normalized) {
        delete nextEqDeleted[item.id];
      }
      return { ...prev, equipment: nextEqDeleted };
    });

    if (mode === 'replace') {
      setLocalItems(normalized);
    } else {
      setLocalItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const additions = normalized.filter((i) => !existingIds.has(i.id));
        return [...additions, ...prev];
      });
    }
    showToast(
      'ok',
      lang === 'fr' ? 'Sauvegarde importée sur votre PC.' : 'تم استرجاع النسخة الاحتياطية على الحاسوب.'
    );
  };

  const triggerPrint = (targetItems: EquipmentItem[], title: string, subtitle?: string) => {
    setPrintState({ items: targetItems, title, subtitle });
    setTimeout(() => {
      window.print();
    }, 120);
  };

  const conditionTone = (cond: EquipmentItem['condition']) => {
    switch (cond) {
      case 'جاهزة للعمل':
        return 'text-emerald-700 dark:text-emerald-400';
      case 'قيد الصيانة':
        return 'text-sky-700 dark:text-sky-400';
      case 'متوقفة - بانتظار':
        return 'text-amber-700 dark:text-amber-400';
      case 'خارجة عن الخدمة':
        return 'text-red-700 dark:text-red-400';
    }
  };

  if (workMode === 'cloud' && !authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm text-slate-600 dark:bg-slate-950 dark:text-slate-300">
        {t.initializing}
      </div>
    );
  }

  if (workMode === 'cloud' && (!firebaseUser || !isUnlocked)) {
    return (
      <>
        <LoginGate
          firebaseUser={firebaseUser}
          lang={lang}
          onChangeLang={setLang}
          onUnlockSuccess={handleUnlockSuccess}
          onEnterLocalMode={handleEnterLocalMode}
        />
        <OfflineIndicator lang={lang} />
      </>
    );
  }

  return (
    <>
      <div className="no-print min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {/* Strict 3-Zone Top Navigation Bar */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-8 px-6 py-3.5">
            <a
              href="#top"
              onClick={(e) => {
                e.preventDefault();
                setActiveTab('dashboard');
              }}
              className="shrink-0 whitespace-nowrap"
            >
              <BrandTitle className="text-2xl" />
            </a>

            <nav className="hidden items-center gap-5 text-sm font-medium md:flex">
              <button
                type="button"
                onClick={() => setActiveTab('dashboard')}
                className={`whitespace-nowrap shrink-0 border-b-2 pb-1 transition-colors ${
                  activeTab === 'dashboard'
                    ? 'border-[#0F4C81] font-bold text-[#0F4C81] dark:border-sky-400 dark:text-sky-400'
                    : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {t.navDashboard}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('monthlyArchive')}
                className={`whitespace-nowrap shrink-0 border-b-2 pb-1 transition-colors ${
                  activeTab === 'monthlyArchive'
                    ? 'border-[#0F4C81] font-bold text-[#0F4C81] dark:border-sky-400 dark:text-sky-400'
                    : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {t.navMonthlyArchive} ({stats.ready})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('inventory')}
                className={`whitespace-nowrap shrink-0 border-b-2 pb-1 transition-colors ${
                  activeTab === 'inventory'
                    ? 'border-[#0F4C81] font-bold text-[#0F4C81] dark:border-sky-400 dark:text-sky-400'
                    : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {t.navInventory}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('delays')}
                className={`whitespace-nowrap shrink-0 border-b-2 pb-1 transition-colors ${
                  activeTab === 'delays'
                    ? 'border-[#0F4C81] font-bold text-[#0F4C81] dark:border-sky-400 dark:text-sky-400'
                    : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {t.navDelays}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('exports')}
                className={`whitespace-nowrap shrink-0 border-b-2 pb-1 transition-colors ${
                  activeTab === 'exports'
                    ? 'border-[#0F4C81] font-bold text-[#0F4C81] dark:border-sky-400 dark:text-sky-400'
                    : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {t.navExports}
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('backups')}
                className={`whitespace-nowrap shrink-0 border-b-2 pb-1 transition-colors ${
                  activeTab === 'backups'
                    ? 'border-[#0F4C81] font-bold text-[#0F4C81] dark:border-sky-400 dark:text-sky-400'
                    : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >
                {t.navBackups}
              </button>
            </nav>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {!effectiveCloudActive && (
                <button
                  type="button"
                  onClick={() => void handleSyncWithColleagues()}
                  disabled={isSyncingColleagues}
                  title={
                    isSyncActionBlocked
                      ? syncLockState.lockReason || t.transferLockedByAdminMsg
                      : lastColleagueSyncAt
                      ? `${t.syncColleaguesLastPrefix} ${new Date(lastColleagueSyncAt).toLocaleString(locale)}`
                      : t.syncColleaguesBtn
                  }
                  className={`flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg border px-3.5 py-2 text-xs font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-60 ${
                    isSyncActionBlocked
                      ? 'border-amber-600 bg-amber-600 hover:bg-amber-700'
                      : 'border-emerald-600 bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {isSyncActionBlocked ? (
                    <Lock className="h-4 w-4" />
                  ) : (
                    <RefreshCw className={`h-4 w-4 ${isSyncingColleagues ? 'animate-spin' : ''}`} />
                  )}
                  {isSyncingColleagues
                    ? t.syncColleaguesSyncingBtn
                    : isSyncActionBlocked
                    ? t.syncRefreshLockedBtn
                    : t.syncColleaguesBtn}
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  setEditingItem(null);
                  setIsEquipmentModalOpen(true);
                }}
                className="flex items-center gap-1.5 whitespace-nowrap shrink-0 rounded-lg bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white transition hover:bg-[#0c3c66]"
              >
                <Plus className="h-4 w-4" />
                {t.addEquipment}
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 overflow-x-auto border-t border-slate-100 px-4 py-2 md:hidden dark:border-slate-800">
            {(
              [
                ['dashboard', t.navDashboard],
                ['monthlyArchive', `${t.navMonthlyArchive} (${stats.ready})`],
                ['inventory', t.navInventory],
                ['delays', t.navDelays],
                ['exports', t.navExports],
                ['backups', t.navBackups],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key)}
                className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold ${
                  activeTab === key
                    ? 'bg-[#0F4C81] text-white'
                    : 'text-slate-600 dark:text-slate-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </header>

        {/* Unified Workspace Bar: Mode Switcher (Local / Cloud), Transfer, Lock & Governance */}
        <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-6 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-3">
              {/* Mode Switcher */}
              <div className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => handleSwitchWorkMode('local')}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                    !effectiveCloudActive
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  <HardDrive className="h-3.5 w-3.5" />
                  {t.workModeLocalBadge}
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchWorkMode('cloud')}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                    effectiveCloudActive
                      ? 'bg-[#0F4C81] text-white shadow-sm'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  <Cloud className="h-3.5 w-3.5" />
                  {t.workModeCloudBadge}
                </button>
              </div>

              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-slate-500 dark:text-slate-400" />
                <label htmlFor="actor-name" className="text-slate-500 dark:text-slate-400">
                  {t.yourTeamName}
                </label>
                <input
                  id="actor-name"
                  type="text"
                  maxLength={80}
                  value={actorName}
                  onChange={(e) => setActorName(e.target.value)}
                  onBlur={() => void handleSyncActorName()}
                  placeholder={t.fullNamePlaceholder}
                  className="w-36 rounded-md border border-slate-300 bg-slate-50 px-2.5 py-1 text-xs font-semibold text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>

              {effectiveCloudActive ? (
                <div className="flex flex-wrap items-center gap-2 text-slate-600 dark:text-slate-300">
                  <Cloud
                    className={`h-4 w-4 ${
                      !isOnline || hasPendingWrites
                        ? 'text-amber-600 dark:text-amber-400'
                        : syncConnected
                        ? 'text-emerald-600 dark:text-emerald-400'
                        : 'text-amber-600 dark:text-amber-400'
                    }`}
                  />
                  <span className="font-medium">
                    {!isOnline
                      ? hasPendingWrites
                        ? t.firebasePendingSync
                        : t.firebaseOfflineLocal
                      : hasPendingWrites
                      ? t.firebaseSyncingNow
                      : syncConnected
                      ? syncFromCache
                        ? t.firebaseCachedSync
                        : t.firebaseConnected
                      : t.firebaseConnecting}
                  </span>
                  {firebaseUser?.email && (
                    <span
                      className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300"
                      title={t.googleLinkedBadge}
                    >
                      {t.googleLinkedBadge}{' '}
                      <span className="font-mono">{firebaseUser.email}</span>
                    </span>
                  )}
                  {lastSyncedAt && (
                    <span className="font-mono text-[11px] text-slate-400 dark:text-slate-500">
                      · {t.lastSyncedLabel}{' '}
                      {lastSyncedAt.toLocaleTimeString(locale, {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-1.5 font-medium text-emerald-700 dark:text-emerald-400">
                  <HardDrive className="h-4 w-4" />
                  <span>{t.localModeBanner}</span>
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Safe Bidirectional Transfers (Available whenever Google Cloud is unlocked) */}
              {firebaseUser && isUnlocked && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    disabled={isTransferring}
                    onClick={() => void handleTransferLocalToCloud()}
                    title={t.transferLocalToCloudBtn}
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-60 ${
                      isSyncActionBlocked
                        ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                        : 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-900/60'
                    }`}
                  >
                    {isSyncActionBlocked ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <UploadCloud className="h-3.5 w-3.5" />
                    )}
                    {t.transferLocalToCloudBtn}
                  </button>
                  <button
                    type="button"
                    disabled={isTransferring}
                    onClick={() => void handleTransferCloudToLocal()}
                    title={t.transferCloudToLocalBtn}
                    className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-[11px] font-semibold transition disabled:opacity-60 ${
                      isSyncActionBlocked
                        ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                        : 'border-teal-300 bg-teal-50 text-teal-800 hover:bg-teal-100 dark:border-teal-800 dark:bg-teal-950/40 dark:text-teal-300 dark:hover:bg-teal-900/60'
                    }`}
                  >
                    {isSyncActionBlocked ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <DownloadCloud className="h-3.5 w-3.5" />
                    )}
                    {t.transferCloudToLocalBtn}
                  </button>
                </div>
              )}

              {/* Manual Cloud + App Update Refresh Button */}
              {effectiveCloudActive && (
                <button
                  type="button"
                  disabled={refreshing}
                  onClick={() => void handleRefreshAll()}
                  title={isSyncActionBlocked ? syncLockState.lockReason || t.transferLockedByAdminMsg : t.refreshTooltip}
                  className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
                    isSyncActionBlocked
                      ? 'border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  {isSyncActionBlocked ? (
                    <Lock className="h-3.5 w-3.5" />
                  ) : (
                    <RefreshCw
                      className={`h-3.5 w-3.5 text-[#0F4C81] dark:text-sky-400 ${
                        refreshing ? 'animate-spin' : ''
                      }`}
                    />
                  )}
                  {refreshing
                    ? t.refreshingBtn
                    : isSyncActionBlocked
                    ? t.syncRefreshLockedBtn
                    : t.refreshBtn}
                </button>
              )}

              {/* Language Switcher (Arabic / French) */}
              <div className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                <Globe className="mx-1 h-3.5 w-3.5 text-slate-500 dark:text-slate-400" />
                <button
                  type="button"
                  onClick={() => setLang('ar')}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                    lang === 'ar'
                      ? 'bg-[#0F4C81] text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  العربية
                </button>
                <button
                  type="button"
                  onClick={() => setLang('fr')}
                  className={`rounded-md px-2 py-1 text-[11px] font-semibold transition ${
                    lang === 'fr'
                      ? 'bg-[#0F4C81] text-white'
                      : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                  }`}
                >
                  Français
                </button>
              </div>

              <button
                type="button"
                onClick={handleOpenAdminGovernance}
                className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  effectiveIsAdmin
                    ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                    : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                }`}
              >
                {isPrimaryAdmin ? (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {t.primaryAdminControlBtn}
                  </>
                ) : effectiveIsAdmin ? (
                  <>
                    <ShieldCheck className="h-3.5 w-3.5" />
                    {t.adminModeActive}
                  </>
                ) : (
                  <>
                    <Lock className="h-3.5 w-3.5" />
                    {t.teamModeLabel}
                  </>
                )}
              </button>

              <PWAInstallControl lang={lang} />

              <button
                type="button"
                onClick={() => setDarkMode((prev) => !prev)}
                className="rounded-lg border border-slate-300 bg-white p-1.5 text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                title={darkMode ? t.toggleThemeLight : t.toggleThemeDark}
                aria-label={darkMode ? t.toggleThemeLight : t.toggleThemeDark}
              >
                {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>

              {firebaseUser && isUnlocked && (
                <button
                  type="button"
                  onClick={() => void handleAppLogout()}
                  className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                  title={t.logoutTitle}
                >
                  <LogOut className="h-3.5 w-3.5" />
                  {t.logout}
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Sync & Refresh Lock Governance Banner */}
        {syncLockState.locked && (
          <div className="border-b border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/50">
            <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-6 py-2 text-xs">
              <div className="flex flex-wrap items-center gap-2 font-semibold text-amber-900 dark:text-amber-200">
                <Lock className="h-4 w-4 shrink-0" />
                <span>{t.syncRefreshLockedBanner}</span>
                {syncLockState.lockReason && (
                  <span className="font-normal text-amber-800 dark:text-amber-300">
                    — {syncLockState.lockReason}
                  </span>
                )}
              </div>
              {isPrimaryAdmin && (
                <button
                  type="button"
                  onClick={() => setIsAdminModalOpen(true)}
                  className="inline-flex items-center gap-1 rounded-md border border-amber-400 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-slate-900 dark:text-amber-200"
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  {t.adminTabSyncLock}
                </button>
              )}
            </div>
          </div>
        )}

        {/* PWA App Update Ready Banner */}
        {needRefresh && (
          <div className="border-b border-sky-200 bg-sky-50 dark:border-sky-900/60 dark:bg-sky-950/50">
            <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-6 py-2.5 text-xs">
              <span className="font-semibold text-sky-900 dark:text-sky-200">
                {t.appUpdateAvailable}
              </span>
              <button
                type="button"
                onClick={() => void applyAppUpdate()}
                className="flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-3 py-1.5 font-semibold text-white hover:bg-[#0c3c66]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                {t.applyUpdateNow}
              </button>
            </div>
          </div>
        )}

        {/* Main Viewport */}
        <main className="mx-auto max-w-[1440px] space-y-6 px-6 py-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="flex flex-wrap items-baseline gap-2.5 text-2xl font-bold text-slate-900 dark:text-white">
                <BrandTitle className="text-2xl" />
                <span className="text-slate-300 dark:text-slate-700">—</span>
                <span>{t.heroTitle}</span>
              </h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                {t.heroDesc}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  triggerPrint(
                    filteredItems,
                    lang === 'fr'
                      ? 'Fiche de suivi et maintenance des équipements — Rapport actuel'
                      : 'كشف متابعة وصيانة المعدات — التقرير الحالي'
                  )
                }
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Printer className="h-3.5 w-3.5" />
                {t.printPdf}
              </button>
              <button
                type="button"
                onClick={() => exportToExcel(filteredItems, undefined, lang)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Excel
              </button>
              <button
                type="button"
                onClick={() => void exportToWord(filteredItems, undefined, undefined, lang)}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <FileText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                Word
              </button>
              <button
                type="button"
                onClick={() =>
                  setShareState({
                    isOpen: true,
                    items: filteredItems,
                    title:
                      lang === 'fr'
                        ? 'Rapport de suivi et maintenance des équipements'
                        : 'تقرير متابعة وصيانة المعدات',
                  })
                }
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <Share2 className="h-3.5 w-3.5 text-[#0F4C81] dark:text-sky-400" />
                {t.shareBtn}
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('exports');
                  setTimeout(() => {
                    document
                      .getElementById('dawlind-archive-section')
                      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }, 80);
                }}
                className="flex items-center gap-1.5 rounded-lg border border-[#0F4C81]/40 bg-[#0F4C81]/5 px-3 py-2 text-xs font-semibold text-[#0F4C81] transition hover:bg-[#0F4C81]/10 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/70"
              >
                <HardDrive className="h-3.5 w-3.5" />
                {t.saveDawlindQuickBtn}
              </button>
            </div>
          </div>

          {/* 4-Column KPI Strip */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className="rounded-xl border border-slate-200 bg-white p-4 text-start transition hover:border-slate-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700"
            >
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {t.kpiTotal}
              </div>
              <div className="font-mono mt-2 text-2xl font-bold text-slate-900 dark:text-white">
                {stats.total}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('monthlyArchive')}
              className="rounded-xl border border-slate-200 bg-white p-4 text-start transition hover:border-emerald-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-emerald-800"
            >
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {t.kpiReady}
              </div>
              <div className="font-mono mt-2 text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                {stats.ready}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('dashboard')}
              className="rounded-xl border border-slate-200 bg-white p-4 text-start transition hover:border-sky-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-sky-800"
            >
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {t.kpiMaint}
              </div>
              <div className="font-mono mt-2 text-2xl font-bold text-sky-700 dark:text-sky-400">
                {stats.inMaint}
              </div>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('monthlyArchive')}
              className="rounded-xl border border-slate-200 bg-white p-4 text-start transition hover:border-teal-300 dark:border-slate-800 dark:bg-slate-900 dark:hover:border-teal-800"
            >
              <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
                {t.kpiFinishedMaint}
              </div>
              <div className="font-mono mt-2 text-2xl font-bold text-teal-600 dark:text-teal-400">
                {stats.ready}
              </div>
            </button>
          </div>

          {/* TAB 1: Main Equipment & Delay Dashboard */}
          {activeTab === 'dashboard' && (
            <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/70 px-4 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950/50">
                <span className="text-slate-600 dark:text-slate-300">
                  {t.dashboardArchiveNotice}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="inline-flex rounded-lg border border-slate-300 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                    <button
                      type="button"
                      onClick={() => setDashboardScope('active')}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                        dashboardScope === 'active'
                          ? 'bg-[#0F4C81] text-white'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                      }`}
                    >
                      {t.dashboardActiveOnlyBtn}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDashboardScope('all')}
                      className={`rounded-md px-2.5 py-1 text-[11px] font-semibold transition ${
                        dashboardScope === 'all'
                          ? 'bg-[#0F4C81] text-white'
                          : 'text-slate-600 hover:text-slate-900 dark:text-slate-300'
                      }`}
                    >
                      {t.dashboardAllBtn}
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveTab('monthlyArchive')}
                    className="rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                  >
                    {t.openMonthlyArchiveBtn} ({stats.ready})
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
                <div className="relative min-w-[240px] flex-1">
                  <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={t.searchPlaceholder}
                    className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 ps-9 pe-3 text-sm text-slate-900 focus:border-[#0F4C81] focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                <select
                  value={categoryFilter}
                  onChange={(e) => setCategoryFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                >
                  <option value="ALL">{t.allCategories}</option>
                  {EQUIPMENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[lang][c]}
                    </option>
                  ))}
                </select>

                <select
                  value={conditionFilter}
                  onChange={(e) => setConditionFilter(e.target.value)}
                  className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
                >
                  <option value="ALL">{t.allConditions}</option>
                  {EQUIPMENT_CONDITIONS.map((cond) => (
                    <option key={cond} value={cond}>
                      {CONDITION_LABELS[lang][cond]}
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => setOnlyDelayed((prev) => !prev)}
                  className={`rounded-lg border px-3 py-2 text-xs font-semibold transition ${
                    onlyDelayed
                      ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-950/50 dark:text-red-300'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200'
                  }`}
                >
                  {t.delayedOnlyBtn} ({stats.delayed})
                </button>
              </div>

              {loading ? (
                <div className="space-y-3 p-6">
                  {[1, 2, 3].map((row) => (
                    <div
                      key={row}
                      className="h-14 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
                    />
                  ))}
                </div>
              ) : filteredItems.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {items.length === 0 ? t.emptyTitle : t.emptySearchTitle}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {items.length === 0 ? t.emptyDesc : t.emptySearchDesc}
                  </p>
                  {items.length === 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingItem(null);
                        setIsEquipmentModalOpen(true);
                      }}
                      className="mt-4 inline-flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c3c66]"
                    >
                      <Plus className="h-4 w-4" />
                      {t.addFirstEquipment}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setCategoryFilter('ALL');
                        setConditionFilter('ALL');
                        setOnlyDelayed(false);
                      }}
                      className="mt-4 rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                    >
                      {t.resetFilters}
                    </button>
                  )}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-start text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                        <th className="px-4 py-3 text-start">{t.thEquipmentNum}</th>
                        <th className="px-4 py-3 text-start">{t.thCatCond}</th>
                        <th className="px-4 py-3 text-start">{t.thDelays}</th>
                        <th className="px-4 py-3 text-start">{t.thTeamWrite}</th>
                        <th className="px-4 py-3 text-end">{t.thActions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {filteredItems.map((item) => {
                        const overdueDays = calculateOverdueDays(item);
                        const hasDelay = hasWorkshopDelay(item);
                        return (
                          <tr
                            key={item.id}
                            className="align-top transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                          >
                            <td className="px-4 py-3.5 text-start">
                              <button
                                type="button"
                                onClick={() => setSelectedItemId(item.id)}
                                className="text-start font-semibold text-slate-900 hover:text-[#0F4C81] dark:text-white dark:hover:text-sky-400"
                              >
                                {item.name}
                              </button>
                              <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-mono font-semibold text-[#0F4C81] dark:text-sky-400">
                                  {item.equipmentNumber}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{item.location}</span>
                              </div>
                            </td>

                            <td className="px-4 py-3.5 text-start">
                              <div className="text-xs text-slate-600 dark:text-slate-300">
                                {CATEGORY_LABELS[lang][item.category]}
                              </div>
                              <div
                                className={`mt-1 flex items-center gap-1.5 text-xs font-bold ${conditionTone(
                                  item.condition
                                )}`}
                              >
                                {item.condition === 'جاهزة للعمل' ? (
                                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                ) : (
                                  <Clock className="h-3.5 w-3.5 shrink-0" />
                                )}
                                <span>{CONDITION_LABELS[lang][item.condition]}</span>
                              </div>
                              {overdueDays > 0 && (
                                <div className="font-mono mt-1 text-[11px] font-semibold text-red-600 dark:text-red-400">
                                  {t.overdueDaysPrefix} {overdueDays} {t.dayUnit}
                                </div>
                              )}
                            </td>

                            <td className="max-w-md px-4 py-3.5 text-start">
                              {!hasDelay ? (
                                <span className="text-xs text-slate-400 dark:text-slate-500">
                                  {t.noDelaysRecorded}
                                </span>
                              ) : (
                                <div className="space-y-1.5 text-xs">
                                  {item.delayServices && (
                                    <div className="flex items-start gap-1.5 text-slate-800 dark:text-slate-200">
                                      <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                      <div>
                                        <span className="font-semibold">
                                          {t.delayServicesLabel}{' '}
                                        </span>
                                        <span className="text-slate-600 dark:text-slate-300">
                                          {item.delayServicesNote || t.selectedNoDetails}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                  {item.delaySpareParts && (
                                    <div className="flex items-start gap-1.5 text-slate-800 dark:text-slate-200">
                                      <PackageX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                                      <div>
                                        <span className="font-semibold">
                                          {t.delaySparePartsLabel}{' '}
                                        </span>
                                        <span className="text-slate-600 dark:text-slate-300">
                                          {item.delaySparePartsNote || t.selectedNoDetails}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                  {item.delayOther && (
                                    <div className="flex items-start gap-1.5 text-slate-800 dark:text-slate-200">
                                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-500 dark:text-slate-400" />
                                      <div>
                                        <span className="font-semibold">{t.delayOtherLabel} </span>
                                        <span className="text-slate-600 dark:text-slate-300">
                                          {item.delayOtherNote || t.selectedNoDetails}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                  {item.finalExitDate && (
                                    <div className="flex items-center gap-1.5 pt-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                      <span>{t.finalExitDateLabel}:</span>
                                      <span className="font-mono">{item.finalExitDate}</span>
                                    </div>
                                  )}
                                </div>
                              )}
                            </td>

                            <td className="px-4 py-3.5 text-start">
                              <div className="text-xs font-medium text-slate-800 dark:text-slate-200">
                                {item.lastUpdatedBy}
                              </div>
                              <div className="font-mono mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                {new Date(item.updatedAt).toLocaleDateString(locale)}
                              </div>
                              <button
                                type="button"
                                onClick={() => setSelectedItemId(item.id)}
                                className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-[#0F4C81] hover:underline dark:text-sky-400"
                              >
                                <MessageSquarePlus className="h-3.5 w-3.5" />
                                {t.openTeamNotes}
                              </button>
                            </td>

                            <td className="px-4 py-3.5 text-end">
                              <div className="flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingItem(item);
                                    setIsEquipmentModalOpen(true);
                                  }}
                                  className="rounded-md border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                  title={t.editTooltip}
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    triggerPrint(
                                      [item],
                                      lang === 'fr'
                                        ? `Fiche maintenance : ${item.name} (${item.equipmentNumber})`
                                        : `ورقة صيانة: ${item.name} (${item.equipmentNumber})`
                                    )
                                  }
                                  className="rounded-md border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                  title={t.printTooltip}
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setShareState({
                                      isOpen: true,
                                      items: [item],
                                      title:
                                        lang === 'fr'
                                          ? `Fiche maintenance : ${item.name}`
                                          : `ورقة صيانة: ${item.name}`,
                                    })
                                  }
                                  className="rounded-md border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                  title={t.shareTooltip}
                                >
                                  <Share2 className="h-3.5 w-3.5" />
                                </button>
                                {effectiveIsAdmin ? (
                                  <button
                                    type="button"
                                    onClick={() => requestDeleteItem(item)}
                                    className="rounded-md border border-red-200 p-1.5 text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/50"
                                    title={t.deleteTooltip}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={handleOpenAdminGovernance}
                                    className="rounded-md border border-slate-200 p-1.5 text-slate-400 transition hover:bg-slate-100 dark:border-slate-800 dark:text-slate-600 dark:hover:bg-slate-800"
                                    title={t.deleteLockedTooltip}
                                  >
                                    <Lock className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}

          {/* TAB 2: Dedicated Workshop Delays View */}
          {activeTab === 'delays' && (
            <section className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-white">
                    {t.delaysTabTitle}
                  </h2>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {t.delaysTabDesc}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      triggerPrint(
                        delayedItems,
                        lang === 'fr'
                          ? 'Rapport des équipements en retard de sortie d’atelier'
                          : 'تقرير المعدات المتأخرة عن الخروج من ورشة الصيانة'
                      )
                    }
                    className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    {t.printDelayed}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setShareState({
                        isOpen: true,
                        items: delayedItems,
                        title:
                          lang === 'fr'
                            ? 'Rapport des équipements en retard d’atelier'
                            : 'تقرير المعدات المتأخرة عن الخروج من الورشة',
                      })
                    }
                    className="flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-3 py-2 text-xs font-semibold text-white hover:bg-[#0c3c66]"
                  >
                    <Share2 className="h-3.5 w-3.5" />
                    {t.shareDelayed}
                  </button>
                </div>
              </div>

              {delayedItems.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-12 text-center text-sm text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                  {t.noDelayedNow}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                  {delayedItems.map((item) => (
                    <div
                      key={item.id}
                      className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="flex items-start justify-between gap-4 border-b border-slate-100 pb-3 dark:border-slate-800">
                        <div>
                          <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-mono font-bold text-[#0F4C81] dark:text-sky-400">
                              {item.equipmentNumber}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{CATEGORY_LABELS[lang][item.category]}</span>
                            <span aria-hidden="true">·</span>
                            <span className={conditionTone(item.condition)}>
                              {CONDITION_LABELS[lang][item.condition]}
                            </span>
                          </div>
                          <h3 className="mt-1 text-base font-bold text-slate-900 dark:text-white">
                            {item.name}
                          </h3>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setEditingItem(item);
                            setIsEquipmentModalOpen(true);
                          }}
                          className="shrink-0 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                        >
                          {t.editWriteReason}
                        </button>
                      </div>

                      <div className="mt-4 space-y-3 text-sm">
                        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950/60">
                          <div className="flex items-center gap-2 text-xs font-bold text-amber-700 dark:text-amber-400">
                            <Wrench className="h-3.5 w-3.5" />
                            {t.delayServicesLabel} {item.delayServices ? t.yes : t.no}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                            {item.delayServicesNote || t.noServicesNote}
                          </p>
                        </div>

                        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950/60">
                          <div className="flex items-center gap-2 text-xs font-bold text-red-700 dark:text-red-400">
                            <PackageX className="h-3.5 w-3.5" />
                            {t.delaySparePartsLabel} {item.delaySpareParts ? t.yes : t.no}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                            {item.delaySparePartsNote || t.noSparePartsNote}
                          </p>
                        </div>

                        <div className="rounded-lg bg-slate-50 p-3 dark:bg-slate-950/60">
                          <div className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-300">
                            <AlertTriangle className="h-3.5 w-3.5" />
                            {t.delayOtherLabel} {item.delayOther ? t.yes : t.no}
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-700 dark:text-slate-300">
                            {item.delayOtherNote || t.noOtherNote}
                          </p>
                          <div className="mt-2.5 flex items-center justify-between border-t border-slate-200 pt-2 text-xs dark:border-slate-800">
                            <span className="font-semibold text-slate-600 dark:text-slate-400">
                              {t.finalExitDateLabel}:
                            </span>
                            <span className="font-mono font-semibold text-slate-900 dark:text-white">
                              {item.finalExitDate || '-'}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          )}

          {/* TAB 1B: Monthly Entry-Date Archive for Finished Maintenance */}
          {activeTab === 'monthlyArchive' && (
            <MonthlyArchiveView
              items={items}
              isAdmin={effectiveIsAdmin}
              lang={lang}
              onSelectItem={(id) => setSelectedItemId(id)}
              onEditItem={(item) => {
                setEditingItem(item);
                setIsEquipmentModalOpen(true);
              }}
              onDeleteItem={requestDeleteItem}
              onOpenAdminLogin={handleOpenAdminGovernance}
              onPrintGroup={(groupItems, title, subtitle) =>
                triggerPrint(groupItems, title, subtitle)
              }
              onShareGroup={(groupItems, title, subtitle) =>
                setShareState({
                  isOpen: true,
                  items: groupItems,
                  title,
                  subtitle,
                })
              }
            />
          )}

          {/* TAB 3: Date-Linked Reports (Day/Week/Month/Year), Print, Word, Excel, D:\DAWLIND Archive & Share Center */}
          {activeTab === 'exports' && (
            <div className="space-y-6">
              <DateReportsCenter
                items={items}
                lang={lang}
                onPrint={(targetItems, title, subtitle) =>
                  triggerPrint(targetItems, title, subtitle)
                }
                onShare={(targetItems, title, subtitle) =>
                  setShareState({
                    isOpen: true,
                    items: targetItems,
                    title,
                    subtitle,
                  })
                }
                onSelectItem={(id) => setSelectedItemId(id)}
              />

              <WorkReportArchivePanel
                allItems={items}
                filteredItems={filteredItems}
                delayedItems={delayedItems}
                actorName={safeActor}
                lang={lang}
                onNotify={showToast}
              />

              <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {t.exportsAllTitle} ({items.length})
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t.exportsAllDesc}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      triggerPrint(
                        items,
                        lang === 'fr'
                          ? 'Fiche générale de suivi et maintenance'
                          : 'كشف متابعة وصيانة جميع المعدات'
                      )
                    }
                    className="flex items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-3 text-sm font-semibold text-white hover:bg-[#0c3c66]"
                  >
                    <Printer className="h-4 w-4" />
                    {t.printSavePdf}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      exportToExcel(
                        items,
                        lang === 'fr' ? 'liste_complete_equipements' : 'كشف_جميع_المعدات',
                        lang
                      )
                    }
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                    {t.exportExcel}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void exportToWord(
                        items,
                        lang === 'fr'
                          ? 'Fiche générale de maintenance des équipements'
                          : 'ورقة متابعة وصيانة جميع المعدات',
                        lang === 'fr' ? 'rapport_complet_equipements' : 'تقرير_المعدات_الشامل',
                        lang
                      )
                    }
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <FileText className="h-4 w-4 text-blue-600" />
                    {t.exportWord}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setShareState({
                        isOpen: true,
                        items,
                        title:
                          lang === 'fr'
                            ? 'Rapport global de suivi et maintenance'
                            : 'تقرير متابعة وصيانة جميع المعدات',
                      })
                    }
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <Share2 className="h-4 w-4" />
                    {t.shareBtn}
                  </button>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
                <h2 className="text-base font-bold text-slate-900 dark:text-white">
                  {t.exportsDelayedTitle} ({delayedItems.length})
                </h2>
                <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                  {t.exportsDelayedDesc}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      triggerPrint(
                        delayedItems,
                        lang === 'fr'
                          ? 'Rapport des équipements en retard de sortie d’atelier'
                          : 'تقرير المعدات المتأخرة عن الخروج من الورشة'
                      )
                    }
                    className="flex items-center justify-center gap-2 rounded-lg bg-red-600 px-4 py-3 text-sm font-semibold text-white hover:bg-red-700"
                  >
                    <Printer className="h-4 w-4" />
                    {t.printDelayed}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      exportToExcel(
                        delayedItems,
                        lang === 'fr' ? 'rapport_retards_atelier' : 'تقرير_المتأخرات',
                        lang
                      )
                    }
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <FileSpreadsheet className="h-4 w-4 text-emerald-600" />
                    {t.excelDelayed}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      void exportToWord(
                        delayedItems,
                        lang === 'fr'
                          ? 'Rapport des équipements en retard de sortie d’atelier'
                          : 'تقرير المعدات المتأخرة عن الخروج من الورشة',
                        lang === 'fr' ? 'rapport_equipements_retard' : 'تقرير_المعدات_المتأخرة',
                        lang
                      )
                    }
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <FileText className="h-4 w-4 text-blue-600" />
                    {t.wordDelayed}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setShareState({
                        isOpen: true,
                        items: delayedItems,
                        title:
                          lang === 'fr'
                            ? 'Rapport des équipements en retard d’atelier'
                            : 'تقرير المعدات المتأخرة عن الخروج من الورشة',
                      })
                    }
                    className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-4 py-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-100 dark:hover:bg-slate-800"
                  >
                    <Share2 className="h-4 w-4" />
                    {t.shareDelayedBtn}
                  </button>
                </div>
              </div>
              </section>
            </div>
          )}

          {/* TAB 4: Backups, Restore & Exporter */}
          {activeTab === 'backups' && (
            <BackupRestoreView
              items={items}
              backups={backups}
              isAdmin={effectiveIsAdmin}
              lang={lang}
              onCreateCloudBackup={handleCreateCloudBackup}
              onRestoreCloudBackup={handleRestoreCloudBackup}
              onDeleteCloudBackup={handleDeleteCloudBackup}
              onImportJsonBackup={handleImportJsonBackup}
              onPrintAll={() =>
                triggerPrint(
                  items,
                  lang === 'fr'
                    ? 'Fiche générale de suivi et maintenance'
                    : 'كشف متابعة وصيانة المعدات'
                )
              }
              onOpenAdminLogin={handleOpenAdminGovernance}
            />
          )}

          {/* TAB 5: Organization Equipment Inventory (Name, Number, Status) */}
          {activeTab === 'inventory' && (
            <OrgInventoryView
              assets={orgAssets}
              loading={loading}
              isAdmin={effectiveIsAdmin}
              lang={lang}
              onSaveAsset={handleSaveOrgAsset}
              onDeleteAsset={requestDeleteOrgAsset}
              onOpenAdminLogin={handleOpenAdminGovernance}
            />
          )}
        </main>
      </div>

      {/* Print-Only A4 Maintenance Sheet */}
      <PrintSheet
        items={printState.items}
        title={
          printState.title ||
          (lang === 'fr'
            ? 'Fiche de suivi et maintenance des équipements'
            : 'كشف متابعة وصيانة المعدات')
        }
        subtitle={printState.subtitle}
        lang={lang}
      />

      {/* Modals & Drawers */}
      <EquipmentDetailDrawer
        item={selectedItem}
        isAdmin={effectiveIsAdmin}
        lang={lang}
        onClose={() => setSelectedItemId(null)}
        onEdit={(item) => {
          setEditingItem(item);
          setIsEquipmentModalOpen(true);
        }}
        onDelete={requestDeleteItem}
        onAddNote={handleAddNote}
        onPrintSingle={(item) =>
          triggerPrint(
            [item],
            lang === 'fr'
              ? `Fiche maintenance : ${item.name} (${item.equipmentNumber})`
              : `ورقة صيانة: ${item.name} (${item.equipmentNumber})`
          )
        }
        onExportWordSingle={(item) =>
          void exportToWord(
            [item],
            lang === 'fr'
              ? `Fiche maintenance : ${item.name}`
              : `ورقة صيانة معدة: ${item.name}`,
            lang === 'fr'
              ? `fiche_maintenance_${item.equipmentNumber}`
              : `ورقة_صيانة_${item.equipmentNumber}`,
            lang
          )
        }
        onExportExcelSingle={(item) =>
          exportToExcel(
            [item],
            lang === 'fr'
              ? `fiche_maintenance_${item.equipmentNumber}`
              : `ورقة_صيانة_${item.equipmentNumber}`,
            lang
          )
        }
        onShareSingle={(item) =>
          setShareState({
            isOpen: true,
            items: [item],
            title:
              lang === 'fr'
                ? `Fiche maintenance : ${item.name} (${item.equipmentNumber})`
                : `ورقة صيانة: ${item.name} (${item.equipmentNumber})`,
          })
        }
      />

      <EquipmentModal
        isOpen={isEquipmentModalOpen}
        editingItem={editingItem}
        lang={lang}
        onClose={() => {
          setIsEquipmentModalOpen(false);
          setEditingItem(null);
        }}
        onSave={handleSaveEquipment}
      />

      <ShareModal
        isOpen={shareState.isOpen}
        items={shareState.items}
        title={shareState.title}
        subtitle={shareState.subtitle}
        lang={lang}
        onPrint={() => triggerPrint(shareState.items, shareState.title, shareState.subtitle)}
        onClose={() => setShareState({ isOpen: false, items: [], title: '' })}
      />

      {firebaseUser && isUnlocked && (
        <AdminAuthModal
          isOpen={isAdminModalOpen}
          isAdmin={isAdmin}
          currentUid={firebaseUser.uid}
          currentEmail={firebaseUser.email || ''}
          actorName={safeActor}
          lang={lang}
          syncRefreshLocked={syncLockState.locked}
          syncLockReason={syncLockState.lockReason}
          onPullLocalSyncToCloud={handlePullLocalSyncFromAdminModal}
          onClose={() => setIsAdminModalOpen(false)}
        />
      )}

      {/* In-App Confirmation Dialog */}
      {confirmState && (
        <div className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <h3 className="text-base font-bold text-slate-900 dark:text-white">
              {confirmState.title}
            </h3>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {confirmState.message}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmState(null)}
                className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                {t.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  const fn = confirmState.onConfirm;
                  setConfirmState(null);
                  void fn();
                }}
                className="rounded-lg bg-red-600 px-4 py-2 text-xs font-semibold text-white hover:bg-red-700"
              >
                {confirmState.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Feedback */}
      {toast && (
        <div
          className={`no-print fixed bottom-4 end-4 z-50 rounded-lg px-4 py-2.5 text-xs font-semibold text-white shadow-lg ${
            toast.type === 'ok' ? 'bg-slate-900 dark:bg-slate-800' : 'bg-red-600'
          }`}
        >
          {toast.text}
        </div>
      )}

      <OfflineIndicator lang={lang} />
    </>
  );
}
