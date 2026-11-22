import React, { useCallback, useEffect, useState } from 'react';
import {
  X,
  ShieldCheck,
  Copy,
  Check,
  UserPlus,
  UserMinus,
  Mail,
  Trash2,
  Lock,
  Unlock,
  Users,
  Activity,
  RefreshCw,
  Cloud,
  HardDrive,
  ArrowLeftRight,
} from 'lucide-react';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import {
  auth,
  db,
  handleFirestoreError,
  isTransientOfflineError,
  OperationType,
  PRIMARY_ADMIN_EMAIL,
  WORKSPACE_KEY,
} from '../firebase';
import { T, type Language } from '../i18n';
import type { EquipmentItem, OrganizationAsset } from '../types';
import {
  fetchLocalSyncOverview,
  type LocalSyncMonitorAsset,
  type LocalSyncMonitorItem,
} from '../utils/localCloudSync';
import { recordAuditLog } from '../utils/modeTransfer';

interface AdminAuthModalProps {
  isOpen: boolean;
  isAdmin: boolean;
  currentUid: string;
  currentEmail: string;
  actorName?: string;
  lang: Language;
  syncRefreshLocked?: boolean;
  syncLockReason?: string;
  onPullLocalSyncToCloud?: (
    localEq: EquipmentItem[],
    localAssets: OrganizationAsset[]
  ) => Promise<void>;
  onClose: () => void;
}

interface AdminEmailEntry {
  email: string;
  grantedByEmail?: string;
}

interface TeamMemberEntry {
  uid: string;
  displayName: string;
  joinedAt: string;
}

interface AuditLogEntry {
  id: string;
  sourceMode: string;
  action: string;
  entityType: string;
  entityLabel: string;
  details: string;
  actorName: string;
  createdAt: string;
}

type ModalTab = 'permissions' | 'syncLock' | 'team' | 'monitor';

const EMAIL_REGEX = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;

function toIso(val: unknown): string {
  if (val instanceof Timestamp) return val.toDate().toISOString();
  if (
    val &&
    typeof val === 'object' &&
    'toDate' in val &&
    typeof (val as { toDate: () => Date }).toDate === 'function'
  ) {
    return (val as { toDate: () => Date }).toDate().toISOString();
  }
  if (typeof val === 'string') return val;
  return '';
}

export const AdminAuthModal: React.FC<AdminAuthModalProps> = ({
  isOpen,
  isAdmin,
  currentUid,
  currentEmail,
  actorName,
  lang,
  syncRefreshLocked = false,
  syncLockReason = '',
  onPullLocalSyncToCloud,
  onClose,
}) => {
  const t = T[lang];
  const locale = lang === 'fr' ? 'fr-FR' : 'ar-SA';
  const isPrimaryAdmin =
    currentEmail.trim().toLowerCase() === PRIMARY_ADMIN_EMAIL.toLowerCase() && Boolean(currentUid);

  const [activeTab, setActiveTab] = useState<ModalTab>('permissions');
  const [targetEmail, setTargetEmail] = useState('');
  const [adminEmails, setAdminEmails] = useState<AdminEmailEntry[]>([]);
  const [adminUidSet, setAdminUidSet] = useState<Set<string>>(new Set());
  const [teamMembers, setTeamMembers] = useState<TeamMemberEntry[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [localMonitorEq, setLocalMonitorEq] = useState<LocalSyncMonitorItem[]>([]);
  const [localMonitorAssets, setLocalMonitorAssets] = useState<LocalSyncMonitorAsset[]>([]);
  const [monitorLoading, setMonitorLoading] = useState(false);
  const [lockReasonInput, setLockReasonInput] = useState(syncLockReason);

  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    setLockReasonInput(syncLockReason);
  }, [syncLockReason]);

  useEffect(() => {
    if (!isOpen) {
      setMessage(null);
      setActiveTab('permissions');
    }
  }, [isOpen]);

  // Listen to adminEmails (for admins)
  useEffect(() => {
    if (!isOpen || !isAdmin) {
      setAdminEmails([]);
      return;
    }

    const unsub = onSnapshot(
      collection(db, 'adminEmails'),
      (snap) => {
        const list: AdminEmailEntry[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            email: String(data.email || d.id),
            grantedByEmail: String(data.grantedByEmail || ''),
          };
        });
        list.sort((a, b) => a.email.localeCompare(b.email));
        setAdminEmails(list);
      },
      (error) => {
        if (!isTransientOfflineError(error)) {
          handleFirestoreError(error, OperationType.LIST, 'adminEmails');
        }
      }
    );

    return () => unsub();
  }, [isOpen, isAdmin]);

  // Primary Admin listeners: teamMembers, admins, and auditLogs
  useEffect(() => {
    if (!isOpen || !isPrimaryAdmin) {
      setTeamMembers([]);
      setAdminUidSet(new Set());
      setAuditLogs([]);
      return;
    }

    const unsubTeam = onSnapshot(
      collection(db, 'teamMembers'),
      (snap) => {
        const list: TeamMemberEntry[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            uid: String(data.uid || d.id),
            displayName: String(data.displayName || d.id),
            joinedAt: toIso(data.joinedAt),
          };
        });
        list.sort((a, b) => b.joinedAt.localeCompare(a.joinedAt));
        setTeamMembers(list);
      },
      (error) => {
        if (!isTransientOfflineError(error)) {
          handleFirestoreError(error, OperationType.LIST, 'teamMembers');
        }
      }
    );

    const unsubAdmins = onSnapshot(
      collection(db, 'admins'),
      (snap) => {
        setAdminUidSet(new Set(snap.docs.map((d) => d.id)));
      },
      (error) => {
        if (!isTransientOfflineError(error)) {
          handleFirestoreError(error, OperationType.LIST, 'admins');
        }
      }
    );

    const unsubLogs = onSnapshot(
      query(collection(db, 'auditLogs'), where('workspaceKey', '==', WORKSPACE_KEY)),
      (snap) => {
        const list: AuditLogEntry[] = snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          return {
            id: d.id,
            sourceMode: String(data.sourceMode || 'cloud'),
            action: String(data.action || 'update'),
            entityType: String(data.entityType || 'equipment'),
            entityLabel: String(data.entityLabel || ''),
            details: String(data.details || ''),
            actorName: String(data.actorName || ''),
            createdAt: toIso(data.createdAt),
          };
        });
        list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        setAuditLogs(list.slice(0, 60));
      },
      (error) => {
        if (!isTransientOfflineError(error)) {
          handleFirestoreError(error, OperationType.LIST, 'auditLogs');
        }
      }
    );

    return () => {
      unsubTeam();
      unsubAdmins();
      unsubLogs();
    };
  }, [isOpen, isPrimaryAdmin]);

  const loadLocalMonitorData = useCallback(async () => {
    if (!isPrimaryAdmin) return;
    setMonitorLoading(true);
    try {
      const overview = await fetchLocalSyncOverview();
      setLocalMonitorEq(overview.equipment);
      setLocalMonitorAssets(overview.orgAssets);
    } catch {
      // Offline or unavailable
    } finally {
      setMonitorLoading(false);
    }
  }, [isPrimaryAdmin]);

  useEffect(() => {
    if (isOpen && isPrimaryAdmin && activeTab === 'monitor') {
      void loadLocalMonitorData();
    }
  }, [isOpen, isPrimaryAdmin, activeTab, loadLocalMonitorData]);

  if (!isOpen) return null;

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(currentEmail || currentUid);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const normalizeEmail = (val: string) => val.trim().toLowerCase();
  const effectiveActorName = (actorName || currentEmail || PRIMARY_ADMIN_EMAIL).slice(0, 80);

  const handleGrantAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isPrimaryAdmin) return;
    const email = normalizeEmail(targetEmail);
    if (!EMAIL_REGEX.test(email) || email.length > 160) {
      setMessage({
        type: 'err',
        text: lang === 'fr' ? 'Adresse e-mail invalide.' : 'يرجى إدخال بريد إلكتروني صحيح.',
      });
      return;
    }

    setLoading(true);
    setMessage(null);
    const path = `adminEmails/${email}`;
    try {
      await setDoc(doc(db, 'adminEmails', email), {
        email,
        grantedBy: currentUid,
        grantedByEmail: normalizeEmail(currentEmail) || PRIMARY_ADMIN_EMAIL,
        grantedAt: serverTimestamp(),
      });
      void recordAuditLog({
        db,
        firebaseUser: auth.currentUser,
        sourceMode: 'admin',
        action: 'permission_change',
        entityType: 'team',
        entityId: email.replace(/[^a-zA-Z0-9_-]/g, '_'),
        entityLabel: email,
        details: 'Granted admin permissions by email',
        actorName: effectiveActorName,
      });
      setTargetEmail('');
      setMessage({
        type: 'ok',
        text:
          lang === 'fr'
            ? `Droits Admin accordés à ${email}.`
            : `تم منح صلاحية الآدمن للبريد: ${email}`,
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, path);
      } catch {
        setMessage({ type: 'err', text: t.errCloudVerify });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeAdmin = async (emailInput?: string) => {
    if (!isPrimaryAdmin) return;
    const email = normalizeEmail(emailInput ?? targetEmail);
    if (!EMAIL_REGEX.test(email) || email.length > 160) {
      setMessage({
        type: 'err',
        text:
          lang === 'fr'
            ? 'Veuillez saisir une adresse e-mail valide.'
            : 'أدخل البريد الإلكتروني المراد سحب صلاحيته.',
      });
      return;
    }

    if (email === PRIMARY_ADMIN_EMAIL.toLowerCase()) {
      setMessage({
        type: 'err',
        text:
          lang === 'fr'
            ? 'Impossible de retirer l’administrateur principal.'
            : 'لا يمكن سحب صلاحية الآدمن الرئيسي للبرنامج.',
      });
      return;
    }

    setLoading(true);
    setMessage(null);
    const path = `adminEmails/${email}`;
    try {
      await deleteDoc(doc(db, 'adminEmails', email));
      void recordAuditLog({
        db,
        firebaseUser: auth.currentUser,
        sourceMode: 'admin',
        action: 'permission_change',
        entityType: 'team',
        entityId: email.replace(/[^a-zA-Z0-9_-]/g, '_'),
        entityLabel: email,
        details: 'Revoked admin permissions by email',
        actorName: effectiveActorName,
      });
      if (!emailInput) setTargetEmail('');
      setMessage({
        type: 'ok',
        text:
          lang === 'fr'
            ? `Droits Admin retirés pour ${email}.`
            : `تم سحب صلاحية الآدمن من: ${email}`,
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, path);
      } catch {
        setMessage({ type: 'err', text: t.errCloudVerify });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggleUidAdmin = async (member: TeamMemberEntry, currentlyUidAdmin: boolean) => {
    if (!isPrimaryAdmin) return;
    setLoading(true);
    setMessage(null);
    const path = `admins/${member.uid}`;
    try {
      if (currentlyUidAdmin) {
        await deleteDoc(doc(db, 'admins', member.uid));
      } else {
        await setDoc(doc(db, 'admins', member.uid), {
          uid: member.uid,
          grantedBy: currentUid,
          grantedAt: serverTimestamp(),
        });
      }
      void recordAuditLog({
        db,
        firebaseUser: auth.currentUser,
        sourceMode: 'admin',
        action: 'permission_change',
        entityType: 'team',
        entityId: member.uid,
        entityLabel: member.displayName,
        details: currentlyUidAdmin ? 'Revoked member admin role' : 'Promoted member to admin',
        actorName: effectiveActorName,
      });
      setMessage({
        type: 'ok',
        text: currentlyUidAdmin
          ? lang === 'fr'
            ? `Droits Admin retirés à ${member.displayName}.`
            : `تم سحب صلاحية الآدمن من ${member.displayName}.`
          : lang === 'fr'
          ? `${member.displayName} est maintenant Admin.`
          : `تمت ترقية ${member.displayName} إلى آدمن.`,
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, path);
      } catch {
        setMessage({ type: 'err', text: t.errCloudVerify });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleRemoveTeamMember = async (member: TeamMemberEntry) => {
    if (!isPrimaryAdmin || member.uid === currentUid) return;
    setLoading(true);
    setMessage(null);
    const path = `teamMembers/${member.uid}`;
    try {
      await deleteDoc(doc(db, 'teamMembers', member.uid));
      if (adminUidSet.has(member.uid)) {
        await deleteDoc(doc(db, 'admins', member.uid));
      }
      void recordAuditLog({
        db,
        firebaseUser: auth.currentUser,
        sourceMode: 'admin',
        action: 'delete',
        entityType: 'team',
        entityId: member.uid,
        entityLabel: member.displayName,
        details: 'Removed team member from workspace access',
        actorName: effectiveActorName,
      });
      setMessage({
        type: 'ok',
        text:
          lang === 'fr'
            ? `Membre "${member.displayName}" retiré de l’équipe.`
            : `تمت إزالة "${member.displayName}" من الفريق بنجاح.`,
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.DELETE, path);
      } catch {
        setMessage({ type: 'err', text: t.errCloudVerify });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSyncLock = async () => {
    if (!isPrimaryAdmin) return;
    setLoading(true);
    setMessage(null);
    const nextLocked = !syncRefreshLocked;
    const path = `workspaceSettings/${WORKSPACE_KEY}`;
    try {
      await setDoc(doc(db, 'workspaceSettings', WORKSPACE_KEY), {
        workspaceKey: WORKSPACE_KEY,
        syncRefreshLocked: nextLocked,
        lockReason: nextLocked ? lockReasonInput.trim().slice(0, 300) : '',
        updatedBy: effectiveActorName,
        updatedAt: serverTimestamp(),
      });
      void recordAuditLog({
        db,
        firebaseUser: auth.currentUser,
        sourceMode: 'admin',
        action: 'lock_toggle',
        entityType: 'settings',
        entityId: WORKSPACE_KEY,
        entityLabel: nextLocked ? 'Sync & Refresh LOCKED' : 'Sync & Refresh UNLOCKED',
        details: lockReasonInput.trim().slice(0, 300) || (nextLocked ? 'Locked by Primary Admin' : 'Unlocked by Primary Admin'),
        actorName: effectiveActorName,
      });
      setMessage({
        type: 'ok',
        text: nextLocked ? t.syncLockStatusLocked : t.syncLockStatusUnlocked,
      });
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, path);
      } catch {
        setMessage({ type: 'err', text: t.errCloudVerify });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleMergeLocalSyncIntoCloud = async () => {
    if (!isPrimaryAdmin || !onPullLocalSyncToCloud) return;
    setLoading(true);
    setMessage(null);
    try {
      const activeEq = localMonitorEq.filter((e) => !e.deleted);
      const activeAssets = localMonitorAssets.filter((a) => !a.deleted);
      await onPullLocalSyncToCloud(activeEq, activeAssets);
      setMessage({
        type: 'ok',
        text: t.transferLocalToCloudDone,
      });
    } catch {
      setMessage({ type: 'err', text: t.errCloudVerify });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]">
      <div
        className={`flex max-h-[90vh] w-full flex-col rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900 ${
          isPrimaryAdmin ? 'max-w-3xl' : 'max-w-md'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-[#0F4C81] dark:text-sky-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {isPrimaryAdmin ? t.primaryAdminControlBtn : t.adminModalTitle}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Primary Admin Governance Tabs */}
        {isPrimaryAdmin && (
          <div className="flex flex-wrap gap-1.5 border-b border-slate-200 bg-slate-50/70 px-6 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950/60">
            <button
              type="button"
              onClick={() => setActiveTab('permissions')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold transition ${
                activeTab === 'permissions'
                  ? 'bg-[#0F4C81] text-white'
                  : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              {t.adminTabPermissions}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('syncLock')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold transition ${
                activeTab === 'syncLock'
                  ? 'bg-[#0F4C81] text-white'
                  : syncRefreshLocked
                  ? 'border border-amber-300 bg-amber-50 text-amber-800 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                  : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              {syncRefreshLocked ? <Lock className="h-3.5 w-3.5" /> : <Unlock className="h-3.5 w-3.5" />}
              {t.adminTabSyncLock}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('team')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold transition ${
                activeTab === 'team'
                  ? 'bg-[#0F4C81] text-white'
                  : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Users className="h-3.5 w-3.5" />
              {t.adminTabTeam} ({teamMembers.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('monitor')}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold transition ${
                activeTab === 'monitor'
                  ? 'bg-[#0F4C81] text-white'
                  : 'text-slate-600 hover:bg-slate-200/70 dark:text-slate-300 dark:hover:bg-slate-800'
              }`}
            >
              <Activity className="h-3.5 w-3.5" />
              {t.adminTabMonitor}
            </button>
          </div>
        )}

        <div className="space-y-4 overflow-y-auto p-6 text-xs">
          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3.5 dark:border-slate-800 dark:bg-slate-950">
            <div className="flex items-center justify-between">
              <span className="text-slate-500 dark:text-slate-400">{t.currentAccount}</span>
              {isPrimaryAdmin && (
                <span className="rounded bg-emerald-100 px-2 py-0.5 text-[11px] font-bold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                  {t.primaryAdminLabel}
                </span>
              )}
            </div>
            <div className="mt-1.5 flex items-center justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                <Mail className="h-3.5 w-3.5 shrink-0 text-[#0F4C81] dark:text-sky-400" />
                <span className="truncate">{currentEmail || currentUid}</span>
              </span>
              <button
                type="button"
                onClick={handleCopyEmail}
                className="flex shrink-0 items-center gap-1 rounded border border-slate-300 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              >
                {copied ? (
                  <Check className="h-3 w-3 text-emerald-600" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
                {copied ? t.copiedUid : t.copyUid}
              </button>
            </div>
          </div>

          {message && (
            <div
              className={`rounded-lg border px-3.5 py-2.5 ${
                message.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                  : 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
              }`}
            >
              {message.text}
            </div>
          )}

          {/* TAB 1: Permissions & Admin Emails */}
          {activeTab === 'permissions' && (
            <>
              {isAdmin ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3.5 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300">
                    {t.adminActiveMsg}
                  </div>

                  {!isPrimaryAdmin && (
                    <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
                      {t.primaryAdminOnlyLockNotice}
                    </div>
                  )}

                  {isPrimaryAdmin && (
                    <>
                      <form
                        onSubmit={handleGrantAdmin}
                        className="space-y-3 border-t border-slate-200 pt-4 dark:border-slate-800"
                      >
                        <label
                          htmlFor="admin-target-email"
                          className="block font-semibold text-slate-700 dark:text-slate-300"
                        >
                          {t.grantAdminLabel}
                        </label>
                        <input
                          id="admin-target-email"
                          type="email"
                          dir="ltr"
                          value={targetEmail}
                          onChange={(e) => setTargetEmail(e.target.value)}
                          placeholder={t.uidPlaceholder}
                          className="font-mono w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                        />
                        <div className="flex gap-2">
                          <button
                            type="submit"
                            disabled={loading || !targetEmail.trim()}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#0F4C81] px-3 py-2 font-semibold text-white hover:bg-[#0c3c66] disabled:opacity-50"
                          >
                            <UserPlus className="h-3.5 w-3.5" />
                            {t.grantAdminBtn}
                          </button>
                          <button
                            type="button"
                            disabled={loading || !targetEmail.trim()}
                            onClick={() => void handleRevokeAdmin()}
                            className="flex items-center justify-center gap-1.5 rounded-lg border border-red-200 px-3 py-2 font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50 dark:border-red-900/50 dark:text-red-400"
                          >
                            <UserMinus className="h-3.5 w-3.5" />
                            {t.revokeBtn}
                          </button>
                        </div>
                      </form>

                      <div className="space-y-2 border-t border-slate-200 pt-3 dark:border-slate-800">
                        <div className="font-semibold text-slate-700 dark:text-slate-300">
                          {t.adminEmailsListTitle}
                        </div>
                        <div className="max-h-40 space-y-1.5 overflow-y-auto">
                          <div className="flex items-center justify-between rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-slate-800 dark:bg-slate-950">
                            <span className="font-mono truncate text-slate-800 dark:text-slate-200">
                              {PRIMARY_ADMIN_EMAIL}
                            </span>
                            <span className="shrink-0 font-semibold text-emerald-700 dark:text-emerald-400">
                              {t.primaryAdminLabel}
                            </span>
                          </div>
                          {adminEmails
                            .filter((a) => a.email !== PRIMARY_ADMIN_EMAIL.toLowerCase())
                            .map((entry) => (
                              <div
                                key={entry.email}
                                className="flex items-center justify-between rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-950"
                              >
                                <span className="font-mono truncate text-slate-800 dark:text-slate-200">
                                  {entry.email}
                                </span>
                                <button
                                  type="button"
                                  disabled={loading}
                                  onClick={() => void handleRevokeAdmin(entry.email)}
                                  className="flex shrink-0 items-center gap-1 rounded px-2 py-0.5 font-semibold text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                                >
                                  <Trash2 className="h-3 w-3" />
                                  {t.revokeBtn}
                                </button>
                              </div>
                            ))}
                        </div>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 leading-relaxed text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">
                  {t.memberInfoMsg}
                </div>
              )}
            </>
          )}

          {/* TAB 2: Primary Admin Sync & Refresh Lock Control */}
          {isPrimaryAdmin && activeTab === 'syncLock' && (
            <div className="space-y-4">
              <div
                className={`rounded-lg border p-4 ${
                  syncRefreshLocked
                    ? 'border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/40'
                    : 'border-emerald-200 bg-emerald-50 dark:border-emerald-900/60 dark:bg-emerald-950/30'
                }`}
              >
                <div className="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-white">
                  {syncRefreshLocked ? (
                    <Lock className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  ) : (
                    <Unlock className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  )}
                  {t.syncLockCardTitle}
                </div>
                <p className="mt-1.5 leading-relaxed text-slate-600 dark:text-slate-300">
                  {t.syncLockCardDesc}
                </p>
                <div className="mt-3 font-semibold text-slate-800 dark:text-slate-100">
                  {syncRefreshLocked ? t.syncLockStatusLocked : t.syncLockStatusUnlocked}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block font-semibold text-slate-700 dark:text-slate-300">
                  {t.syncLockReasonLabel}
                </label>
                <input
                  type="text"
                  maxLength={300}
                  value={lockReasonInput}
                  onChange={(e) => setLockReasonInput(e.target.value)}
                  placeholder={t.syncLockReasonPlaceholder}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                />
              </div>

              <button
                type="button"
                disabled={loading}
                onClick={() => void handleToggleSyncLock()}
                className={`flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold text-white transition disabled:opacity-50 ${
                  syncRefreshLocked
                    ? 'bg-emerald-600 hover:bg-emerald-700'
                    : 'bg-amber-600 hover:bg-amber-700'
                }`}
              >
                {syncRefreshLocked ? (
                  <>
                    <Unlock className="h-4 w-4" />
                    {t.syncLockDisableBtn}
                  </>
                ) : (
                  <>
                    <Lock className="h-4 w-4" />
                    {t.syncLockEnableBtn}
                  </>
                )}
              </button>
            </div>
          )}

          {/* TAB 3: Primary Admin Team Management */}
          {isPrimaryAdmin && activeTab === 'team' && (
            <div className="space-y-3">
              <div className="font-semibold text-slate-700 dark:text-slate-300">
                {t.teamMembersListTitle}
              </div>
              {teamMembers.length === 0 ? (
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center text-slate-500 dark:border-slate-800 dark:bg-slate-950">
                  {t.teamMembersEmpty}
                </div>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {teamMembers.map((member) => {
                    const hasUidAdmin = adminUidSet.has(member.uid);
                    const isSelf = member.uid === currentUid;
                    return (
                      <div
                        key={member.uid}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 dark:border-slate-800 dark:bg-slate-950"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 font-bold text-slate-900 dark:text-white">
                            <span>{member.displayName}</span>
                            {hasUidAdmin && (
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                                {t.adminTag}
                              </span>
                            )}
                          </div>
                          <div className="font-mono mt-0.5 truncate text-[11px] text-slate-500">
                            {member.uid}
                            {member.joinedAt
                              ? ` · ${new Date(member.joinedAt).toLocaleDateString(locale)}`
                              : ''}
                          </div>
                        </div>

                        {!isSelf && (
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => void handleToggleUidAdmin(member, hasUidAdmin)}
                              className={`rounded-md border px-2.5 py-1 text-[11px] font-semibold transition ${
                                hasUidAdmin
                                  ? 'border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                                  : 'border-sky-300 bg-sky-50 text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-sky-950/40 dark:text-sky-300'
                              }`}
                            >
                              {hasUidAdmin ? t.teamRevokeAdminBtn : t.teamGrantAdminBtn}
                            </button>
                            <button
                              type="button"
                              disabled={loading}
                              onClick={() => void handleRemoveTeamMember(member)}
                              className="flex items-center gap-1 rounded-md border border-red-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:bg-slate-900 dark:text-red-400"
                            >
                              <Trash2 className="h-3 w-3" />
                              {t.teamRemoveMemberBtn}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* TAB 4: Dual-System Modification Monitor (Cloud + Local Sync) */}
          {isPrimaryAdmin && activeTab === 'monitor' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-700 dark:text-slate-300">
                  {t.monitorCloudLogsTitle} ({auditLogs.length})
                </span>
                <div className="flex items-center gap-2">
                  {onPullLocalSyncToCloud &&
                    (localMonitorEq.filter((e) => !e.deleted).length > 0 ||
                      localMonitorAssets.filter((a) => !a.deleted).length > 0) && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void handleMergeLocalSyncIntoCloud()}
                        className="flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                      >
                        <ArrowLeftRight className="h-3.5 w-3.5" />
                        {t.monitorPullLocalToCloudBtn}
                      </button>
                    )}
                  <button
                    type="button"
                    disabled={monitorLoading}
                    onClick={() => void loadLocalMonitorData()}
                    className="flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  >
                    <RefreshCw className={`h-3 w-3 ${monitorLoading ? 'animate-spin' : ''}`} />
                    {t.monitorRefreshBtn}
                  </button>
                </div>
              </div>

              {/* Cloud Audit Logs Feed */}
              <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-950">
                {auditLogs.length === 0 ? (
                  <div className="py-4 text-center text-slate-500">{t.monitorEmptyLogs}</div>
                ) : (
                  auditLogs.map((log) => (
                    <div
                      key={log.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                          <Cloud className="h-3.5 w-3.5 shrink-0 text-sky-600 dark:text-sky-400" />
                          <span className="truncate">{log.entityLabel}</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                            {log.sourceMode} / {log.action}
                          </span>
                        </div>
                        {log.details && (
                          <div className="mt-0.5 truncate text-[11px] text-slate-500">
                            {log.details}
                          </div>
                        )}
                      </div>
                      <div className="text-end text-[11px] text-slate-500">
                        <div className="font-semibold text-slate-700 dark:text-slate-300">
                          {log.actorName}
                        </div>
                        {log.createdAt && (
                          <div className="font-mono">
                            {new Date(log.createdAt).toLocaleString(locale)}
                          </div>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Local Colleague Sync Feed */}
              <div className="font-semibold text-slate-700 dark:text-slate-300">
                {t.monitorLocalSyncTitle} ({localMonitorEq.length + localMonitorAssets.length})
              </div>
              <div className="max-h-44 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-2.5 dark:border-slate-800 dark:bg-slate-950">
                {localMonitorEq.length === 0 && localMonitorAssets.length === 0 ? (
                  <div className="py-4 text-center text-slate-500">{t.monitorEmptyLogs}</div>
                ) : (
                  <>
                    {localMonitorEq.map((item) => (
                      <div
                        key={`loc-eq-${item.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                            <HardDrive className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            <span className="truncate">
                              {item.name} ({item.equipmentNumber})
                            </span>
                            {item.deleted && (
                              <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700 dark:bg-red-950 dark:text-red-300">
                                {lang === 'fr' ? 'Supprimé' : 'محذوف'}
                              </span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[11px] text-slate-500">
                            {item.condition} · {(item.teamNotes || []).length}{' '}
                            {lang === 'fr' ? 'notes' : 'ملاحظات'}
                          </div>
                        </div>
                        <div className="text-end text-[11px] text-slate-500">
                          <div className="font-semibold text-slate-700 dark:text-slate-300">
                            {item.lastUpdatedBy}
                          </div>
                          <div className="font-mono">
                            {new Date(item.updatedAt).toLocaleString(locale)}
                          </div>
                        </div>
                      </div>
                    ))}
                    {localMonitorAssets.map((asset) => (
                      <div
                        key={`loc-asset-${asset.id}`}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 dark:border-slate-800 dark:bg-slate-900"
                      >
                        <div className="flex items-center gap-1.5 font-semibold text-slate-900 dark:text-white">
                          <HardDrive className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                          <span>
                            {asset.name} ({asset.assetNumber}) — {asset.status}
                          </span>
                          {asset.deleted && (
                            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] text-red-700">
                              {lang === 'fr' ? 'Supprimé' : 'محذوف'}
                            </span>
                          )}
                        </div>
                        <div className="text-end text-[11px] text-slate-500">
                          <div className="font-semibold text-slate-700 dark:text-slate-300">
                            {asset.lastUpdatedBy}
                          </div>
                          <div className="font-mono">
                            {new Date(asset.updatedAt).toLocaleString(locale)}
                          </div>
                        </div>
                      </div>
                    ))}
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
