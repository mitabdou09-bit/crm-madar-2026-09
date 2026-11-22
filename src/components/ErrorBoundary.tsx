import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || 'حدث خطأ غير متوقع في النظام السحابي.',
    };
  }

  render() {
    if (this.state.hasError) {
      const isFr =
        typeof document !== 'undefined' && document.documentElement.lang === 'fr';
      let friendlyMessage = isFr
        ? 'Une erreur est survenue lors de la connexion à la base de données cloud.'
        : 'حدث خطأ أثناء الاتصال بقاعدة البيانات السحابية.';
      try {
        const parsed = JSON.parse(this.state.message) as {
          error?: string;
          operationType?: string;
        };
        if (parsed.error?.toLowerCase().includes('permission')) {
          friendlyMessage = isFr
            ? 'Vous n’avez pas la permission pour cette opération (suppression réservée à l’Admin ou code d’accès invalide).'
            : 'ليست لديك صلاحية لتنفيذ هذه العملية (مثل الحذف المخصص للآدمن أو الدخول بدون الكود الصحيح).';
        }
      } catch {
        // Not a JSON FirestoreErrorInfo string
      }

      return (
        <div
          dir={isFr ? 'ltr' : 'rtl'}
          className="flex min-h-screen items-center justify-center bg-slate-50 p-6 text-slate-900 dark:bg-slate-950 dark:text-slate-100"
        >
          <div className="w-full max-w-md rounded-xl border border-red-200 bg-white p-6 shadow-sm dark:border-red-900/60 dark:bg-slate-900">
            <h2 className="text-lg font-bold text-red-700 dark:text-red-400">
              {isFr ? 'Alerte système cloud' : 'تنبيه النظام السحابي'}
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600 dark:text-slate-300">
              {friendlyMessage}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-5 w-full rounded-lg bg-[#0F4C81] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#0c3c66]"
            >
              {isFr ? 'Recharger le tableau' : 'إعادة تحميل اللوحة'}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
