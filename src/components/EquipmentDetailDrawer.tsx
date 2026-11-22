import React, { useState } from 'react';
import {
  X,
  Pencil,
  Trash2,
  Printer,
  FileSpreadsheet,
  FileText,
  Share2,
  Send,
  Lock,
  Wrench,
  PackageX,
  AlertTriangle,
} from 'lucide-react';
import { CATEGORY_LABELS, CONDITION_LABELS, T, type Language } from '../i18n';
import type { EquipmentItem } from '../types';
import { calculateOverdueDays } from '../utils/exporters';

interface EquipmentDetailDrawerProps {
  item: EquipmentItem | null;
  isAdmin: boolean;
  lang: Language;
  onClose: () => void;
  onEdit: (item: EquipmentItem) => void;
  onDelete: (item: EquipmentItem) => void;
  onAddNote: (itemId: string, text: string) => Promise<void>;
  onPrintSingle: (item: EquipmentItem) => void;
  onExportWordSingle: (item: EquipmentItem) => void;
  onExportExcelSingle: (item: EquipmentItem) => void;
  onShareSingle: (item: EquipmentItem) => void;
}

export const EquipmentDetailDrawer: React.FC<EquipmentDetailDrawerProps> = ({
  item,
  isAdmin,
  lang,
  onClose,
  onEdit,
  onDelete,
  onAddNote,
  onPrintSingle,
  onExportWordSingle,
  onExportExcelSingle,
  onShareSingle,
}) => {
  const [noteText, setNoteText] = useState('');
  const [submittingNote, setSubmittingNote] = useState(false);

  if (!item) return null;

  const t = T[lang];
  const locale = lang === 'fr' ? 'fr-FR' : 'ar-SA';
  const overdueDays = calculateOverdueDays(item);

  const handleNoteSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteText.trim()) return;
    setSubmittingNote(true);
    try {
      await onAddNote(item.id, noteText.trim());
      setNoteText('');
    } finally {
      setSubmittingNote(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-950/55 backdrop-blur-[2px]">
      <div className="flex h-full w-full max-w-2xl flex-col border-s border-slate-200 bg-white shadow-2xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-start justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-mono font-semibold text-[#0F4C81] dark:text-sky-400">
                {item.equipmentNumber}
              </span>
              <span aria-hidden="true">·</span>
              <span>{CATEGORY_LABELS[lang][item.category]}</span>
              <span aria-hidden="true">·</span>
              <span>{CONDITION_LABELS[lang][item.condition]}</span>
            </div>
            <h2 className="mt-1 text-xl font-bold text-slate-900 dark:text-white">{item.name}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-6 py-3 dark:border-slate-800 dark:bg-slate-950/70">
          <button
            type="button"
            onClick={() => onEdit(item)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t.editCorrectBtn}
          </button>

          <button
            type="button"
            onClick={() => onPrintSingle(item)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Printer className="h-3.5 w-3.5" />
            {t.printPdf}
          </button>

          <button
            type="button"
            onClick={() => onExportWordSingle(item)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <FileText className="h-3.5 w-3.5" />
            Word
          </button>

          <button
            type="button"
            onClick={() => onExportExcelSingle(item)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <FileSpreadsheet className="h-3.5 w-3.5" />
            Excel
          </button>

          <button
            type="button"
            onClick={() => onShareSingle(item)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <Share2 className="h-3.5 w-3.5" />
            {t.shareBtnShort}
          </button>

          <div className="ms-auto">
            {isAdmin ? (
              <button
                type="button"
                onClick={() => onDelete(item)}
                className="flex items-center gap-1.5 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-red-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {t.deleteAdminBtn}
              </button>
            ) : (
              <span className="flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-800/60 dark:text-slate-500">
                <Lock className="h-3.5 w-3.5" />
                {t.deleteAdminOnlyBadge}
              </span>
            )}
          </div>
        </div>

        <div className="flex-1 space-y-6 overflow-y-auto p-6">
          <div className="grid grid-cols-2 gap-4 rounded-lg border border-slate-200 p-4 text-sm dark:border-slate-800 sm:grid-cols-3">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t.locationLabel}</div>
              <div className="mt-1 font-medium text-slate-900 dark:text-white">{item.location}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t.entryDateLabel}</div>
              <div className="font-mono mt-1 font-medium text-slate-900 dark:text-white">
                {item.entryDate}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t.expectedExitLabel}</div>
              <div className="font-mono mt-1 font-medium text-slate-900 dark:text-white">
                {item.expectedExitDate}
                {overdueDays > 0 && (
                  <span className="ms-2 text-xs font-semibold text-red-600 dark:text-red-400">
                    ({t.overdueDaysPrefix} {overdueDays} {t.dayUnit})
                  </span>
                )}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t.createdByLabel}</div>
              <div className="mt-1 font-medium text-slate-900 dark:text-white">{item.createdBy}</div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t.lastUpdatedByLabel}</div>
              <div className="mt-1 font-medium text-slate-900 dark:text-white">
                {item.lastUpdatedBy}
              </div>
            </div>
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400">{t.updatedAtLabel}</div>
              <div className="font-mono mt-1 text-xs text-slate-700 dark:text-slate-300">
                {new Date(item.updatedAt).toLocaleString(locale)}
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h3 className="text-sm font-bold text-slate-900 dark:text-white">
              {t.delaySectionTitle}
            </h3>

            <div className="space-y-2.5">
              <div className="rounded-lg border border-slate-200 p-3.5 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                    <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                    {t.delayServicesLabel.replace(':', '')}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      item.delayServices ? 'text-amber-700 dark:text-amber-400' : 'text-slate-400'
                    }`}
                  >
                    {item.delayServices ? t.recordedReason : t.noReason}
                  </span>
                </div>
                {item.delayServices && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    {item.delayServicesNote || t.selectedNoDetails}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 p-3.5 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                    <PackageX className="h-4 w-4 text-red-600 dark:text-red-400" />
                    {t.delaySparePartsLabel.replace(':', '')}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      item.delaySpareParts ? 'text-red-700 dark:text-red-400' : 'text-slate-400'
                    }`}
                  >
                    {item.delaySpareParts ? t.recordedReason : t.noReason}
                  </span>
                </div>
                {item.delaySpareParts && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    {item.delaySparePartsNote || t.selectedNoDetails}
                  </p>
                )}
              </div>

              <div className="rounded-lg border border-slate-200 p-3.5 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-slate-200">
                    <AlertTriangle className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                    {t.delayOtherLabel.replace(':', '')}
                  </span>
                  <span
                    className={`text-xs font-semibold ${
                      item.delayOther ? 'text-slate-800 dark:text-slate-200' : 'text-slate-400'
                    }`}
                  >
                    {item.delayOther ? t.recordedReason : t.noReason}
                  </span>
                </div>
                {item.delayOther && (
                  <p className="mt-2 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
                    {item.delayOtherNote || t.selectedNoDetails}
                  </p>
                )}
                <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-xs dark:border-slate-800">
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

          <div className="space-y-3">
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                {t.teamNotesTitle}
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">{t.teamNotesDesc}</p>
            </div>

            <form onSubmit={handleNoteSubmit} className="flex gap-2">
              <input
                type="text"
                maxLength={1000}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={t.noteInputPlaceholder}
                className="flex-1 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
              <button
                type="submit"
                disabled={submittingNote || !noteText.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#0c3c66] disabled:opacity-50"
              >
                <Send className="h-4 w-4" />
                {t.sendBtn}
              </button>
            </form>

            <div className="space-y-2.5 pt-1">
              {item.teamNotes.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                  {t.noNotesYet}
                </p>
              ) : (
                item.teamNotes.map((note) => (
                  <div
                    key={note.id}
                    className="rounded-lg border border-slate-200 bg-slate-50/70 p-3.5 dark:border-slate-800 dark:bg-slate-950/60"
                  >
                    <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {note.author} {note.role === 'admin' ? `· ${t.adminTag}` : ''}
                      </span>
                      <span className="font-mono">
                        {new Date(note.createdAt).toLocaleString(locale)}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm text-slate-700 dark:text-slate-300">{note.text}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
