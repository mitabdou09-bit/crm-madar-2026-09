import type { Language } from '../i18n';
import type { EquipmentItem } from '../types';

export type ReportPeriodType = 'day' | 'week' | 'month' | 'year' | 'all';
export type ReportDateBasis = 'either' | 'entryDate' | 'updatedAt';
export type ReportStatusFilter = 'all' | 'active' | 'finished' | 'delayed';

export interface DateFilterOptions {
  periodType: ReportPeriodType;
  selectedDate: string; // YYYY-MM-DD (used for day & week)
  selectedMonth: string; // YYYY-MM (used for month)
  selectedYear: string; // YYYY (used for year)
  dateBasis: ReportDateBasis;
  statusFilter: ReportStatusFilter;
}

export function getTodayDateStr(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function getCurrentMonthStr(): string {
  return getTodayDateStr().slice(0, 7);
}

export function getCurrentYearStr(): string {
  return getTodayDateStr().slice(0, 4);
}

/**
 * Returns the Saturday-to-Friday (for Arabic) or Monday-to-Sunday (for French)
 * week start/end YYYY-MM-DD bounds containing the given YYYY-MM-DD date.
 */
export function getWeekBounds(dateStr: string, lang: Language = 'ar'): { start: string; end: string } {
  const parsed = new Date(`${dateStr}T00:00:00`);
  const base = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  base.setHours(0, 0, 0, 0);

  // Start of week: Saturday (day 6) in Arabic workshops, Monday (day 1) in French
  const targetStartDay = lang === 'fr' ? 1 : 6;
  const currentDay = base.getDay();
  const diffToStart = (currentDay - targetStartDay + 7) % 7;

  const startDate = new Date(base);
  startDate.setDate(base.getDate() - diffToStart);

  const endDate = new Date(startDate);
  endDate.setDate(startDate.getDate() + 6);

  const fmt = (dt: Date) =>
    `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;

  return { start: fmt(startDate), end: fmt(endDate) };
}

function toLocalDateKey(isoOrDate: string): string {
  if (!isoOrDate) return '';
  if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(isoOrDate)) {
    return isoOrDate;
  }
  const dt = new Date(isoOrDate);
  if (Number.isNaN(dt.getTime())) return isoOrDate.slice(0, 10);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function matchesDateRange(dateKey: string, opts: DateFilterOptions, lang: Language): boolean {
  if (!dateKey || dateKey.length < 4) return false;
  switch (opts.periodType) {
    case 'all':
      return true;
    case 'day':
      return dateKey === opts.selectedDate;
    case 'week': {
      const { start, end } = getWeekBounds(opts.selectedDate, lang);
      return dateKey >= start && dateKey <= end;
    }
    case 'month':
      return dateKey.slice(0, 7) === opts.selectedMonth;
    case 'year':
      return dateKey.slice(0, 4) === opts.selectedYear;
  }
}

export function filterItemsByDateOptions(
  items: EquipmentItem[],
  opts: DateFilterOptions,
  lang: Language,
  isDelayedFn: (item: EquipmentItem) => boolean
): EquipmentItem[] {
  return items.filter((item) => {
    if (opts.statusFilter === 'active' && item.condition === 'جاهزة للعمل') return false;
    if (opts.statusFilter === 'finished' && item.condition !== 'جاهزة للعمل') return false;
    if (opts.statusFilter === 'delayed' && !isDelayedFn(item)) return false;

    if (opts.periodType === 'all') return true;

    const entryKey = toLocalDateKey(item.entryDate);
    const updatedKey = toLocalDateKey(item.updatedAt);

    if (opts.dateBasis === 'entryDate') {
      return matchesDateRange(entryKey, opts, lang);
    }
    if (opts.dateBasis === 'updatedAt') {
      return matchesDateRange(updatedKey, opts, lang);
    }
    return matchesDateRange(entryKey, opts, lang) || matchesDateRange(updatedKey, opts, lang);
  });
}

export function formatMonthYearLabel(monthKey: string, lang: Language): string {
  if (!/^[0-9]{4}-[0-9]{2}$/.test(monthKey)) {
    return lang === 'fr' ? 'Mois non spécifié' : 'شهر غير محدد';
  }
  const [yStr, mStr] = monthKey.split('-');
  const dt = new Date(Number(yStr), Number(mStr) - 1, 1);
  if (Number.isNaN(dt.getTime())) return monthKey;
  const formatted = dt.toLocaleDateString(lang === 'fr' ? 'fr-FR' : 'ar-SA', {
    month: 'long',
    year: 'numeric',
  });
  return lang === 'fr' ? formatted.charAt(0).toUpperCase() + formatted.slice(1) : formatted;
}

export function buildDatePeriodLabel(opts: DateFilterOptions, lang: Language): string {
  const isRtl = lang === 'ar';
  switch (opts.periodType) {
    case 'day':
      return isRtl ? `تقرير اليوم: ${opts.selectedDate}` : `Rapport du jour : ${opts.selectedDate}`;
    case 'week': {
      const { start, end } = getWeekBounds(opts.selectedDate, lang);
      return isRtl
        ? `التقرير الأسبوعي: ${start} ← ${end}`
        : `Rapport hebdomadaire : ${start} → ${end}`;
    }
    case 'month':
      return isRtl
        ? `التقرير الشهري: ${formatMonthYearLabel(opts.selectedMonth, lang)} (${opts.selectedMonth})`
        : `Rapport mensuel : ${formatMonthYearLabel(opts.selectedMonth, lang)} (${opts.selectedMonth})`;
    case 'year':
      return isRtl ? `التقرير السنوي: عام ${opts.selectedYear}` : `Rapport annuel : Année ${opts.selectedYear}`;
    case 'all':
      return isRtl ? 'التقرير الشامل (جميع التواريخ)' : 'Rapport complet (toutes dates)';
  }
}

export function getEntryMonthKey(item: EquipmentItem): string {
  if (item.entryDate && /^[0-9]{4}-[0-9]{2}/.test(item.entryDate)) {
    return item.entryDate.slice(0, 7);
  }
  if (item.createdAt && /^[0-9]{4}-[0-9]{2}/.test(item.createdAt)) {
    return item.createdAt.slice(0, 7);
  }
  return getCurrentMonthStr();
}

export interface MonthlyArchiveGroup {
  monthKey: string;
  monthLabel: string;
  year: string;
  items: EquipmentItem[];
}

/**
 * Groups equipment whose maintenance is finished ('جاهزة للعمل')
 * into the month in which they entered ('entryDate' YYYY-MM), newest month first.
 */
export function groupFinishedEquipmentByEntryMonth(
  items: EquipmentItem[],
  lang: Language
): MonthlyArchiveGroup[] {
  const finished = items.filter((item) => item.condition === 'جاهزة للعمل');
  const map = new Map<string, EquipmentItem[]>();

  for (const item of finished) {
    const key = getEntryMonthKey(item);
    const list = map.get(key) || [];
    list.push(item);
    map.set(key, list);
  }

  return Array.from(map.entries())
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([monthKey, groupItems]) => ({
      monthKey,
      monthLabel: formatMonthYearLabel(monthKey, lang),
      year: monthKey.slice(0, 4),
      items: groupItems.sort((a, b) => b.entryDate.localeCompare(a.entryDate)),
    }));
}

export function getAvailableYears(items: EquipmentItem[]): string[] {
  const years = new Set<string>([getCurrentYearStr()]);
  for (const item of items) {
    if (item.entryDate && /^[0-9]{4}/.test(item.entryDate)) {
      years.add(item.entryDate.slice(0, 4));
    }
    if (item.updatedAt && /^[0-9]{4}/.test(item.updatedAt)) {
      years.add(item.updatedAt.slice(0, 4));
    }
  }
  return Array.from(years).sort((a, b) => b.localeCompare(a));
}

export function getAvailableMonths(items: EquipmentItem[]): string[] {
  const months = new Set<string>([getCurrentMonthStr()]);
  for (const item of items) {
    if (item.entryDate && /^[0-9]{4}-[0-9]{2}/.test(item.entryDate)) {
      months.add(item.entryDate.slice(0, 7));
    }
    if (item.updatedAt && /^[0-9]{4}-[0-9]{2}/.test(item.updatedAt)) {
      months.add(item.updatedAt.slice(0, 7));
    }
  }
  return Array.from(months).sort((a, b) => b.localeCompare(a));
}
