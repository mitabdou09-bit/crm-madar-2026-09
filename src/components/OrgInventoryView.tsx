import React, { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  CheckCircle2,
  Clock,
  FileSpreadsheet,
  Lock,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  Wrench,
  X,
  XCircle,
} from 'lucide-react';
import { ORG_ASSET_STATUS_LABELS, T, type Language } from '../i18n';
import {
  ORG_ASSET_STATUSES,
  type OrgAssetStatus,
  type OrganizationAsset,
  type OrganizationAssetInput,
} from '../types';
import { triggerBlobDownload } from '../utils/exporters';

interface OrgInventoryViewProps {
  assets: OrganizationAsset[];
  loading: boolean;
  isAdmin: boolean;
  lang: Language;
  onSaveAsset: (input: OrganizationAssetInput, editingId?: string) => Promise<void>;
  onDeleteAsset: (asset: OrganizationAsset) => void;
  onOpenAdminLogin: () => void;
}

export const OrgInventoryView: React.FC<OrgInventoryViewProps> = ({
  assets,
  loading,
  isAdmin,
  lang,
  onSaveAsset,
  onDeleteAsset,
  onOpenAdminLogin,
}) => {
  const t = T[lang];
  const locale = lang === 'fr' ? 'fr-FR' : 'ar-SA';

  const [name, setName] = useState('');
  const [assetNumber, setAssetNumber] = useState('');
  const [status, setStatus] = useState<OrgAssetStatus>('يعمل - حالة جيدة');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  const formRef = useRef<HTMLFormElement | null>(null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');

  const filteredAssets = useMemo(() => {
    const q = search.trim().toLowerCase();
    return assets.filter((item) => {
      if (statusFilter !== 'ALL' && item.status !== statusFilter) return false;
      if (!q) return true;
      return (
        item.name.toLowerCase().includes(q) ||
        item.assetNumber.toLowerCase().includes(q)
      );
    });
  }, [assets, search, statusFilter]);

  const counts = useMemo(() => {
    return {
      total: assets.length,
      good: assets.filter((a) => a.status === 'يعمل - حالة جيدة').length,
      maint: assets.filter((a) => a.status === 'بحاجة لصيانة').length,
      broken: assets.filter((a) => a.status === 'معطل' || a.status === 'خارج الخدمة').length,
    };
  }, [assets]);

  const handleStartEdit = (asset: OrganizationAsset) => {
    setEditingId(asset.id);
    setName(asset.name);
    setAssetNumber(asset.assetNumber);
    setStatus(asset.status);
    setFormError('');
    setTimeout(() => {
      formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      nameInputRef.current?.focus();
    }, 30);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setName('');
    setAssetNumber('');
    setStatus('يعمل - حالة جيدة');
    setFormError('');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !assetNumber.trim()) {
      setFormError(t.orgAssetErrRequired);
      nameInputRef.current?.focus();
      return;
    }
    setFormError('');
    setSaving(true);
    try {
      await onSaveAsset(
        {
          name: name.trim(),
          assetNumber: assetNumber.trim(),
          status,
        },
        editingId || undefined
      );
      handleCancelEdit();
    } catch (err) {
      let message: string = t.errCloudVerify;
      if (err instanceof Error && err.message) {
        if (err.message.startsWith('{')) {
          try {
            const parsed = JSON.parse(err.message) as { error?: string };
            if (parsed.error) message = parsed.error;
          } catch {
            message = err.message;
          }
        } else {
          message = err.message;
        }
      }
      setFormError(message);
    } finally {
      setSaving(false);
    }
  };

  const handleExportInventoryExcel = () => {
    const headers =
      lang === 'fr'
        ? ['#', 'Nom du matériel', 'Numéro', 'État', 'Mis à jour par', 'Date']
        : ['#', 'اسم العتاد', 'الرقم', 'الحالة', 'آخر تحديث بواسطة', 'التاريخ'];

    const rows = filteredAssets.map((a, idx) =>
      lang === 'fr'
        ? {
            '#': idx + 1,
            'Nom du matériel': a.name,
            Numéro: a.assetNumber,
            État: ORG_ASSET_STATUS_LABELS.fr[a.status],
            'Mis à jour par': a.lastUpdatedBy,
            Date: new Date(a.updatedAt).toLocaleDateString(locale),
          }
        : {
            '#': idx + 1,
            'اسم العتاد': a.name,
            الرقم: a.assetNumber,
            الحالة: ORG_ASSET_STATUS_LABELS.ar[a.status],
            'آخر تحديث بواسطة': a.lastUpdatedBy,
            التاريخ: new Date(a.updatedAt).toLocaleDateString(locale),
          }
    );

    const wb = XLSX.utils.book_new();
    wb.Workbook = { Views: [{ RTL: lang === 'ar' }] };
    const ws =
      rows.length > 0
        ? XLSX.utils.json_to_sheet(rows, { header: headers })
        : XLSX.utils.aoa_to_sheet([headers]);
    ws['!cols'] = [{ wch: 6 }, { wch: 30 }, { wch: 18 }, { wch: 24 }, { wch: 20 }, { wch: 16 }];
    XLSX.utils.book_append_sheet(
      wb,
      ws,
      lang === 'fr' ? 'Matériel Entreprise' : 'عتاد المؤسسة'
    );
    const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' }) as ArrayBuffer;
    const blob = new Blob([buf], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const stamp = new Date().toISOString().slice(0, 10);
    triggerBlobDownload(
      blob,
      lang === 'fr' ? `inventaire_materiel_${stamp}.xlsx` : `قائمة_عتاد_المؤسسة_${stamp}.xlsx`
    );
  };

  const renderStatusTone = (st: OrgAssetStatus) => {
    switch (st) {
      case 'يعمل - حالة جيدة':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            {ORG_ASSET_STATUS_LABELS[lang][st]}
          </span>
        );
      case 'بحاجة لصيانة':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-amber-700 dark:text-amber-400">
            <Wrench className="h-3.5 w-3.5 shrink-0" />
            {ORG_ASSET_STATUS_LABELS[lang][st]}
          </span>
        );
      case 'معطل':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-red-700 dark:text-red-400">
            <Clock className="h-3.5 w-3.5 shrink-0" />
            {ORG_ASSET_STATUS_LABELS[lang][st]}
          </span>
        );
      case 'خارج الخدمة':
        return (
          <span className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-600 dark:text-slate-400">
            <XCircle className="h-3.5 w-3.5 shrink-0" />
            {ORG_ASSET_STATUS_LABELS[lang][st]}
          </span>
        );
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Summary */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-4 dark:border-slate-800">
          <div>
            <h2 className="text-base font-bold text-slate-900 dark:text-white">
              {t.orgInvTitle} ({counts.total})
            </h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.orgInvDesc}</p>
          </div>
          <button
            type="button"
            onClick={handleExportInventoryExcel}
            className="flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <FileSpreadsheet className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            {t.orgAssetExportExcel}
          </button>
        </div>

        {/* Add / Edit Inline Form */}
        <form ref={formRef} onSubmit={handleSubmit} className="mt-5 space-y-3">
          {editingId && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
              <span>
                {t.orgAssetEditingBanner} <span className="font-bold">{name}</span> (
                <span className="font-mono">{assetNumber}</span>)
              </span>
              <button
                type="button"
                onClick={handleCancelEdit}
                className="rounded border border-sky-300 bg-white px-2 py-0.5 text-[11px] font-semibold text-sky-800 hover:bg-sky-100 dark:border-sky-800 dark:bg-slate-900 dark:text-sky-300"
              >
                {t.orgAssetCancelEditBtn}
              </button>
            </div>
          )}
          {formError && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              {formError}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
            <div className="md:col-span-4">
              <label
                htmlFor="org-asset-name"
                className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {t.orgAssetNameLabel}
              </label>
              <input
                ref={nameInputRef}
                id="org-asset-name"
                type="text"
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t.orgAssetNamePlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div className="md:col-span-3">
              <label
                htmlFor="org-asset-number"
                className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {t.orgAssetNumberLabel}
              </label>
              <input
                id="org-asset-number"
                type="text"
                maxLength={80}
                value={assetNumber}
                onChange={(e) => setAssetNumber(e.target.value)}
                placeholder={t.orgAssetNumberPlaceholder}
                className="font-mono w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div className="md:col-span-3">
              <label
                htmlFor="org-asset-status"
                className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {t.orgAssetStatusLabel}
              </label>
              <select
                id="org-asset-status"
                value={status}
                onChange={(e) => setStatus(e.target.value as OrgAssetStatus)}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              >
                {ORG_ASSET_STATUSES.map((st) => (
                  <option key={st} value={st}>
                    {ORG_ASSET_STATUS_LABELS[lang][st]}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2 md:col-span-2">
              <button
                type="submit"
                disabled={saving}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#0F4C81] px-3.5 py-2 text-sm font-semibold text-white transition hover:bg-[#0c3c66] disabled:opacity-50"
              >
                {editingId ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                {editingId ? t.orgAssetSaveEditBtn : t.orgAssetAddBtn}
              </button>
              {editingId && (
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  title={t.orgAssetCancelEditBtn}
                  className="rounded-lg border border-slate-300 p-2 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </form>
      </section>

      {/* Organization Assets List Table */}
      <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center gap-3 border-b border-slate-200 p-4 dark:border-slate-800">
          <div className="relative min-w-[220px] flex-1">
            <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t.orgAssetSearchPlaceholder}
              className="w-full rounded-lg border border-slate-300 bg-slate-50 py-2 ps-9 pe-3 text-sm text-slate-900 focus:border-[#0F4C81] focus:bg-white focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
            />
          </div>

          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-slate-200"
          >
            <option value="ALL">{t.orgAssetAllStatuses}</option>
            {ORG_ASSET_STATUSES.map((st) => (
              <option key={st} value={st}>
                {ORG_ASSET_STATUS_LABELS[lang][st]}
              </option>
            ))}
          </select>

          <div className="flex items-center gap-3 text-xs text-slate-500 dark:text-slate-400">
            <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
              {counts.good}
            </span>
            <span aria-hidden="true">/</span>
            <span className="font-mono font-semibold text-amber-700 dark:text-amber-400">
              {counts.maint}
            </span>
            <span aria-hidden="true">/</span>
            <span className="font-mono font-semibold text-red-700 dark:text-red-400">
              {counts.broken}
            </span>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3 p-6">
            {[1, 2, 3].map((row) => (
              <div
                key={row}
                className="h-12 animate-pulse rounded-lg bg-slate-100 dark:bg-slate-800"
              />
            ))}
          </div>
        ) : filteredAssets.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              {assets.length === 0 ? t.orgAssetEmptyTitle : t.emptySearchTitle}
            </p>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {assets.length === 0 ? t.orgAssetEmptyDesc : t.emptySearchDesc}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-start text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <th className="w-12 px-4 py-3 text-start">#</th>
                  <th className="px-4 py-3 text-start">{t.orgAssetThName}</th>
                  <th className="px-4 py-3 text-start">{t.orgAssetThNumber}</th>
                  <th className="px-4 py-3 text-start">{t.orgAssetThStatus}</th>
                  <th className="px-4 py-3 text-start">{t.orgAssetThUpdated}</th>
                  <th className="px-4 py-3 text-end">{t.orgAssetThActions}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-800">
                {filteredAssets.map((asset, idx) => (
                  <tr
                    key={asset.id}
                    className={`transition-colors hover:bg-slate-50/80 dark:hover:bg-slate-800/40 ${
                      editingId === asset.id ? 'bg-sky-50/60 dark:bg-sky-950/20' : ''
                    }`}
                  >
                    <td className="font-mono px-4 py-3 text-xs text-slate-400">{idx + 1}</td>
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-white">
                      {asset.name}
                    </td>
                    <td className="font-mono px-4 py-3 text-xs font-bold text-[#0F4C81] dark:text-sky-400">
                      {asset.assetNumber}
                    </td>
                    <td className="px-4 py-3">{renderStatusTone(asset.status)}</td>
                    <td className="px-4 py-3 text-xs text-slate-600 dark:text-slate-300">
                      <div>{asset.lastUpdatedBy}</div>
                      <div className="font-mono text-[11px] text-slate-400">
                        {new Date(asset.updatedAt).toLocaleDateString(locale)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-end">
                      <div className="flex items-center justify-end gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(asset)}
                          className="rounded-md border border-slate-200 p-1.5 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                          title={t.editTooltip}
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>

                        {isAdmin ? (
                          <button
                            type="button"
                            onClick={() => onDeleteAsset(asset)}
                            className="rounded-md border border-red-200 p-1.5 text-red-600 transition hover:bg-red-50 dark:border-red-900/60 dark:text-red-400 dark:hover:bg-red-950/50"
                            title={t.deleteTooltip}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={onOpenAdminLogin}
                            className="rounded-md border border-slate-200 p-1.5 text-slate-400 transition hover:bg-slate-100 dark:border-slate-800 dark:text-slate-600 dark:hover:bg-slate-800"
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
        )}
      </section>
    </div>
  );
};
