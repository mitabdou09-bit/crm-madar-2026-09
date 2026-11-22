import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
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
  ShieldCheck,
  MessageSquarePlus,
  Moon,
  Sun,
  UserCheck,
  HardDrive,
  AlertTriangle,
  Wrench,
  PackageX,
  Globe,
  RefreshCw,
  Cloud,
  LogIn,
  LogOut,
  UploadCloud,
  DownloadCloud,
  ArrowLeftRight,
  ExternalLink,
  Lock,
  X,
} from 'lucide-react';
import {
  auth,
  commitWriteOfflineSafe,
  db,
  googleProvider,
  handleFirestoreError,
  isTransientOfflineError,
  OperationType,
  PRIMARY_ADMIN_EMAIL,
  syncPendingCloudWrites,
  WORKSPACE_KEY,
} from './firebase';
import { CATEGORY_LABELS, CONDITION_LABELS, T, type Language } from './i18n';
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
import { WorkReportArchivePanel } from './components/WorkReportArchivePanel';
import { OrgInventoryView } from './components/OrgInventoryView';
import { DateReportsCenter } from './components/DateReportsCenter';
import { MonthlyArchiveView } from './components/MonthlyArchiveView';
import { formatMonthYearLabel } from './utils/dateReports';
import { BrandTitle } from './components/BrandTitle';
import { PWAInstallControl } from './components/PWAInstallModal';
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
  recordAuditLog,
  transferCloudToLocal,
  transferLocalToCloud,
} from './utils/modeTransfer';

type ActiveTab = 'dashboard' | 'monthlyArchive' | 'inventory' | 'delays' | 'exports' | 'backups';

interface ConfirmActionState {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
}

const LOCAL_ITEMS_KEY = 'crm_local_items_v1';
const LOCAL_ORG_ASSETS_KEY = 'crm_local_org_assets_v1';
const LOCAL_BACKUPS_KEY = 'crm_local_backups_v1';
const LOCAL_ACTOR_KEY = 'crm_local_actor_name_v1';
const LOCAL_THEME_KEY = 'crm_local_theme_v1';
const LOCAL_LANG_KEY = 'crm_local_lang_v1';
const LOCAL_GOOGLE_MODE_KEY = 'crm_local_google_mode_v1';
const LOCAL_GOOGLE_UNLOCKED_UID_KEY = 'crm_local_google_unlocked_uid_v1';
const LOCAL_GOOGLE_ADMIN_CACHE_PREFIX = 'crm_local_google_admin_uid_';
const DEFAULT_CLOUD_WEB_URL =
  'https://ais-dev-kuuou4u5ajby3g35lwv5sr-900477063934.europe-west2.run.app';

function makeSafeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getCloudWebUrl(): string {
  if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)) {
    return `${window.location.origin}/`;
  }
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="crm-cloud-url"]')?.getAttribute('content');
    if (meta && /^https?:\/\//i.test(meta)) {
      const clean = meta.trim().replace(/\/Crm-Local\.html$/i, '').replace(/\/+$/, '');
      return `${clean}/`;
    }
  }
  return `${DEFAULT_CLOUD_WEB_URL}/`;
}

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

function sanitizeOrgAssetStatus(val: unknown): OrgAssetStatus {
  return ORG_ASSET_STATUSES.includes(val as OrgAssetStatus)
    ? (val as OrgAssetStatus)
    : 'يعمل - حالة جيدة';
}

function readJsonStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota errors cleanly
  }
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

export default function LocalApp() {
  const [lang, setLang] = useState<Language>(() => {
    try {
      const saved = localStorage.getItem(LOCAL_LANG_KEY);
      if (saved === 'fr' || saved === 'ar') return saved;
      if (typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('fr')) {
        return 'fr';
      }
    } catch {
      // Fallback safely
    }
    return 'ar';
  });

  const t = T[lang];
  const locale = lang === 'fr' ? 'fr-FR' : 'ar-SA';

  const [activeTab, setActiveTab] = useState<ActiveTab>('dashboard');
  const [items, setItems] = useState<EquipmentItem[]>(() =>
    readJsonStorage<EquipmentItem[]>(LOCAL_ITEMS_KEY, [])
  );
  const [orgAssets, setOrgAssets] = useState<OrganizationAsset[]>(() =>
    readJsonStorage<OrganizationAsset[]>(LOCAL_ORG_ASSETS_KEY, [])
  );
  const [backups, setBackups] = useState<CloudBackupSnapshot[]>(() =>
    readJsonStorage<CloudBackupSnapshot[]>(LOCAL_BACKUPS_KEY, [])
  );
  const [deletedRecords, setDeletedRecords] = useState<DeletedRecordsMap>(() =>
    readJsonStorage<DeletedRecordsMap>(LOCAL_DELETED_RECORDS_KEY, {
      equipment: {},
      orgAssets: {},
    })
  );
  const [lastColleagueSyncAt, setLastColleagueSyncAt] = useState<string>(() => {
    try {
      return localStorage.getItem(LOCAL_LAST_SYNC_KEY) || '';
    } catch {
      return '';
    }
  });
  const [isSyncingColleagues, setIsSyncingColleagues] = useState(false);

  const [actorName, setActorName] = useState<string>(() => {
    try {
      return localStorage.getItem(LOCAL_ACTOR_KEY) || '';
    } catch {
      return '';
    }
  });

  const [darkMode, setDarkMode] = useState<boolean>(() => {
    try {
      return localStorage.getItem(LOCAL_THEME_KEY) === 'dark';
    } catch {
      return false;
    }
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('ALL');
  const [conditionFilter, setConditionFilter] = useState<string>('ALL');
  const [dashboardScope, setDashboardScope] = useState<'active' | 'all'>('active');
  const [onlyDelayed, setOnlyDelayed] = useState(false);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [isEquipmentModalOpen, setIsEquipmentModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<EquipmentItem | null>(null);
  const [confirmState, setConfirmState] = useState<ConfirmActionState | null>(null);

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

  const isFileProtocol =
    typeof window !== 'undefined' && window.location.protocol === 'file:';

  // Second Feature: Google + Internet Mode (opt-in inside Local Desktop Edition)
  const [googleModeEnabled, setGoogleModeEnabled] = useState<boolean>(() => {
    if (typeof window !== 'undefined' && window.location.protocol === 'file:') {
      return false;
    }
    try {
      return localStorage.getItem(LOCAL_GOOGLE_MODE_KEY) === '1';
    } catch {
      return false;
    }
  });
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [googleUnlocked, setGoogleUnlocked] = useState(false);
  const [googleIsAdmin, setGoogleIsAdmin] = useState(false);
  const [googleItems, setGoogleItems] = useState<EquipmentItem[]>([]);
  const [googleOrgAssets, setGoogleOrgAssets] = useState<OrganizationAsset[]>([]);
  const [googleBackups, setGoogleBackups] = useState<CloudBackupSnapshot[]>([]);
  const [googleSelectedNotes, setGoogleSelectedNotes] = useState<TeamNote[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [syncConnected, setSyncConnected] = useState(false);
  const [syncFromCache, setSyncFromCache] = useState(false);
  const [hasPendingWrites, setHasPendingWrites] = useState(false);
  const [isGoogleModalOpen, setIsGoogleModalOpen] = useState(false);
  const [isFileProtocolNoticeOpen, setIsFileProtocolNoticeOpen] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [googleAccessCode, setGoogleAccessCode] = useState('');
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [googleAuthError, setGoogleAuthError] = useState('');
  const [pushingLocalToGoogle, setPushingLocalToGoogle] = useState(false);
  const [syncLockState, setSyncLockState] = useState<WorkspaceSyncLockStatus>(() =>
    readJsonStorage<WorkspaceSyncLockStatus>(LOCAL_SYNC_LOCK_CACHE_KEY, { locked: false })
  );

  const [toast, setToast] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const showToast = useCallback((type: 'ok' | 'err', text: string) => {
    setToast({ type, text });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode);
    try {
      localStorage.setItem(LOCAL_THEME_KEY, darkMode ? 'dark' : 'light');
    } catch {
      // Ignore storage errors
    }
  }, [darkMode]);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === 'fr' ? 'ltr' : 'rtl';
    try {
      localStorage.setItem(LOCAL_LANG_KEY, lang);
    } catch {
      // Ignore storage errors
    }
  }, [lang]);

  useEffect(() => {
    writeJsonStorage(LOCAL_ITEMS_KEY, items);
  }, [items]);

  useEffect(() => {
    writeJsonStorage(LOCAL_ORG_ASSETS_KEY, orgAssets);
  }, [orgAssets]);

  useEffect(() => {
    writeJsonStorage(LOCAL_BACKUPS_KEY, backups);
  }, [backups]);

  useEffect(() => {
    writeJsonStorage(LOCAL_DELETED_RECORDS_KEY, deletedRecords);
  }, [deletedRecords]);

  useEffect(() => {
    if (!lastColleagueSyncAt) return;
    try {
      localStorage.setItem(LOCAL_LAST_SYNC_KEY, lastColleagueSyncAt);
    } catch {
      // Ignore storage errors
    }
  }, [lastColleagueSyncAt]);

  useEffect(() => {
    try {
      localStorage.setItem(LOCAL_ACTOR_KEY, actorName);
    } catch {
      // Ignore storage errors
    }
  }, [actorName]);

  useEffect(() => {
    if (isFileProtocol) return;
    try {
      localStorage.setItem(LOCAL_GOOGLE_MODE_KEY, googleModeEnabled ? '1' : '0');
    } catch {
      // Ignore storage errors
    }
  }, [googleModeEnabled, isFileProtocol]);

  useEffect(() => {
    writeJsonStorage(LOCAL_SYNC_LOCK_CACHE_KEY, syncLockState);
  }, [syncLockState]);

  // Listen to Google Auth state only on http/https (never hits network on file://)
  useEffect(() => {
    if (isFileProtocol) return;
    const unsub = onAuthStateChanged(auth, async (user) => {
      setGoogleUser(user);
      if (!user) {
        setGoogleUnlocked(false);
        setGoogleIsAdmin(false);
        setGoogleItems([]);
        setGoogleOrgAssets([]);
        setGoogleBackups([]);
        return;
      }

      const unlockedUid = (() => {
        try {
          return localStorage.getItem(LOCAL_GOOGLE_UNLOCKED_UID_KEY);
        } catch {
          return null;
        }
      })();
      const normalizedEmail = (user.email || '').trim().toLowerCase();

      if (typeof navigator !== 'undefined' && !navigator.onLine && unlockedUid === user.uid) {
        setActorName((prev) => prev || user.displayName || '');
        try {
          if (localStorage.getItem(`${LOCAL_GOOGLE_ADMIN_CACHE_PREFIX}${user.uid}`) === '1') {
            setGoogleIsAdmin(true);
          }
        } catch {
          // Ignore storage errors
        }
        setGoogleUnlocked(true);
        return;
      }

      try {
        const memberSnap = await getDoc(doc(db, 'teamMembers', user.uid));
        if (memberSnap.exists()) {
          const data = memberSnap.data() as { displayName?: string };
          setActorName((prev) => prev || data.displayName || user.displayName || '');
          try {
            localStorage.setItem(LOCAL_GOOGLE_UNLOCKED_UID_KEY, user.uid);
          } catch {
            // Ignore storage errors
          }
          setGoogleUnlocked(true);
          return;
        }

        const isPrimaryAdmin =
          normalizedEmail === PRIMARY_ADMIN_EMAIL.toLowerCase() && user.emailVerified;

        let isCloudAdmin = isPrimaryAdmin;
        if (!isCloudAdmin) {
          const [uidAdminSnap, emailAdminSnap] = await Promise.all([
            getDoc(doc(db, 'admins', user.uid)),
            normalizedEmail
              ? getDoc(doc(db, 'adminEmails', normalizedEmail))
              : Promise.resolve(null),
          ]);
          isCloudAdmin = Boolean(uidAdminSnap.exists() || emailAdminSnap?.exists());
        }

        if (isCloudAdmin) {
          setActorName((prev) => prev || user.displayName || '');
          try {
            localStorage.setItem(LOCAL_GOOGLE_UNLOCKED_UID_KEY, user.uid);
            localStorage.setItem(`${LOCAL_GOOGLE_ADMIN_CACHE_PREFIX}${user.uid}`, '1');
          } catch {
            // Ignore storage errors
          }
          setGoogleUnlocked(true);
        } else {
          setGoogleUnlocked(false);
        }
      } catch {
        if (unlockedUid === user.uid) {
          setActorName((prev) => prev || user.displayName || '');
          try {
            if (localStorage.getItem(`${LOCAL_GOOGLE_ADMIN_CACHE_PREFIX}${user.uid}`) === '1') {
              setGoogleIsAdmin(true);
            }
          } catch {
            // Ignore storage errors
          }
          setGoogleUnlocked(true);
        } else {
          setGoogleUnlocked(false);
        }
      }
    });

    return () => unsub();
  }, [isFileProtocol]);

  const effectiveGoogleActive =
    googleModeEnabled && !isFileProtocol && Boolean(googleUser) && googleUnlocked;

  // Check Admin status in Google + Internet Mode
  useEffect(() => {
    if (!effectiveGoogleActive || !googleUser) {
      setGoogleIsAdmin(false);
      return;
    }

    const normalizedEmail = (googleUser.email || '').trim().toLowerCase();
    if (
      normalizedEmail === PRIMARY_ADMIN_EMAIL.toLowerCase() &&
      googleUser.emailVerified
    ) {
      setGoogleIsAdmin(true);
      try {
        localStorage.setItem(`${LOCAL_GOOGLE_ADMIN_CACHE_PREFIX}${googleUser.uid}`, '1');
      } catch {
        // Ignore storage errors
      }
      return;
    }

    try {
      if (localStorage.getItem(`${LOCAL_GOOGLE_ADMIN_CACHE_PREFIX}${googleUser.uid}`) === '1') {
        setGoogleIsAdmin(true);
      }
    } catch {
      // Ignore storage errors
    }

    let hasUidAdmin = false;
    let hasEmailAdmin = false;

    const updateCachedAdmin = (val: boolean) => {
      setGoogleIsAdmin(val);
      try {
        if (val) {
          localStorage.setItem(`${LOCAL_GOOGLE_ADMIN_CACHE_PREFIX}${googleUser.uid}`, '1');
        } else if (typeof navigator === 'undefined' || navigator.onLine) {
          localStorage.removeItem(`${LOCAL_GOOGLE_ADMIN_CACHE_PREFIX}${googleUser.uid}`);
        }
      } catch {
        // Ignore storage errors
      }
    };

    const adminPath = `admins/${googleUser.uid}`;
    const unsubUid = onSnapshot(
      doc(db, 'admins', googleUser.uid),
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
  }, [effectiveGoogleActive, googleUser]);

  // Real-time Firestore sync when Mode 2 (Google + Internet) is active
  useEffect(() => {
    if (!effectiveGoogleActive || !googleUser) {
      setSyncConnected(false);
      setGoogleLoading(false);
      return;
    }

    setGoogleLoading(true);
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
        setGoogleItems(nextItems);
        setGoogleLoading(false);
        setSyncConnected(true);
        setSyncFromCache(snapshot.metadata.fromCache);
        eqPending = snapshot.metadata.hasPendingWrites;
        syncPendingFlag();
      },
      (error) => {
        setSyncConnected(false);
        setGoogleLoading(false);
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
        setGoogleBackups(nextBackups);
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
        setGoogleOrgAssets(nextAssets);
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
  }, [effectiveGoogleActive, googleUser]);

  // Automatic flush notification when internet reconnects during Google Mode
  useEffect(() => {
    if (!effectiveGoogleActive || !googleUser) return;
    const handleOnlineReconnect = () => {
      void syncPendingCloudWrites()
        .then(() => {
          setHasPendingWrites(false);
          setSyncFromCache(false);
          setSyncConnected(true);
          showToast('ok', t.backOnlineSyncedToast);
        })
        .catch(() => {
          // Firestore will retry automatically
        });
    };
    window.addEventListener('online', handleOnlineReconnect);
    return () => window.removeEventListener('online', handleOnlineReconnect);
  }, [effectiveGoogleActive, googleUser, showToast, t.backOnlineSyncedToast]);

  // Real-time notes subcollection listener when Google Mode is active
  useEffect(() => {
    if (!effectiveGoogleActive || !googleUser || !selectedItemId) {
      setGoogleSelectedNotes([]);
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
        setGoogleSelectedNotes(list);
      },
      (error) => {
        if (!isTransientOfflineError(error)) {
          handleFirestoreError(error, OperationType.LIST, notesPath);
        }
      }
    );

    return () => unsub();
  }, [effectiveGoogleActive, googleUser, selectedItemId]);

  const activeItems = effectiveGoogleActive ? googleItems : items;
  const activeOrgAssets = effectiveGoogleActive ? googleOrgAssets : orgAssets;
  const activeBackups = effectiveGoogleActive ? googleBackups : backups;
  const effectiveIsAdmin = effectiveGoogleActive ? googleIsAdmin : true;
  const isPrimaryAdmin = Boolean(
    googleUser?.emailVerified &&
      (googleUser.email || '').trim().toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase()
  );
  const isSyncActionBlocked = syncLockState.locked && !isPrimaryAdmin;

  // Listen to Primary Admin Sync/Refresh Lock in both Google Mode and Local Mode
  useEffect(() => {
    if (isFileProtocol) return;
    if (effectiveGoogleActive && googleUser) {
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

    if (typeof navigator !== 'undefined' && navigator.onLine) {
      void fetchWorkspaceSyncLockStatus()
        .then((status) => setSyncLockState(status))
        .catch(() => {
          // Keep cached lock state
        });
    }
  }, [isFileProtocol, effectiveGoogleActive, googleUser]);

  const selectedItem = useMemo(() => {
    const found = activeItems.find((i) => i.id === selectedItemId);
    if (!found) return null;
    if (effectiveGoogleActive) {
      return {
        ...found,
        teamNotes: googleSelectedNotes,
      };
    }
    return found;
  }, [activeItems, selectedItemId, effectiveGoogleActive, googleSelectedNotes]);

  const filteredItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return activeItems.filter((item) => {
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
  }, [activeItems, dashboardScope, searchQuery, categoryFilter, conditionFilter, onlyDelayed]);

  const delayedItems = useMemo(
    () => activeItems.filter((item) => hasWorkshopDelay(item) || calculateOverdueDays(item) > 0),
    [activeItems]
  );

  const stats = useMemo(() => {
    const ready = activeItems.filter((i) => i.condition === 'جاهزة للعمل').length;
    const inMaint = activeItems.filter(
      (i) => i.condition === 'قيد الصيانة' || i.condition === 'متوقفة - بانتظار'
    ).length;
    return {
      total: activeItems.length,
      ready,
      inMaint,
      delayed: delayedItems.length,
    };
  }, [activeItems, delayedItems]);

  const safeActor = (
    actorName.trim() ||
    (effectiveGoogleActive ? googleUser?.displayName || '' : '') ||
    (lang === 'fr' ? 'Responsable PC' : 'مشرف الحاسوب')
  ).slice(0, 80);

  const handleSaveEquipment = async (input: EquipmentInput, editingId?: string) => {
    const fallbackLocation = lang === 'fr' ? 'Atelier de maintenance' : 'ورشة الصيانة';
    const nowIso = new Date().toISOString();

    const baseFields = {
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

    const finishedMonthKey = baseFields.entryDate.slice(0, 7);
    const finishedMonthLabel = formatMonthYearLabel(finishedMonthKey, lang);

    if (effectiveGoogleActive && googleUser) {
      if (editingId) {
        const path = `equipment/${editingId}`;
        try {
          const outcome = await commitWriteOfflineSafe(
            updateDoc(doc(db, 'equipment', editingId), {
              ...baseFields,
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
            firebaseUser: googleUser,
            sourceMode: 'cloud',
            action: 'update',
            entityType: 'equipment',
            entityId: editingId,
            entityLabel: `${baseFields.name} (${baseFields.equipmentNumber})`,
            details: baseFields.condition,
            actorName: safeActor,
          });
          showToast(
            'ok',
            outcome === 'queued_offline'
              ? t.offlineSavedQueuedToast
              : baseFields.condition === 'جاهزة للعمل'
                ? `${t.monthlyArchiveMovedToastPrefix} ${finishedMonthLabel} (${finishedMonthKey}).`
                : lang === 'fr'
                  ? 'Données corrigées et synchronisées dans le cloud Google.'
                  : 'تم تصحيح البيانات ومزامنتها عبر سحابة Google.'
          );
        } catch (err) {
          const msg =
            err instanceof Error && !err.message.startsWith('{') ? err.message : t.errCloudVerify;
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
              ...baseFields,
              createdByUid: googleUser.uid,
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
            firebaseUser: googleUser,
            sourceMode: 'cloud',
            action: 'create',
            entityType: 'equipment',
            entityId: newId,
            entityLabel: `${baseFields.name} (${baseFields.equipmentNumber})`,
            details: baseFields.condition,
            actorName: safeActor,
          });
          showToast(
            'ok',
            outcome === 'queued_offline'
              ? t.offlineSavedQueuedToast
              : baseFields.condition === 'جاهزة للعمل'
                ? `${t.monthlyArchiveMovedToastPrefix} ${finishedMonthLabel} (${finishedMonthKey}).`
                : lang === 'fr'
                  ? 'Équipement ajouté et synchronisé dans le cloud Google.'
                  : 'تمت إضافة المعدة ومزامنتها عبر سحابة Google.'
          );
        } catch (err) {
          const msg =
            err instanceof Error && !err.message.startsWith('{') ? err.message : t.errCloudVerify;
          showToast('err', msg);
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      }
      return;
    }

    // Mode 1: Local PC Edition (no Google, no internet required)
    const baseData = { ...baseFields, updatedAt: nowIso };
    if (editingId) {
      setItems((prev) =>
        prev
          .map((item) => (item.id === editingId ? { ...item, ...baseData } : item))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      );
      showToast(
        'ok',
        baseData.condition === 'جاهزة للعمل'
          ? `${t.monthlyArchiveMovedToastPrefix} ${finishedMonthLabel} (${finishedMonthKey}).`
          : lang === 'fr'
            ? 'Données corrigées et enregistrées localement sur votre PC.'
            : 'تم تصحيح البيانات وحفظها محلياً على حاسوبك.'
      );
    } else {
      const newItem: EquipmentItem = {
        id: makeSafeId('eq'),
        workspaceKey: WORKSPACE_KEY,
        ...baseData,
        teamNotes: [],
        createdByUid: 'local_pc_user',
        createdBy: safeActor,
        createdAt: nowIso,
      };
      setItems((prev) => [newItem, ...prev]);
      showToast(
        'ok',
        baseData.condition === 'جاهزة للعمل'
          ? `${t.monthlyArchiveMovedToastPrefix} ${finishedMonthLabel} (${finishedMonthKey}).`
          : lang === 'fr'
            ? 'Équipement ajouté et enregistré localement sur votre PC.'
            : 'تمت إضافة المعدة وحفظها محلياً على حاسوبك.'
      );
    }
  };

  const handleAddNote = async (itemId: string, text: string) => {
    if (effectiveGoogleActive && googleUser) {
      const noteId = makeSafeId('note');
      const path = `equipment/${itemId}/notes/${noteId}`;
      try {
        const outcome = await commitWriteOfflineSafe(
          setDoc(doc(db, 'equipment', itemId, 'notes', noteId), {
            workspaceKey: WORKSPACE_KEY,
            equipmentId: itemId,
            authorUid: googleUser.uid,
            author: safeActor,
            role: googleIsAdmin ? 'admin' : 'member',
            text: text.trim().slice(0, 1000),
            createdAt: serverTimestamp(),
          }),
          (err) => {
            if (!isTransientOfflineError(err)) {
              handleFirestoreError(err, OperationType.CREATE, path);
            }
          }
        );
        if (outcome === 'queued_offline') setHasPendingWrites(true);
        void recordAuditLog({
          db,
          firebaseUser: googleUser,
          sourceMode: 'cloud',
          action: 'note',
          entityType: 'note',
          entityId: itemId,
          entityLabel: itemId,
          details: text.trim().slice(0, 200),
          actorName: safeActor,
        });
        showToast(
          'ok',
          outcome === 'queued_offline'
            ? t.offlineSavedQueuedToast
            : lang === 'fr'
              ? 'Note ajoutée et synchronisée avec Google Cloud.'
              : 'تمت إضافة الملاحظة ومزامنتها عبر سحابة Google.'
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
      authorUid: 'local_pc_user',
      author: safeActor,
      role: 'admin',
      text: text.trim().slice(0, 1000),
      createdAt: nowIso,
    };
    setItems((prev) =>
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
    showToast(
      'ok',
      lang === 'fr' ? 'Note enregistrée localement.' : 'تم حفظ الملاحظة محلياً.'
    );
  };

  const requestDeleteItem = (item: EquipmentItem) => {
    if (effectiveGoogleActive && !googleIsAdmin) {
      setIsAdminModalOpen(true);
      return;
    }

    setConfirmState({
      title: t.deleteConfirmTitle,
      message: effectiveGoogleActive
        ? lang === 'fr'
          ? `Voulez-vous supprimer définitivement "${item.name}" (${item.equipmentNumber}) de Firebase ?`
          : `هل تريد حذف "${item.name}" (${item.equipmentNumber}) نهائياً من قاعدة بيانات Firebase؟`
        : lang === 'fr'
          ? `Voulez-vous supprimer définitivement "${item.name}" (${item.equipmentNumber}) de ce PC ?`
          : `هل تريد حذف "${item.name}" (${item.equipmentNumber}) نهائياً من قاعدة البيانات المحلية؟`,
      confirmLabel: t.deleteConfirmBtn,
      onConfirm: async () => {
        if (effectiveGoogleActive && googleUser) {
          const path = `equipment/${item.id}`;
          try {
            const outcome = await commitWriteOfflineSafe(
              deleteDoc(doc(db, 'equipment', item.id)),
              (err) => {
                if (!isTransientOfflineError(err)) {
                  handleFirestoreError(err, OperationType.DELETE, path);
                }
              }
            );
            if (outcome === 'queued_offline') setHasPendingWrites(true);
            void recordAuditLog({
              db,
              firebaseUser: googleUser,
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
        setItems((prev) => prev.filter((x) => x.id !== item.id));
        setDeletedRecords((prev) => ({
          ...prev,
          equipment: { ...prev.equipment, [item.id]: deletedAtIso },
        }));
        if (selectedItemId === item.id) setSelectedItemId(null);
        showToast('ok', lang === 'fr' ? 'Équipement supprimé.' : 'تم حذف المعدة.');
      },
    });
  };

  const handleSaveOrgAsset = async (input: OrganizationAssetInput, editingId?: string) => {
    const baseFields = {
      name: input.name.trim().slice(0, 200),
      assetNumber: input.assetNumber.trim().slice(0, 80),
      status: sanitizeOrgAssetStatus(input.status),
      lastUpdatedBy: safeActor,
    };

    if (effectiveGoogleActive && googleUser) {
      if (editingId) {
        const path = `orgAssets/${editingId}`;
        try {
          const outcome = await commitWriteOfflineSafe(
            updateDoc(doc(db, 'orgAssets', editingId), {
              ...baseFields,
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
            firebaseUser: googleUser,
            sourceMode: 'cloud',
            action: 'update',
            entityType: 'orgAsset',
            entityId: editingId,
            entityLabel: `${baseFields.name} (${baseFields.assetNumber})`,
            details: baseFields.status,
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
          const msg =
            err instanceof Error && !err.message.startsWith('{') ? err.message : t.errCloudVerify;
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
              ...baseFields,
              createdByUid: googleUser.uid,
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
            firebaseUser: googleUser,
            sourceMode: 'cloud',
            action: 'create',
            entityType: 'orgAsset',
            entityId: newId,
            entityLabel: `${baseFields.name} (${baseFields.assetNumber})`,
            details: baseFields.status,
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
          const msg =
            err instanceof Error && !err.message.startsWith('{') ? err.message : t.errCloudVerify;
          showToast('err', msg);
          handleFirestoreError(err, OperationType.CREATE, path);
        }
      }
      return;
    }

    const nowIso = new Date().toISOString();
    const baseData = { ...baseFields, updatedAt: nowIso };
    if (editingId) {
      setOrgAssets((prev) =>
        prev
          .map((asset) => (asset.id === editingId ? { ...asset, ...baseData } : asset))
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      );
      showToast(
        'ok',
        lang === 'fr'
          ? 'Matériel corrigé et enregistré localement.'
          : 'تم تصحيح العتاد وحفظه محلياً.'
      );
    } else {
      const created: OrganizationAsset = {
        id: makeSafeId('asset'),
        workspaceKey: WORKSPACE_KEY,
        ...baseData,
        createdByUid: 'local_pc_user',
        createdBy: safeActor,
        createdAt: nowIso,
      };
      setOrgAssets((prev) => [created, ...prev]);
      showToast(
        'ok',
        lang === 'fr'
          ? 'Matériel ajouté à la liste locale.'
          : 'تمت إضافة العتاد إلى القائمة المحلية.'
      );
    }
  };

  const requestDeleteOrgAsset = (asset: OrganizationAsset) => {
    if (effectiveGoogleActive && !googleIsAdmin) {
      setIsAdminModalOpen(true);
      return;
    }

    setConfirmState({
      title: t.orgAssetDeleteTitle,
      message: effectiveGoogleActive
        ? lang === 'fr'
          ? `Voulez-vous supprimer définitivement "${asset.name}" (${asset.assetNumber}) de l’inventaire ?`
          : `هل تريد حذف "${asset.name}" (${asset.assetNumber}) نهائياً من قائمة عتاد المؤسسة؟`
        : lang === 'fr'
          ? `Voulez-vous supprimer "${asset.name}" (${asset.assetNumber}) de l’inventaire local ?`
          : `هل تريد حذف "${asset.name}" (${asset.assetNumber}) من قائمة عتاد المؤسسة المحلية؟`,
      confirmLabel: t.orgAssetDeleteBtn,
      onConfirm: async () => {
        if (effectiveGoogleActive && googleUser) {
          const path = `orgAssets/${asset.id}`;
          try {
            const outcome = await commitWriteOfflineSafe(
              deleteDoc(doc(db, 'orgAssets', asset.id)),
              (err) => {
                if (!isTransientOfflineError(err)) {
                  handleFirestoreError(err, OperationType.DELETE, path);
                }
              }
            );
            if (outcome === 'queued_offline') setHasPendingWrites(true);
            void recordAuditLog({
              db,
              firebaseUser: googleUser,
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
        setOrgAssets((prev) => prev.filter((a) => a.id !== asset.id));
        setDeletedRecords((prev) => ({
          ...prev,
          orgAssets: { ...prev.orgAssets, [asset.id]: deletedAtIso },
        }));
        showToast('ok', lang === 'fr' ? 'Matériel supprimé.' : 'تم حذف العتاد.');
      },
    });
  };

  const handleCreateCloudBackup = async (label: string) => {
    if (effectiveGoogleActive && googleUser) {
      const backupId = makeSafeId('bkp');
      const path = `backups/${backupId}`;
      const boundedItems = googleItems.slice(0, 500).map((it) => ({
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

      try {
        const outcome = await commitWriteOfflineSafe(
          setDoc(doc(db, 'backups', backupId), {
            workspaceKey: WORKSPACE_KEY,
            label:
              label.trim().slice(0, 120) || (lang === 'fr' ? 'Sauvegarde cloud' : 'نسخة سحابية'),
            createdByUid: googleUser.uid,
            createdBy: safeActor,
            itemCount: boundedItems.length,
            items: boundedItems,
            createdAt: serverTimestamp(),
          }),
          (err) => {
            if (!isTransientOfflineError(err)) {
              handleFirestoreError(err, OperationType.CREATE, path);
            }
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
      createdByUid: 'local_pc_user',
      createdBy: safeActor,
      itemCount: items.length,
      items: items.slice(0, 500),
      createdAt: new Date().toISOString(),
    };
    setBackups((prev) => [snapshot, ...prev]);
  };

  const applyGoogleRestoredItemsBatch = async (
    restoredItems: EquipmentItem[],
    mode: 'replace' | 'merge'
  ) => {
    if (!googleUser) return;
    const batch = writeBatch(db);

    if (mode === 'replace') {
      for (const existing of googleItems) {
        batch.delete(doc(db, 'equipment', existing.id));
      }
    }

    const existingIds = new Set(googleItems.map((i) => i.id));
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
        createdByUid: googleUser.uid,
        createdBy: (String(raw.createdBy || safeActor).trim() || safeActor).slice(0, 80),
        lastUpdatedBy: safeActor,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }

    try {
      const outcome = await commitWriteOfflineSafe(batch.commit(), (err) => {
        if (!isTransientOfflineError(err)) {
          handleFirestoreError(err, OperationType.WRITE, 'equipment');
        }
      });
      if (outcome === 'queued_offline') {
        setHasPendingWrites(true);
        showToast('ok', t.offlineSavedQueuedToast);
      }
      void recordAuditLog({
        db,
        firebaseUser: googleUser,
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
    const snapshot = activeBackups.find((b) => b.id === backupId);
    if (!snapshot) return;

    if (effectiveGoogleActive && !googleIsAdmin) {
      setIsAdminModalOpen(true);
      return;
    }

    setConfirmState({
      title: t.restoreConfirmTitle,
      message: t.restoreConfirmMsg,
      confirmLabel: t.restoreConfirmBtn,
      onConfirm: async () => {
        if (effectiveGoogleActive) {
          await applyGoogleRestoredItemsBatch(snapshot.items, 'replace');
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
        setItems(restored);
        showToast(
          'ok',
          lang === 'fr'
            ? 'Sauvegarde locale restaurée.'
            : 'تم استرجاع النسخة الاحتياطية المحلية.'
        );
      },
    });
  };

  const handleDeleteCloudBackup = async (backupId: string) => {
    if (effectiveGoogleActive) {
      if (!googleIsAdmin) {
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

    setBackups((prev) => prev.filter((b) => b.id !== backupId));
    showToast('ok', lang === 'fr' ? 'Sauvegarde supprimée.' : 'تم حذف النسخة الاحتياطية.');
  };

  const handleImportJsonBackup = async (
    importedItems: EquipmentItem[],
    mode: 'replace' | 'merge'
  ) => {
    if (effectiveGoogleActive) {
      if (!googleIsAdmin) {
        setIsAdminModalOpen(true);
        return;
      }
      await applyGoogleRestoredItemsBatch(importedItems, mode);
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
      createdByUid: 'local_pc_user',
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
      setItems(normalized);
    } else {
      setItems((prev) => {
        const existingIds = new Set(prev.map((i) => i.id));
        const additions = normalized.filter((i) => !existingIds.has(i.id));
        return [...additions, ...prev];
      });
    }
    showToast(
      'ok',
      lang === 'fr'
        ? 'Sauvegarde importée sur votre PC.'
        : 'تم استرجاع النسخة الاحتياطية على الحاسوب.'
    );
  };

  const handleSyncWithColleagues = async () => {
    if (isSyncingColleagues) return;
    if (isSyncActionBlocked) {
      showToast('err', syncLockState.lockReason || t.transferLockedByAdminMsg);
      return;
    }

    if (effectiveGoogleActive) {
      setIsSyncingColleagues(true);
      try {
        const eqQuery = query(
          collection(db, 'equipment'),
          where('workspaceKey', '==', WORKSPACE_KEY)
        );
        const orgQuery = query(
          collection(db, 'orgAssets'),
          where('workspaceKey', '==', WORKSPACE_KEY)
        );
        await syncPendingCloudWrites();
        const [eqSnap, orgSnap] = await Promise.all([
          getDocsFromServer(eqQuery),
          getDocsFromServer(orgQuery),
        ]);
        const nextItems = eqSnap.docs.map(mapEquipmentDoc);
        nextItems.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setGoogleItems(nextItems);
        const nextAssets = orgSnap.docs.map(mapOrgAssetDoc);
        nextAssets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
        setGoogleOrgAssets(nextAssets);
        setSyncConnected(true);
        setSyncFromCache(false);
        setHasPendingWrites(false);
        showToast('ok', t.refreshSuccessMsg);
      } catch {
        showToast('err', t.syncColleaguesOffline);
      } finally {
        setIsSyncingColleagues(false);
      }
      return;
    }

    setIsSyncingColleagues(true);
    try {
      const result = await syncColleaguesWithCloud({
        items,
        orgAssets,
        deletedRecords,
        actorName: safeActor,
        bypassLock: isPrimaryAdmin,
      });

      setItems(result.mergedItems);
      setOrgAssets(result.mergedOrgAssets);
      setDeletedRecords(result.mergedDeleted);
      setLastColleagueSyncAt(result.syncedAtIso);

      writeJsonStorage(LOCAL_ITEMS_KEY, result.mergedItems);
      writeJsonStorage(LOCAL_ORG_ASSETS_KEY, result.mergedOrgAssets);
      writeJsonStorage(LOCAL_DELETED_RECORDS_KEY, result.mergedDeleted);

      if (googleUser && googleUnlocked) {
        void recordAuditLog({
          db,
          firebaseUser: googleUser,
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

  // Mode 2 Handlers: Google + Internet Mode
  const handleOpenGoogleMode = () => {
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('err', t.googleModeNeedInternet);
      return;
    }
    if (isFileProtocol) {
      setIsFileProtocolNoticeOpen(true);
      return;
    }
    if (googleUser && googleUnlocked) {
      setGoogleModeEnabled(true);
      showToast('ok', t.refreshSuccessMsg);
      return;
    }
    setGoogleAuthError('');
    setIsGoogleModalOpen(true);
  };

  const handleSwitchToLocalMode = () => {
    setGoogleModeEnabled(false);
    setSelectedItemId(null);
    showToast(
      'ok',
      lang === 'fr'
        ? 'Retour au mode local sur PC.'
        : 'تم الرجوع إلى الوضع المحلي على الحاسوب.'
    );
  };

  const handleGooglePopupSignIn = async () => {
    setGoogleAuthLoading(true);
    setGoogleAuthError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setGoogleAuthError(
        err instanceof Error && err.message.includes('popup')
          ? t.errPopupClosed
          : t.errGoogleFailed
      );
    } finally {
      setGoogleAuthLoading(false);
    }
  };

  const handleGoogleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!googleUser) return;

    const trimmedName = (actorName.trim() || googleUser.displayName || '').trim().slice(0, 80);
    const trimmedCode = googleAccessCode.trim();

    if (!trimmedName) {
      setGoogleAuthError(t.errEnterName);
      return;
    }
    if (!trimmedCode) {
      setGoogleAuthError(t.errEnterCode);
      return;
    }
    if (trimmedCode !== WORKSPACE_KEY) {
      setGoogleAuthError(t.errWrongCode);
      return;
    }

    setGoogleAuthLoading(true);
    setGoogleAuthError('');
    const memberPath = `teamMembers/${googleUser.uid}`;

    try {
      const ref = doc(db, 'teamMembers', googleUser.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, { displayName: trimmedName });
      } else {
        await setDoc(ref, {
          uid: googleUser.uid,
          displayName: trimmedName,
          role: 'member',
          accessCode: trimmedCode,
          joinedAt: serverTimestamp(),
        });
      }
      setActorName(trimmedName);
      try {
        localStorage.setItem(LOCAL_GOOGLE_UNLOCKED_UID_KEY, googleUser.uid);
      } catch {
        // Ignore storage errors
      }
      setGoogleUnlocked(true);
      setGoogleModeEnabled(true);
      setGoogleAccessCode('');
      setIsGoogleModalOpen(false);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, memberPath);
      } catch (wrapped) {
        setGoogleAuthError(
          wrapped instanceof Error && wrapped.message.includes('permission')
            ? t.errAuthUnverified
            : t.errCloudVerify
        );
      }
    } finally {
      setGoogleAuthLoading(false);
    }
  };

  const handleGoogleSignOut = async () => {
    try {
      localStorage.removeItem(LOCAL_GOOGLE_UNLOCKED_UID_KEY);
    } catch {
      // Ignore storage errors
    }
    setGoogleModeEnabled(false);
    setGoogleUnlocked(false);
    setSelectedItemId(null);
    await signOut(auth);
  };

  const handlePushLocalToGoogle = async () => {
    if (!effectiveGoogleActive || !googleUser || pushingLocalToGoogle) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      showToast('err', t.googleModeNeedInternet);
      return;
    }
    if (isSyncActionBlocked) {
      showToast('err', syncLockState.lockReason || t.transferLockedByAdminMsg);
      return;
    }

    setPushingLocalToGoogle(true);
    try {
      const result = await transferLocalToCloud({
        db,
        firebaseUser: googleUser,
        isAdmin: googleIsAdmin,
        actorName: safeActor,
        localItems: items,
        localOrgAssets: orgAssets,
        cloudItems: googleItems,
        cloudOrgAssets: googleOrgAssets,
      });

      void recordAuditLog({
        db,
        firebaseUser: googleUser,
        sourceMode: 'transfer',
        action: 'transfer_to_cloud',
        entityType: 'equipment',
        entityId: WORKSPACE_KEY,
        entityLabel: 'Local → Cloud',
        details: `+eq=${result.createdEquipment}, ~eq=${result.updatedEquipment}, notes=${result.notesUploaded}, +assets=${result.createdAssets}`,
        actorName: safeActor,
      });

      showToast(
        'ok',
        `${t.transferLocalToCloudDone} (+${result.createdEquipment + result.createdAssets}, ~${result.updatedEquipment + result.updatedAssets}, ${result.notesUploaded} notes)`
      );
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, 'equipment');
    } finally {
      setPushingLocalToGoogle(false);
    }
  };

  const handlePullGoogleToLocal = async () => {
    if (!effectiveGoogleActive || !googleUser || pushingLocalToGoogle) return;
    if (isSyncActionBlocked) {
      showToast('err', syncLockState.lockReason || t.transferLockedByAdminMsg);
      return;
    }

    setPushingLocalToGoogle(true);
    try {
      const result = await transferCloudToLocal({
        db,
        cloudItems: googleItems,
        cloudOrgAssets: googleOrgAssets,
        cloudBackups: googleBackups,
      });

      setItems(result.mergedItems);
      setOrgAssets(result.mergedOrgAssets);
      setBackups(result.mergedBackups);

      void recordAuditLog({
        db,
        firebaseUser: googleUser,
        sourceMode: 'transfer',
        action: 'transfer_to_local',
        entityType: 'equipment',
        entityId: WORKSPACE_KEY,
        entityLabel: 'Cloud → Local',
        details: `+eq=${result.addedEquipment}, ~eq=${result.updatedEquipment}, notes=${result.notesMerged}, +assets=${result.addedAssets}`,
        actorName: safeActor,
      });

      showToast(
        'ok',
        `${t.transferCloudToLocalDone} (+${result.addedEquipment + result.addedAssets}, ~${result.updatedEquipment + result.updatedAssets}, ${result.notesMerged} notes)`
      );
    } catch (err) {
      console.error('Pull cloud->local error:', err);
      showToast('err', t.refreshErrorMsg);
    } finally {
      setPushingLocalToGoogle(false);
    }
  };

  const handlePullLocalSyncFromAdminModal = async (
    syncedEq: EquipmentItem[],
    syncedAssets: OrganizationAsset[]
  ) => {
    if (!googleUser) return;
    const result = await transferLocalToCloud({
      db,
      firebaseUser: googleUser,
      isAdmin: true,
      actorName: safeActor,
      localItems: syncedEq,
      localOrgAssets: syncedAssets,
      cloudItems: googleItems,
      cloudOrgAssets: googleOrgAssets,
    });
    await recordAuditLog({
      db,
      firebaseUser: googleUser,
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

  return (
    <>
      <div className="no-print min-h-screen bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        {/* Top Navigation Bar */}
        <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-6 py-3.5 md:flex-nowrap md:gap-6">
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

        {/* Dual Mode Workspace Bar (Local PC vs Google + Internet) */}
        <div className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900/60">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-4 px-6 py-2.5 text-xs">
            <div className="flex flex-wrap items-center gap-4">
              {effectiveGoogleActive ? (
                <div className="flex flex-wrap items-center gap-2 font-semibold text-sky-700 dark:text-sky-400">
                  <Cloud className="h-4 w-4" />
                  <span>
                    {t.googleModeBannerPrefix}{' '}
                    <span className="font-mono">{googleUser?.email || safeActor}</span>
                    {hasPendingWrites
                      ? ` (${t.firebasePendingSync})`
                      : syncFromCache
                        ? ` (${t.firebaseCachedSync})`
                        : syncConnected
                          ? ` — ${t.firebaseConnected}`
                          : ''}
                  </span>
                </div>
              ) : (
                <div className="flex items-center gap-2 font-semibold text-emerald-700 dark:text-emerald-400">
                  <HardDrive className="h-4 w-4" />
                  <span>{t.localModeBanner}</span>
                </div>
              )}

              <div className="flex items-center gap-2">
                <UserCheck className="h-3.5 w-3.5 text-slate-400" />
                <span className="text-slate-500 dark:text-slate-400">{t.yourTeamName}</span>
                <input
                  type="text"
                  maxLength={80}
                  value={actorName}
                  onChange={(e) => setActorName(e.target.value)}
                  placeholder={t.fullNamePlaceholder}
                  className="w-40 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-800 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {!effectiveGoogleActive ? (
                <button
                  type="button"
                  onClick={handleOpenGoogleMode}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-800 transition hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-900/60"
                >
                  <Cloud className="h-3.5 w-3.5" />
                  {t.enableGoogleModeBtn}
                </button>
              ) : (
                <>
                  {(items.length > 0 || orgAssets.length > 0) && (
                    <button
                      type="button"
                      onClick={() => void handlePushLocalToGoogle()}
                      disabled={pushingLocalToGoogle}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800 transition hover:bg-amber-100 disabled:opacity-60 dark:border-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                    >
                      {isSyncActionBlocked ? (
                        <Lock className="h-3.5 w-3.5" />
                      ) : (
                        <UploadCloud className="h-3.5 w-3.5" />
                      )}
                      {t.transferLocalToCloudBtn}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => void handlePullGoogleToLocal()}
                    disabled={pushingLocalToGoogle}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-teal-300 bg-teal-50 px-3 py-1.5 text-xs font-semibold text-teal-800 transition hover:bg-teal-100 disabled:opacity-60 dark:border-teal-800 dark:bg-teal-950/50 dark:text-teal-300"
                  >
                    {isSyncActionBlocked ? (
                      <Lock className="h-3.5 w-3.5" />
                    ) : (
                      <DownloadCloud className="h-3.5 w-3.5" />
                    )}
                    {t.transferCloudToLocalBtn}
                  </button>
                  <button
                    type="button"
                    onClick={handleSwitchToLocalMode}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                  >
                    <HardDrive className="h-3.5 w-3.5" />
                    {t.switchToLocalModeBtn}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleGoogleSignOut()}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-600 transition hover:border-red-300 hover:text-red-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
                    title={t.googleSignOutBtn}
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    {t.googleSignOutBtn}
                  </button>
                </>
              )}

              {/* Language Switcher */}
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

              {effectiveGoogleActive ? (
                <button
                  type="button"
                  onClick={() => setIsAdminModalOpen(true)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                    effectiveIsAdmin
                      ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
                      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200'
                  }`}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {isPrimaryAdmin
                    ? t.primaryAdminControlBtn
                    : effectiveIsAdmin
                      ? t.adminModeActive
                      : t.teamModeLabel}
                </button>
              ) : (
                <span className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {t.adminModeActive}
                </span>
              )}

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
              {effectiveGoogleActive && isPrimaryAdmin && (
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

        {/* Main Content */}
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

          {/* TAB 1: Dashboard */}
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

                <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200">
                  <input
                    type="checkbox"
                    checked={onlyDelayed}
                    onChange={(e) => setOnlyDelayed(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-slate-300 text-[#0F4C81]"
                  />
                  {t.delayedOnlyBtn}
                </label>
              </div>

              {filteredItems.length === 0 ? (
                <div className="p-12 text-center">
                  <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                    {activeItems.length === 0 ? t.emptyTitle : t.emptySearchTitle}
                  </p>
                  <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                    {activeItems.length === 0 ? t.emptyDesc : t.emptySearchDesc}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-start text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                        <th className="px-4 py-3 text-start">{t.thEquipmentNum}</th>
                        <th className="px-4 py-3 text-start">{t.thCatCond}</th>
                        <th className="px-4 py-3 text-start">{t.entryDateLabel} / {t.expectedExitLabel}</th>
                        <th className="px-4 py-3 text-start">{t.thDelays}</th>
                        <th className="px-4 py-3 text-start">{t.thTeamWrite}</th>
                        <th className="px-4 py-3 text-end">{t.thActions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {filteredItems.map((item) => {
                        const overdueDays = calculateOverdueDays(item);
                        const delayed = hasWorkshopDelay(item) || overdueDays > 0;

                        return (
                          <tr
                            key={item.id}
                            className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                          >
                            <td className="px-4 py-3.5 text-start">
                              <button
                                type="button"
                                onClick={() => setSelectedItemId(item.id)}
                                className="text-start font-bold text-slate-900 hover:text-[#0F4C81] dark:text-white dark:hover:text-sky-400"
                              >
                                {item.name}
                              </button>
                              <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                                <span className="font-mono font-semibold text-[#0F4C81] dark:text-sky-400">
                                  {item.equipmentNumber}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span>{item.location}</span>
                              </div>
                            </td>

                            <td className="px-4 py-3.5 text-start">
                              <div className="text-xs font-medium text-slate-600 dark:text-slate-300">
                                {CATEGORY_LABELS[lang][item.category]}
                              </div>
                              <div className={`mt-1 text-xs font-bold ${conditionTone(item.condition)}`}>
                                {CONDITION_LABELS[lang][item.condition]}
                              </div>
                            </td>

                            <td className="font-mono px-4 py-3.5 text-start text-xs text-slate-600 dark:text-slate-300">
                              <div>
                                {t.entryDateLabel}: {item.entryDate}
                              </div>
                              <div className="mt-0.5">
                                {t.expectedExitLabel}: {item.expectedExitDate}
                              </div>
                              {item.finalExitDate && (
                                <div className="mt-0.5 font-semibold text-emerald-700 dark:text-emerald-400">
                                  {t.finalExitDateLabel}: {item.finalExitDate}
                                </div>
                              )}
                              {overdueDays > 0 && (
                                <div className="mt-1 font-semibold text-red-600 dark:text-red-400">
                                  {t.overdueDaysPrefix} {overdueDays} {t.dayUnit}
                                </div>
                              )}
                            </td>

                            <td className="max-w-xs px-4 py-3.5 text-start text-xs">
                              {!delayed ? (
                                <span className="text-slate-400 dark:text-slate-500">
                                  {t.noDelaysRecorded}
                                </span>
                              ) : (
                                <div className="space-y-1.5">
                                  {item.delayServices && (
                                    <div className="flex items-start gap-1.5">
                                      <Wrench className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                                      <div>
                                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                                          {t.delayServicesLabel}{' '}
                                        </span>
                                        <span className="text-slate-600 dark:text-slate-300">
                                          {item.delayServicesNote || t.selectedNoDetails}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                  {item.delaySpareParts && (
                                    <div className="flex items-start gap-1.5">
                                      <PackageX className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
                                      <div>
                                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                                          {t.delaySparePartsLabel}{' '}
                                        </span>
                                        <span className="text-slate-600 dark:text-slate-300">
                                          {item.delaySparePartsNote || t.selectedNoDetails}
                                        </span>
                                      </div>
                                    </div>
                                  )}
                                  {item.delayOther && (
                                    <div className="flex items-start gap-1.5">
                                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-600 dark:text-slate-400" />
                                      <div>
                                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                                          {t.delayOtherLabel}{' '}
                                        </span>
                                        <span className="text-slate-600 dark:text-slate-300">
                                          {item.delayOtherNote || t.selectedNoDetails}
                                        </span>
                                      </div>
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
                                <button
                                  type="button"
                                  onClick={() => requestDeleteItem(item)}
                                  className={`rounded-md border p-1.5 transition ${
                                    effectiveIsAdmin
                                      ? 'border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/50'
                                      : 'border-slate-200 text-slate-400 hover:bg-slate-50 dark:border-slate-800 dark:text-slate-600'
                                  }`}
                                  title={
                                    effectiveIsAdmin ? t.deleteTooltip : t.deleteLockedTooltip
                                  }
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
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

          {/* TAB 1B: Monthly Entry-Date Archive */}
          {activeTab === 'monthlyArchive' && (
            <MonthlyArchiveView
              items={activeItems}
              isAdmin={effectiveIsAdmin}
              lang={lang}
              onSelectItem={(id) => setSelectedItemId(id)}
              onEditItem={(item) => {
                setEditingItem(item);
                setIsEquipmentModalOpen(true);
              }}
              onDeleteItem={requestDeleteItem}
              onOpenAdminLogin={() => {
                if (effectiveGoogleActive) setIsAdminModalOpen(true);
              }}
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

          {/* TAB 2: Delays View */}
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

          {/* TAB 3: Date Reports & Exports */}
          {activeTab === 'exports' && (
            <div className="space-y-6">
              <DateReportsCenter
                items={activeItems}
                lang={lang}
                onPrint={(reportItems, title, subtitle) =>
                  triggerPrint(reportItems, title, subtitle)
                }
                onShare={(reportItems, title, subtitle) =>
                  setShareState({
                    isOpen: true,
                    items: reportItems,
                    title,
                    subtitle,
                  })
                }
              />

              <div id="dawlind-archive-section">
                <WorkReportArchivePanel
                  allItems={activeItems}
                  filteredItems={filteredItems}
                  delayedItems={delayedItems}
                  actorName={safeActor}
                  lang={lang}
                  onNotify={showToast}
                />
              </div>
            </div>
          )}

          {/* TAB 4: Backups */}
          {activeTab === 'backups' && (
            <BackupRestoreView
              items={activeItems}
              backups={activeBackups}
              isAdmin={effectiveIsAdmin}
              lang={lang}
              onCreateCloudBackup={handleCreateCloudBackup}
              onRestoreCloudBackup={handleRestoreCloudBackup}
              onDeleteCloudBackup={handleDeleteCloudBackup}
              onImportJsonBackup={handleImportJsonBackup}
              onPrintAll={() =>
                triggerPrint(
                  activeItems,
                  lang === 'fr'
                    ? 'Registre complet des équipements et de la maintenance'
                    : 'السجل الشامل للمعدات والصيانة'
                )
              }
              onOpenAdminLogin={() => {
                if (effectiveGoogleActive) setIsAdminModalOpen(true);
              }}
            />
          )}

          {/* TAB 5: Organization Inventory */}
          {activeTab === 'inventory' && (
            <OrgInventoryView
              assets={activeOrgAssets}
              loading={effectiveGoogleActive && googleLoading}
              isAdmin={effectiveIsAdmin}
              lang={lang}
              onSaveAsset={handleSaveOrgAsset}
              onDeleteAsset={requestDeleteOrgAsset}
              onOpenAdminLogin={() => {
                if (effectiveGoogleActive) setIsAdminModalOpen(true);
              }}
            />
          )}
        </main>
      </div>

      {/* Print Sheet */}
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

      {/* Drawer & Modals */}
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

      {effectiveGoogleActive && googleUser && (
        <AdminAuthModal
          isOpen={isAdminModalOpen}
          isAdmin={googleIsAdmin}
          currentUid={googleUser.uid}
          currentEmail={googleUser.email || ''}
          actorName={safeActor}
          lang={lang}
          syncRefreshLocked={syncLockState.locked}
          syncLockReason={syncLockState.lockReason}
          onPullLocalSyncToCloud={handlePullLocalSyncFromAdminModal}
          onClose={() => setIsAdminModalOpen(false)}
        />
      )}

      {/* Mode 2 Modal: Google + Internet Sign-In & Team Access Code */}
      {isGoogleModalOpen && (
        <div className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="h-5 w-5 text-[#0F4C81] dark:text-sky-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {t.googleModeTitle}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsGoogleModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mb-4 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {t.googleModeDesc}
            </p>

            {googleAuthError && (
              <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
                {googleAuthError}
              </div>
            )}

            {!googleUser ? (
              <div className="space-y-3">
                <button
                  type="button"
                  disabled={googleAuthLoading}
                  onClick={() => void handleGooglePopupSignIn()}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c3c66] disabled:opacity-50"
                >
                  <ShieldCheck className="h-4 w-4" />
                  {googleAuthLoading ? t.openingGoogle : t.signInGoogle}
                </button>
                <button
                  type="button"
                  onClick={() => setIsGoogleModalOpen(false)}
                  className="w-full rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                >
                  {t.cancel}
                </button>
              </div>
            ) : (
              <form onSubmit={(e) => void handleGoogleVerifyCode(e)} className="space-y-4">
                <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-950">
                  <span className="truncate font-medium text-slate-700 dark:text-slate-300">
                    {googleUser.email}
                  </span>
                  <button
                    type="button"
                    onClick={() => void signOut(auth)}
                    className="flex items-center gap-1 text-slate-500 hover:text-red-600 dark:text-slate-400"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    {t.switchAccount}
                  </button>
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t.fullNameLabel}
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={actorName}
                    onChange={(e) => setActorName(e.target.value)}
                    placeholder={t.fullNamePlaceholder}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    {t.accessCodeLabel}
                  </label>
                  <div className="relative">
                    <Lock className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="password"
                      required
                      maxLength={32}
                      value={googleAccessCode}
                      onChange={(e) => setGoogleAccessCode(e.target.value)}
                      placeholder={t.accessCodePlaceholder}
                      className="font-mono w-full rounded-lg border border-slate-300 bg-white py-2 ps-9 pe-3 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setIsGoogleModalOpen(false)}
                    className="rounded-lg border border-slate-300 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                  >
                    {t.cancel}
                  </button>
                  <button
                    type="submit"
                    disabled={googleAuthLoading}
                    className="flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-4 py-2 text-xs font-semibold text-white hover:bg-[#0c3c66] disabled:opacity-50"
                  >
                    <LogIn className="h-3.5 w-3.5" />
                    {googleAuthLoading ? t.verifying : t.enterDashboard}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Notice Modal when opening Google Mode from file:// on disk */}
      {isFileProtocolNoticeOpen && (
        <div className="no-print fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Cloud className="h-5 w-5 text-[#0F4C81] dark:text-sky-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {t.googleModeFileProtocolTitle}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsFileProtocolNoticeOpen(false)}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {t.googleModeFileProtocolDesc}
            </p>

            <div className="mt-5 flex flex-col gap-2">
              <a
                href={getCloudWebUrl()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setIsFileProtocolNoticeOpen(false)}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-xs font-semibold text-white transition hover:bg-[#0c3c66]"
              >
                <ExternalLink className="h-4 w-4" />
                {t.openGoogleWebLinkBtn}
              </a>
              <button
                type="button"
                onClick={() => setIsFileProtocolNoticeOpen(false)}
                className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
              >
                <HardDrive className="h-4 w-4" />
                {t.stayLocalSyncBtn}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div
          className={`no-print fixed bottom-4 end-4 z-50 rounded-lg px-4 py-2.5 text-xs font-semibold text-white shadow-lg ${
            toast.type === 'ok' ? 'bg-slate-900 dark:bg-slate-800' : 'bg-red-600'
          }`}
        >
          {toast.text}
        </div>
      )}
    </>
  );
}
