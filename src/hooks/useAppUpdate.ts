import { useCallback, useEffect, useRef } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

export function useAppUpdate() {
  const registrationRef = useRef<ServiceWorkerRegistration | null>(null);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        registrationRef.current = registration;
      }
    },
    onRegisterError() {
      // Ignore SW registration errors in unsupported environments
    },
  });

  const checkForAppUpdate = useCallback(async () => {
    try {
      const reg =
        registrationRef.current ||
        (typeof navigator !== 'undefined' && 'serviceWorker' in navigator
          ? await navigator.serviceWorker.getRegistration()
          : undefined);
      if (reg) {
        registrationRef.current = reg;
        await reg.update();
      }
    } catch {
      // Ignore offline/network check errors
    }
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void checkForAppUpdate();
    }, 30 * 60 * 1000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForAppUpdate();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      window.clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [checkForAppUpdate]);

  const applyAppUpdate = useCallback(async () => {
    try {
      await updateServiceWorker(true);
    } finally {
      setNeedRefresh(false);
    }
  }, [setNeedRefresh, updateServiceWorker]);

  return {
    needRefresh,
    checkForAppUpdate,
    applyAppUpdate,
  };
}
