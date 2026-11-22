import React, { useRef, useState } from 'react';
import {
  CloudUpload,
  Download,
  FileSpreadsheet,
  FileText,
  Printer,
  RotateCcw,
  Trash2,
  Upload,
  Lock,
  FileJson,
  FileDown,
} from 'lucide-react';
import { T, type Language } from '../i18n';
import type { CloudBackupSnapshot, EquipmentItem } from '../types';
import {
  exportBackupJSON,
  exportToCSV,
  exportToExcel,
  exportToWord,
} from '../utils/exporters';

interface BackupRestoreViewProps {
  items: EquipmentItem[];
  backups: CloudBackupSnapshot[];
  isAdmin: boolean;
  lang: Language;
  onCreateCloudBackup: (label: string) => Promise<void>;
  onRestoreCloudBackup: (backupId: string) => Promise<void>;
  onDeleteCloudBackup: (backupId: string) => Promise<void>;
  onImportJsonBackup: (items: EquipmentItem[], mode: 'replace' | 'merge') => Promise<void>;
  onPrintAll: () => void;
  onOpenAdminLogin: () => void;
}

export const BackupRestoreView: React.FC<BackupRestoreViewProps> = ({
  items,
  backups,
  isAdmin,
  lang,
  onCreateCloudBackup,
  onRestoreCloudBackup,
  onDeleteCloudBackup,
  onImportJsonBackup,
  onPrintAll,
  onOpenAdminLogin,
}) => {
  const t = T[lang];
  const locale = lang === 'fr' ? 'fr-FR' : 'ar-SA';
  const [snapshotLabel, setSnapshotLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [importMode, setImportMode] = useState<'replace' | 'merge'>('merge');
  const [statusMessage, setStatusMessage] = useState<{ type: 'ok' | 'err'; text: string } | null>(
    null
  );
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleCreateBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setStatusMessage(null);
    try {
      const defaultLabel =
        lang === 'fr'
          ? `Sauvegarde cloud (${new Date().toLocaleDateString('fr-FR')})`
          : `نسخة سحابية (${new Date().toLocaleDateString('ar-SA')})`;
      await onCreateCloudBackup(snapshotLabel.trim() || defaultLabel);
      setSnapshotLabel('');
      setStatusMessage({
        type: 'ok',
        text:
          lang === 'fr'
            ? 'Sauvegarde enregistrée dans le cloud avec succès.'
            : 'تم حفظ النسخة الاحتياطية في السحابة بنجاح.',
      });
    } catch (err) {
      setStatusMessage({
        type: 'err',
        text: err instanceof Error ? err.message : t.errCloudVerify,
      });
    } finally {
      setCreating(false);
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setStatusMessage(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as { items?: EquipmentItem[] } | EquipmentItem[];
      const importedItems = Array.isArray(parsed) ? parsed : parsed.items;
      if (!Array.isArray(importedItems)) {
        throw new Error(
          lang === 'fr'
            ? 'Ce fichier JSON ne contient pas de liste valide.'
            : 'ملف النسخة الاحتياطية لا يحتوي على قائمة معدات صالحة.'
        );
      }
      await onImportJsonBackup(importedItems, importMode);
      setStatusMessage({
        type: 'ok',
        text:
          lang === 'fr'
            ? `${importedItems.length} équipement(s) restauré(s) et synchronisé(s).`
            : `تم استرجاع ${importedItems.length} معدة من الملف ومزامنتها للسحابة.`,
      });
    } catch (err) {
      setStatusMessage({
        type: 'err',
        text: err instanceof Error ? err.message : t.errCloudVerify,
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  return (
    <div className="space-y-6">
      {statusMessage && (
        <div
          className={`rounded-lg border px-4 py-3 text-sm ${
            statusMessage.type === 'ok'
              ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-300'
              : 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
          }`}
        >
          {statusMessage.text}
        </div>
      )}

      {/* Exporter Suite */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-4">
          <h2 className="text-base font-bold text-slate-900 dark:text-white">{t.exporterTitle}</h2>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.exporterDesc}</p>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <button
            type="button"
            onClick={onPrintAll}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <Printer className="h-4 w-4 text-[#0F4C81] dark:text-sky-400" />
            {t.printPdf}
          </button>

          <button
            type="button"
            onClick={() => exportToExcel(items, undefined, lang)}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            {t.exportExcel}
          </button>

          <button
            type="button"
            onClick={() => void exportToWord(items, undefined, undefined, lang)}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <FileText className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            {t.exportWord}
          </button>

          <button
            type="button"
            onClick={() => exportToCSV(items, undefined, lang)}
            className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <FileDown className="h-4 w-4 text-slate-600 dark:text-slate-400" />
            {t.exportCsv}
          </button>

          <button
            type="button"
            onClick={() => exportBackupJSON(items, 'full_backup')}
            className="flex items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#0c3c66]"
          >
            <FileJson className="h-4 w-4" />
            {t.downloadJson}
          </button>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Cloud Snapshots */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t.cloudSnapshotsTitle}
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t.cloudSnapshotsDesc}
            </p>
          </div>

          <form onSubmit={handleCreateBackup} className="mb-5 flex gap-2">
            <input
              type="text"
              maxLength={120}
              value={snapshotLabel}
              onChange={(e) => setSnapshotLabel(e.target.value)}
              placeholder={t.snapshotPlaceholder}
              className="flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
            <button
              type="submit"
              disabled={creating}
              className="flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c3c66] disabled:opacity-50"
            >
              <CloudUpload className="h-4 w-4" />
              {creating ? t.savingSnapshot : t.saveSnapshotBtn}
            </button>
          </form>

          {backups.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              {t.noSnapshots}
            </div>
          ) : (
            <div className="space-y-2.5">
              {backups.map((bkp) => (
                <div
                  key={bkp.id}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3.5 dark:border-slate-800"
                >
                  <div>
                    <div className="text-sm font-semibold text-slate-900 dark:text-white">
                      {bkp.label}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-mono">
                        {bkp.itemCount} {t.itemCountUnit}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{bkp.createdBy}</span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">
                        {new Date(bkp.createdAt).toLocaleString(locale)}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => exportBackupJSON(bkp.items, bkp.id)}
                      className="rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
                    >
                      <Download className="h-3.5 w-3.5" />
                    </button>
                    {isAdmin ? (
                      <>
                        <button
                          type="button"
                          onClick={() => void onRestoreCloudBackup(bkp.id)}
                          className="flex items-center gap-1 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {t.restoreBtn}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeleteCloudBackup(bkp.id)}
                          className="rounded-lg border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/50"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={onOpenAdminLogin}
                        className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-500 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400"
                      >
                        <Lock className="h-3.5 w-3.5" />
                        {t.restoreAdminBtn}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* File Import Restore */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
          <div className="mb-4">
            <h2 className="text-base font-bold text-slate-900 dark:text-white">{t.importTitle}</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.importDesc}</p>
          </div>

          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-4 text-sm">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'merge'}
                  onChange={() => setImportMode('merge')}
                />
                <span>{t.importMerge}</span>
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="importMode"
                  checked={importMode === 'replace'}
                  onChange={() => setImportMode('replace')}
                />
                <span>{t.importReplace}</span>
              </label>
            </div>

            {isAdmin ? (
              <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center dark:border-slate-700 dark:bg-slate-950/60">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  className="hidden"
                  id="backup-json-upload"
                />
                <label
                  htmlFor="backup-json-upload"
                  className="inline-flex cursor-pointer items-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c3c66]"
                >
                  <Upload className="h-4 w-4" />
                  {t.chooseJsonFile}
                </label>
                <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t.importHint}</p>
              </div>
            ) : (
              <div className="rounded-lg border border-slate-200 bg-slate-50 p-6 text-center dark:border-slate-800 dark:bg-slate-950/50">
                <Lock className="mx-auto mb-2 h-6 w-6 text-slate-400" />
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                  {t.importAdminOnlyMsg}
                </p>
                <button
                  type="button"
                  onClick={onOpenAdminLogin}
                  className="mt-3 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 dark:bg-slate-700"
                >
                  {t.showAdminDetails}
                </button>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
