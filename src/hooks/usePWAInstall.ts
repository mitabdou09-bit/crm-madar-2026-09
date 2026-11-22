import { useCallback, useEffect, useState } from 'react';

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

declare global {
  interface Window {
    __pwaInstallPrompt?: BeforeInstallPromptEvent | null;
    __pwaInstalled?: boolean;
  }
}

export function usePWAInstall() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(() =>
    typeof window !== 'undefined' ? window.__pwaInstallPrompt || null : null
  );
  const [isInstalled, setIsInstalled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return (
      Boolean(window.__pwaInstalled) ||
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true
    );
  });
  const [isIOS, setIsIOS] = useState(false);
  const [isInIframe, setIsInIframe] = useState(false);
  const [swActive, setSwActive] = useState(false);
  const [manifestLinked, setManifestLinked] = useState(false);
  const [alreadyInstalledRelated, setAlreadyInstalledRelated] = useState(false);
  const [installTriggeredFromQuery, setInstallTriggeredFromQuery] = useState(false);
  const [isFileProtocol, setIsFileProtocol] = useState<boolean>(() =>
    typeof window !== 'undefined' ? window.location.protocol === 'file:' : false
  );

  useEffect(() => {
    const checkStandalone = () =>
      Boolean(window.__pwaInstalled) ||
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: window-controls-overlay)').matches ||
      (window.navigator as unknown as { standalone?: boolean }).standalone === true;

    setIsInstalled(checkStandalone());
    setDeferredPrompt(window.__pwaInstallPrompt || null);

    try {
      setIsInIframe(window.self !== window.top);
    } catch {
      setIsInIframe(true);
    }

    const isHttpOrigin = /^https?:$/i.test(window.location.protocol);
    setIsFileProtocol(!isHttpOrigin && window.location.protocol === 'file:');

    const params = new URLSearchParams(window.location.search);
    if (params.get('install') === '1') {
      setInstallTriggeredFromQuery(true);
    }

    const userAgent = window.navigator.userAgent.toLowerCase();
    setIsIOS(/iphone|ipad|ipod/.test(userAgent));

    setManifestLinked(Boolean(document.querySelector('link[rel="manifest"]')));

    const checkSWAndRelated = async () => {
      if (isHttpOrigin && 'serviceWorker' in navigator) {
        try {
          const reg = await navigator.serviceWorker.getRegistration();
          if (reg && (reg.active || reg.waiting || reg.installing)) {
            setSwActive(true);
          }
          navigator.serviceWorker.ready
            .then(() => setSwActive(true))
            .catch(() => {});
        } catch {
          // Ignore in restricted frames
        }
      }

      const navAny = window.navigator as Navigator & {
        getInstalledRelatedApps?: () => Promise<Array<{ id?: string; platform?: string; url?: string }>>;
      };
      if (typeof navAny.getInstalledRelatedApps === 'function') {
        try {
          const related = await navAny.getInstalledRelatedApps();
          if (Array.isArray(related) && related.length > 0) {
            setAlreadyInstalledRelated(true);
          }
        } catch {
          // Ignore unsupported environments
        }
      }
    };

    void checkSWAndRelated();

    const syncFromGlobalPrompt = () => {
      setDeferredPrompt(window.__pwaInstallPrompt || null);
    };

    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      window.__pwaInstallPrompt = e as BeforeInstallPromptEvent;
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    const handleAppInstalled = () => {
      window.__pwaInstalled = true;
      window.__pwaInstallPrompt = null;
      setIsInstalled(true);
      setAlreadyInstalledRelated(true);
      setDeferredPrompt(null);
    };

    const displayModeMq = window.matchMedia('(display-mode: standalone)');
    const handleDisplayModeChange = () => {
      setIsInstalled(checkStandalone());
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('pwa:prompt-ready', syncFromGlobalPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('pwa:app-installed', handleAppInstalled);
    displayModeMq.addEventListener?.('change', handleDisplayModeChange);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('pwa:prompt-ready', syncFromGlobalPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('pwa:app-installed', handleAppInstalled);
      displayModeMq.removeEventListener?.('change', handleDisplayModeChange);
    };
  }, []);

  const clearInstallQuery = useCallback(() => {
    setInstallTriggeredFromQuery(false);
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.has('install')) {
        url.searchParams.delete('install');
        window.history.replaceState({}, '', url.pathname + (url.search ? url.search : '') + url.hash);
      }
    } catch {
      // Ignore history errors
    }
  }, []);

  const install = useCallback(async (): Promise<{
    ok: boolean;
    outcome: 'accepted' | 'dismissed' | 'unavailable';
  }> => {
    const promptEvent = deferredPrompt || window.__pwaInstallPrompt || null;
    if (!promptEvent) {
      return { ok: false, outcome: 'unavailable' };
    }
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      window.__pwaInstallPrompt = null;
      setDeferredPrompt(null);
      if (outcome === 'accepted') {
        window.__pwaInstalled = true;
        setIsInstalled(true);
        setAlreadyInstalledRelated(true);
        clearInstallQuery();
        return { ok: true, outcome: 'accepted' };
      }
      return { ok: false, outcome: 'dismissed' };
    } catch {
      return { ok: false, outcome: 'unavailable' };
    }
  }, [clearInstallQuery, deferredPrompt]);

  return {
    isInstallable: Boolean(deferredPrompt || (typeof window !== 'undefined' && window.__pwaInstallPrompt)),
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
  };
}

export function useOnlineStatus() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return isOnline;
}
