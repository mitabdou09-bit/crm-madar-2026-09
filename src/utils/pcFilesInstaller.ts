import { triggerBlobDownload } from './exporters';
import type { Language } from '../i18n';

export interface InstalledFileEntry {
  name: string;
  content: Uint8Array;
}

export interface PcInstallResult {
  mode: 'folder' | 'zip' | 'html';
  folderName?: string;
  fileNames: string[];
  hasOfflineApp?: boolean;
  blockedByIframe?: boolean;
  cancelled?: boolean;
  unsupported?: boolean;
  error?: string;
}

interface DirectoryHandleWithSubdir {
  kind: 'directory';
  name: string;
  getDirectoryHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<DirectoryHandleWithSubdir>;
  getFileHandle: (
    name: string,
    options?: { create?: boolean }
  ) => Promise<{
    createWritable: () => Promise<{
      write: (data: Blob | Uint8Array) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

const DB_NAME = 'crm_pc_install_db';
const STORE_NAME = 'install_folder';
const FOLDER_KEY = 'last_folder_name';

function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function encodeUtf8WithBom(text: string): Uint8Array {
  const body = encodeUtf8(text);
  const out = new Uint8Array(3 + body.length);
  out[0] = 0xef;
  out[1] = 0xbb;
  out[2] = 0xbf;
  out.set(body, 3);
  return out;
}

function buildIcoFromPng(pngBytes: Uint8Array): Uint8Array {
  // Windows Vista / 7 / 10 / 11 natively support PNG-encoded 192x192 icons inside .ico
  const headerSize = 22;
  const ico = new Uint8Array(headerSize + pngBytes.length);
  const view = new DataView(ico.buffer);

  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);

  ico[6] = 192;
  ico[7] = 192;
  ico[8] = 0;
  ico[9] = 0;
  view.setUint16(10, 1, true);
  view.setUint16(12, 32, true);
  view.setUint32(14, pngBytes.length, true);
  view.setUint32(18, headerSize, true);

  ico.set(pngBytes, headerSize);
  return ico;
}

async function fetchPngIconBytes(): Promise<Uint8Array | null> {
  if (
    typeof fetch !== 'function' ||
    (typeof window !== 'undefined' && !/^https?:$/i.test(window.location.protocol))
  ) {
    return null;
  }
  try {
    const res = await fetch('/pwa-192x192.png', { cache: 'default' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

function normalizeOrigin(url: string): string {
  return url.trim().replace(/\/Crm-Local\.html$/i, '').replace(/\/+$/, '');
}

function injectCloudMetaIntoHtml(html: string, appUrl: string): string {
  const cleanOrigin = normalizeOrigin(appUrl);
  const escapedUrl = cleanOrigin.replace(/"/g, '&quot;');
  if (html.includes('name="crm-cloud-url"')) {
    return html.replace(
      /<meta\s+name="crm-cloud-url"\s+content="[^"]*"\s*\/?>/i,
      `<meta name="crm-cloud-url" content="${escapedUrl}" />`
    );
  }
  return html.replace(
    '<head>',
    `<head>\n  <meta name="crm-cloud-url" content="${escapedUrl}" />`
  );
}

function reconstructStandaloneHtmlFromCurrentDoc(appUrl: string): Uint8Array | null {
  if (typeof document === 'undefined') return null;
  const isLocalEdition = Boolean(document.querySelector('meta[name="crm-local-edition"]'));
  if (!isLocalEdition) return null;

  const styleEl = document.getElementById('crm-local-bundle-style');
  const scriptEl = document.getElementById('crm-local-bundle-script');
  if (!scriptEl || !scriptEl.textContent) return null;

  const iconHref =
    document.getElementById('crm-local-bundle-icon')?.getAttribute('href') || '';
  const escapedOrigin = normalizeOrigin(appUrl).replace(/"/g, '&quot;');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="crm-local-edition" content="1" />
  <meta name="crm-cloud-url" content="${escapedOrigin}" />
  <title>Crm — Local Desktop Edition</title>
  ${iconHref ? `<link id="crm-local-bundle-icon" rel="icon" type="image/svg+xml" href="${iconHref}" />` : ''}
  <style id="crm-local-bundle-style">${styleEl?.textContent || ''}</style>
</head>
<body class="bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
  <div id="root"></div>
  <script id="crm-local-bundle-script">${scriptEl.textContent}</script>
</body>
</html>
`;
  return encodeUtf8(html);
}

async function fetchLocalHtmlBundleBytes(appUrl: string): Promise<Uint8Array | null> {
  // 1. If already running inside standalone local bundle (e.g. file://), reconstruct cleanly
  const selfBytes = reconstructStandaloneHtmlFromCurrentDoc(appUrl);
  if (selfBytes && selfBytes.length > 0) {
    return selfBytes;
  }

  // 2. Fetch from origin or Service Worker cache on http(s)://
  if (typeof fetch === 'function' && typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)) {
    try {
      const res = await fetch('/Crm-Local.html', { cache: 'default' });
      if (res.ok) {
        const text = await res.text();
        if (text.includes('id="root"')) {
          return encodeUtf8(injectCloudMetaIntoHtml(text, appUrl));
        }
      }
    } catch {
      // Continue to fallback check
    }
  }

  return null;
}

export function getAppOriginUrl(): string {
  if (typeof window !== 'undefined' && /^https?:$/i.test(window.location.protocol)) {
    return window.location.origin;
  }
  if (typeof document !== 'undefined') {
    const meta = document.querySelector('meta[name="crm-cloud-url"]')?.getAttribute('content');
    if (meta && /^https?:\/\//i.test(meta)) {
      return normalizeOrigin(meta);
    }
  }
  return 'https://ais-dev-kuuou4u5ajby3g35lwv5sr-900477063934.europe-west2.run.app';
}

export function buildBatchLauncher(_appUrl?: string): string {
  const lines = [
    '@echo off',
    'setlocal',
    'set "APP_DIR=%~dp0"',
    'if "%APP_DIR:~-1%"=="\\" set "APP_DIR=%APP_DIR:~0,-1%"',
    'set "TARGET_FILE=%APP_DIR%\\Crm-Local.html"',
    'if not exist "%TARGET_FILE%" set "TARGET_FILE=%APP_DIR%\\Crm-Launcher.html"',
    'set "EDGE1=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'set "EDGE2=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'set "EDGE3=%LocalAppData%\\Microsoft\\Edge\\Application\\msedge.exe"',
    'set "CHROME1=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
    'set "CHROME2=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
    'set "CHROME3=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"',
    '',
    'if exist "%EDGE1%" (',
    '  start "" "%EDGE1%" --app="%TARGET_FILE%"',
    '  exit /b 0',
    ')',
    'if exist "%EDGE2%" (',
    '  start "" "%EDGE2%" --app="%TARGET_FILE%"',
    '  exit /b 0',
    ')',
    'if exist "%EDGE3%" (',
    '  start "" "%EDGE3%" --app="%TARGET_FILE%"',
    '  exit /b 0',
    ')',
    'if exist "%CHROME1%" (',
    '  start "" "%CHROME1%" --app="%TARGET_FILE%"',
    '  exit /b 0',
    ')',
    'if exist "%CHROME2%" (',
    '  start "" "%CHROME2%" --app="%TARGET_FILE%"',
    '  exit /b 0',
    ')',
    'if exist "%CHROME3%" (',
    '  start "" "%CHROME3%" --app="%TARGET_FILE%"',
    '  exit /b 0',
    ')',
    'start "" "%TARGET_FILE%"',
    'exit /b 0',
    '',
  ];
  return lines.join('\r\n');
}

export function buildShortcutInstallerBatch(_appUrl?: string): string {
  const lines = [
    '@echo off',
    'setlocal',
    'set "APP_DIR=%~dp0"',
    'if "%APP_DIR:~-1%"=="\\" set "APP_DIR=%APP_DIR:~0,-1%"',
    'set "TARGET_FILE=%APP_DIR%\\Crm-Local.html"',
    'if not exist "%TARGET_FILE%" set "TARGET_FILE=%APP_DIR%\\Crm-Launcher.html"',
    'set "ICON_PATH=%APP_DIR%\\Crm.ico"',
    'set "TARGET_EXE="',
    'set "TARGET_ARGS="',
    '',
    'if exist "%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  set "TARGET_EXE=%ProgramFiles(x86)%\\Microsoft\\Edge\\Application\\msedge.exe"',
    '  set "TARGET_ARGS=--app=""%TARGET_FILE%"""',
    ') else if exist "%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  set "TARGET_EXE=%ProgramFiles%\\Microsoft\\Edge\\Application\\msedge.exe"',
    '  set "TARGET_ARGS=--app=""%TARGET_FILE%"""',
    ') else if exist "%LocalAppData%\\Microsoft\\Edge\\Application\\msedge.exe" (',
    '  set "TARGET_EXE=%LocalAppData%\\Microsoft\\Edge\\Application\\msedge.exe"',
    '  set "TARGET_ARGS=--app=""%TARGET_FILE%"""',
    ') else if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" (',
    '  set "TARGET_EXE=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
    '  set "TARGET_ARGS=--app=""%TARGET_FILE%"""',
    ') else if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" (',
    '  set "TARGET_EXE=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
    '  set "TARGET_ARGS=--app=""%TARGET_FILE%"""',
    ') else if exist "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" (',
    '  set "TARGET_EXE=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"',
    '  set "TARGET_ARGS=--app=""%TARGET_FILE%"""',
    ') else (',
    '  set "TARGET_EXE=%APP_DIR%\\Crm.bat"',
    '  set "TARGET_ARGS="',
    ')',
    '',
    'set "VBS=%TEMP%\\crm_shortcut_%RANDOM%.vbs"',
    '(',
    '  echo Set sh = CreateObject^("WScript.Shell"^)',
    '  echo Set fso = CreateObject^("Scripting.FileSystemObject"^)',
    '  echo desktopDir = sh.SpecialFolders^("Desktop"^)',
    '  echo startDir = sh.SpecialFolders^("Programs"^)',
    '  echo Set sc1 = sh.CreateShortcut^(desktopDir ^& "\\Crm.lnk"^)',
    '  echo sc1.TargetPath = "%TARGET_EXE%"',
    '  echo sc1.Arguments = "%TARGET_ARGS%"',
    '  echo sc1.WorkingDirectory = "%APP_DIR%"',
    '  echo sc1.Description = "Crm Local Desktop Application"',
    '  echo If fso.FileExists^("%ICON_PATH%"^) Then sc1.IconLocation = "%ICON_PATH%"',
    '  echo sc1.Save',
    '  echo Set sc2 = sh.CreateShortcut^(startDir ^& "\\Crm.lnk"^)',
    '  echo sc2.TargetPath = "%TARGET_EXE%"',
    '  echo sc2.Arguments = "%TARGET_ARGS%"',
    '  echo sc2.WorkingDirectory = "%APP_DIR%"',
    '  echo sc2.Description = "Crm Local Desktop Application"',
    '  echo If fso.FileExists^("%ICON_PATH%"^) Then sc2.IconLocation = "%ICON_PATH%"',
    '  echo sc2.Save',
    ') > "%VBS%"',
    'cscript //nologo "%VBS%"',
    'del /q "%VBS%" >nul 2>&1',
    'echo.',
    'echo Crm Local Desktop shortcuts created on Desktop and Start Menu.',
    'pause',
    '',
  ];
  return lines.join('\r\n');
}

export function buildInternetShortcutFile(appUrl: string): string {
  const targetUrl = normalizeOrigin(appUrl);
  return [
    '[InternetShortcut]',
    `URL=${targetUrl}/`,
    'IconIndex=0',
    'IconFile=Crm.ico',
    '',
  ].join('\r\n');
}

export function buildLocalHtmlLauncher(appUrl: string, lang: Language): string {
  const isFr = lang === 'fr';
  const title = isFr ? 'Crm — Lanceur Local PC' : 'Crm — مشغّل الحاسوب المحلي';
  const heading = isFr
    ? 'Programme Crm prêt en local sur votre PC'
    : 'برنامج Crm جاهز للعمل محلياً على حاسوبك';
  const desc = isFr
    ? 'Cette version locale fonctionne directement sur votre ordinateur Windows 11 / 10 / 07 sans connexion Google, sans Internet et sans erreur 403.'
    : 'تعمل هذه النسخة المحلية مباشرة من ملفات حاسوبك على Windows 11 / 10 / 07 بدون تسجيل دخول Google وبدون إنترنت وبدون خطأ 403.';
  const btn = isFr ? 'Ouvrir Crm Local maintenant' : 'فتح برنامج Crm المحلي الآن';
  const tip = isFr
    ? 'Astuce : double-cliquez sur Crm.bat ou Create-Desktop-Shortcut.bat pour lancer Crm en fenêtre bureau sans barre de navigateur.'
    : 'نصيحة: اضغط مرتين على Crm.bat أو Create-Desktop-Shortcut.bat لتشغيل البرنامج في نافذة مستقلة على سطح المكتب.';
  const cleanOrigin = normalizeOrigin(appUrl);
  const cloudNote = isFr
    ? `Lien Cloud : ${cleanOrigin}/`
    : `رابط النسخة السحابية على الويب: ${cleanOrigin}/`;

  return `<!DOCTYPE html>
<html lang="${isFr ? 'fr' : 'ar'}" dir="${isFr ? 'ltr' : 'rtl'}">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,Segoe UI,Tahoma,sans-serif;background:#f1f5f9;color:#0f172a;padding:24px}
    .card{max-width:540px;width:100%;background:#fff;border:1px solid #cbd5e1;border-radius:16px;padding:28px;box-shadow:0 12px 30px rgba(15,23,42,.08);text-align:center}
    .brand{font-size:40px;font-weight:900;letter-spacing:-1px;margin:0 0 8px}
    .c1{color:#0F4C81}.c2{color:#E11D48}.c3{color:#059669}
    h1{font-size:18px;margin:8px 0 10px}
    p{font-size:14px;line-height:1.7;color:#475569;margin:0 0 18px}
    .btn{display:inline-block;background:#0F4C81;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 26px;border-radius:10px}
    .btn:hover{background:#0c3c66}
    .tip{margin-top:18px;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;font-size:12px;color:#334155;line-height:1.6}
    .url{margin-top:10px;font-family:monospace;font-size:11px;color:#64748b;word-break:break-all}
  </style>
</head>
<body>
  <div class="card">
    <div class="brand"><span class="c1">C</span><span class="c2">r</span><span class="c3">m</span></div>
    <h1>${heading}</h1>
    <p>${desc}</p>
    <a class="btn" href="./Crm-Local.html">${btn}</a>
    <div class="tip">${tip}</div>
    <div class="url">${cloudNote}</div>
  </div>
</body>
</html>`;
}

export function buildReadmeText(appUrl: string): string {
  const cleanOrigin = normalizeOrigin(appUrl);
  return [
    '============================================================',
    '  Crm - Version Locale PC (Windows 11 / 10 / 07)',
    '  Crm - النسخة المحلية على الحاسوب بدون Google وبدون 403',
    '============================================================',
    '',
    '[Français - Utilisation locale sans Google et sans Erreur 403]',
    '1. Pour ouvrir le programme complet directement sur votre PC :',
    '   Double-cliquez sur : Crm.bat   (ou directement Crm-Local.html)',
    '2. Pour créer une icône Crm sur votre Bureau et Menu Démarrer :',
    '   Double-cliquez sur : Create-Desktop-Shortcut.bat',
    '3. Toutes vos données (équipements, retards, inventaire, rapports Word/Excel/PDF)',
    '   sont enregistrées localement sur ce PC et exportables en JSON à tout moment.',
    '',
    '[العربية - تشغيل محلي بدون Google وبدون خطأ 403]',
    '1. لفتح البرنامج الكامل مباشرة على حاسوبك في نافذة مستقلة:',
    '   اضغط مرتين على الملف: Crm.bat (أو مباشرة على Crm-Local.html)',
    '2. لإنشاء أيقونة اختصار للبرنامج على سطح المكتب وقائمة ابدأ:',
    '   اضغط مرتين على الملف: Create-Desktop-Shortcut.bat',
    '3. تحفظ جميع البيانات محلياً على جهازك مع إمكانية طباعة وتصدير Word و Excel و JSON.',
    '',
    `Cloud Web URL: ${cleanOrigin}/`,
    '',
  ].join('\r\n');
}

export async function buildInstallFilesPayload(lang: Language): Promise<InstalledFileEntry[]> {
  const appUrl = getAppOriginUrl();
  const files: InstalledFileEntry[] = [
    { name: 'Crm.bat', content: encodeUtf8(buildBatchLauncher(appUrl)) },
    {
      name: 'Create-Desktop-Shortcut.bat',
      content: encodeUtf8(buildShortcutInstallerBatch(appUrl)),
    },
    { name: 'Crm-Launcher.html', content: encodeUtf8(buildLocalHtmlLauncher(appUrl, lang)) },
    { name: 'Crm-Cloud.url', content: encodeUtf8(buildInternetShortcutFile(appUrl)) },
    { name: 'README.txt', content: encodeUtf8WithBom(buildReadmeText(appUrl)) },
  ];

  const [localBundleBytes, pngBytes] = await Promise.all([
    fetchLocalHtmlBundleBytes(appUrl),
    fetchPngIconBytes(),
  ]);

  if (localBundleBytes && localBundleBytes.length > 0) {
    files.unshift({ name: 'Crm-Local.html', content: localBundleBytes });
  }

  if (pngBytes && pngBytes.length > 0) {
    files.push({ name: 'pwa-192x192.png', content: pngBytes });
    files.push({ name: 'Crm.ico', content: buildIcoFromPng(pngBytes) });
  }

  return files;
}

// Standard CRC-32 & uncompressed Store ZIP generator (supports UTF-8 filenames via bit 11 flag)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) !== 0 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function buildZipArchive(entries: InstalledFileEntry[], rootPrefix = 'Crm/'): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  const now = new Date();
  const dosTime =
    ((now.getHours() & 0x1f) << 11) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getSeconds() >> 1) & 0x1f);
  const dosDate =
    (((Math.max(1980, now.getFullYear()) - 1980) & 0x7f) << 9) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (now.getDate() & 0x1f);

  for (const entry of entries) {
    const fileNameBytes = encodeUtf8(`${rootPrefix}${entry.name}`);
    const data = entry.content;
    const fileCrc = crc32(data);

    const localHeader = new Uint8Array(30 + fileNameBytes.length);
    const ldv = new DataView(localHeader.buffer);
    ldv.setUint32(0, 0x04034b50, true);
    ldv.setUint16(4, 20, true);
    ldv.setUint16(6, 0x0800, true);
    ldv.setUint16(8, 0, true);
    ldv.setUint16(10, dosTime, true);
    ldv.setUint16(12, dosDate, true);
    ldv.setUint32(14, fileCrc, true);
    ldv.setUint32(18, data.length, true);
    ldv.setUint32(22, data.length, true);
    ldv.setUint16(26, fileNameBytes.length, true);
    ldv.setUint16(28, 0, true);
    localHeader.set(fileNameBytes, 30);

    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + fileNameBytes.length);
    const cdv = new DataView(centralHeader.buffer);
    cdv.setUint32(0, 0x02014b50, true);
    cdv.setUint16(4, 20, true);
    cdv.setUint16(6, 20, true);
    cdv.setUint16(8, 0x0800, true);
    cdv.setUint16(10, 0, true);
    cdv.setUint16(12, dosTime, true);
    cdv.setUint16(14, dosDate, true);
    cdv.setUint32(16, fileCrc, true);
    cdv.setUint32(20, data.length, true);
    cdv.setUint32(24, data.length, true);
    cdv.setUint16(28, fileNameBytes.length, true);
    cdv.setUint16(30, 0, true);
    cdv.setUint16(32, 0, true);
    cdv.setUint16(34, 0, true);
    cdv.setUint16(36, 0, true);
    cdv.setUint32(38, 0, true);
    cdv.setUint32(42, offset, true);
    centralHeader.set(fileNameBytes, 46);

    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const centralDirOffset = offset;
  let centralDirSize = 0;
  for (const cp of centralParts) {
    centralDirSize += cp.length;
  }

  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralDirSize, true);
  ev.setUint32(16, centralDirOffset, true);
  ev.setUint16(20, 0, true);

  const totalSize = centralDirOffset + centralDirSize + eocd.length;
  const out = new Uint8Array(totalSize);
  let cursor = 0;
  for (const part of localParts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  for (const cp of centralParts) {
    out.set(cp, cursor);
    cursor += cp.length;
  }
  out.set(eocd, cursor);
  return out;
}

function saveLastInstalledFolderName(name: string): void {
  try {
    localStorage.setItem(`${DB_NAME}_${STORE_NAME}_${FOLDER_KEY}`, name);
  } catch {
    // Ignore storage error
  }
}

export function getLastInstalledFolderName(): string {
  try {
    return localStorage.getItem(`${DB_NAME}_${STORE_NAME}_${FOLDER_KEY}`) || '';
  } catch {
    return '';
  }
}

export async function installToComputerFolder(lang: Language): Promise<PcInstallResult> {
  if (
    typeof window === 'undefined' ||
    !('showDirectoryPicker' in window) ||
    typeof (window as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker !== 'function'
  ) {
    return { mode: 'folder', fileNames: [], unsupported: true };
  }

  try {
    const picker = (
      window as unknown as {
        showDirectoryPicker: (options?: {
          id?: string;
          mode?: 'read' | 'readwrite';
        }) => Promise<DirectoryHandleWithSubdir>;
      }
    ).showDirectoryPicker;

    const selectedDir = await picker({
      id: 'crm-install-folder',
      mode: 'readwrite',
    });

    const targetDir =
      selectedDir.name.toLowerCase() === 'crm'
        ? selectedDir
        : await selectedDir.getDirectoryHandle('Crm', { create: true });

    const files = await buildInstallFilesPayload(lang);
    for (const file of files) {
      const fh = await targetDir.getFileHandle(file.name, { create: true });
      const writable = await fh.createWritable();
      await writable.write(new Blob([new Uint8Array(file.content)]));
      await writable.close();
    }

    const displayFolder =
      selectedDir.name.toLowerCase() === 'crm'
        ? selectedDir.name
        : `${selectedDir.name}\\Crm`;
    saveLastInstalledFolderName(displayFolder);

    return {
      mode: 'folder',
      folderName: displayFolder,
      fileNames: files.map((f) => f.name),
      hasOfflineApp: files.some((f) => f.name === 'Crm-Local.html'),
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const msg = err instanceof Error ? err.message : '';
    if (name === 'AbortError') {
      return { mode: 'folder', fileNames: [], cancelled: true };
    }
    if (name === 'SecurityError' || msg.toLowerCase().includes('cross origin sub frame')) {
      return { mode: 'folder', fileNames: [], blockedByIframe: true };
    }
    return { mode: 'folder', fileNames: [], error: msg || 'install_folder_failed' };
  }
}

export async function downloadComputerInstallerZip(lang: Language): Promise<PcInstallResult> {
  const files = await buildInstallFilesPayload(lang);
  const zipBytes = buildZipArchive(files, 'Crm/');
  const blob = new Blob([new Uint8Array(zipBytes)], { type: 'application/zip' });
  triggerBlobDownload(blob, 'Crm-Windows-Setup.zip');
  return {
    mode: 'zip',
    folderName: 'Crm-Windows-Setup.zip',
    fileNames: files.map((f) => f.name),
    hasOfflineApp: files.some((f) => f.name === 'Crm-Local.html'),
  };
}

export async function downloadStandaloneHtmlApp(): Promise<PcInstallResult> {
  const appUrl = getAppOriginUrl();
  const bytes = await fetchLocalHtmlBundleBytes(appUrl);
  if (!bytes || bytes.length === 0) {
    return {
      mode: 'html',
      fileNames: [],
      hasOfflineApp: false,
      error: 'local_bundle_unavailable',
    };
  }
  const blob = new Blob([new Uint8Array(bytes)], { type: 'text/html;charset=utf-8' });
  triggerBlobDownload(blob, 'Crm-Local.html');
  return {
    mode: 'html',
    folderName: 'Crm-Local.html',
    fileNames: ['Crm-Local.html'],
    hasOfflineApp: true,
  };
}
