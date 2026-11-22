import * as XLSX from 'xlsx';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import { CATEGORY_LABELS, CONDITION_LABELS, type Language } from '../i18n';
import type { EquipmentItem } from '../types';

export function hasWorkshopDelay(item: EquipmentItem): boolean {
  return item.delayServices || item.delaySpareParts || item.delayOther;
}

export function getDelaySummaryList(item: EquipmentItem, lang: Language = 'ar'): string[] {
  const reasons: string[] = [];
  if (item.delayServices) {
    const label = lang === 'fr' ? 'Manque de services' : 'عدم توفر الخدمات';
    reasons.push(item.delayServicesNote ? `${label}: ${item.delayServicesNote}` : label);
  }
  if (item.delaySpareParts) {
    const label = lang === 'fr' ? 'Manque de pièces' : 'عدم توفر قطع الغيار';
    reasons.push(item.delaySparePartsNote ? `${label}: ${item.delaySparePartsNote}` : label);
  }
  if (item.delayOther) {
    const label = lang === 'fr' ? 'Autres raisons' : 'أسباب أخرى';
    reasons.push(item.delayOtherNote ? `${label}: ${item.delayOtherNote}` : label);
  }
  return reasons;
}

export function calculateOverdueDays(item: EquipmentItem): number {
  if (item.condition === 'جاهزة للعمل' || !item.expectedExitDate) return 0;
  const expected = new Date(`${item.expectedExitDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - expected.getTime()) / 86400000);
  return diff > 0 ? diff : 0;
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export function buildExcelBlob(
  items: EquipmentItem[],
  lang: Language = 'ar',
  workReportMeta?: { title?: string; notes?: string; author?: string; periodSubtitle?: string }
): Blob {
  const locale = lang === 'fr' ? 'fr-FR' : 'ar-SA';
  const formatSafeDate = (val: string) => {
    const d = new Date(val);
    return Number.isNaN(d.getTime()) ? val || '-' : d.toLocaleString(locale);
  };

  const headers =
    lang === 'fr'
      ? [
          '#',
          'Nom équipement',
          'Numéro',
          'Catégorie',
          'État',
          'Atelier / Site',
          'Date entrée',
          'Sortie prévue',
          'Jours de retard',
          'Retard services',
          'Détails services',
          'Retard pièces',
          'Détails pièces',
          'Autres retards',
          'Détails autres',
          'Date de sortie finale',
          'Dernière mise à jour par',
          'Date mise à jour',
        ]
      : [
          '#',
          'اسم المعدة',
          'رقم المعدة',
          'الصنف',
          'حالة العتاد',
          'الموقع / الورشة',
          'تاريخ الدخول',
          'الخروج المتوقع',
          'أيام التأخر',
          'تأخر عدم توفر الخدمات',
          'تفاصيل عدم توفر الخدمات',
          'تأخر عدم توفر قطع الغيار',
          'تفاصيل عدم توفر قطع الغيار',
          'تأخر لأسباب أخرى',
          'تفاصيل الأسباب الأخرى',
          'تاريخ الخروج النهائي',
          'آخر تحديث بواسطة',
          'تاريخ التحديث',
        ];

  const rows = items.map((item, index) =>
    lang === 'fr'
      ? {
          '#': index + 1,
          'Nom équipement': item.name,
          'Numéro': item.equipmentNumber,
          'Catégorie': CATEGORY_LABELS.fr[item.category] || item.category,
          'État': CONDITION_LABELS.fr[item.condition] || item.condition,
          'Atelier / Site': item.location,
          'Date entrée': item.entryDate,
          'Sortie prévue': item.expectedExitDate,
          'Jours de retard': calculateOverdueDays(item),
          'Retard services': item.delayServices ? 'Oui' : 'Non',
          'Détails services': item.delayServicesNote || '-',
          'Retard pièces': item.delaySpareParts ? 'Oui' : 'Non',
          'Détails pièces': item.delaySparePartsNote || '-',
          'Autres retards': item.delayOther ? 'Oui' : 'Non',
          'Détails autres': item.delayOtherNote || '-',
          'Date de sortie finale': item.finalExitDate || '-',
          'Dernière mise à jour par': item.lastUpdatedBy,
          'Date mise à jour': formatSafeDate(item.updatedAt),
        }
      : {
          '#': index + 1,
          'اسم المعدة': item.name,
          'رقم المعدة': item.equipmentNumber,
          'الصنف': item.category,
          'حالة العتاد': item.condition,
          'الموقع / الورشة': item.location,
          'تاريخ الدخول': item.entryDate,
          'الخروج المتوقع': item.expectedExitDate,
          'أيام التأخر': calculateOverdueDays(item),
          'تأخر عدم توفر الخدمات': item.delayServices ? 'نعم' : 'لا',
          'تفاصيل عدم توفر الخدمات': item.delayServicesNote || '-',
          'تأخر عدم توفر قطع الغيار': item.delaySpareParts ? 'نعم' : 'لا',
          'تفاصيل عدم توفر قطع الغيار': item.delaySparePartsNote || '-',
          'تأخر لأسباب أخرى': item.delayOther ? 'نعم' : 'لا',
          'تفاصيل الأسباب الأخرى': item.delayOtherNote || '-',
          'تاريخ الخروج النهائي': item.finalExitDate || '-',
          'آخر تحديث بواسطة': item.lastUpdatedBy,
          'تاريخ التحديث': formatSafeDate(item.updatedAt),
        }
  );

  const summaryRows =
    lang === 'fr'
      ? [
          { Indicateur: 'Total des équipements', Nombre: items.length },
          {
            Indicateur: 'Opérationnels',
            Nombre: items.filter((i) => i.condition === 'جاهزة للعمل').length,
          },
          {
            Indicateur: 'En maintenance',
            Nombre: items.filter((i) => i.condition === 'قيد الصيانة').length,
          },
          {
            Indicateur: 'À l’arrêt — En attente',
            Nombre: items.filter((i) => i.condition === 'متوقفة - بانتظار').length,
          },
          {
            Indicateur: 'Hors service',
            Nombre: items.filter((i) => i.condition === 'خارجة عن الخدمة').length,
          },
          {
            Indicateur: 'Retard manque de services',
            Nombre: items.filter((i) => i.delayServices).length,
          },
          {
            Indicateur: 'Retard manque de pièces',
            Nombre: items.filter((i) => i.delaySpareParts).length,
          },
          {
            Indicateur: 'Autres causes de retard',
            Nombre: items.filter((i) => i.delayOther).length,
          },
        ]
      : [
          { البند: 'إجمالي المعدات', العدد: items.length },
          { البند: 'جاهزة للعمل', العدد: items.filter((i) => i.condition === 'جاهزة للعمل').length },
          { البند: 'قيد الصيانة', العدد: items.filter((i) => i.condition === 'قيد الصيانة').length },
          {
            البند: 'متوقفة - بانتظار',
            العدد: items.filter((i) => i.condition === 'متوقفة - بانتظار').length,
          },
          {
            البند: 'خارجة عن الخدمة',
            العدد: items.filter((i) => i.condition === 'خارجة عن الخدمة').length,
          },
          { البند: 'تأخر بسبب عدم توفر الخدمات', العدد: items.filter((i) => i.delayServices).length },
          {
            البند: 'تأخر بسبب عدم توفر قطع الغيار',
            العدد: items.filter((i) => i.delaySpareParts).length,
          },
          { البند: 'تأخر لأسباب أخرى', العدد: items.filter((i) => i.delayOther).length },
        ];

  const wb = XLSX.utils.book_new();
  wb.Workbook = { Views: [{ RTL: lang === 'ar' }] };

  const wsMain =
    rows.length > 0
      ? XLSX.utils.json_to_sheet(rows, { header: headers })
      : XLSX.utils.aoa_to_sheet([headers]);
  wsMain['!cols'] = [
    { wch: 5 },
    { wch: 28 },
    { wch: 15 },
    { wch: 18 },
    { wch: 20 },
    { wch: 24 },
    { wch: 13 },
    { wch: 13 },
    { wch: 12 },
    { wch: 18 },
    { wch: 32 },
    { wch: 20 },
    { wch: 32 },
    { wch: 16 },
    { wch: 30 },
    { wch: 16 },
    { wch: 18 },
    { wch: 22 },
  ];

  const summaryWithPeriod =
    workReportMeta?.periodSubtitle || workReportMeta?.title
      ? lang === 'fr'
        ? [
            ...(workReportMeta.title
              ? [{ Indicateur: 'Titre du rapport', Nombre: workReportMeta.title }]
              : []),
            ...(workReportMeta.periodSubtitle
              ? [{ Indicateur: 'Période du rapport', Nombre: workReportMeta.periodSubtitle }]
              : []),
            ...summaryRows,
          ]
        : [
            ...(workReportMeta.title
              ? [{ البند: 'عنوان التقرير', العدد: workReportMeta.title }]
              : []),
            ...(workReportMeta.periodSubtitle
              ? [{ البند: 'الفترة الزمنية للتقرير', العدد: workReportMeta.periodSubtitle }]
              : []),
            ...summaryRows,
          ]
      : summaryRows;

  const wsSummary = XLSX.utils.json_to_sheet(summaryWithPeriod);
  wsSummary['!cols'] = [{ wch: 32 }, { wch: 36 }];

  XLSX.utils.book_append_sheet(
    wb,
    wsMain,
    lang === 'fr' ? 'Équipements et Retards' : 'بيانات المعدات والتأخيرات'
  );
  XLSX.utils.book_append_sheet(wb, wsSummary, lang === 'fr' ? 'Résumé' : 'ملخص الحالة');

  if (workReportMeta && (workReportMeta.title || workReportMeta.notes)) {
    const wsWork = XLSX.utils.json_to_sheet([
      lang === 'fr'
        ? {
            'Titre du travail / rapport': workReportMeta.title || '-',
            'Rédigé par': workReportMeta.author || '-',
            'Date': new Date().toLocaleString(locale),
            'Détails des travaux et observations': workReportMeta.notes || '-',
          }
        : {
            'عنوان العمل / التقرير': workReportMeta.title || '-',
            'بواسطة': workReportMeta.author || '-',
            'التاريخ': new Date().toLocaleString(locale),
            'تفاصيل الأعمال المنجزة والملاحظات': workReportMeta.notes || '-',
          },
    ]);
    wsWork['!cols'] = [{ wch: 28 }, { wch: 20 }, { wch: 22 }, { wch: 60 }];
    XLSX.utils.book_append_sheet(
      wb,
      wsWork,
      lang === 'fr' ? 'Travaux & Rapport' : 'تفاصيل العمل والتقرير'
    );
  }

  const buffer = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}

export function exportToExcel(
  items: EquipmentItem[],
  filenamePrefix?: string,
  lang: Language = 'ar',
  periodSubtitle?: string
): void {
  const defaultPrefix = lang === 'fr' ? 'rapport_maintenance_equipements' : 'تقرير_صيانة_المعدات';
  const prefix = filenamePrefix || defaultPrefix;
  const blob = buildExcelBlob(
    items,
    lang,
    periodSubtitle ? { periodSubtitle } : undefined
  );
  const dateStamp = new Date().toISOString().slice(0, 10);
  triggerBlobDownload(blob, `${prefix}_${dateStamp}.xlsx`);
}

function makeDocParagraph(
  text: string,
  lang: Language,
  options?: {
    bold?: boolean;
    size?: number;
    color?: string;
    align?: (typeof AlignmentType)[keyof typeof AlignmentType];
    spaceAfter?: number;
  }
): Paragraph {
  const isRtl = lang === 'ar';
  return new Paragraph({
    bidirectional: isRtl,
    alignment: options?.align ?? (isRtl ? AlignmentType.RIGHT : AlignmentType.LEFT),
    spacing: { after: options?.spaceAfter ?? 120 },
    children: [
      new TextRun({
        text,
        bold: options?.bold,
        size: options?.size ?? 22,
        color: options?.color ?? '0F172A',
        font: 'Arial',
        rightToLeft: isRtl,
      }),
    ],
  });
}

function makeDocCell(text: string, lang: Language, isHeader = false): TableCell {
  const isRtl = lang === 'ar';
  return new TableCell({
    shading: isHeader
      ? { type: ShadingType.CLEAR, color: 'auto', fill: '0F4C81' }
      : undefined,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      bottom: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      left: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
      right: { style: BorderStyle.SINGLE, size: 1, color: 'CBD5E1' },
    },
    children: [
      new Paragraph({
        bidirectional: isRtl,
        alignment: isRtl ? AlignmentType.RIGHT : AlignmentType.LEFT,
        children: [
          new TextRun({
            text: text || '-',
            bold: isHeader,
            size: isHeader ? 20 : 18,
            color: isHeader ? 'FFFFFF' : '0F172A',
            font: 'Arial',
            rightToLeft: isRtl,
          }),
        ],
      }),
    ],
  });
}

export async function buildWordBlob(
  items: EquipmentItem[],
  reportTitle?: string,
  lang: Language = 'ar',
  workDetailsNote?: string,
  authorName?: string,
  periodSubtitle?: string
): Promise<Blob> {
  const isRtl = lang === 'ar';
  const locale = isRtl ? 'ar-SA' : 'fr-FR';
  const nowStr = new Date().toLocaleString(locale);
  const title =
    reportTitle || (isRtl ? 'ورقة متابعة وصيانة المعدات' : 'Fiche de suivi et maintenance des équipements');

  const children: (Paragraph | Table)[] = [
    makeDocParagraph(title, lang, {
      bold: true,
      size: 32,
      color: '0F4C81',
      align: AlignmentType.CENTER,
      spaceAfter: 80,
    }),
    ...(periodSubtitle
      ? [
          makeDocParagraph(periodSubtitle, lang, {
            bold: true,
            size: 22,
            color: '334155',
            align: AlignmentType.CENTER,
            spaceAfter: 80,
          }),
        ]
      : []),
    makeDocParagraph(
      isRtl
        ? `تاريخ الإصدار: ${nowStr}   |   عدد المعدات: ${items.length}${authorName ? `   |   المعدّ: ${authorName}` : ''}`
        : `Date d’édition : ${nowStr}   |   Nombre d’équipements : ${items.length}${authorName ? `   |   Rédacteur : ${authorName}` : ''}`,
      lang,
      {
        size: 20,
        color: '475569',
        align: AlignmentType.CENTER,
        spaceAfter: 240,
      }
    ),
  ];

  if (workDetailsNote && workDetailsNote.trim()) {
    children.push(
      makeDocParagraph(
        isRtl ? 'ملخص الأعمال المنجزة وتفاصيل التقرير:' : 'Détails des travaux réalisés et rapport :',
        lang,
        { bold: true, size: 24, color: '0F4C81', spaceAfter: 80 }
      )
    );
    for (const line of workDetailsNote.trim().split('\n')) {
      children.push(
        makeDocParagraph(line || ' ', lang, { size: 22, color: '0F172A', spaceAfter: 80 })
      );
    }
    children.push(makeDocParagraph('', lang, { spaceAfter: 120 }));
  }

  if (items.length === 1) {
    const eq = items[0];
    const detailsTable = new Table({
      visuallyRightToLeft: isRtl,
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            makeDocCell(isRtl ? 'البيان' : 'Rubrique', lang, true),
            makeDocCell(isRtl ? 'القيمة' : 'Valeur', lang, true),
          ],
        }),
        new TableRow({
          children: [makeDocCell(isRtl ? 'اسم المعدة' : 'Nom de l’équipement', lang), makeDocCell(eq.name, lang)],
        }),
        new TableRow({
          children: [makeDocCell(isRtl ? 'رقم المعدة / التسلسلي' : 'Numéro / Série', lang), makeDocCell(eq.equipmentNumber, lang)],
        }),
        new TableRow({
          children: [makeDocCell(isRtl ? 'الصنف' : 'Catégorie', lang), makeDocCell(CATEGORY_LABELS[lang][eq.category], lang)],
        }),
        new TableRow({
          children: [makeDocCell(isRtl ? 'حالة العتاد' : 'État du matériel', lang), makeDocCell(CONDITION_LABELS[lang][eq.condition], lang)],
        }),
        new TableRow({
          children: [makeDocCell(isRtl ? 'الموقع / الورشة' : 'Atelier / Site', lang), makeDocCell(eq.location, lang)],
        }),
        new TableRow({
          children: [makeDocCell(isRtl ? 'تاريخ الدخول' : 'Date d’entrée', lang), makeDocCell(eq.entryDate, lang)],
        }),
        new TableRow({
          children: [makeDocCell(isRtl ? 'تاريخ الخروج المتوقع' : 'Sortie prévue', lang), makeDocCell(eq.expectedExitDate, lang)],
        }),
        new TableRow({
          children: [
            makeDocCell(isRtl ? 'تأخر بسبب عدم توفر الخدمات' : 'Retard — Manque de services', lang),
            makeDocCell(
              eq.delayServices
                ? `${isRtl ? 'نعم' : 'Oui'} — ${eq.delayServicesNote || (isRtl ? 'لم تكتب تفاصيل' : 'Sans détails')}`
                : isRtl
                ? 'لا يوجد'
                : 'Aucun',
              lang
            ),
          ],
        }),
        new TableRow({
          children: [
            makeDocCell(isRtl ? 'تأخر بسبب عدم توفر قطع الغيار' : 'Retard — Manque de pièces', lang),
            makeDocCell(
              eq.delaySpareParts
                ? `${isRtl ? 'نعم' : 'Oui'} — ${eq.delaySparePartsNote || (isRtl ? 'لم تكتب تفاصيل' : 'Sans détails')}`
                : isRtl
                ? 'لا يوجد'
                : 'Aucun',
              lang
            ),
          ],
        }),
        new TableRow({
          children: [
            makeDocCell(isRtl ? 'أسباب تأخر أخرى' : 'Autres causes de retard', lang),
            makeDocCell(
              eq.delayOther
                ? `${isRtl ? 'نعم' : 'Oui'} — ${eq.delayOtherNote || (isRtl ? 'لم تكتب تفاصيل' : 'Sans détails')}`
                : isRtl
                ? 'لا يوجد'
                : 'Aucun',
              lang
            ),
          ],
        }),
        new TableRow({
          children: [
            makeDocCell(isRtl ? 'تاريخ الخروج النهائي' : 'Date de sortie finale', lang),
            makeDocCell(eq.finalExitDate || '-', lang),
          ],
        }),
        new TableRow({
          children: [makeDocCell(isRtl ? 'آخر تحديث بواسطة' : 'Dernière mise à jour par', lang), makeDocCell(eq.lastUpdatedBy, lang)],
        }),
      ],
    });
    children.push(detailsTable);

    if (eq.teamNotes.length > 0) {
      children.push(
        makeDocParagraph(isRtl ? 'ملاحظات فريق الصيانة:' : 'Notes de l’équipe de maintenance :', lang, {
          bold: true,
          size: 24,
          color: '0F4C81',
          spaceAfter: 100,
        })
      );
      for (const note of eq.teamNotes) {
        children.push(
          makeDocParagraph(
            `• ${note.author} (${new Date(note.createdAt).toLocaleString(locale)}): ${note.text}`,
            lang,
            { size: 20, spaceAfter: 80 }
          )
        );
      }
    }
  } else {
    const headerRow = new TableRow({
      children: [
        makeDocCell('#', lang, true),
        makeDocCell(isRtl ? 'اسم المعدة' : 'Équipement', lang, true),
        makeDocCell(isRtl ? 'الرقم' : 'Numéro', lang, true),
        makeDocCell(isRtl ? 'الصنف' : 'Catégorie', lang, true),
        makeDocCell(isRtl ? 'حالة العتاد' : 'État', lang, true),
        makeDocCell(
          isRtl ? 'أسباب التأخر عن الخروج من الورشة' : 'Retards de sortie d’atelier',
          lang,
          true
        ),
        makeDocCell(isRtl ? 'الخروج النهائي' : 'Sortie finale', lang, true),
        makeDocCell(isRtl ? 'آخر تحديث' : 'Mis à jour par', lang, true),
      ],
    });

    const dataRows = items.map((item, idx) => {
      const delays = getDelaySummaryList(item, lang);
      return new TableRow({
        children: [
          makeDocCell(String(idx + 1), lang),
          makeDocCell(item.name, lang),
          makeDocCell(item.equipmentNumber, lang),
          makeDocCell(CATEGORY_LABELS[lang][item.category], lang),
          makeDocCell(CONDITION_LABELS[lang][item.condition], lang),
          makeDocCell(
            delays.length > 0 ? delays.join(' | ') : isRtl ? 'لا يوجد تأخر' : 'Aucun retard',
            lang
          ),
          makeDocCell(item.finalExitDate || '-', lang),
          makeDocCell(item.lastUpdatedBy, lang),
        ],
      });
    });

    children.push(
      new Table({
        visuallyRightToLeft: isRtl,
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [headerRow, ...dataRows],
      })
    );
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  });

  return Packer.toBlob(doc);
}

export async function exportToWord(
  items: EquipmentItem[],
  reportTitle?: string,
  filenamePrefix?: string,
  lang: Language = 'ar',
  periodSubtitle?: string
): Promise<void> {
  const isRtl = lang === 'ar';
  const prefix = filenamePrefix || (isRtl ? 'ورقة_صيانة_المعدات' : 'fiche_maintenance_equipements');
  const blob = await buildWordBlob(items, reportTitle, lang, undefined, undefined, periodSubtitle);
  const dateStamp = new Date().toISOString().slice(0, 10);
  triggerBlobDownload(blob, `${prefix}_${dateStamp}.docx`);
}

export function buildCSVBlob(items: EquipmentItem[], lang: Language = 'ar'): Blob {
  const isRtl = lang === 'ar';
  const headers = isRtl
    ? [
        'اسم المعدة',
        'رقم المعدة',
        'الصنف',
        'حالة العتاد',
        'الموقع',
        'تاريخ الدخول',
        'الخروج المتوقع',
        'تأخر الخدمات',
        'تفاصيل الخدمات',
        'تأخر قطع الغيار',
        'تفاصيل قطع الغيار',
        'أسباب أخرى',
        'تفاصيل الأسباب الأخرى',
        'تاريخ الخروج النهائي',
        'آخر تحديث بواسطة',
      ]
    : [
        'Nom équipement',
        'Numéro',
        'Catégorie',
        'État',
        'Site / Atelier',
        'Date entrée',
        'Sortie prévue',
        'Retard services',
        'Détails services',
        'Retard pièces',
        'Détails pièces',
        'Autres retards',
        'Détails autres',
        'Date de sortie finale',
        'Mis à jour par',
      ];

  const escapeCsv = (val: string) => `"${String(val ?? '').replace(/"/g, '""')}"`;

  const lines = [
    headers.map(escapeCsv).join(','),
    ...items.map((item) =>
      [
        item.name,
        item.equipmentNumber,
        CATEGORY_LABELS[lang][item.category],
        CONDITION_LABELS[lang][item.condition],
        item.location,
        item.entryDate,
        item.expectedExitDate,
        item.delayServices ? (isRtl ? 'نعم' : 'Oui') : isRtl ? 'لا' : 'Non',
        item.delayServicesNote,
        item.delaySpareParts ? (isRtl ? 'نعم' : 'Oui') : isRtl ? 'لا' : 'Non',
        item.delaySparePartsNote,
        item.delayOther ? (isRtl ? 'نعم' : 'Oui') : isRtl ? 'لا' : 'Non',
        item.delayOtherNote,
        item.finalExitDate || '',
        item.lastUpdatedBy,
      ]
        .map(escapeCsv)
        .join(',')
    ),
  ];

  const bom = '\uFEFF';
  return new Blob([bom + lines.join('\r\n')], {
    type: 'text/csv;charset=utf-8;',
  });
}

export function exportToCSV(
  items: EquipmentItem[],
  filenamePrefix?: string,
  lang: Language = 'ar'
): void {
  const isRtl = lang === 'ar';
  const prefix = filenamePrefix || (isRtl ? 'تقرير_المعدات' : 'rapport_equipements');
  const blob = buildCSVBlob(items, lang);
  const dateStamp = new Date().toISOString().slice(0, 10);
  triggerBlobDownload(blob, `${prefix}_${dateStamp}.csv`);
}

export function buildBackupJSONBlob(
  items: EquipmentItem[],
  workReportMeta?: { title?: string; notes?: string; author?: string }
): Blob {
  const payload = {
    app: 'Crm Equipment Cloud',
    archiveFolder: 'D:\\DAWLIND',
    exportedAt: new Date().toISOString(),
    itemCount: items.length,
    ...(workReportMeta ? { workReport: workReportMeta } : {}),
    items,
  };
  return new Blob([JSON.stringify(payload, null, 2)], {
    type: 'application/json;charset=utf-8',
  });
}

export function buildWorkReportTextBlob(
  items: EquipmentItem[],
  reportTitle: string,
  workDetailsNote: string,
  authorName: string,
  lang: Language = 'ar'
): Blob {
  const isRtl = lang === 'ar';
  const locale = isRtl ? 'ar-SA' : 'fr-FR';
  const header = isRtl
    ? `${reportTitle}\nالتاريخ: ${new Date().toLocaleString(locale)}\nبواسطة: ${authorName}\nالمجلد المستهدف: D:\\DAWLIND\n${'='.repeat(48)}`
    : `${reportTitle}\nDate : ${new Date().toLocaleString(locale)}\nRédigé par : ${authorName}\nDossier cible : D:\\DAWLIND\n${'='.repeat(48)}`;

  const notesBlock = workDetailsNote.trim()
    ? isRtl
      ? `\n\n[تفاصيل الأعمال المنجزة والتقرير]\n${workDetailsNote.trim()}\n`
      : `\n\n[Détails des travaux réalisés & rapport]\n${workDetailsNote.trim()}\n`
    : '';

  const eqText = formatShareReportText(items, reportTitle, lang);
  const bom = '\uFEFF';
  return new Blob([`${bom}${header}${notesBlock}\n\n${eqText}`], {
    type: 'text/plain;charset=utf-8;',
  });
}

export function exportBackupJSON(items: EquipmentItem[], label = 'backup'): void {
  const blob = buildBackupJSONBlob(items);
  const dateStamp = new Date().toISOString().slice(0, 10);
  triggerBlobDownload(blob, `madar_${label}_${dateStamp}.json`);
}

export function formatShareReportText(
  items: EquipmentItem[],
  title?: string,
  lang: Language = 'ar',
  periodSubtitle?: string
): string {
  const isRtl = lang === 'ar';
  const locale = isRtl ? 'ar-SA' : 'fr-FR';
  const headerTitle =
    title || (isRtl ? 'تقرير متابعة وصيانة المعدات' : 'Rapport de suivi et maintenance');

  const periodLine = periodSubtitle ? `\n${periodSubtitle}` : '';
  const header = isRtl
    ? `*${headerTitle}*${periodLine}\nالتاريخ: ${new Date().toLocaleString(locale)}\nإجمالي المعدات: ${items.length}\n${'—'.repeat(24)}`
    : `*${headerTitle}*${periodLine}\nDate : ${new Date().toLocaleString(locale)}\nTotal équipements : ${items.length}\n${'—'.repeat(24)}`;

  const body = items
    .slice(0, 25)
    .map((item, idx) => {
      const delays = getDelaySummaryList(item, lang);
      const delayBlock =
        delays.length > 0
          ? isRtl
            ? `\n  • أسباب التأخر: ${delays.join(' / ')}`
            : `\n  • Motifs de retard : ${delays.join(' / ')}`
          : isRtl
          ? '\n  • حالة الورشة: منتظمة بدون تأخر مسجل'
          : '\n  • Statut atelier : Régulier sans retard';
      const finalExitLine = item.finalExitDate
        ? isRtl
          ? `\n  • تاريخ الخروج النهائي: ${item.finalExitDate}`
          : `\n  • Date de sortie finale : ${item.finalExitDate}`
        : '';
      return isRtl
        ? `${idx + 1}. *${item.name}* (${item.equipmentNumber})\n  • الصنف: ${item.category} | الحالة: ${item.condition}${delayBlock}${finalExitLine}\n  • آخر تحديث: ${item.lastUpdatedBy}`
        : `${idx + 1}. *${item.name}* (${item.equipmentNumber})\n  • Catégorie : ${CATEGORY_LABELS.fr[item.category]} | État : ${CONDITION_LABELS.fr[item.condition]}${delayBlock}${finalExitLine}\n  • Mis à jour par : ${item.lastUpdatedBy}`;
    })
    .join('\n\n');

  const moreNote =
    items.length > 25
      ? isRtl
        ? `\n\n... وعدد ${items.length - 25} معدة إضافية في اللوحة السحابية.`
        : `\n\n... et ${items.length - 25} autre(s) équipement(s) dans le tableau cloud.`
      : '';

  return `${header}\n\n${body}${moreNote}`;
}
