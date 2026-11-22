import React, { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileJson,
  FileSpreadsheet,
  FileText,
  FolderCheck,
  FolderOpen,
  HardDrive,
  RefreshCw,
  Save,
  Unlink,
} from 'lucide-react';
import { T, type Language } from '../i18n';
import type { EquipmentItem } from '../types';
import {
  buildBackupJSONBlob,
  buildExcelBlob,
  buildWorkReportTextBlob,
  buildWordBlob,
  triggerBlobDownload,
} from '../utils/exporters';
import {
  clearStoredDirectoryHandle,
  downloadFileFromDirectory,
  ensureReadWritePermission,
  getStoredDirectoryHandle,
  isDirectoryPickerSupported,
  isRunningInIframe,
  listDirectoryFiles,
  pickDawlindDirectory,
  sanitizeArchiveFilename,
  writeBlobToDirectory,
  type DirectoryHandleLike,
  type SavedFolderFileInfo,
} from '../utils/localFolderArchive';

interface WorkReportArchivePanelProps {
  allItems: EquipmentItem[];
  filteredItems: EquipmentItem[];
  delayedItems: EquipmentItem[];
  actorName: string;
  lang: Language;
  onNotify?: (type: 'ok' | 'err', message: string) => void;
}

type ReportScope = 'all' | 'filtered' | 'delayed';

export const WorkReportArchivePanel: React.FC<WorkReportArchivePanelProps> = ({
  allItems,
  filteredItems,
  delayedItems,
  actorName,
  lang,
  onNotify,
}) => {
  const t = T[lang];
  const locale = lang === 'fr' ? 'fr-FR' : 'ar-SA';

  const [dirHandle, setDirHandle] = useState<DirectoryHandleLike | null>(null);
  const [hasPermission, setHasPermission] = useState(false);
  const [savedFiles, setSavedFiles] = useState<SavedFolderFileInfo[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [iframeBlocked, setIframeBlocked] = useState(() => isRunningInIframe());

  const [workTitle, setWorkTitle] = useState('');
  const [workNotes, setWorkNotes] = useState('');
  const [scope, setScope] = useState<ReportScope>('all');
  const [formats, setFormats] = useState({
    word: true,
    excel: true,
    txt: true,
    json: false,
  });
  const [saving, setSaving] = useState(false);
  const [statusBanner, setStatusBanner] = useState<{
    type: 'ok' | 'info' | 'err';
    text: string;
  } | null>(null);

  const refreshFilesList = useCallback(
    async (handle: DirectoryHandleLike | null, promptIfNeeded = false) => {
      if (!handle) {
        setSavedFiles([]);
        setHasPermission(false);
        return;
      }
      setLoadingFiles(true);
      try {
        const permitted = await ensureReadWritePermission(handle, promptIfNeeded);
        setHasPermission(permitted);
        if (permitted) {
          const files = await listDirectoryFiles(handle);
          setSavedFiles(files);
        } else {
          setSavedFiles([]);
        }
      } catch {
        setSavedFiles([]);
      } finally {
        setLoadingFiles(false);
      }
    },
    []
  );

  useEffect(() => {
    void (async () => {
      const existing = await getStoredDirectoryHandle();
      if (existing) {
        setDirHandle(existing);
        await refreshFilesList(existing, false);
      }
    })();
  }, [refreshFilesList]);

  const handlePickFolder = async () => {
    setStatusBanner(null);
    const result = await pickDawlindDirectory();
    if (result.handle) {
      setDirHandle(result.handle);
      setIframeBlocked(false);
      await refreshFilesList(result.handle, true);
      setStatusBanner({
        type: 'ok',
        text: `${t.dawlindLinkedStatus} ${result.handle.name}`,
      });
    } else if (result.blockedByIframe) {
      setIframeBlocked(true);
      setStatusBanner({
        type: 'info',
        text: t.dawlindIframeNotice,
      });
    } else if (result.error === 'unsupported') {
      setStatusBanner({
        type: 'info',
        text: t.dawlindIframeNotice,
      });
    }
  };

  const handleUnlinkFolder = async () => {
    await clearStoredDirectoryHandle();
    setDirHandle(null);
    setHasPermission(false);
    setSavedFiles([]);
    setStatusBanner(null);
  };

  const handleSaveWorkReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formats.word && !formats.excel && !formats.txt && !formats.json) {
      setStatusBanner({
        type: 'err',
        text:
          lang === 'fr'
            ? 'Sélectionnez au moins un format de fichier.'
            : 'يرجى تحديد صيغة ملف واحدة على الأقل.',
      });
      return;
    }

    setSaving(true);
    setStatusBanner(null);

    const targetItems =
      scope === 'delayed' ? delayedItems : scope === 'filtered' ? filteredItems : allItems;

    const finalTitle =
      workTitle.trim() ||
      (lang === 'fr'
        ? `Rapport travaux ${new Date().toLocaleDateString('fr-FR')}`
        : `تقرير أعمال وصيانة ${new Date().toLocaleDateString('ar-SA')}`);

    const safePrefix = sanitizeArchiveFilename(finalTitle);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
    const baseName = `DAWLIND_${safePrefix}_${stamp}`;

    try {
      const filesToSave: Array<{ filename: string; blob: Blob }> = [];

      if (formats.word) {
        const wordBlob = await buildWordBlob(
          targetItems,
          finalTitle,
          lang,
          workNotes,
          actorName
        );
        filesToSave.push({ filename: `${baseName}.docx`, blob: wordBlob });
      }

      if (formats.excel) {
        const excelBlob = buildExcelBlob(targetItems, lang, {
          title: finalTitle,
          notes: workNotes,
          author: actorName,
        });
        filesToSave.push({ filename: `${baseName}.xlsx`, blob: excelBlob });
      }

      if (formats.txt) {
        const txtBlob = buildWorkReportTextBlob(
          targetItems,
          finalTitle,
          workNotes,
          actorName,
          lang
        );
        filesToSave.push({ filename: `${baseName}.txt`, blob: txtBlob });
      }

      if (formats.json) {
        const jsonBlob = buildBackupJSONBlob(targetItems, {
          title: finalTitle,
          notes: workNotes,
          author: actorName,
        });
        filesToSave.push({ filename: `${baseName}.json`, blob: jsonBlob });
      }

      let wroteDirectly = false;
      if (dirHandle) {
        const ok = await ensureReadWritePermission(dirHandle, true);
        if (ok) {
          for (const file of filesToSave) {
            await writeBlobToDirectory(dirHandle, file.filename, file.blob);
          }
          wroteDirectly = true;
          await refreshFilesList(dirHandle, false);
        }
      }

      if (!wroteDirectly) {
        for (const file of filesToSave) {
          triggerBlobDownload(file.blob, file.filename);
        }
      }

      const msg = wroteDirectly
        ? `${t.dawlindSavedDirectMsg} "${dirHandle?.name || 'DAWLIND'}" (${filesToSave.length})`
        : t.dawlindSavedDownloadMsg;
      setStatusBanner({ type: 'ok', text: msg });
      onNotify?.('ok', msg);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : lang === 'fr'
          ? 'Impossible d’enregistrer le fichier.'
          : 'تعذر حفظ ملف العمل والتقرير.';
      setStatusBanner({ type: 'err', text: msg });
      onNotify?.('err', msg);
    } finally {
      setSaving(false);
    }
  };

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  return (
    <section
      id="dawlind-archive-section"
      className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900"
    >
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-[#0F4C81] dark:text-sky-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t.dawlindPanelTitle}
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.dawlindPanelDesc}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!dirHandle ? (
            <button
              type="button"
              onClick={() => void handlePickFolder()}
              className="flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#0c3c66]"
            >
              <FolderOpen className="h-4 w-4" />
              {t.dawlindLinkBtn}
            </button>
          ) : (
            <>
              {!hasPermission && (
                <button
                  type="button"
                  onClick={() => void refreshFilesList(dirHandle, true)}
                  className="flex items-center gap-1.5 rounded-lg bg-amber-600 px-3 py-2 text-xs font-semibold text-white hover:bg-amber-700"
                >
                  <FolderCheck className="h-4 w-4" />
                  {t.dawlindGrantPermBtn}
                </button>
              )}
              <button
                type="button"
                onClick={() => void handlePickFolder()}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                <FolderOpen className="h-4 w-4" />
                {t.dawlindChangeBtn}
              </button>
              <button
                type="button"
                onClick={() => void handleUnlinkFolder()}
                className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              >
                <Unlink className="h-3.5 w-3.5" />
                {t.dawlindUnlinkBtn}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Folder Link Status */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-xs dark:border-slate-800 dark:bg-slate-950/60">
        <div className="flex items-center gap-2">
          {dirHandle && hasPermission ? (
            <>
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span className="font-semibold text-slate-700 dark:text-slate-200">
                {t.dawlindLinkedStatus}{' '}
                <span className="font-mono text-[#0F4C81] dark:text-sky-400">
                  D:\{dirHandle.name}
                </span>
              </span>
            </>
          ) : (
            <>
              <FolderOpen className="h-4 w-4 shrink-0 text-slate-500" />
              <span className="text-slate-600 dark:text-slate-300">
                {t.dawlindNotLinkedStatus}
              </span>
            </>
          )}
        </div>

        {(iframeBlocked || !isDirectoryPickerSupported()) && (
          <a
            href={typeof window !== 'undefined' ? window.location.href : '/'}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 font-semibold text-[#0F4C81] hover:underline dark:text-sky-400"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            {t.dawlindOpenStandalone}
          </a>
        )}
      </div>

      {statusBanner && (
        <div
          className={`mt-4 rounded-lg border px-4 py-2.5 text-xs font-medium ${
            statusBanner.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
              : statusBanner.type === 'info'
              ? 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
          }`}
        >
          {statusBanner.text}
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Work & Report Creation Form */}
        <form onSubmit={handleSaveWorkReport} className="space-y-4 lg:col-span-2">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label
                htmlFor="dawlind-work-title"
                className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {t.dawlindWorkTitleLabel}
              </label>
              <input
                id="dawlind-work-title"
                type="text"
                maxLength={120}
                value={workTitle}
                onChange={(e) => setWorkTitle(e.target.value)}
                placeholder={t.dawlindWorkTitlePlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div>
              <label
                htmlFor="dawlind-scope"
                className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {t.dawlindScopeLabel}
              </label>
              <select
                id="dawlind-scope"
                value={scope}
                onChange={(e) => setScope(e.target.value as ReportScope)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                <option value="all">
                  {t.dawlindScopeAll} ({allItems.length})
                </option>
                <option value="filtered">
                  {t.dawlindScopeFiltered} ({filteredItems.length})
                </option>
                <option value="delayed">
                  {t.dawlindScopeDelayed} ({delayedItems.length})
                </option>
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="dawlind-work-notes"
              className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              {t.dawlindNotesLabel}
            </label>
            <textarea
              id="dawlind-work-notes"
              rows={4}
              maxLength={4000}
              value={workNotes}
              onChange={(e) => setWorkNotes(e.target.value)}
              placeholder={t.dawlindNotesPlaceholder}
              className="w-full rounded-lg border border-slate-300 bg-white p-3.5 text-sm leading-relaxed text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>

          <div>
            <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t.dawlindFormatsLabel}
            </div>
            <div className="flex flex-wrap items-center gap-4 text-xs font-medium text-slate-700 dark:text-slate-300">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={formats.word}
                  onChange={(e) => setFormats((f) => ({ ...f, word: e.target.checked }))}
                />
                <FileText className="h-3.5 w-3.5 text-blue-600" />
                <span>Word (.docx)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={formats.excel}
                  onChange={(e) => setFormats((f) => ({ ...f, excel: e.target.checked }))}
                />
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600" />
                <span>Excel (.xlsx)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={formats.txt}
                  onChange={(e) => setFormats((f) => ({ ...f, txt: e.target.checked }))}
                />
                <FileText className="h-3.5 w-3.5 text-slate-500" />
                <span>Text (.txt)</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={formats.json}
                  onChange={(e) => setFormats((f) => ({ ...f, json: e.target.checked }))}
                />
                <FileJson className="h-3.5 w-3.5 text-amber-600" />
                <span>JSON</span>
              </label>
            </div>
          </div>

          <button
            type="submit"
            disabled={saving}
            className="inline-flex items-center gap-2 rounded-lg bg-[#0F4C81] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c3c66] disabled:opacity-50"
          >
            <Save className="h-4 w-4" />
            {saving ? t.dawlindSavingBtn : t.dawlindSaveBtn}
          </button>
        </form>

        {/* Saved Files inside linked D:\DAWLIND Folder */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950/50">
          <div className="mb-3 flex items-center justify-between gap-2">
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
              {t.dawlindSavedFilesTitle}
            </h3>
            {dirHandle && hasPermission && (
              <button
                type="button"
                onClick={() => void refreshFilesList(dirHandle, false)}
                disabled={loadingFiles}
                className="flex items-center gap-1 text-[11px] font-semibold text-[#0F4C81] hover:underline dark:text-sky-400"
              >
                <RefreshCw className={`h-3 w-3 ${loadingFiles ? 'animate-spin' : ''}`} />
                {t.dawlindRefreshFiles}
              </button>
            )}
          </div>

          {!dirHandle || !hasPermission || savedFiles.length === 0 ? (
            <p className="py-8 text-center text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {t.dawlindNoFilesYet}
            </p>
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {savedFiles.slice(0, 25).map((file) => (
                <div
                  key={file.name}
                  className="flex items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-slate-800 dark:text-slate-100">
                      {file.name}
                    </div>
                    <div className="font-mono mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                      {formatBytes(file.size)} · {new Date(file.lastModified).toLocaleDateString(locale)}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void downloadFileFromDirectory(dirHandle, file.name)}
                    className="shrink-0 rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                    title={file.name}
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
};
