import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const outTmpDir = path.resolve(rootDir, '.local-build-tmp');
const publicOutFile = path.resolve(rootDir, 'public/Crm-Local.html');

async function buildStandaloneHtml() {
  fs.rmSync(outTmpDir, { recursive: true, force: true });

  await build({
    configFile: false,
    root: rootDir,
    plugins: [react(), tailwindcss()],
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    build: {
      outDir: outTmpDir,
      emptyOutDir: true,
      minify: 'esbuild',
      cssCodeSplit: false,
      assetsInlineLimit: 100_000_000,
      lib: {
        entry: path.resolve(rootDir, 'src/localEntry.tsx'),
        name: 'CrmLocalApp',
        formats: ['iife'],
        fileName: () => 'crm-local.iife.js',
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          assetFileNames: (assetInfo) =>
            assetInfo.name && assetInfo.name.endsWith('.css') ? 'crm-local.css' : '[name][extname]',
        },
      },
    },
    logLevel: 'warn',
  });

  const files = fs.readdirSync(outTmpDir);
  const jsFile = files.find((f) => f.endsWith('.js'));
  const cssFile = files.find((f) => f.endsWith('.css'));

  if (!jsFile) {
    throw new Error('Failed to generate IIFE JS bundle for Crm-Local.html');
  }

  const jsCode = fs
    .readFileSync(path.join(outTmpDir, jsFile), 'utf8')
    .replace(/<\/script/gi, '<\\/script');
  const cssCode = cssFile
    ? fs.readFileSync(path.join(outTmpDir, cssFile), 'utf8').replace(/<\/style/gi, '<\\/style')
    : '';

  // Embed inline SVG favicon cleanly so it works offline from file://
  const iconSvgPath = path.resolve(rootDir, 'public/icon.svg');
  let faviconDataUri = '';
  if (fs.existsSync(iconSvgPath)) {
    const svgBase64 = fs.readFileSync(iconSvgPath).toString('base64');
    faviconDataUri = `data:image/svg+xml;base64,${svgBase64}`;
  }

  const buildOrigin = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  const escapedBuildOrigin = buildOrigin.replace(/"/g, '&quot;');

  const html = `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="crm-local-edition" content="1" />
  ${escapedBuildOrigin ? `<meta name="crm-cloud-url" content="${escapedBuildOrigin}" />` : ''}
  <title>Crm — Local Desktop Edition</title>
  ${faviconDataUri ? `<link id="crm-local-bundle-icon" rel="icon" type="image/svg+xml" href="${faviconDataUri}" />` : ''}
  <style id="crm-local-bundle-style">${cssCode}</style>
</head>
<body class="bg-slate-50 text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
  <div id="root"></div>
  <script id="crm-local-bundle-script">${jsCode}</script>
</body>
</html>
`;

  fs.mkdirSync(path.dirname(publicOutFile), { recursive: true });
  fs.writeFileSync(publicOutFile, html, 'utf8');
  fs.rmSync(outTmpDir, { recursive: true, force: true });

  const sizeKb = (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1);
  console.log(`Built standalone Crm-Local.html (${sizeKb} KB)`);
}

buildStandaloneHtml().catch((err) => {
  console.error(err);
  process.exit(1);
});
