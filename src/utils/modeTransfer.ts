import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
  writeBatch,
  type Firestore,
} from 'firebase/firestore';
import type { User } from 'firebase/auth';
import { WORKSPACE_KEY } from '../firebase';
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CONDITIONS,
  ORG_ASSET_STATUSES,
  type CloudBackupSnapshot,
  type EquipmentCategory,
  type EquipmentCondition,
  type EquipmentItem,
  type OrgAssetStatus,
  type OrganizationAsset,
  type TeamNote,
} from '../types';
import {
  LOCAL_DELETED_RECORDS_KEY,
  mergeNotesLists,
  sanitizeFirestoreId,
  type DeletedRecordsMap,
} from './localCloudSync';

export const LOCAL_ITEMS_KEY = 'crm_local_items_v1';
export const LOCAL_ORG_ASSETS_KEY = 'crm_local_org_assets_v1';
export const LOCAL_BACKUPS_KEY = 'crm_local_backups_v1';
export const LOCAL_ACTOR_KEY = 'crm_local_actor_name_v1';
export const UNIFIED_WORK_MODE_KEY = 'crm_unified_work_mode_v1';

export type WorkMode = 'local' | 'cloud';

export type AuditSourceMode = 'cloud' | 'local' | 'transfer' | 'admin';
export type AuditAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'note'
  | 'sync'
  | 'transfer_to_cloud'
  | 'transfer_to_local'
  | 'lock_toggle'
  | 'permission_change'
  | 'backup_restore';
export type AuditEntityType =
  | 'equipment'
  | 'orgAsset'
  | 'note'
  | 'backup'
  | 'team'
  | 'settings';

export function readLocalJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeLocalJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore quota errors cleanly
  }
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

function parseTs(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

function normalizeNaturalKey(a: string, b: string): string {
  return `${a.trim().toLowerCase()}|${b.trim().toLowerCase()}`;
}

export async function recordAuditLog(params: {
  db: Firestore;
  firebaseUser: User | null;
  sourceMode: AuditSourceMode;
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  entityLabel: string;
  details: string;
  actorName: string;
}): Promise<void> {
  if (!params.firebaseUser) return;
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return;

  const logId = `log_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  try {
    await setDoc(doc(params.db, 'auditLogs', logId), {
      workspaceKey: WORKSPACE_KEY,
      sourceMode: params.sourceMode,
      action: params.action,
      entityType: params.entityType,
      entityId: sanitizeFirestoreId(params.entityId, 'ent'),
      entityLabel: (params.entityLabel || params.entityId).trim().slice(0, 200) || 'Record',
      details: (params.details || '').trim().slice(0, 400),
      actorUid: params.firebaseUser.uid,
      actorName:
        (params.actorName || params.firebaseUser.displayName || 'User')
          .trim()
          .slice(0, 80) || 'User',
      createdAt: serverTimestamp(),
    });
  } catch {
    // Audit logging is non-blocking so offline or transient restrictions never interrupt work
  }
}

export interface CloudToLocalTransferResult {
  addedEquipment: number;
  updatedEquipment: number;
  notesMerged: number;
  addedAssets: number;
  updatedAssets: number;
  mergedItems: EquipmentItem[];
  mergedOrgAssets: OrganizationAsset[];
  mergedBackups: CloudBackupSnapshot[];
}

export async function transferCloudToLocal(params: {
  db: Firestore;
  cloudItems: EquipmentItem[];
  cloudOrgAssets: OrganizationAsset[];
  cloudBackups: CloudBackupSnapshot[];
}): Promise<CloudToLocalTransferResult> {
  const existingLocalItems = readLocalJson<EquipmentItem[]>(LOCAL_ITEMS_KEY, []);
  const existingLocalAssets = readLocalJson<OrganizationAsset[]>(LOCAL_ORG_ASSETS_KEY, []);
  const existingLocalBackups = readLocalJson<CloudBackupSnapshot[]>(LOCAL_BACKUPS_KEY, []);
  const deletedMap = readLocalJson<DeletedRecordsMap>(LOCAL_DELETED_RECORDS_KEY, {
    equipment: {},
    orgAssets: {},
  });

  // Fetch notes subcollections for all cloud equipment items in parallel chunks
  const notesByEqId = new Map<string, TeamNote[]>();
  const chunkSize = 10;
  for (let i = 0; i < params.cloudItems.length; i += chunkSize) {
    const chunk = params.cloudItems.slice(i, i + chunkSize);
    await Promise.all(
      chunk.map(async (eq) => {
        try {
          const notesSnap = await getDocs(
            query(
              collection(params.db, 'equipment', eq.id, 'notes'),
              where('workspaceKey', '==', WORKSPACE_KEY)
            )
          );
          const fetched: TeamNote[] = notesSnap.docs.map((d) => {
            const data = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              workspaceKey: WORKSPACE_KEY,
              equipmentId: eq.id,
              authorUid: String(data.authorUid || ''),
              author: String(data.author || 'Colleague'),
              role: data.role === 'member' ? 'member' : 'admin',
              text: String(data.text || ''),
              createdAt: toIsoString(data.createdAt),
            };
          });
          notesByEqId.set(eq.id, fetched);
        } catch {
          notesByEqId.set(eq.id, eq.teamNotes || []);
        }
      })
    );
  }

  const localById = new Map<string, EquipmentItem>();
  const localByNatural = new Map<string, string>();
  for (const item of existingLocalItems) {
    const safeId = sanitizeFirestoreId(item.id, 'eq');
    localById.set(safeId, { ...item, id: safeId });
    const nat = normalizeNaturalKey(item.equipmentNumber, item.name);
    if (!localByNatural.has(nat)) {
      localByNatural.set(nat, safeId);
    }
  }

  let addedEquipment = 0;
  let updatedEquipment = 0;
  let notesMerged = 0;
  const nextEqDeleted = { ...(deletedMap.equipment || {}) };

  for (const cloudItem of params.cloudItems) {
    const cloudNotes = notesByEqId.get(cloudItem.id) || cloudItem.teamNotes || [];
    const natKey = normalizeNaturalKey(cloudItem.equipmentNumber, cloudItem.name);
    const matchedId = localById.has(cloudItem.id)
      ? cloudItem.id
      : localByNatural.get(natKey);

    if (!matchedId) {
      localById.set(cloudItem.id, {
        ...cloudItem,
        teamNotes: mergeNotesLists([], cloudNotes),
      });
      delete nextEqDeleted[cloudItem.id];
      addedEquipment += 1;
      notesMerged += cloudNotes.length;
    } else {
      const localItem = localById.get(matchedId)!;
      const mergedNotes = mergeNotesLists(localItem.teamNotes || [], cloudNotes);
      const addedNotes = mergedNotes.length - (localItem.teamNotes || []).length;
      if (addedNotes > 0) notesMerged += addedNotes;

      const cloudNewer = parseTs(cloudItem.updatedAt) >= parseTs(localItem.updatedAt);
      const winner = cloudNewer ? cloudItem : localItem;
      localById.set(matchedId, {
        ...winner,
        id: matchedId,
        workspaceKey: WORKSPACE_KEY,
        teamNotes: mergedNotes,
        createdAt: localItem.createdAt || cloudItem.createdAt,
      });
      delete nextEqDeleted[matchedId];
      if (cloudNewer || addedNotes > 0) updatedEquipment += 1;
    }
  }

  const mergedItems = Array.from(localById.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  // Merge Org Assets without duplication
  const assetById = new Map<string, OrganizationAsset>();
  const assetByNatural = new Map<string, string>();
  for (const a of existingLocalAssets) {
    const safeId = sanitizeFirestoreId(a.id, 'asset');
    assetById.set(safeId, { ...a, id: safeId });
    const nat = normalizeNaturalKey(a.assetNumber, a.name);
    if (!assetByNatural.has(nat)) {
      assetByNatural.set(nat, safeId);
    }
  }

  let addedAssets = 0;
  let updatedAssets = 0;
  const nextAssetDeleted = { ...(deletedMap.orgAssets || {}) };

  for (const cloudAsset of params.cloudOrgAssets) {
    const natKey = normalizeNaturalKey(cloudAsset.assetNumber, cloudAsset.name);
    const matchedId = assetById.has(cloudAsset.id)
      ? cloudAsset.id
      : assetByNatural.get(natKey);

    if (!matchedId) {
      assetById.set(cloudAsset.id, { ...cloudAsset });
      delete nextAssetDeleted[cloudAsset.id];
      addedAssets += 1;
    } else {
      const localAsset = assetById.get(matchedId)!;
      if (parseTs(cloudAsset.updatedAt) >= parseTs(localAsset.updatedAt)) {
        assetById.set(matchedId, {
          ...cloudAsset,
          id: matchedId,
          workspaceKey: WORKSPACE_KEY,
        });
        updatedAssets += 1;
      }
      delete nextAssetDeleted[matchedId];
    }
  }

  const mergedOrgAssets = Array.from(assetById.values()).sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  // Merge Backups by ID without duplication
  const backupById = new Map<string, CloudBackupSnapshot>();
  for (const b of existingLocalBackups) backupById.set(b.id, b);
  for (const b of params.cloudBackups) backupById.set(b.id, b);
  const mergedBackups = Array.from(backupById.values()).sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt)
  );

  writeLocalJson(LOCAL_ITEMS_KEY, mergedItems);
  writeLocalJson(LOCAL_ORG_ASSETS_KEY, mergedOrgAssets);
  writeLocalJson(LOCAL_BACKUPS_KEY, mergedBackups);
  writeLocalJson(LOCAL_DELETED_RECORDS_KEY, {
    equipment: nextEqDeleted,
    orgAssets: nextAssetDeleted,
  });

  return {
    addedEquipment,
    updatedEquipment,
    notesMerged,
    addedAssets,
    updatedAssets,
    mergedItems,
    mergedOrgAssets,
    mergedBackups,
  };
}

export interface LocalToCloudTransferResult {
  createdEquipment: number;
  updatedEquipment: number;
  skippedEquipment: number;
  notesUploaded: number;
  createdAssets: number;
  updatedAssets: number;
  skippedAssets: number;
}

export async function transferLocalToCloud(params: {
  db: Firestore;
  firebaseUser: User;
  isAdmin: boolean;
  actorName: string;
  localItems: EquipmentItem[];
  localOrgAssets: OrganizationAsset[];
  cloudItems: EquipmentItem[];
  cloudOrgAssets: OrganizationAsset[];
}): Promise<LocalToCloudTransferResult> {
  const cloudEqById = new Map<string, EquipmentItem>();
  const cloudEqByNatural = new Map<string, EquipmentItem>();
  for (const item of params.cloudItems) {
    cloudEqById.set(item.id, item);
    const nat = normalizeNaturalKey(item.equipmentNumber, item.name);
    if (!cloudEqByNatural.has(nat)) {
      cloudEqByNatural.set(nat, item);
    }
  }

  const cloudAssetById = new Map<string, OrganizationAsset>();
  const cloudAssetByNatural = new Map<string, OrganizationAsset>();
  for (const asset of params.cloudOrgAssets) {
    cloudAssetById.set(asset.id, asset);
    const nat = normalizeNaturalKey(asset.assetNumber, asset.name);
    if (!cloudAssetByNatural.has(nat)) {
      cloudAssetByNatural.set(nat, asset);
    }
  }

  const batches: ReturnType<typeof writeBatch>[] = [writeBatch(params.db)];
  let opCount = 0;
  const pushOp = (fn: (b: ReturnType<typeof writeBatch>) => void) => {
    if (opCount >= 350) {
      batches.push(writeBatch(params.db));
      opCount = 0;
    }
    fn(batches[batches.length - 1]);
    opCount += 1;
  };

  let createdEquipment = 0;
  let updatedEquipment = 0;
  let skippedEquipment = 0;
  let notesUploaded = 0;

  const safeActor =
    (params.actorName || params.firebaseUser.displayName || 'Team Member')
      .trim()
      .slice(0, 80) || 'Team Member';

  for (const localItem of params.localItems) {
    const safeId = sanitizeFirestoreId(localItem.id, 'eq');
    const natKey = normalizeNaturalKey(localItem.equipmentNumber, localItem.name);
    const cloudMatch = cloudEqById.get(safeId) || cloudEqByNatural.get(natKey);
    const targetDocId = cloudMatch ? cloudMatch.id : safeId;

    const editableFields = {
      name: String(localItem.name || 'Equipment').trim().slice(0, 200) || 'Equipment',
      equipmentNumber:
        String(localItem.equipmentNumber || 'N/A').trim().slice(0, 80) || 'N/A',
      category: sanitizeCategory(localItem.category),
      condition: sanitizeCondition(localItem.condition),
      location: String(localItem.location || 'Atelier').trim().slice(0, 200) || 'Atelier',
      entryDate: sanitizeDateStr(localItem.entryDate),
      expectedExitDate: sanitizeDateStr(localItem.expectedExitDate),
      delayServices: Boolean(localItem.delayServices),
      delayServicesNote: String(localItem.delayServicesNote || '').trim().slice(0, 1500),
      delaySpareParts: Boolean(localItem.delaySpareParts),
      delaySparePartsNote: String(localItem.delaySparePartsNote || '')
        .trim()
        .slice(0, 1500),
      delayOther: Boolean(localItem.delayOther),
      delayOtherNote: String(localItem.delayOtherNote || '').trim().slice(0, 1500),
      finalExitDate: sanitizeOptionalDateStr(localItem.finalExitDate),
      lastUpdatedBy:
        (String(localItem.lastUpdatedBy || safeActor).trim() || safeActor).slice(0, 80),
      updatedAt: serverTimestamp(),
    };

    if (!cloudMatch) {
      pushOp((b) =>
        b.set(doc(params.db, 'equipment', targetDocId), {
          workspaceKey: WORKSPACE_KEY,
          ...editableFields,
          createdByUid: params.firebaseUser.uid,
          createdBy:
            (String(localItem.createdBy || safeActor).trim() || safeActor).slice(0, 80),
          createdAt: serverTimestamp(),
        })
      );
      createdEquipment += 1;

      for (const note of localItem.teamNotes || []) {
        if (!note.text?.trim()) continue;
        const noteId = sanitizeFirestoreId(note.id, 'note');
        pushOp((b) =>
          b.set(doc(params.db, 'equipment', targetDocId, 'notes', noteId), {
            workspaceKey: WORKSPACE_KEY,
            equipmentId: targetDocId,
            authorUid: params.firebaseUser.uid,
            author: (String(note.author || safeActor).trim() || safeActor).slice(0, 80),
            role: params.isAdmin ? 'admin' : 'member',
            text: note.text.trim().slice(0, 1000),
            createdAt: serverTimestamp(),
          })
        );
        notesUploaded += 1;
      }
    } else {
      const localNewer = parseTs(localItem.updatedAt) > parseTs(cloudMatch.updatedAt);
      if (localNewer) {
        pushOp((b) => b.update(doc(params.db, 'equipment', targetDocId), editableFields));
        updatedEquipment += 1;
      } else {
        skippedEquipment += 1;
      }

      // Safely sync only missing notes (check existing notes by ID + author/text signature)
      if ((localItem.teamNotes || []).length > 0) {
        let existingNoteIds = new Set<string>();
        let existingNoteSigs = new Set<string>();
        try {
          const notesSnap = await getDocs(
            query(
              collection(params.db, 'equipment', targetDocId, 'notes'),
              where('workspaceKey', '==', WORKSPACE_KEY)
            )
          );
          existingNoteIds = new Set(notesSnap.docs.map((d) => d.id));
          existingNoteSigs = new Set(
            notesSnap.docs.map((d) => {
              const data = d.data() as { author?: string; text?: string };
              return normalizeNaturalKey(data.author || '', data.text || '');
            })
          );
        } catch {
          // Proceed safely with ID deduplication
        }

        for (const note of localItem.teamNotes || []) {
          const trimmedText = note.text?.trim();
          if (!trimmedText) continue;
          const noteId = sanitizeFirestoreId(note.id, 'note');
          const sig = normalizeNaturalKey(note.author || safeActor, trimmedText);
          if (existingNoteIds.has(noteId) || existingNoteSigs.has(sig)) continue;
          existingNoteIds.add(noteId);
          existingNoteSigs.add(sig);
          pushOp((b) =>
            b.set(doc(params.db, 'equipment', targetDocId, 'notes', noteId), {
              workspaceKey: WORKSPACE_KEY,
              equipmentId: targetDocId,
              authorUid: params.firebaseUser.uid,
              author: (String(note.author || safeActor).trim() || safeActor).slice(0, 80),
              role: params.isAdmin ? 'admin' : 'member',
              text: trimmedText.slice(0, 1000),
              createdAt: serverTimestamp(),
            })
          );
          notesUploaded += 1;
        }
      }
    }
  }

  let createdAssets = 0;
  let updatedAssets = 0;
  let skippedAssets = 0;

  for (const localAsset of params.localOrgAssets) {
    const safeId = sanitizeFirestoreId(localAsset.id, 'asset');
    const natKey = normalizeNaturalKey(localAsset.assetNumber, localAsset.name);
    const cloudMatch = cloudAssetById.get(safeId) || cloudAssetByNatural.get(natKey);
    const targetDocId = cloudMatch ? cloudMatch.id : safeId;

    const assetFields = {
      name: String(localAsset.name || 'Asset').trim().slice(0, 200) || 'Asset',
      assetNumber: String(localAsset.assetNumber || 'N/A').trim().slice(0, 80) || 'N/A',
      status: sanitizeOrgAssetStatus(localAsset.status),
      lastUpdatedBy:
        (String(localAsset.lastUpdatedBy || safeActor).trim() || safeActor).slice(0, 80),
      updatedAt: serverTimestamp(),
    };

    if (!cloudMatch) {
      pushOp((b) =>
        b.set(doc(params.db, 'orgAssets', targetDocId), {
          workspaceKey: WORKSPACE_KEY,
          ...assetFields,
          createdByUid: params.firebaseUser.uid,
          createdBy:
            (String(localAsset.createdBy || safeActor).trim() || safeActor).slice(0, 80),
          createdAt: serverTimestamp(),
        })
      );
      createdAssets += 1;
    } else if (parseTs(localAsset.updatedAt) > parseTs(cloudMatch.updatedAt)) {
      pushOp((b) => b.update(doc(params.db, 'orgAssets', targetDocId), assetFields));
      updatedAssets += 1;
    } else {
      skippedAssets += 1;
    }
  }

  for (const batch of batches) {
    await batch.commit();
  }

  return {
    createdEquipment,
    updatedEquipment,
    skippedEquipment,
    notesUploaded,
    createdAssets,
    updatedAssets,
    skippedAssets,
  };
}
