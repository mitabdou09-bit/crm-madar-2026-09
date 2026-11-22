import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  Download,
  ExternalLink,
  FileCode2,
  FolderDown,
  HardDrive,
  Loader2,
  MonitorDown,
  Package,
  WifiOff,
  X,
} from 'lucide-react';
import { T, type Language } from '../i18n';
import { useOnlineStatus, usePWAInstall } from '../hooks/usePWAInstall';
import { isDirectoryPickerSupported } from '../utils/localFolderArchive';
import {
  downloadComputerInstallerZip,
  downloadStandaloneHtmlApp,
  getAppOriginUrl,
  getLastInstalledFolderName,
  installToComputerFolder,
} from '../utils/pcFilesInstaller';

interface PWAInstallControlProps {
  lang?: Language;
  variant?: 'toolbar' | 'card';
}

export const PWAInstallControl: React.FC<PWAInstallControlProps> = ({
  lang = 'ar',
  variant = 'toolbar',
}) => {
  const {
    isInstallable,
    isInstalled,
    isIOS,
    isInIframe,
    isFileProtocol,
    swActive,
    manifestLinked,
    alreadyInstalledRelated,
    installTriggeredFromQuery,
    clearInstallQuery,
    install,
  } = usePWAInstall();

  const [showModal, setShowModal] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [wasDismissed, setWasDismissed] = useState(false);
  const [pcInstalling, setPcInstalling] = useState(false);
  const [lastInstalledFolder, setLastInstalledFolder] = useState(() =>
    getLastInstalledFolderName()
  );
  const [pcInstallStatus, setPcInstallStatus] = useState<{
    type: 'ok' | 'info' | 'err';
    text: string;
    files?: string[];
  } | null>(null);

  const t = T[lang];
  const folderPickerAvailable = useMemo(() => isDirectoryPickerSupported(), []);

  // Auto-open real install confirmation modal when opened via ?install=1 in standalone tab
  useEffect(() => {
    if (installTriggeredFromQuery && !isInstalled) {
      setShowModal(true);
    }
  }, [installTriggeredFromQuery, isInstalled]);

  const standaloneInstallUrl = useMemo(() => {
    if (typeof window === 'undefined') return '/?install=1';
    if (window.location.protocol === 'file:') {
      return `${getAppOriginUrl()}/?install=1`;
    }
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('install', '1');
      return url.toString();
    } catch {
      return '/?install=1';
    }
  }, []);

  const runNativeInstall = async () => {
    setInstalling(true);
    setWasDismissed(false);
    try {
      const result = await install();
      if (result.ok) {
        setShowModal(false);
      } else if (result.outcome === 'dismissed') {
        setWasDismissed(true);
        setShowModal(true);
      } else {
        setShowModal(true);
      }
    } finally {
      setInstalling(false);
    }
  };

  const handleInstallIntoFolder = async () => {
    setPcInstalling(true);
    setPcInstallStatus(null);
    try {
      const res = await installToComputerFolder(lang);
      if (res.cancelled) {
        return;
      }
      if (res.blockedByIframe) {
        setPcInstallStatus({
          type: 'info',
          text: t.installPcFilesIframeNote,
        });
        return;
      }
      if (res.unsupported) {
        const zipRes = await downloadComputerInstallerZip(lang);
        setPcInstallStatus({
          type: zipRes.hasOfflineApp === false ? 'err' : 'ok',
          text:
            zipRes.hasOfflineApp === false
              ? t.installDownloadErrorMsg
              : t.installPcZipSavedMsg,
          files: zipRes.fileNames,
        });
        return;
      }
      if (res.error) {
        setPcInstallStatus({
          type: 'err',
          text: res.error,
        });
        return;
      }
      if (res.folderName) {
        setLastInstalledFolder(res.folderName);
        setPcInstallStatus({
          type: 'ok',
          text: `${t.installPcFolderSavedPrefix} ${res.folderName}`,
          files: res.fileNames,
        });
      }
    } catch {
      setPcInstallStatus({
        type: 'err',
        text: t.installDownloadErrorMsg,
      });
    } finally {
      setPcInstalling(false);
    }
  };

  const handleDownloadInstallerZip = async () => {
    setPcInstalling(true);
    setPcInstallStatus(null);
    try {
      const res = await downloadComputerInstallerZip(lang);
      setPcInstallStatus({
        type: res.hasOfflineApp === false ? 'err' : 'ok',
        text: res.hasOfflineApp === false ? t.installDownloadErrorMsg : t.installPcZipSavedMsg,
        files: res.fileNames,
      });
    } catch {
      setPcInstallStatus({
        type: 'err',
        text: t.installDownloadErrorMsg,
      });
    } finally {
      setPcInstalling(false);
    }
  };

  const handleDownloadSingleHtml = async () => {
    setPcInstalling(true);
    setPcInstallStatus(null);
    try {
      const res = await downloadStandaloneHtmlApp();
      if (!res.hasOfflineApp || res.error) {
        setPcInstallStatus({
          type: 'err',
          text: t.installDownloadErrorMsg,
        });
      } else {
        setPcInstallStatus({
          type: 'ok',
          text: t.installSingleHtmlSavedMsg,
          files: res.fileNames,
        });
      }
    } catch {
      setPcInstallStatus({
        type: 'err',
        text: t.installDownloadErrorMsg,
      });
    } finally {
      setPcInstalling(false);
    }
  };

  const handleCloseModal = () => {
    setShowModal(false);
    if (installTriggeredFromQuery) {
      clearInstallQuery();
    }
  };

  const triggerLabel = isInstalled
    ? t.installDownloadedBtn
    : isInstallable
      ? t.installNowReadyBtn
      : t.installWinBtn;

  return (
    <>
      {variant === 'card' ? (
        <div className="rounded-xl border border-[#0F4C81]/25 bg-[#0F4C81]/5 p-4 dark:border-sky-800/60 dark:bg-sky-950/30">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#0F4C81] text-white dark:bg-sky-600">
              <Download className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="text-xs font-bold text-slate-900 dark:text-white">
                {t.installBannerTitle}
              </h3>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-600 dark:text-slate-300">
                {t.installBannerDesc}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {isInstallable && !isInstalled && (
              <button
                type="button"
                disabled={installing}
                onClick={() => void runNativeInstall()}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              >
                <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                {t.installTriggerNativeNow}
              </button>
            )}

            <button
              type="button"
              disabled={pcInstalling}
              onClick={() => void handleDownloadInstallerZip()}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-[#0F4C81] px-3 py-2 text-xs font-bold text-white transition hover:bg-[#0c3c66] disabled:opacity-60"
            >
              {pcInstalling ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Package className="h-3.5 w-3.5" />
              )}
              {t.installQuickDownloadZipBtn}
            </button>

            <button
              type="button"
              onClick={() => setShowModal(true)}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 transition hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
            >
              <MonitorDown className="h-3.5 w-3.5 text-[#0F4C81] dark:text-sky-400" />
              {t.installQuickOpenHubBtn}
            </button>
          </div>

          {pcInstallStatus && !showModal && (
            <div
              className={`mt-2.5 rounded-lg border px-3 py-2 text-[11px] font-medium ${
                pcInstallStatus.type === 'ok'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                  : pcInstallStatus.type === 'err'
                    ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
                    : 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200'
              }`}
            >
              {pcInstallStatus.text}
            </div>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowModal(true)}
          disabled={installing}
          className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition disabled:opacity-60 ${
            isInstallable && !isInstalled
              ? 'border-emerald-400 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-200 dark:hover:bg-emerald-900/60'
              : 'border-[#0F4C81]/40 bg-[#0F4C81]/10 text-[#0F4C81] hover:bg-[#0F4C81]/15 dark:border-sky-700 dark:bg-sky-950/50 dark:text-sky-300 dark:hover:bg-sky-900/60'
          }`}
        >
          {isInstallable && !isInstalled ? (
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
          ) : (
            <Download className="h-3.5 w-3.5" />
          )}
          {triggerLabel}
        </button>
      )}

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[2px]">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl dark:border-slate-800 dark:bg-slate-900">
            <div className="flex shrink-0 items-center justify-between border-b border-slate-200 px-6 py-4 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <MonitorDown className="h-5 w-5 text-[#0F4C81] dark:text-sky-400" />
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {t.installWinTitle}
                </h3>
              </div>
              <button
                type="button"
                onClick={handleCloseModal}
                className="rounded-lg p-1 text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex-1 space-y-5 overflow-y-auto p-6 text-sm leading-relaxed text-slate-700 dark:text-slate-300">
              <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {t.installHubSubtitle}
              </p>

              {/* Section 1: Native PWA / Standalone App Installation */}
              <div className="space-y-3 rounded-xl border border-slate-200 bg-slate-50/70 p-4 dark:border-slate-800 dark:bg-slate-950/60">
                <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                  {t.installSectionAppTitle}
                </h4>

                {isInstalled ? (
                  <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs font-medium text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                    <span>{t.installAlreadyInstalledMsg}</span>
                  </div>
                ) : isIOS ? (
                  <div className="space-y-2 text-xs text-slate-700 dark:text-slate-300">
                    {lang === 'fr' ? (
                      <>
                        <p>
                          1. Appuyez sur le bouton <strong>Partager</strong> dans Safari.
                        </p>
                        <p>
                          2. Choisissez <strong>Sur l’écran d’accueil</strong>.
                        </p>
                      </>
                    ) : (
                      <>
                        <p>
                          1. اضغط على زر <strong>المشاركة (Share)</strong> في متصفح Safari.
                        </p>
                        <p>
                          2. اختر <strong>إضافة إلى الشاشة الرئيسية (Add to Home Screen)</strong>.
                        </p>
                      </>
                    )}
                  </div>
                ) : (
                  <>
                    {!isFileProtocol && (
                      <div className="rounded-lg border border-slate-200 bg-white p-2.5 text-xs dark:border-slate-800 dark:bg-slate-900">
                        <div className="flex items-center justify-between py-1">
                          <span className="text-slate-600 dark:text-slate-400">
                            {t.installReadinessManifest}
                          </span>
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {manifestLinked ? t.installReadinessReady : t.installReadinessLoading}
                          </span>
                        </div>
                        <div className="flex items-center justify-between border-t border-slate-200 pt-1.5 dark:border-slate-800">
                          <span className="text-slate-600 dark:text-slate-400">
                            {t.installReadinessSw}
                          </span>
                          <span
                            className={`inline-flex items-center gap-1 font-semibold ${
                              swActive
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {swActive ? (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            ) : (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            )}
                            {swActive ? t.installReadinessReady : t.installReadinessLoading}
                          </span>
                        </div>
                      </div>
                    )}

                    {isInstallable ? (
                      <button
                        type="button"
                        disabled={installing}
                        onClick={() => void runNativeInstall()}
                        className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-3 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {installing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Download className="h-4 w-4" />
                        )}
                        {t.installTriggerNativeNow}
                      </button>
                    ) : isInIframe || isFileProtocol ? (
                      <div className="space-y-2.5">
                        <p className="text-xs text-slate-600 dark:text-slate-300">
                          {t.installIframeReason}
                        </p>
                        <a
                          href={standaloneInstallUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={() => setShowModal(false)}
                          className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#0c3c66]"
                        >
                          <ExternalLink className="h-4 w-4" />
                          {t.installWinOpenTab}
                        </a>
                      </div>
                    ) : alreadyInstalledRelated ? (
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200">
                        {t.installAlreadyInstalledMsg}
                      </div>
                    ) : (
                      <div className="space-y-2 text-xs">
                        {!swActive && (
                          <div className="flex items-center gap-2 rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
                            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                            <span>{t.installWaitingPrompt}</span>
                          </div>
                        )}
                        <p className="text-slate-600 dark:text-slate-300">
                          {t.installDismissedNote}
                        </p>
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Section 2: Direct Computer Download & Local Folder Installation */}
              <div className="space-y-3 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
                <div className="flex items-start gap-2.5">
                  <HardDrive className="mt-0.5 h-4 w-4 shrink-0 text-[#0F4C81] dark:text-sky-400" />
                  <div>
                    <h4 className="text-xs font-bold text-slate-900 dark:text-white">
                      {t.installSectionDownloadTitle}
                    </h4>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {t.installPcFilesDesc}
                    </p>
                  </div>
                </div>

                {lastInstalledFolder && (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2 text-[11px] font-semibold text-emerald-800 dark:border-emerald-900/50 dark:bg-emerald-950/30 dark:text-emerald-300">
                    {t.installPcLastFolderPrefix}{' '}
                    <span className="font-mono font-bold">{lastInstalledFolder}</span>
                  </div>
                )}

                <div className="grid grid-cols-1 gap-2">
                  <button
                    type="button"
                    disabled={pcInstalling}
                    onClick={() => void handleDownloadInstallerZip()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-xs font-bold text-white transition hover:bg-[#0c3c66] disabled:opacity-60"
                  >
                    {pcInstalling ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Package className="h-4 w-4" />
                    )}
                    {t.installDownloadZipBtn}
                  </button>

                  <button
                    type="button"
                    disabled={pcInstalling}
                    onClick={() => void handleDownloadSingleHtml()}
                    className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2.5 text-xs font-bold text-emerald-900 transition hover:bg-emerald-100 disabled:opacity-60 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200 dark:hover:bg-emerald-900/60"
                  >
                    <FileCode2 className="h-4 w-4" />
                    {t.installDownloadSingleHtmlBtn}
                  </button>

                  <p className="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                    {t.installSingleHtmlDesc}
                  </p>

                  {folderPickerAvailable && !isInIframe && (
                    <button
                      type="button"
                      disabled={pcInstalling}
                      onClick={() => void handleInstallIntoFolder()}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-2.5 text-xs font-bold text-slate-800 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700"
                    >
                      {pcInstalling ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <FolderDown className="h-4 w-4 text-[#0F4C81] dark:text-sky-400" />
                      )}
                      {t.installChoosePcFolderBtn}
                    </button>
                  )}
                </div>

                {isInIframe && folderPickerAvailable && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    {t.installPcFilesIframeNote}
                  </p>
                )}

                {pcInstallStatus && (
                  <div
                    className={`rounded-lg border px-3 py-2.5 text-xs ${
                      pcInstallStatus.type === 'ok'
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/40 dark:text-emerald-200'
                        : pcInstallStatus.type === 'err'
                          ? 'border-red-200 bg-red-50 text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300'
                          : 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200'
                    }`}
                  >
                    <div className="font-semibold">{pcInstallStatus.text}</div>
                    {pcInstallStatus.files && pcInstallStatus.files.length > 0 && (
                      <div className="mt-1.5 font-mono text-[11px] opacity-90">
                        {pcInstallStatus.files.join(' · ')}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export const OfflineIndicator: React.FC<{ lang?: Language }> = ({ lang = 'ar' }) => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div className="no-print fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-semibold text-white shadow-lg">
      <WifiOff className="h-4 w-4" />
      {T[lang].offlineBanner}
    </div>
  );
};
