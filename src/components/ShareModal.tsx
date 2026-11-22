import React, { useMemo, useState } from 'react';
import {
  X,
  MessageCircle,
  Mail,
  Copy,
  Check,
  Share2,
  Printer,
  FileText,
  FileSpreadsheet,
} from 'lucide-react';
import { T, type Language } from '../i18n';
import type { EquipmentItem } from '../types';
import {
  buildExcelBlob,
  buildWordBlob,
  exportToExcel,
  exportToWord,
  formatShareReportText,
} from '../utils/exporters';

interface ShareModalProps {
  isOpen: boolean;
  items: EquipmentItem[];
  title: string;
  subtitle?: string;
  lang: Language;
  onPrint?: () => void;
  onClose: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  items,
  title,
  subtitle,
  lang,
  onPrint,
  onClose,
}) => {
  const [copied, setCopied] = useState(false);
  const [busyFile, setBusyFile] = useState<'word' | 'excel' | null>(null);
  const t = T[lang];

  const reportText = useMemo(
    () => formatShareReportText(items, title, lang, subtitle),
    [items, title, lang, subtitle]
  );

  if (!isOpen) return null;

  const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(reportText)}`;
  const fullSubject = subtitle ? `${title} — ${subtitle}` : title;
  const mailtoUrl = `mailto:?subject=${encodeURIComponent(fullSubject)}&body=${encodeURIComponent(
    reportText
  )}`;

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(reportText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  const handleNativeShare = async () => {
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await navigator.share({
          title: fullSubject,
          text: reportText,
        });
      } catch {
        // User cancelled share dialog
      }
    }
  };

  const handleShareOrDownloadFile = async (kind: 'word' | 'excel') => {
    setBusyFile(kind);
    try {
      const dateStamp = new Date().toISOString().slice(0, 10);
      const blob =
        kind === 'word'
          ? await buildWordBlob(items, title, lang, undefined, undefined, subtitle)
          : buildExcelBlob(items, lang, { title, periodSubtitle: subtitle });
      const filename =
        kind === 'word'
          ? `rapport_madar_${dateStamp}.docx`
          : `rapport_madar_${dateStamp}.xlsx`;
      const file = new File([blob], filename, { type: blob.type });

      if (
        typeof navigator !== 'undefined' &&
        'canShare' in navigator &&
        typeof navigator.canShare === 'function' &&
        navigator.canShare({ files: [file] })
      ) {
        await navigator.share({
          title: fullSubject,
          text: reportText,
          files: [file],
        });
      } else if (kind === 'word') {
        await exportToWord(items, title, undefined, lang, subtitle);
      } else {
        exportToExcel(items, undefined, lang, subtitle);
      }
    } catch {
      if (kind === 'word') {
        await exportToWord(items, title, undefined, lang, subtitle);
      } else {
        exportToExcel(items, undefined, lang, subtitle);
      }
    } finally {
      setBusyFile(null);
    }
  };

  const supportsNativeShare = typeof navigator !== 'undefined' && 'share' in navigator;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]">
      <div className="w-full max-w-xl rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {t.shareModalTitle}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {title}
              {subtitle ? ` · ${subtitle}` : ''} ({items.length} {t.itemCountUnit})
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="space-y-4 p-6">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <a
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
            >
              <MessageCircle className="h-4 w-4" />
              {t.shareWhatsapp}
            </a>

            <a
              href={mailtoUrl}
              className="flex items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c3c66]"
            >
              <Mail className="h-4 w-4" />
              {t.shareEmail}
            </a>

            <button
              type="button"
              onClick={handleCopy}
              className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
              {copied ? t.copiedReport : t.copyReport}
            </button>

            {supportsNativeShare && (
              <button
                type="button"
                onClick={handleNativeShare}
                className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-800 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
              >
                <Share2 className="h-4 w-4" />
                {t.shareWindows}
              </button>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/60">
            <div className="mb-2 text-xs font-semibold text-slate-700 dark:text-slate-300">
              {t.shareAttachExportLabel}
            </div>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {onPrint && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onPrint();
                  }}
                  className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
                >
                  <Printer className="h-3.5 w-3.5 text-[#0F4C81] dark:text-sky-400" />
                  {t.printSavePdf}
                </button>
              )}
              <button
                type="button"
                disabled={busyFile !== null}
                onClick={() => void handleShareOrDownloadFile('word')}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <FileText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                Word (.docx)
              </button>
              <button
                type="button"
                disabled={busyFile !== null}
                onClick={() => void handleShareOrDownloadFile('excel')}
                className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800"
              >
                <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                Excel (.xlsx)
              </button>
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-400">
              {t.sharePreviewLabel}
            </label>
            <textarea
              readOnly
              rows={7}
              value={reportText}
              className="w-full rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs leading-relaxed text-slate-800 focus:outline-none dark:border-slate-800 dark:bg-slate-950 dark:text-slate-200"
            />
          </div>
        </div>
      </div>
    </div>
  );
};
