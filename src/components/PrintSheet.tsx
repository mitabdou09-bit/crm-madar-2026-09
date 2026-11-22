import React from 'react';
import { CATEGORY_LABELS, CONDITION_LABELS, T, type Language } from '../i18n';
import type { EquipmentItem } from '../types';
import { calculateOverdueDays, getDelaySummaryList } from '../utils/exporters';
import { BrandTitle } from './BrandTitle';

interface PrintSheetProps {
  items: EquipmentItem[];
  title: string;
  subtitle?: string;
  lang: Language;
}

export const PrintSheet: React.FC<PrintSheetProps> = ({ items, title, subtitle, lang }) => {
  const t = T[lang];
  const isRtl = lang === 'ar';
  const locale = isRtl ? 'ar-SA' : 'fr-FR';
  const nowStr = new Date().toLocaleString(locale);
  const single = items.length === 1 ? items[0] : null;
  const alignCell = isRtl ? 'text-right' : 'text-left';

  return (
    <div className="print-only hidden bg-white p-4 text-slate-900" dir={isRtl ? 'rtl' : 'ltr'}>
      <div className="mb-6 flex items-center justify-between border-b-2 border-[#0F4C81] pb-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F4C81]">{title}</h1>
          {subtitle && (
            <p className="mt-1 text-xs font-semibold text-slate-800">{subtitle}</p>
          )}
          <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-600">
            <BrandTitle className="text-sm" />
            <span>— {t.printSubTitle}</span>
          </p>
        </div>
        <div className={`text-xs text-slate-600 ${isRtl ? 'text-left' : 'text-right'}`}>
          <div>
            {t.printDateLabel} {nowStr}
          </div>
          <div className="font-mono mt-1">
            {t.printCountLabel} {items.length}
          </div>
        </div>
      </div>

      {single ? (
        <div className="space-y-5">
          <table className="w-full border-collapse border border-slate-300 text-sm">
            <tbody>
              <tr>
                <th className={`w-48 border border-slate-300 bg-slate-100 p-2.5 font-bold ${alignCell}`}>
                  {t.eqNameLabel}
                </th>
                <td className="border border-slate-300 p-2.5 font-semibold">{single.name}</td>
                <th className={`w-44 border border-slate-300 bg-slate-100 p-2.5 font-bold ${alignCell}`}>
                  {t.eqNumLabel}
                </th>
                <td className="font-mono border border-slate-300 p-2.5">{single.equipmentNumber}</td>
              </tr>
              <tr>
                <th className={`border border-slate-300 bg-slate-100 p-2.5 font-bold ${alignCell}`}>
                  {t.eqCatLabel}
                </th>
                <td className="border border-slate-300 p-2.5">
                  {CATEGORY_LABELS[lang][single.category]}
                </td>
                <th className={`border border-slate-300 bg-slate-100 p-2.5 font-bold ${alignCell}`}>
                  {t.eqCondLabel}
                </th>
                <td className="border border-slate-300 p-2.5 font-bold">
                  {CONDITION_LABELS[lang][single.condition]}
                </td>
              </tr>
              <tr>
                <th className={`border border-slate-300 bg-slate-100 p-2.5 font-bold ${alignCell}`}>
                  {t.locationLabel}
                </th>
                <td className="border border-slate-300 p-2.5">{single.location}</td>
                <th className={`border border-slate-300 bg-slate-100 p-2.5 font-bold ${alignCell}`}>
                  {t.entryDateLabel} / {t.expectedExitLabel}
                </th>
                <td className="font-mono border border-slate-300 p-2.5">
                  {single.entryDate} → {single.expectedExitDate}
                  {calculateOverdueDays(single) > 0 &&
                    ` (${t.overdueDaysPrefix} ${calculateOverdueDays(single)} ${t.dayUnit})`}
                </td>
              </tr>
            </tbody>
          </table>

          <div>
            <h2 className="mb-2 text-base font-bold text-[#0F4C81]">{t.delaySectionTitle}</h2>
            <table className="w-full border-collapse border border-slate-300 text-sm">
              <thead>
                <tr className="bg-slate-100">
                  <th className={`w-60 border border-slate-300 p-2.5 ${alignCell}`}>
                    {isRtl ? 'سبب التأخر' : 'Motif'}
                  </th>
                  <th className="w-24 border border-slate-300 p-2.5 text-center">
                    {isRtl ? 'الحالة' : 'Statut'}
                  </th>
                  <th className={`border border-slate-300 p-2.5 ${alignCell}`}>
                    {isRtl ? 'التفاصيل المكتوبة' : 'Détails saisis'}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-slate-300 p-2.5 font-semibold">
                    {t.delayServicesLabel.replace(':', '')}
                  </td>
                  <td className="border border-slate-300 p-2.5 text-center">
                    {single.delayServices ? t.yes : t.no}
                  </td>
                  <td className="border border-slate-300 p-2.5">
                    {single.delayServicesNote || '-'}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 p-2.5 font-semibold">
                    {t.delaySparePartsLabel.replace(':', '')}
                  </td>
                  <td className="border border-slate-300 p-2.5 text-center">
                    {single.delaySpareParts ? t.yes : t.no}
                  </td>
                  <td className="border border-slate-300 p-2.5">
                    {single.delaySparePartsNote || '-'}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 p-2.5 font-semibold">
                    {t.delayOtherLabel.replace(':', '')}
                  </td>
                  <td className="border border-slate-300 p-2.5 text-center">
                    {single.delayOther ? t.yes : t.no}
                  </td>
                  <td className="border border-slate-300 p-2.5">
                    {single.delayOtherNote || '-'}
                  </td>
                </tr>
                <tr>
                  <td className="border border-slate-300 p-2.5 font-semibold">
                    {t.finalExitDateLabel}
                  </td>
                  <td className="border border-slate-300 p-2.5 text-center">
                    {single.finalExitDate ? t.yes : '-'}
                  </td>
                  <td className="font-mono border border-slate-300 p-2.5">
                    {single.finalExitDate || '-'}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>

          {single.teamNotes.length > 0 && (
            <div>
              <h2 className="mb-2 text-base font-bold text-[#0F4C81]">{t.teamNotesTitle}</h2>
              <ul className="list-disc space-y-1 ps-5 text-sm">
                {single.teamNotes.map((n) => (
                  <li key={n.id}>
                    <strong>{n.author}:</strong> {n.text} ({new Date(n.createdAt).toLocaleString(locale)})
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-10 grid grid-cols-3 gap-8 pt-8 text-center text-xs text-slate-600">
            <div className="border-t border-slate-400 pt-2">{t.printTechSig}</div>
            <div className="border-t border-slate-400 pt-2">{t.printSupSig}</div>
            <div className="border-t border-slate-400 pt-2">{t.printMgrSig}</div>
          </div>
        </div>
      ) : (
        <table className="w-full border-collapse border border-slate-300 text-xs">
          <thead>
            <tr className="bg-[#0F4C81] text-white">
              <th className={`border border-slate-300 p-2 ${alignCell}`}>#</th>
              <th className={`border border-slate-300 p-2 ${alignCell}`}>{t.eqNameLabel}</th>
              <th className={`border border-slate-300 p-2 ${alignCell}`}>{t.eqNumLabel}</th>
              <th className={`border border-slate-300 p-2 ${alignCell}`}>{t.eqCatLabel}</th>
              <th className={`border border-slate-300 p-2 ${alignCell}`}>{t.eqCondLabel}</th>
              <th className={`border border-slate-300 p-2 ${alignCell}`}>{t.entryDateLabel}</th>
              <th className={`border border-slate-300 p-2 ${alignCell}`}>{t.finalExitDateLabel}</th>
              <th className={`border border-slate-300 p-2 ${alignCell}`}>{t.locationLabel}</th>
              <th className={`border border-slate-300 p-2 ${alignCell}`}>{t.delaySectionTitle}</th>
              <th className={`border border-slate-300 p-2 ${alignCell}`}>{t.lastUpdatedByLabel}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => {
              const delays = getDelaySummaryList(item, lang);
              return (
                <tr key={item.id} className="even:bg-slate-50">
                  <td className="font-mono border border-slate-300 p-2">{idx + 1}</td>
                  <td className="border border-slate-300 p-2 font-semibold">{item.name}</td>
                  <td className="font-mono border border-slate-300 p-2">{item.equipmentNumber}</td>
                  <td className="border border-slate-300 p-2">
                    {CATEGORY_LABELS[lang][item.category]}
                  </td>
                  <td className="border border-slate-300 p-2">
                    {CONDITION_LABELS[lang][item.condition]}
                  </td>
                  <td className="font-mono border border-slate-300 p-2">{item.entryDate || '-'}</td>
                  <td className="font-mono border border-slate-300 p-2">{item.finalExitDate || '-'}</td>
                  <td className="border border-slate-300 p-2">{item.location}</td>
                  <td className="border border-slate-300 p-2">
                    {delays.length > 0 ? delays.join(' | ') : t.noDelaysRecorded}
                  </td>
                  <td className="border border-slate-300 p-2">{item.lastUpdatedBy}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};
