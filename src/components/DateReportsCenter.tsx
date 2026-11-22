import React, { useMemo, useState } from 'react';
import {
  Calendar,
  CalendarDays,
  CalendarRange,
  FileSpreadsheet,
  FileText,
  Printer,
  Share2,
} from 'lucide-react';
import { CATEGORY_LABELS, CONDITION_LABELS, T, type Language } from '../i18n';
import type { EquipmentItem } from '../types';
import {
  buildDatePeriodLabel,
  filterItemsByDateOptions,
  formatMonthYearLabel,
  getAvailableMonths,
  getAvailableYears,
  getCurrentMonthStr,
  getCurrentYearStr,
  getTodayDateStr,
  type ReportDateBasis,
  type ReportPeriodType,
  type ReportStatusFilter,
} from '../utils/dateReports';
import { calculateOverdueDays, exportToExcel, exportToWord, hasWorkshopDelay } from '../utils/exporters';

interface DateReportsCenterProps {
  items: EquipmentItem[];
  lang: Language;
  onPrint: (targetItems: EquipmentItem[], title: string, subtitle?: string) => void;
  onShare: (targetItems: EquipmentItem[], title: string, subtitle?: string) => void;
  onSelectItem?: (itemId: string) => void;
}

export const DateReportsCenter: React.FC<DateReportsCenterProps> = ({
  items,
  lang,
  onPrint,
  onShare,
  onSelectItem,
}) => {
  const t = T[lang];
  const isRtl = lang === 'ar';

  const [periodType, setPeriodType] = useState<ReportPeriodType>('day');
  const [selectedDate, setSelectedDate] = useState<string>(() => getTodayDateStr());
  const [selectedMonth, setSelectedMonth] = useState<string>(() => getCurrentMonthStr());
  const [selectedYear, setSelectedYear] = useState<string>(() => getCurrentYearStr());
  const [dateBasis, setDateBasis] = useState<ReportDateBasis>('either');
  const [statusFilter, setStatusFilter] = useState<ReportStatusFilter>('all');

  const availableYears = useMemo(() => getAvailableYears(items), [items]);
  const availableMonths = useMemo(() => getAvailableMonths(items), [items]);

  const filterOptions = useMemo(
    () => ({
      periodType,
      selectedDate,
      selectedMonth,
      selectedYear,
      dateBasis,
      statusFilter,
    }),
    [periodType, selectedDate, selectedMonth, selectedYear, dateBasis, statusFilter]
  );

  const matchedItems = useMemo(
    () =>
      filterItemsByDateOptions(
        items,
        filterOptions,
        lang,
        (item) => hasWorkshopDelay(item) || calculateOverdueDays(item) > 0
      ),
    [items, filterOptions, lang]
  );

  const periodLabel = useMemo(
    () => buildDatePeriodLabel(filterOptions, lang),
    [filterOptions, lang]
  );

  const reportTitle = useMemo(() => {
    if (isRtl) {
      switch (periodType) {
        case 'day':
          return 'التقرير اليومي لمتابعة وصيانة المعدات';
        case 'week':
          return 'التقرير الأسبوعي لمتابعة وصيانة المعدات';
        case 'month':
          return 'التقرير الشهري لمتابعة وصيانة المعدات';
        case 'year':
          return 'التقرير السنوي لمتابعة وصيانة المعدات';
        case 'all':
          return 'التقرير الشامل لمتابعة وصيانة المعدات';
      }
    }
    switch (periodType) {
      case 'day':
        return 'Rapport journalier de maintenance des équipements';
      case 'week':
        return 'Rapport hebdomadaire de maintenance des équipements';
      case 'month':
        return 'Rapport mensuel de maintenance des équipements';
      case 'year':
        return 'Rapport annuel de maintenance des équipements';
      case 'all':
        return 'Rapport général de maintenance des équipements';
    }
  }, [isRtl, periodType]);

  const filePrefix = useMemo(() => {
    const base = isRtl ? 'تقرير_المعدات' : 'rapport_equipements';
    switch (periodType) {
      case 'day':
        return `${base}_${selectedDate}`;
      case 'week':
        return `${base}_semaine_${selectedDate}`;
      case 'month':
        return `${base}_${selectedMonth}`;
      case 'year':
        return `${base}_${selectedYear}`;
      case 'all':
        return `${base}_complet`;
    }
  }, [isRtl, periodType, selectedDate, selectedMonth, selectedYear]);

  const periodTabs: Array<{ key: ReportPeriodType; label: string; icon: React.ReactNode }> = [
    { key: 'day', label: t.periodDayBtn, icon: <Calendar className="h-3.5 w-3.5" /> },
    { key: 'week', label: t.periodWeekBtn, icon: <CalendarRange className="h-3.5 w-3.5" /> },
    { key: 'month', label: t.periodMonthBtn, icon: <CalendarDays className="h-3.5 w-3.5" /> },
    { key: 'year', label: t.periodYearBtn, icon: <Calendar className="h-3.5 w-3.5" /> },
    { key: 'all', label: t.periodAllBtn, icon: <CalendarDays className="h-3.5 w-3.5" /> },
  ];

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-[#0F4C81] dark:text-sky-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t.dateReportCenterTitle}
            </h2>
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
            {t.dateReportCenterDesc}
          </p>
        </div>

        <div className="rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-[#0F4C81] dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-300">
          {periodLabel}
        </div>
      </div>

      {/* Period Selector Tabs */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {periodTabs.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setPeriodType(tab.key)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition ${
              periodType === tab.key
                ? 'border-[#0F4C81] bg-[#0F4C81] text-white'
                : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200 dark:hover:bg-slate-800'
            }`}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Date Picker & Criteria Controls */}
      <div className="mt-4 grid grid-cols-1 gap-4 rounded-xl border border-slate-200 bg-slate-50 p-4 md:grid-cols-3 dark:border-slate-800 dark:bg-slate-950/60">
        {(periodType === 'day' || periodType === 'week') && (
          <div>
            <label
              htmlFor="report-day-picker"
              className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              {t.pickDayLabel}
            </label>
            <input
              id="report-day-picker"
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value || getTodayDateStr())}
              className="font-mono w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>
        )}

        {periodType === 'month' && (
          <div>
            <label
              htmlFor="report-month-picker"
              className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              {t.pickMonthLabel}
            </label>
            <select
              id="report-month-picker"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              {availableMonths.map((m) => (
                <option key={m} value={m}>
                  {formatMonthYearLabel(m, lang)} ({m})
                </option>
              ))}
            </select>
          </div>
        )}

        {periodType === 'year' && (
          <div>
            <label
              htmlFor="report-year-picker"
              className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
            >
              {t.pickYearLabel}
            </label>
            <select
              id="report-year-picker"
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className="font-mono w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            >
              {availableYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label
            htmlFor="report-date-basis"
            className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            {t.dateBasisLabel}
          </label>
          <select
            id="report-date-basis"
            value={dateBasis}
            onChange={(e) => setDateBasis(e.target.value as ReportDateBasis)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          >
            <option value="either">{t.dateBasisEither}</option>
            <option value="entryDate">{t.dateBasisEntry}</option>
            <option value="updatedAt">{t.dateBasisUpdated}</option>
          </select>
        </div>

        <div>
          <label
            htmlFor="report-status-scope"
            className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
          >
            {t.reportStatusScopeLabel}
          </label>
          <select
            id="report-status-scope"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as ReportStatusFilter)}
            className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
          >
            <option value="all">{t.scopeAllStatuses}</option>
            <option value="active">{t.scopeActiveMaint}</option>
            <option value="finished">{t.scopeFinishedOnly}</option>
            <option value="delayed">{t.scopeDelayedOnly}</option>
          </select>
        </div>
      </div>

      {/* Matching Count + Send / Print / Word / Excel / PDF Actions */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
          {t.dateReportMatchingCount}{' '}
          <span className="font-mono text-sm font-bold text-[#0F4C81] dark:text-sky-400">
            {matchedItems.length}
          </span>{' '}
          {t.itemCountUnit}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={matchedItems.length === 0}
            onClick={() => onPrint(matchedItems, reportTitle, periodLabel)}
            className="flex items-center gap-1.5 rounded-lg bg-[#0F4C81] px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-[#0c3c66] disabled:opacity-50"
          >
            <Printer className="h-3.5 w-3.5" />
            {t.printSavePdf}
          </button>

          <button
            type="button"
            disabled={matchedItems.length === 0}
            onClick={() => void exportToWord(matchedItems, reportTitle, filePrefix, lang, periodLabel)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <FileText className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
            {t.exportWord}
          </button>

          <button
            type="button"
            disabled={matchedItems.length === 0}
            onClick={() => exportToExcel(matchedItems, filePrefix, lang, periodLabel)}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            {t.exportExcel}
          </button>

          <button
            type="button"
            disabled={matchedItems.length === 0}
            onClick={() => onShare(matchedItems, reportTitle, periodLabel)}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-50"
          >
            <Share2 className="h-3.5 w-3.5" />
            {t.sendReportBtn}
          </button>
        </div>
      </div>

      {/* Period Preview Table */}
      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        {matchedItems.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            {t.dateReportEmptyPeriod}
          </div>
        ) : (
          <table className="w-full border-collapse text-start text-xs">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                <th className="px-3 py-2.5 text-start">{t.eqNameLabel}</th>
                <th className="px-3 py-2.5 text-start">{t.eqNumLabel}</th>
                <th className="px-3 py-2.5 text-start">{t.eqCatLabel}</th>
                <th className="px-3 py-2.5 text-start">{t.eqCondLabel}</th>
                <th className="px-3 py-2.5 text-start">{t.entryDateLabel}</th>
                <th className="px-3 py-2.5 text-start">{t.lastUpdatedByLabel}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
              {matchedItems.slice(0, 25).map((item) => (
                <tr
                  key={item.id}
                  className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                >
                  <td className="px-3 py-2.5 font-semibold text-slate-900 dark:text-white">
                    {onSelectItem ? (
                      <button
                        type="button"
                        onClick={() => onSelectItem(item.id)}
                        className="text-start hover:text-[#0F4C81] hover:underline dark:hover:text-sky-400"
                      >
                        {item.name}
                      </button>
                    ) : (
                      item.name
                    )}
                  </td>
                  <td className="font-mono px-3 py-2.5 text-[#0F4C81] dark:text-sky-400">
                    {item.equipmentNumber}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-300">
                    {CATEGORY_LABELS[lang][item.category]}
                  </td>
                  <td className="px-3 py-2.5 font-semibold text-slate-800 dark:text-slate-200">
                    {CONDITION_LABELS[lang][item.condition]}
                  </td>
                  <td className="font-mono px-3 py-2.5 text-slate-600 dark:text-slate-400">
                    {item.entryDate || '-'}
                  </td>
                  <td className="px-3 py-2.5 text-slate-600 dark:text-slate-400">
                    {item.lastUpdatedBy}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
};
