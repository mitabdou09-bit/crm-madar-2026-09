import React, { useMemo, useState } from 'react';
import {
  CalendarCheck2,
  CheckCircle2,
  FileSpreadsheet,
  FileText,
  Lock,
  MessageSquarePlus,
  Pencil,
  Printer,
  Search,
  Share2,
  Trash2,
} from 'lucide-react';
import { CATEGORY_LABELS, T, type Language } from '../i18n';
import type { EquipmentItem } from '../types';
import {
  getAvailableYears,
  groupFinishedEquipmentByEntryMonth,
} from '../utils/dateReports';
import { exportToExcel, exportToWord } from '../utils/exporters';

interface MonthlyArchiveViewProps {
  items: EquipmentItem[];
  isAdmin: boolean;
  lang: Language;
  onSelectItem: (itemId: string) => void;
  onEditItem: (item: EquipmentItem) => void;
  onDeleteItem: (item: EquipmentItem) => void;
  onOpenAdminLogin: () => void;
  onPrintGroup: (groupItems: EquipmentItem[], title: string, subtitle?: string) => void;
  onShareGroup: (groupItems: EquipmentItem[], title: string, subtitle?: string) => void;
}

export const MonthlyArchiveView: React.FC<MonthlyArchiveViewProps> = ({
  items,
  isAdmin,
  lang,
  onSelectItem,
  onEditItem,
  onDeleteItem,
  onOpenAdminLogin,
  onPrintGroup,
  onShareGroup,
}) => {
  const t = T[lang];
  const locale = lang === 'fr' ? 'fr-FR' : 'ar-SA';
  const [selectedYear, setSelectedYear] = useState<string>('ALL');
  const [search, setSearch] = useState('');

  const finishedItems = useMemo(
    () => items.filter((item) => item.condition === 'جاهزة للعمل'),
    [items]
  );

  const availableYears = useMemo(() => getAvailableYears(finishedItems), [finishedItems]);

  const filteredFinished = useMemo(() => {
    const q = search.trim().toLowerCase();
    return finishedItems.filter((item) => {
      if (selectedYear !== 'ALL' && item.entryDate.slice(0, 4) !== selectedYear) {
        return false;
      }
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.equipmentNumber.toLowerCase().includes(q) ||
        item.location.toLowerCase().includes(q) ||
        item.entryDate.toLowerCase().includes(q)
      );
    });
  }, [finishedItems, selectedYear, search]);

  const monthGroups = useMemo(
    () => groupFinishedEquipmentByEntryMonth(filteredFinished, lang),
    [filteredFinished, lang]
  );

  return (
    <section className="space-y-4">
      {/* Header & Filters */}
      <div className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2">
              <CalendarCheck2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
              <h2 className="text-base font-bold text-slate-900 dark:text-white">
                {t.monthlyArchiveTitle} ({finishedItems.length})
              </h2>
            </div>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {t.monthlyArchiveDesc}
            </p>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <div className="relative min-w-[240px] flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.monthlyArchiveSearchPlaceholder}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 ps-9 pe-3 text-sm text-slate-900 focus:border-[#0F4C81] focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>

          <select
            value={selectedYear}
            onChange={(e) => setSelectedYear(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="ALL">{t.monthlyArchiveAllYears}</option>
            {availableYears.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Month-by-Month Folders */}
      {monthGroups.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-12 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
            {t.monthlyArchiveEmptyTitle}
          </p>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t.monthlyArchiveEmptyDesc}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {monthGroups.map((group) => {
            const reportTitle =
              lang === 'fr'
                ? `Archive de maintenance terminée — ${group.monthLabel}`
                : `أرشيف المعدات المنتهية صيانتها — ${group.monthLabel}`;
            const periodSubtitle =
              lang === 'fr'
                ? `Mois d’entrée : ${group.monthLabel} (${group.monthKey})`
                : `شهر الدخول للورشة: ${group.monthLabel} (${group.monthKey})`;
            const filePrefix =
              lang === 'fr'
                ? `archive_maintenance_${group.monthKey}`
                : `ارشيف_صيانة_${group.monthKey}`;

            return (
              <div
                key={group.monthKey}
                className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900"
              >
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-950/60">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400">
                      <CheckCircle2 className="h-5 w-5" />
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                        {group.monthLabel}{' '}
                        <span className="font-mono text-xs font-medium text-slate-500 dark:text-slate-400">
                          ({group.monthKey})
                        </span>
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {group.items.length} {t.itemCountUnit} · {t.monthlyArchiveFinishedBadge}
                      </p>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onPrintGroup(group.items, reportTitle, periodSubtitle)}
                      className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <Printer className="h-3.5 w-3.5" />
                      {t.printPdf}
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        void exportToWord(group.items, reportTitle, filePrefix, lang, periodSubtitle)
                      }
                      className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <FileText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                      Word
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        exportToExcel(group.items, filePrefix, lang, periodSubtitle)
                      }
                      className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                    >
                      <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      Excel
                    </button>
                    <button
                      type="button"
                      onClick={() => onShareGroup(group.items, reportTitle, periodSubtitle)}
                      className="flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-[#0c3c66]"
                    >
                      <Share2 className="h-3.5 w-3.5" />
                      {t.sendReportBtn}
                    </button>
                  </div>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-start text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 bg-white text-xs font-semibold text-slate-500 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-400">
                        <th className="px-4 py-2.5 text-start">{t.thEquipmentNum}</th>
                        <th className="px-4 py-2.5 text-start">{t.eqCatLabel}</th>
                        <th className="px-4 py-2.5 text-start">{t.entryDateLabel}</th>
                        <th className="px-4 py-2.5 text-start">{t.finalExitDateLabel}</th>
                        <th className="px-4 py-2.5 text-start">{t.thTeamWrite}</th>
                        <th className="px-4 py-2.5 text-end">{t.thActions}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                      {group.items.map((item) => (
                        <tr
                          key={item.id}
                          className="transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                        >
                          <td className="px-4 py-3 text-start">
                            <button
                              type="button"
                              onClick={() => onSelectItem(item.id)}
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
                          <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                            <div>{CATEGORY_LABELS[lang][item.category]}</div>
                            <div className="mt-1 inline-flex items-center gap-1 font-bold text-emerald-700 dark:text-emerald-400">
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {t.monthlyArchiveFinishedBadge}
                            </div>
                          </td>
                          <td className="font-mono px-4 py-3 text-xs font-semibold text-slate-800 dark:text-slate-200">
                            {item.entryDate || '-'}
                          </td>
                          <td className="font-mono px-4 py-3 text-xs text-slate-600 dark:text-slate-400">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                              {item.finalExitDate || item.expectedExitDate || '-'}
                            </div>
                            {item.finalExitDate && item.expectedExitDate && (
                              <div className="text-[10px] text-slate-400">
                                {t.expectedExitLabel}: {item.expectedExitDate}
                              </div>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs">
                            <div className="font-medium text-slate-800 dark:text-slate-200">
                              {item.lastUpdatedBy}
                            </div>
                            <div className="font-mono mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                              {new Date(item.updatedAt).toLocaleDateString(locale)}
                            </div>
                            <button
                              type="button"
                              onClick={() => onSelectItem(item.id)}
                              className="mt-1 inline-flex items-center gap-1 font-semibold text-[#0F4C81] hover:underline dark:text-sky-400"
                            >
                              <MessageSquarePlus className="h-3.5 w-3.5" />
                              {t.openTeamNotes}
                            </button>
                          </td>
                          <td className="px-4 py-3 text-end">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => onEditItem(item)}
                                className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                title={t.monthlyArchiveReopenTooltip}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onPrintGroup(
                                    [item],
                                    lang === 'fr'
                                      ? `Fiche maintenance : ${item.name} (${item.equipmentNumber})`
                                      : `ورقة صيانة: ${item.name} (${item.equipmentNumber})`,
                                    periodSubtitle
                                  )
                                }
                                className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                title={t.printTooltip}
                              >
                                <Printer className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  onShareGroup(
                                    [item],
                                    lang === 'fr'
                                      ? `Fiche maintenance : ${item.name}`
                                      : `ورقة صيانة: ${item.name}`,
                                    periodSubtitle
                                  )
                                }
                                className="rounded-md border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                                title={t.shareTooltip}
                              >
                                <Share2 className="h-3.5 w-3.5" />
                              </button>
                              {isAdmin ? (
                                <button
                                  type="button"
                                  onClick={() => onDeleteItem(item)}
                                  className="rounded-md border border-red-200 p-1.5 text-red-600 hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/50"
                                  title={t.deleteTooltip}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={onOpenAdminLogin}
                                  className="rounded-md border border-slate-200 p-1.5 text-slate-400 hover:bg-slate-100 dark:border-slate-800 dark:text-slate-600 dark:hover:bg-slate-800"
                                  title={t.deleteLockedTooltip}
                                >
                                  <Lock className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
};
