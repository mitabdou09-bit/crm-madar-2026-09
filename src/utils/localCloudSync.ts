import firebaseConfig from '../../firebase-applet-config.json';
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CONDITIONS,
  ORG_ASSET_STATUSES,
  type EquipmentCategory,
  type EquipmentCondition,
  type EquipmentItem,
  type OrgAssetStatus,
  type OrganizationAsset,
  type TeamNote,
} from '../types';

export const LOCAL_DELETED_RECORDS_KEY = 'crm_local_deleted_ids_v1';
export const LOCAL_LAST_SYNC_KEY = 'crm_local_last_colleague_sync_v1';

export const LOCAL_SYNC_LOCK_CACHE_KEY = 'crm_workspace_sync_lock_v1';

const WORKSPACE_KEY = 'm1256';
const EQUIPMENT_COLLECTION = 'localSyncEquipment';
const ORG_ASSETS_COLLECTION = 'localSyncOrgAssets';
const SETTINGS_COLLECTION = 'workspaceSettings';

export interface DeletedRecordsMap {
  equipment: Record<string, string>;
  orgAssets: Record<string, string>;
}

export interface WorkspaceSyncLockStatus {
  locked: boolean;
  updatedBy?: string;
  lockReason?: string;
  updatedAtIso?: string;
}

export interface ColleagueSyncResult {
  uploadedCount: number;
  downloadedCount: number;
  mergedItems: EquipmentItem[];
  mergedOrgAssets: OrganizationAsset[];
  mergedDeleted: DeletedRecordsMap;
  syncedAtIso: string;
}

export class OfflineSyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'OfflineSyncError';
  }
}

export class SyncLockedError extends Error {
  updatedBy?: string;
  lockReason?: string;
  constructor(updatedBy?: string, lockReason?: string) {
    super(lockReason || 'Sync and refresh are locked by the Primary Admin');
    this.name = 'SyncLockedError';
    this.updatedBy = updatedBy;
    this.lockReason = lockReason;
  }
}

type FirestoreFieldValue =
  | { stringValue: string }
  | { booleanValue: boolean }
  | { integerValue: string }
  | { doubleValue: number }
  | { timestampValue: string }
  | { nullValue: null }
  | { arrayValue: { values?: FirestoreFieldValue[] } }
  | { mapValue: { fields?: Record<string, FirestoreFieldValue> } };

interface FirestoreDocumentPayload {
  name?: string;
  fields?: Record<string, FirestoreFieldValue>;
}

interface CloudEquipmentRecord {
  id: string;
  workspaceKey: string;
  name: string;
  equipmentNumber: string;
  category: EquipmentCategory;
  condition: EquipmentCondition;
  location: string;
  entryDate: string;
  expectedExitDate: string;
  delayServices: boolean;
  delayServicesNote: string;
  delaySpareParts: boolean;
  delaySparePartsNote: string;
  delayOther: boolean;
  delayOtherNote: string;
  finalExitDate: string;
  teamNotes: TeamNote[];
  createdBy: string;
  lastUpdatedBy: string;
  createdAtIso: string;
  updatedAtIso: string;
  deleted: boolean;
}

interface CloudOrgAssetRecord {
  id: string;
  workspaceKey: string;
  name: string;
  assetNumber: string;
  status: OrgAssetStatus;
  createdBy: string;
  lastUpdatedBy: string;
  createdAtIso: string;
  updatedAtIso: string;
  deleted: boolean;
}

function getFirestoreBaseUrl(): string {
  const projectId = firebaseConfig.projectId;
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/${databaseId}/documents`;
}

function getFirestoreDocPrefix(): string {
  const projectId = firebaseConfig.projectId;
  const databaseId = firebaseConfig.firestoreDatabaseId || '(default)';
  return `projects/${projectId}/databases/${databaseId}/documents`;
}

export function sanitizeFirestoreId(raw: string, prefix = 'rec'): string {
  const cleaned = String(raw || '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 128);
  return cleaned || `${prefix}_${Date.now()}`;
}

function sanitizeDateString(val: unknown): string {
  if (typeof val === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(val)) return val;
  return new Date().toISOString().slice(0, 10);
}

function sanitizeOptionalDateString(val: unknown): string {
  if (typeof val === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(val)) return val;
  return '';
}

function sanitizeIsoString(val: unknown, fallback?: string): string {
  if (typeof val === 'string' && val.trim().length >= 10) {
    return val.trim().slice(0, 40);
  }
  return fallback || new Date().toISOString();
}

function parseTs(iso: string | undefined): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
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

function encodeValue(val: unknown): FirestoreFieldValue {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === 'boolean') {
    return { booleanValue: val };
  }
  if (typeof val === 'number') {
    return Number.isInteger(val) ? { integerValue: String(val) } : { doubleValue: val };
  }
  if (typeof val === 'string') {
    return { stringValue: val };
  }
  if (Array.isArray(val)) {
    return {
      arrayValue: {
        values: val.map((item) => encodeValue(item)),
      },
    };
  }
  if (typeof val === 'object') {
    const fields: Record<string, FirestoreFieldValue> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      if (v !== undefined) {
        fields[k] = encodeValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

function encodeFields(obj: Record<string, unknown>): Record<string, FirestoreFieldValue> {
  const fields: Record<string, FirestoreFieldValue> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) {
      fields[k] = encodeValue(v);
    }
  }
  return fields;
}

function decodeValue(fv: FirestoreFieldValue | undefined): unknown {
  if (!fv) return undefined;
  if ('stringValue' in fv) return fv.stringValue;
  if ('booleanValue' in fv) return fv.booleanValue;
  if ('integerValue' in fv) return Number(fv.integerValue);
  if ('doubleValue' in fv) return fv.doubleValue;
  if ('timestampValue' in fv) return fv.timestampValue;
  if ('nullValue' in fv) return null;
  if ('arrayValue' in fv) {
    return (fv.arrayValue.values || []).map((item) => decodeValue(item));
  }
  if ('mapValue' in fv) {
    const out: Record<string, unknown> = {};
    const fields = fv.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      out[k] = decodeValue(v);
    }
    return out;
  }
  return undefined;
}

function decodeFields(fields: Record<string, FirestoreFieldValue> | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!fields) return out;
  for (const [k, v] of Object.entries(fields)) {
    out[k] = decodeValue(v);
  }
  return out;
}

function extractDocId(docName: string | undefined): string {
  if (!docName) return '';
  const parts = docName.split('/');
  return parts[parts.length - 1] || '';
}

function normalizeTeamNotes(notes: unknown): TeamNote[] {
  if (!Array.isArray(notes)) return [];
  const byId = new Map<string, TeamNote>();
  for (const raw of notes) {
    if (!raw || typeof raw !== 'object') continue;
    const obj = raw as Record<string, unknown>;
    const id = sanitizeFirestoreId(String(obj.id || `note_${byId.size}`), 'note');
    const author = String(obj.author || 'Colleague').trim().slice(0, 80) || 'Colleague';
    const role: 'admin' | 'member' = obj.role === 'member' ? 'member' : 'admin';
    const text = String(obj.text || '').trim().slice(0, 1000);
    if (!text) continue;
    const createdAt = sanitizeIsoString(obj.createdAt);
    if (!byId.has(id)) {
      byId.set(id, { id, author, role, text, createdAt });
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 200);
}

export function mergeNotesLists(localNotes: TeamNote[], cloudNotes: TeamNote[]): TeamNote[] {
  return normalizeTeamNotes([...localNotes, ...cloudNotes]);
}

function decodeCloudEquipment(doc: FirestoreDocumentPayload): CloudEquipmentRecord | null {
  const id = extractDocId(doc.name);
  if (!id || !doc.fields) return null;
  const data = decodeFields(doc.fields);
  if (data.workspaceKey !== WORKSPACE_KEY) return null;
  return {
    id,
    workspaceKey: WORKSPACE_KEY,
    name: String(data.name || 'Équipement').slice(0, 200),
    equipmentNumber: String(data.equipmentNumber || 'N/A').slice(0, 80),
    category: sanitizeCategory(data.category),
    condition: sanitizeCondition(data.condition),
    location: String(data.location || 'Atelier').slice(0, 200),
    entryDate: sanitizeDateString(data.entryDate),
    expectedExitDate: sanitizeDateString(data.expectedExitDate),
    delayServices: Boolean(data.delayServices),
    delayServicesNote: String(data.delayServicesNote || '').slice(0, 1500),
    delaySpareParts: Boolean(data.delaySpareParts),
    delaySparePartsNote: String(data.delaySparePartsNote || '').slice(0, 1500),
    delayOther: Boolean(data.delayOther),
    delayOtherNote: String(data.delayOtherNote || '').slice(0, 1500),
    finalExitDate: sanitizeOptionalDateString(data.finalExitDate),
    teamNotes: normalizeTeamNotes(data.teamNotes),
    createdBy: String(data.createdBy || 'Colleague').slice(0, 80),
    lastUpdatedBy: String(data.lastUpdatedBy || 'Colleague').slice(0, 80),
    createdAtIso: sanitizeIsoString(data.createdAtIso),
    updatedAtIso: sanitizeIsoString(data.updatedAtIso),
    deleted: Boolean(data.deleted),
  };
}

function decodeCloudOrgAsset(doc: FirestoreDocumentPayload): CloudOrgAssetRecord | null {
  const id = extractDocId(doc.name);
  if (!id || !doc.fields) return null;
  const data = decodeFields(doc.fields);
  if (data.workspaceKey !== WORKSPACE_KEY) return null;
  return {
    id,
    workspaceKey: WORKSPACE_KEY,
    name: String(data.name || 'Matériel').slice(0, 200),
    assetNumber: String(data.assetNumber || 'N/A').slice(0, 80),
    status: sanitizeOrgAssetStatus(data.status),
    createdBy: String(data.createdBy || 'Colleague').slice(0, 80),
    lastUpdatedBy: String(data.lastUpdatedBy || 'Colleague').slice(0, 80),
    createdAtIso: sanitizeIsoString(data.createdAtIso),
    updatedAtIso: sanitizeIsoString(data.updatedAtIso),
    deleted: Boolean(data.deleted),
  };
}

function toEquipmentItem(rec: CloudEquipmentRecord): EquipmentItem {
  return {
    id: rec.id,
    workspaceKey: WORKSPACE_KEY,
    name: rec.name,
    equipmentNumber: rec.equipmentNumber,
    category: rec.category,
    condition: rec.condition,
    location: rec.location,
    entryDate: rec.entryDate,
    expectedExitDate: rec.expectedExitDate,
    delayServices: rec.delayServices,
    delayServicesNote: rec.delayServicesNote,
    delaySpareParts: rec.delaySpareParts,
    delaySparePartsNote: rec.delaySparePartsNote,
    delayOther: rec.delayOther,
    delayOtherNote: rec.delayOtherNote,
    finalExitDate: rec.finalExitDate,
    teamNotes: rec.teamNotes,
    createdByUid: 'local_pc_user',
    createdBy: rec.createdBy,
    lastUpdatedBy: rec.lastUpdatedBy,
    createdAt: rec.createdAtIso,
    updatedAt: rec.updatedAtIso,
  };
}

function toOrgAsset(rec: CloudOrgAssetRecord): OrganizationAsset {
  return {
    id: rec.id,
    workspaceKey: WORKSPACE_KEY,
    name: rec.name,
    assetNumber: rec.assetNumber,
    status: rec.status,
    createdByUid: 'local_pc_user',
    createdBy: rec.createdBy,
    lastUpdatedBy: rec.lastUpdatedBy,
    createdAt: rec.createdAtIso,
    updatedAt: rec.updatedAtIso,
  };
}

function serializeEquipmentForCloud(
  item: EquipmentItem,
  deleted: boolean,
  preserveCreatedAtIso?: string
): Record<string, unknown> {
  const safeName = item.name.trim().slice(0, 200) || 'Équipement';
  const safeNumber = item.equipmentNumber.trim().slice(0, 80) || 'N/A';
  const safeLocation = item.location.trim().slice(0, 200) || 'Atelier';
  const safeCreatedBy = (item.createdBy || 'Responsable PC').trim().slice(0, 80) || 'Responsable PC';
  const safeLastUpdatedBy =
    (item.lastUpdatedBy || safeCreatedBy).trim().slice(0, 80) || 'Responsable PC';
  const createdAtIso = sanitizeIsoString(preserveCreatedAtIso || item.createdAt);
  const updatedAtIso = sanitizeIsoString(item.updatedAt, createdAtIso);

  const compactNotes = normalizeTeamNotes(item.teamNotes).map((n) => ({
    id: sanitizeFirestoreId(n.id, 'note'),
    author: n.author.trim().slice(0, 80) || 'Colleague',
    role: n.role === 'member' ? 'member' : 'admin',
    text: n.text.trim().slice(0, 1000),
    createdAt: sanitizeIsoString(n.createdAt),
  }));

  return {
    workspaceKey: WORKSPACE_KEY,
    name: safeName,
    equipmentNumber: safeNumber,
    category: sanitizeCategory(item.category),
    condition: sanitizeCondition(item.condition),
    location: safeLocation,
    entryDate: sanitizeDateString(item.entryDate),
    expectedExitDate: sanitizeDateString(item.expectedExitDate),
    delayServices: Boolean(item.delayServices),
    delayServicesNote: (item.delayServicesNote || '').slice(0, 1500),
    delaySpareParts: Boolean(item.delaySpareParts),
    delaySparePartsNote: (item.delaySparePartsNote || '').slice(0, 1500),
    delayOther: Boolean(item.delayOther),
    delayOtherNote: (item.delayOtherNote || '').slice(0, 1500),
    finalExitDate: sanitizeOptionalDateString(item.finalExitDate),
    teamNotes: compactNotes,
    createdBy: safeCreatedBy,
    lastUpdatedBy: safeLastUpdatedBy,
    createdAtIso,
    updatedAtIso,
    deleted,
  };
}

function serializeOrgAssetForCloud(
  asset: OrganizationAsset,
  deleted: boolean,
  preserveCreatedAtIso?: string
): Record<string, unknown> {
  const safeName = asset.name.trim().slice(0, 200) || 'Matériel';
  const safeNumber = asset.assetNumber.trim().slice(0, 80) || 'N/A';
  const safeCreatedBy = (asset.createdBy || 'Responsable PC').trim().slice(0, 80) || 'Responsable PC';
  const safeLastUpdatedBy =
    (asset.lastUpdatedBy || safeCreatedBy).trim().slice(0, 80) || 'Responsable PC';
  const createdAtIso = sanitizeIsoString(preserveCreatedAtIso || asset.createdAt);
  const updatedAtIso = sanitizeIsoString(asset.updatedAt, createdAtIso);

  return {
    workspaceKey: WORKSPACE_KEY,
    name: safeName,
    assetNumber: safeNumber,
    status: sanitizeOrgAssetStatus(asset.status),
    createdBy: safeCreatedBy,
    lastUpdatedBy: safeLastUpdatedBy,
    createdAtIso,
    updatedAtIso,
    deleted,
  };
}

async function runWorkspaceQuery(collectionId: string): Promise<FirestoreDocumentPayload[]> {
  const url = `${getFirestoreBaseUrl()}:runQuery`;
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId }],
          where: {
            fieldFilter: {
              field: { fieldPath: 'workspaceKey' },
              op: 'EQUAL',
              value: { stringValue: WORKSPACE_KEY },
            },
          },
        },
      }),
    });
  } catch (err) {
    throw new OfflineSyncError(err instanceof Error ? err.message : 'Network error');
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Firestore query error (${response.status}): ${text}`);
  }

  const rows = (await response.json()) as Array<{ document?: FirestoreDocumentPayload }>;
  return rows.filter((r) => Boolean(r.document)).map((r) => r.document as FirestoreDocumentPayload);
}

interface PendingCommitWrite {
  collectionId: string;
  docId: string;
  data: Record<string, unknown>;
}

async function commitWritesInBatches(writes: PendingCommitWrite[]): Promise<void> {
  if (writes.length === 0) return;
  const baseUrl = getFirestoreBaseUrl();
  const docPrefix = getFirestoreDocPrefix();
  const batchSize = 40;

  for (let i = 0; i < writes.length; i += batchSize) {
    const chunk = writes.slice(i, i + batchSize);
    const payload = {
      writes: chunk.map((w) => ({
        update: {
          name: `${docPrefix}/${w.collectionId}/${w.docId}`,
          fields: encodeFields(w.data),
        },
        updateTransforms: [
          {
            fieldPath: 'syncedAt',
            setToServerValue: 'REQUEST_TIME',
          },
        ],
      })),
    };

    let response: Response;
    try {
      response = await fetch(`${baseUrl}:commit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new OfflineSyncError(err instanceof Error ? err.message : 'Network error');
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Firestore commit error (${response.status}): ${text}`);
    }
  }
}

export function mergeEquipmentCollections(params: {
  localItems: EquipmentItem[];
  localDeleted: Record<string, string>;
  cloudRecords: CloudEquipmentRecord[];
  actorName: string;
}): {
  mergedItems: EquipmentItem[];
  nextDeleted: Record<string, string>;
  pendingUploads: PendingCommitWrite[];
  uploadedCount: number;
  downloadedCount: number;
} {
  const localMap = new Map<string, EquipmentItem>();
  for (const item of params.localItems) {
    const safeId = sanitizeFirestoreId(item.id, 'eq');
    localMap.set(safeId, { ...item, id: safeId });
  }

  const cloudMap = new Map<string, CloudEquipmentRecord>();
  for (const rec of params.cloudRecords) {
    cloudMap.set(rec.id, rec);
  }

  const allIds = new Set<string>([
    ...localMap.keys(),
    ...cloudMap.keys(),
    ...Object.keys(params.localDeleted),
  ]);

  const mergedItems: EquipmentItem[] = [];
  const nextDeleted: Record<string, string> = {};
  const pendingUploads: PendingCommitWrite[] = [];
  let uploadedCount = 0;
  let downloadedCount = 0;

  for (const id of allIds) {
    const local = localMap.get(id);
    const cloud = cloudMap.get(id);
    const localDeletedAt = params.localDeleted[id];

    // Case 1: Only exists locally (not in cloud yet)
    if (local && !cloud) {
      mergedItems.push(local);
      pendingUploads.push({
        collectionId: EQUIPMENT_COLLECTION,
        docId: id,
        data: serializeEquipmentForCloud(local, false),
      });
      uploadedCount += 1;
      continue;
    }

    // Case 2: Only in local deleted map (not active locally, not in cloud) -> keep tombstone pruned cleanly
    if (!local && !cloud) {
      continue;
    }

    // Case 3: Only in cloud (not active locally)
    if (!local && cloud) {
      const deletedTs = parseTs(localDeletedAt);
      const cloudTs = parseTs(cloud.updatedAtIso);

      if (localDeletedAt && deletedTs >= cloudTs) {
        nextDeleted[id] = localDeletedAt;
        if (!cloud.deleted) {
          const tombstoneItem = {
            ...toEquipmentItem(cloud),
            lastUpdatedBy: params.actorName,
            updatedAt: localDeletedAt,
          };
          pendingUploads.push({
            collectionId: EQUIPMENT_COLLECTION,
            docId: id,
            data: serializeEquipmentForCloud(tombstoneItem, true, cloud.createdAtIso),
          });
          uploadedCount += 1;
        }
      } else if (cloud.deleted) {
        nextDeleted[id] = cloud.updatedAtIso;
      } else {
        mergedItems.push(toEquipmentItem(cloud));
        downloadedCount += 1;
      }
      continue;
    }

    // Case 4: Present both locally and in cloud
    if (local && cloud) {
      const localTs = parseTs(local.updatedAt);
      const cloudTs = parseTs(cloud.updatedAtIso);

      if (cloud.deleted && cloudTs > localTs) {
        nextDeleted[id] = cloud.updatedAtIso;
        downloadedCount += 1;
        continue;
      }

      const mergedNotes = mergeNotesLists(local.teamNotes || [], cloud.teamNotes || []);
      const localNoteIds = new Set((local.teamNotes || []).map((n) => n.id));
      const cloudNoteIds = new Set((cloud.teamNotes || []).map((n) => n.id));
      const cloudHasNewNotes = mergedNotes.some((n) => !localNoteIds.has(n.id));
      const localHasNewNotes = mergedNotes.some((n) => !cloudNoteIds.has(n.id));

      const baseWinner = cloudTs > localTs ? toEquipmentItem(cloud) : local;
      const mergedItem: EquipmentItem = {
        ...baseWinner,
        id,
        workspaceKey: WORKSPACE_KEY,
        teamNotes: mergedNotes,
        createdAt: cloud.createdAtIso || local.createdAt,
      };
      mergedItems.push(mergedItem);

      if (cloudTs > localTs || cloudHasNewNotes) {
        downloadedCount += 1;
      }

      if (localTs > cloudTs || localHasNewNotes || (cloud.deleted && localTs >= cloudTs)) {
        pendingUploads.push({
          collectionId: EQUIPMENT_COLLECTION,
          docId: id,
          data: serializeEquipmentForCloud(mergedItem, false, cloud.createdAtIso),
        });
        uploadedCount += 1;
      }
    }
  }

  mergedItems.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { mergedItems, nextDeleted, pendingUploads, uploadedCount, downloadedCount };
}

export function mergeOrgAssetsCollections(params: {
  localAssets: OrganizationAsset[];
  localDeleted: Record<string, string>;
  cloudRecords: CloudOrgAssetRecord[];
  actorName: string;
}): {
  mergedAssets: OrganizationAsset[];
  nextDeleted: Record<string, string>;
  pendingUploads: PendingCommitWrite[];
  uploadedCount: number;
  downloadedCount: number;
} {
  const localMap = new Map<string, OrganizationAsset>();
  for (const asset of params.localAssets) {
    const safeId = sanitizeFirestoreId(asset.id, 'asset');
    localMap.set(safeId, { ...asset, id: safeId });
  }

  const cloudMap = new Map<string, CloudOrgAssetRecord>();
  for (const rec of params.cloudRecords) {
    cloudMap.set(rec.id, rec);
  }

  const allIds = new Set<string>([
    ...localMap.keys(),
    ...cloudMap.keys(),
    ...Object.keys(params.localDeleted),
  ]);

  const mergedAssets: OrganizationAsset[] = [];
  const nextDeleted: Record<string, string> = {};
  const pendingUploads: PendingCommitWrite[] = [];
  let uploadedCount = 0;
  let downloadedCount = 0;

  for (const id of allIds) {
    const local = localMap.get(id);
    const cloud = cloudMap.get(id);
    const localDeletedAt = params.localDeleted[id];

    if (local && !cloud) {
      mergedAssets.push(local);
      pendingUploads.push({
        collectionId: ORG_ASSETS_COLLECTION,
        docId: id,
        data: serializeOrgAssetForCloud(local, false),
      });
      uploadedCount += 1;
      continue;
    }

    if (!local && !cloud) {
      continue;
    }

    if (!local && cloud) {
      const deletedTs = parseTs(localDeletedAt);
      const cloudTs = parseTs(cloud.updatedAtIso);

      if (localDeletedAt && deletedTs >= cloudTs) {
        nextDeleted[id] = localDeletedAt;
        if (!cloud.deleted) {
          const tombstoneAsset = {
            ...toOrgAsset(cloud),
            lastUpdatedBy: params.actorName,
            updatedAt: localDeletedAt,
          };
          pendingUploads.push({
            collectionId: ORG_ASSETS_COLLECTION,
            docId: id,
            data: serializeOrgAssetForCloud(tombstoneAsset, true, cloud.createdAtIso),
          });
          uploadedCount += 1;
        }
      } else if (cloud.deleted) {
        nextDeleted[id] = cloud.updatedAtIso;
      } else {
        mergedAssets.push(toOrgAsset(cloud));
        downloadedCount += 1;
      }
      continue;
    }

    if (local && cloud) {
      const localTs = parseTs(local.updatedAt);
      const cloudTs = parseTs(cloud.updatedAtIso);

      if (cloud.deleted && cloudTs > localTs) {
        nextDeleted[id] = cloud.updatedAtIso;
        downloadedCount += 1;
        continue;
      }

      const winner = cloudTs > localTs ? toOrgAsset(cloud) : local;
      const mergedAsset: OrganizationAsset = {
        ...winner,
        id,
        workspaceKey: WORKSPACE_KEY,
        createdAt: cloud.createdAtIso || local.createdAt,
      };
      mergedAssets.push(mergedAsset);

      if (cloudTs > localTs) {
        downloadedCount += 1;
      }

      if (localTs > cloudTs || (cloud.deleted && localTs >= cloudTs)) {
        pendingUploads.push({
          collectionId: ORG_ASSETS_COLLECTION,
          docId: id,
          data: serializeOrgAssetForCloud(mergedAsset, false, cloud.createdAtIso),
        });
        uploadedCount += 1;
      }
    }
  }

  mergedAssets.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { mergedAssets, nextDeleted, pendingUploads, uploadedCount, downloadedCount };
}

export async function fetchWorkspaceSyncLockStatus(): Promise<WorkspaceSyncLockStatus> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new OfflineSyncError('Navigator is offline');
  }

  const url = `${getFirestoreBaseUrl()}/${SETTINGS_COLLECTION}/${WORKSPACE_KEY}`;
  let response: Response;
  try {
    response = await fetch(url, { method: 'GET' });
  } catch (err) {
    throw new OfflineSyncError(err instanceof Error ? err.message : 'Network error');
  }

  if (response.status === 404) {
    return { locked: false };
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Workspace settings error (${response.status}): ${text}`);
  }

  const doc = (await response.json()) as FirestoreDocumentPayload;
  const data = decodeFields(doc.fields);
  return {
    locked: Boolean(data.syncRefreshLocked),
    updatedBy: typeof data.updatedBy === 'string' ? data.updatedBy : undefined,
    lockReason: typeof data.lockReason === 'string' ? data.lockReason : undefined,
    updatedAtIso: typeof data.updatedAt === 'string' ? data.updatedAt : undefined,
  };
}

export interface LocalSyncMonitorItem extends EquipmentItem {
  deleted: boolean;
}

export interface LocalSyncMonitorAsset extends OrganizationAsset {
  deleted: boolean;
}

export async function fetchLocalSyncOverview(): Promise<{
  equipment: LocalSyncMonitorItem[];
  orgAssets: LocalSyncMonitorAsset[];
}> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new OfflineSyncError('Navigator is offline');
  }

  const [eqDocs, assetDocs] = await Promise.all([
    runWorkspaceQuery(EQUIPMENT_COLLECTION),
    runWorkspaceQuery(ORG_ASSETS_COLLECTION),
  ]);

  const equipment = eqDocs
    .map(decodeCloudEquipment)
    .filter((x): x is CloudEquipmentRecord => x !== null)
    .map((rec) => ({
      ...toEquipmentItem(rec),
      deleted: rec.deleted,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const orgAssets = assetDocs
    .map(decodeCloudOrgAsset)
    .filter((x): x is CloudOrgAssetRecord => x !== null)
    .map((rec) => ({
      ...toOrgAsset(rec),
      deleted: rec.deleted,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  return { equipment, orgAssets };
}

export async function syncColleaguesWithCloud(params: {
  items: EquipmentItem[];
  orgAssets: OrganizationAsset[];
  deletedRecords: DeletedRecordsMap;
  actorName: string;
  bypassLock?: boolean;
}): Promise<ColleagueSyncResult> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new OfflineSyncError('Navigator is offline');
  }

  if (!params.bypassLock) {
    const lockStatus = await fetchWorkspaceSyncLockStatus();
    if (lockStatus.locked) {
      throw new SyncLockedError(lockStatus.updatedBy, lockStatus.lockReason);
    }
  }

  const [eqDocs, assetDocs] = await Promise.all([
    runWorkspaceQuery(EQUIPMENT_COLLECTION),
    runWorkspaceQuery(ORG_ASSETS_COLLECTION),
  ]);

  const cloudEquipment = eqDocs
    .map(decodeCloudEquipment)
    .filter((x): x is CloudEquipmentRecord => x !== null);
  const cloudOrgAssets = assetDocs
    .map(decodeCloudOrgAsset)
    .filter((x): x is CloudOrgAssetRecord => x !== null);

  const eqMerge = mergeEquipmentCollections({
    localItems: params.items,
    localDeleted: params.deletedRecords.equipment || {},
    cloudRecords: cloudEquipment,
    actorName: params.actorName,
  });

  const assetMerge = mergeOrgAssetsCollections({
    localAssets: params.orgAssets,
    localDeleted: params.deletedRecords.orgAssets || {},
    cloudRecords: cloudOrgAssets,
    actorName: params.actorName,
  });

  await commitWritesInBatches([
    ...eqMerge.pendingUploads,
    ...assetMerge.pendingUploads,
  ]);

  const syncedAtIso = new Date().toISOString();

  return {
    uploadedCount: eqMerge.uploadedCount + assetMerge.uploadedCount,
    downloadedCount: eqMerge.downloadedCount + assetMerge.downloadedCount,
    mergedItems: eqMerge.mergedItems,
    mergedOrgAssets: assetMerge.mergedAssets,
    mergedDeleted: {
      equipment: eqMerge.nextDeleted,
      orgAssets: assetMerge.nextDeleted,
    },
    syncedAtIso,
  };
}
