import React, { useEffect, useRef, useState } from 'react';
import { X, Wrench, AlertTriangle, PackageX, FileText } from 'lucide-react';
import { CATEGORY_LABELS, CONDITION_LABELS, T, type Language } from '../i18n';
import {
  EQUIPMENT_CATEGORIES,
  EQUIPMENT_CONDITIONS,
  type EquipmentCategory,
  type EquipmentCondition,
  type EquipmentInput,
  type EquipmentItem,
} from '../types';

interface EquipmentModalProps {
  isOpen: boolean;
  editingItem: EquipmentItem | null;
  lang: Language;
  onClose: () => void;
  onSave: (input: EquipmentInput, editingId?: string) => Promise<void>;
}

const DEFAULT_TODAY = () => new Date().toISOString().slice(0, 10);

function normalizeDateForInput(val: string | undefined, fallback: string): string {
  if (val && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(val)) return val;
  return fallback;
}

function formatReadableSaveError(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback;
  const raw = err.message || '';
  if (raw.startsWith('{')) {
    try {
      const parsed = JSON.parse(raw) as { error?: string };
      if (parsed.error) return parsed.error;
    } catch {
      // Fallback to raw message
    }
  }
  return raw || fallback;
}

export const EquipmentModal: React.FC<EquipmentModalProps> = ({
  isOpen,
  editingItem,
  lang,
  onClose,
  onSave,
}) => {
  const t = T[lang];
  const [name, setName] = useState(() => editingItem?.name ?? '');
  const [equipmentNumber, setEquipmentNumber] = useState(() => editingItem?.equipmentNumber ?? '');
  const [category, setCategory] = useState<EquipmentCategory>(
    () => editingItem?.category ?? 'آليات ثقيلة'
  );
  const [condition, setCondition] = useState<EquipmentCondition>(
    () => editingItem?.condition ?? 'قيد الصيانة'
  );
  const [location, setLocation] = useState(() => editingItem?.location ?? '');
  const [entryDate, setEntryDate] = useState(() =>
    normalizeDateForInput(editingItem?.entryDate, DEFAULT_TODAY())
  );
  const [expectedExitDate, setExpectedExitDate] = useState(() =>
    normalizeDateForInput(editingItem?.expectedExitDate, DEFAULT_TODAY())
  );

  const [delayServices, setDelayServices] = useState(() => editingItem?.delayServices ?? false);
  const [delayServicesNote, setDelayServicesNote] = useState(
    () => editingItem?.delayServicesNote ?? ''
  );
  const [delaySpareParts, setDelaySpareParts] = useState(
    () => editingItem?.delaySpareParts ?? false
  );
  const [delaySparePartsNote, setDelaySparePartsNote] = useState(
    () => editingItem?.delaySparePartsNote ?? ''
  );
  const [delayOther, setDelayOther] = useState(() => editingItem?.delayOther ?? false);
  const [delayOtherNote, setDelayOtherNote] = useState(() => editingItem?.delayOtherNote ?? '');
  const [finalExitDate, setFinalExitDate] = useState(() =>
    normalizeDateForInput(editingItem?.finalExitDate, '')
  );

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const nameInputRef = useRef<HTMLInputElement | null>(null);
  const numberInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setError('');
    setSaving(false);
    if (editingItem) {
      setName(editingItem.name);
      setEquipmentNumber(editingItem.equipmentNumber);
      setCategory(editingItem.category);
      setCondition(editingItem.condition);
      setLocation(editingItem.location);
      setEntryDate(normalizeDateForInput(editingItem.entryDate, DEFAULT_TODAY()));
      setExpectedExitDate(normalizeDateForInput(editingItem.expectedExitDate, DEFAULT_TODAY()));
      setDelayServices(editingItem.delayServices);
      setDelayServicesNote(editingItem.delayServicesNote);
      setDelaySpareParts(editingItem.delaySpareParts);
      setDelaySparePartsNote(editingItem.delaySparePartsNote);
      setDelayOther(editingItem.delayOther);
      setDelayOtherNote(editingItem.delayOtherNote);
      setFinalExitDate(normalizeDateForInput(editingItem.finalExitDate, ''));
    } else {
      setName('');
      setEquipmentNumber('');
      setCategory('آليات ثقيلة');
      setCondition('قيد الصيانة');
      setLocation('');
      setEntryDate(DEFAULT_TODAY());
      setExpectedExitDate(DEFAULT_TODAY());
      setDelayServices(false);
      setDelayServicesNote('');
      setDelaySpareParts(false);
      setDelaySparePartsNote('');
      setDelayOther(false);
      setDelayOtherNote('');
      setFinalExitDate('');
    }
  }, [isOpen, editingItem]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError(t.errRequiredNameNum);
      nameInputRef.current?.focus();
      return;
    }
    if (!equipmentNumber.trim()) {
      setError(t.errRequiredNameNum);
      numberInputRef.current?.focus();
      return;
    }
    setSaving(true);
    setError('');
    try {
      await onSave(
        {
          name: name.trim(),
          equipmentNumber: equipmentNumber.trim(),
          category,
          condition,
          location: location.trim() || (lang === 'fr' ? 'Atelier principal' : 'ورشة الصيانة الرئيسية'),
          entryDate: normalizeDateForInput(entryDate, DEFAULT_TODAY()),
          expectedExitDate: normalizeDateForInput(expectedExitDate, DEFAULT_TODAY()),
          delayServices,
          delayServicesNote: delayServices ? delayServicesNote.trim() : '',
          delaySpareParts,
          delaySparePartsNote: delaySpareParts ? delaySparePartsNote.trim() : '',
          delayOther,
          delayOtherNote: delayOther ? delayOtherNote.trim() : '',
          finalExitDate: normalizeDateForInput(finalExitDate, ''),
        },
        editingItem?.id
      );
      onClose();
    } catch (err) {
      setError(formatReadableSaveError(err, t.errCloudVerify));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
    >
      <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-white">
              {editingItem ? t.modalEditTitle : t.modalAddTitle}
            </h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
              {t.modalSyncSubtitle}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.cancel}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 space-y-6 overflow-y-auto p-6">
            {/* Section 1: Basic Identification */}
            <section className="space-y-4">
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">{t.modalSec1}</h3>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor="eq-modal-name"
                    className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {t.eqNameLabel} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="eq-modal-name"
                    ref={nameInputRef}
                    type="text"
                    required
                    maxLength={200}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={t.eqNamePlaceholder}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="eq-modal-number"
                    className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {t.eqNumLabel} <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="eq-modal-number"
                    ref={numberInputRef}
                    type="text"
                    required
                    maxLength={80}
                    value={equipmentNumber}
                    onChange={(e) => setEquipmentNumber(e.target.value)}
                    placeholder={t.eqNumPlaceholder}
                    className="font-mono w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                <div>
                  <label
                    htmlFor="eq-modal-category"
                    className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {t.eqCatLabel}
                  </label>
                  <select
                    id="eq-modal-category"
                    value={category}
                    onChange={(e) => setCategory(e.target.value as EquipmentCategory)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    {EQUIPMENT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_LABELS[lang][cat]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="eq-modal-condition"
                    className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {t.eqCondLabel}
                  </label>
                  <select
                    id="eq-modal-condition"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as EquipmentCondition)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  >
                    {EQUIPMENT_CONDITIONS.map((cond) => (
                      <option key={cond} value={cond}>
                        {CONDITION_LABELS[lang][cond]}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor="eq-modal-location"
                    className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
                  >
                    {t.eqLocLabel}
                  </label>
                  <input
                    id="eq-modal-location"
                    type="text"
                    maxLength={200}
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    placeholder={t.eqLocPlaceholder}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label
                      htmlFor="eq-modal-entry-date"
                      className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      {t.entryDateLabel}
                    </label>
                    <input
                      id="eq-modal-entry-date"
                      type="date"
                      value={entryDate}
                      onChange={(e) => setEntryDate(e.target.value)}
                      className="font-mono w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="eq-modal-expected-exit"
                      className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
                    >
                      {t.expectedExitLabel}
                    </label>
                    <input
                      id="eq-modal-expected-exit"
                      type="date"
                      value={expectedExitDate}
                      onChange={(e) => setExpectedExitDate(e.target.value)}
                      className="font-mono w-full rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-xs text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                    />
                  </div>
                </div>
              </div>
            </section>

            <hr className="border-slate-200 dark:border-slate-800" />

            {/* Section 2: Workshop Exit Delay Reasons */}
            <section className="space-y-4">
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">{t.modalSec2}</h3>
                <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t.modalSec2Desc}</p>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={delayServices}
                    onChange={(e) => setDelayServices(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0F4C81] focus:ring-[#0F4C81]"
                  />
                  <Wrench className="h-4 w-4 text-amber-600 dark:text-amber-400" />
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {t.chkDelayServices}
                  </span>
                </label>
                <div className="mt-3">
                  <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">
                    {t.noteServicesPrompt}
                  </label>
                  <textarea
                    rows={2}
                    maxLength={1500}
                    value={delayServicesNote}
                    onChange={(e) => {
                      setDelayServicesNote(e.target.value);
                      if (e.target.value.trim() && !delayServices) setDelayServices(true);
                    }}
                    placeholder={t.noteServicesPlaceholder}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={delaySpareParts}
                    onChange={(e) => setDelaySpareParts(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0F4C81] focus:ring-[#0F4C81]"
                  />
                  <PackageX className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {t.chkDelaySpareParts}
                  </span>
                </label>
                <div className="mt-3">
                  <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">
                    {t.noteSparePartsPrompt}
                  </label>
                  <textarea
                    rows={2}
                    maxLength={1500}
                    value={delaySparePartsNote}
                    onChange={(e) => {
                      setDelaySparePartsNote(e.target.value);
                      if (e.target.value.trim() && !delaySpareParts) setDelaySpareParts(true);
                    }}
                    placeholder={t.noteSparePartsPlaceholder}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <label className="flex cursor-pointer items-center gap-3">
                  <input
                    type="checkbox"
                    checked={delayOther}
                    onChange={(e) => setDelayOther(e.target.checked)}
                    className="h-4 w-4 rounded border-slate-300 text-[#0F4C81] focus:ring-[#0F4C81]"
                  />
                  <AlertTriangle className="h-4 w-4 text-slate-600 dark:text-slate-400" />
                  <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {t.chkDelayOther}
                  </span>
                </label>
                <div className="mt-3">
                  <label className="mb-1 block text-xs text-slate-600 dark:text-slate-400">
                    {t.noteOtherPrompt}
                  </label>
                  <textarea
                    rows={2}
                    maxLength={1500}
                    value={delayOtherNote}
                    onChange={(e) => {
                      setDelayOtherNote(e.target.value);
                      if (e.target.value.trim() && !delayOther) setDelayOther(true);
                    }}
                    placeholder={t.noteOtherPlaceholder}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </div>

                {/* Final Exit Date directly underneath "Other reasons for delay" */}
                <div className="mt-4 border-t border-slate-200 pt-3.5 dark:border-slate-800">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <label
                        htmlFor="equipment-final-exit-date"
                        className="block text-xs font-bold text-slate-800 dark:text-slate-200"
                      >
                        {t.finalExitDateLabel}
                      </label>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {t.finalExitDateHint}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        id="equipment-final-exit-date"
                        type="date"
                        value={finalExitDate}
                        onChange={(e) => setFinalExitDate(e.target.value)}
                        className="font-mono rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                      {finalExitDate && (
                        <button
                          type="button"
                          onClick={() => setFinalExitDate('')}
                          className="rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-[11px] font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                        >
                          {t.clearFinalExitBtn}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </section>
          </div>

          {/* Sticky Modal Footer with Inline Error Feedback */}
          <div className="shrink-0 space-y-3 border-t border-slate-200 bg-slate-50/90 px-6 py-4 dark:border-slate-800 dark:bg-slate-950/90">
            {error && (
              <div
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300"
              >
                {error}
              </div>
            )}
            <div className="flex items-center justify-end gap-3">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
              >
                {t.cancel}
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex items-center gap-2 rounded-lg bg-[#0F4C81] px-5 py-2 text-sm font-semibold text-white transition hover:bg-[#0c3c66] disabled:opacity-50"
              >
                <FileText className="h-4 w-4" />
                {saving ? t.saving : editingItem ? t.saveEditBtn : t.saveAddBtn}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
