import React, { useEffect, useState } from 'react';
import { signInWithPopup, signOut, type User } from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { Globe, HardDrive, Lock, LogIn, LogOut, ShieldCheck } from 'lucide-react';
import {
  auth,
  db,
  googleProvider,
  handleFirestoreError,
  OperationType,
  WORKSPACE_KEY,
} from '../firebase';
import { T, type Language } from '../i18n';
import { PWAInstallControl } from './PWAInstallModal';
import { BrandTitle } from './BrandTitle';
import { useOnlineStatus } from '../hooks/usePWAInstall';

interface LoginGateProps {
  firebaseUser: User | null;
  lang: Language;
  onChangeLang: (lang: Language) => void;
  onUnlockSuccess: (memberName: string) => void;
  onEnterLocalMode: () => void;
}

export const LoginGate: React.FC<LoginGateProps> = ({
  firebaseUser,
  lang,
  onChangeLang,
  onUnlockSuccess,
  onEnterLocalMode,
}) => {
  const [memberName, setMemberName] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const isOnline = useOnlineStatus();
  const t = T[lang];

  useEffect(() => {
    if (firebaseUser?.displayName && !memberName) {
      setMemberName(firebaseUser.displayName.slice(0, 80));
    }
  }, [firebaseUser, memberName]);

  const handleGoogleSignIn = async () => {
    setLoading(true);
    setError('');
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes('popup')
          ? t.errPopupClosed
          : t.errGoogleFailed
      );
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) return;

    const trimmedName = memberName.trim().slice(0, 80);
    const trimmedCode = accessCode.trim();

    if (!trimmedName) {
      setError(t.errEnterName);
      return;
    }
    if (!trimmedCode) {
      setError(t.errEnterCode);
      return;
    }
    if (trimmedCode !== WORKSPACE_KEY) {
      setError(t.errWrongCode);
      return;
    }

    setLoading(true);
    setError('');
    const memberPath = `teamMembers/${firebaseUser.uid}`;

    try {
      const ref = doc(db, 'teamMembers', firebaseUser.uid);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        await updateDoc(ref, {
          displayName: trimmedName,
        });
      } else {
        await setDoc(ref, {
          uid: firebaseUser.uid,
          displayName: trimmedName,
          role: 'member',
          accessCode: trimmedCode,
          joinedAt: serverTimestamp(),
        });
      }
      onUnlockSuccess(trimmedName);
    } catch (err) {
      try {
        handleFirestoreError(err, OperationType.WRITE, memberPath);
      } catch (wrapped) {
        setError(
          wrapped instanceof Error && wrapped.message.includes('permission')
            ? t.errAuthUnverified
            : t.errCloudVerify
        );
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-50 p-4 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-8 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        {/* Language Toggle on Login Screen */}
        <div className="mb-5 flex items-center justify-end">
          <div className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 dark:border-slate-800 dark:bg-slate-950">
            <Globe className="mx-1.5 h-3.5 w-3.5 text-slate-500" />
            <button
              type="button"
              onClick={() => onChangeLang('ar')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                lang === 'ar'
                  ? 'bg-[#0F4C81] text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              العربية
            </button>
            <button
              type="button"
              onClick={() => onChangeLang('fr')}
              className={`rounded-md px-2.5 py-1 text-xs font-semibold transition ${
                lang === 'fr'
                  ? 'bg-[#0F4C81] text-white'
                  : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
              }`}
            >
              Français
            </button>
          </div>
        </div>

        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1>
              <BrandTitle className="text-3xl" />
            </h1>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t.loginSub}</p>
          </div>
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-[#0F4C81]/10 text-[#0F4C81] dark:bg-sky-950 dark:text-sky-400">
            <Lock className="h-5 w-5" />
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
            {error}
          </div>
        )}

        {!firebaseUser ? (
          <div className="space-y-4">
            <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
              {t.chooseWorkModeLabel}
            </p>
            <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {t.loginGoogleDesc}
            </p>
            <p className="rounded-lg border border-sky-200 bg-sky-50 px-3.5 py-2.5 text-xs leading-relaxed text-sky-900 dark:border-sky-900/60 dark:bg-sky-950/40 dark:text-sky-200">
              {t.loginPersistentNote}
            </p>
            {!isOnline && (
              <p className="rounded-lg border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-xs leading-relaxed text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200">
                {t.loginOfflineNotice}
              </p>
            )}
            <button
              type="button"
              disabled={loading || !isOnline}
              onClick={handleGoogleSignIn}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-3 text-sm font-semibold text-white transition hover:bg-[#0c3c66] disabled:opacity-50"
            >
              <ShieldCheck className="h-4 w-4" />
              {loading ? t.openingGoogle : t.signInGoogle}
            </button>

            <div className="relative py-1">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-slate-200 dark:border-slate-800" />
              </div>
              <div className="relative flex justify-center text-[11px]">
                <span className="bg-white px-2.5 font-medium text-slate-400 dark:bg-slate-900">
                  {lang === 'fr' ? 'ou' : 'أو'}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3.5 dark:border-emerald-900/60 dark:bg-emerald-950/30">
              <button
                type="button"
                onClick={onEnterLocalMode}
                className="flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-700"
              >
                <HardDrive className="h-4 w-4" />
                {t.enterLocalModeBtn}
              </button>
              <p className="mt-2 text-[11px] leading-relaxed text-emerald-900 dark:text-emerald-200">
                {t.enterLocalModeDesc}
              </p>
            </div>
          </div>
        ) : (
          <form onSubmit={handleVerifyCode} className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs dark:border-slate-800 dark:bg-slate-950">
              <span className="truncate font-medium text-slate-700 dark:text-slate-300">
                {firebaseUser.email}
              </span>
              <button
                type="button"
                onClick={() => void signOut(auth)}
                className="flex items-center gap-1 text-slate-500 hover:text-red-600 dark:text-slate-400"
              >
                <LogOut className="h-3.5 w-3.5" />
                {t.switchAccount}
              </button>
            </div>

            <div>
              <label
                htmlFor="login-member-name"
                className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {t.fullNameLabel}
              </label>
              <input
                id="login-member-name"
                type="text"
                required
                autoFocus
                maxLength={80}
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                placeholder={t.fullNamePlaceholder}
                className="w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <div>
              <label
                htmlFor="login-access-code"
                className="mb-1.5 block text-xs font-semibold text-slate-700 dark:text-slate-300"
              >
                {t.accessCodeLabel}
              </label>
              <input
                id="login-access-code"
                type="password"
                required
                maxLength={32}
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder={t.accessCodePlaceholder}
                className="font-mono w-full rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-[#0F4C81] focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#0c3c66] disabled:opacity-50"
            >
              <LogIn className="h-4 w-4" />
              {loading ? t.verifying : t.enterDashboard}
            </button>

            <button
              type="button"
              onClick={onEnterLocalMode}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
            >
              <HardDrive className="h-3.5 w-3.5" />
              {t.enterLocalModeBtn}
            </button>
          </form>
        )}

        <div className="mt-6 border-t border-slate-100 pt-5 dark:border-slate-800">
          <PWAInstallControl lang={lang} variant="card" />
        </div>
      </div>
    </div>
  );
};
