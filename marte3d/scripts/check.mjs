// npm run check — abre la escena en Chrome headless (Chrome instalado, sin descargas),
// guarda check/captura.png y check/errores.txt. Sale con código 1 si hay errores.
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

const OUT = new URL('../check/', import.meta.url);
mkdirSync(OUT, { recursive: true });

let url = process.env.URL || 'http://localhost:5173/';
let server = null;
try {
  await fetch(url);
} catch {
  // No hay servidor dev corriendo: levantamos uno temporal.
  server = await createServer({ server: { port: 5199, strictPort: false } });
  await server.listen();
  url = server.resolvedUrls.local[0];
}

const browser = await chromium.launch({
  channel: 'chrome',
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });

const errors = [];
const warnings = [];
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console.error] ${m.text()}`);
  else if (m.type() === 'warning') warnings.push(`[console.warn] ${m.text()}`);
});
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => errors.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'load' });
try {
  await page.waitForFunction(() => window.__sceneReady === true, null, { timeout: 60000 });
} catch {
  errors.push('[check] La escena no indicó __sceneReady en 60 s');
}
await page.waitForTimeout(1500);
const shot = fileURLToPath(new URL('captura.png', OUT));
await page.screenshot({ path: shot });

const report = [
  `URL: ${url}`,
  `Fecha: ${new Date().toISOString()}`,
  `Errores (${errors.length}):`, ...errors.map((e) => '  ' + e),
  `Avisos (${warnings.length}):`, ...warnings.map((w) => '  ' + w),
].join('\n');
writeFileSync(new URL('errores.txt', OUT), report + '\n');
console.log(report);
console.log(`Captura: ${shot}`);
// Cerrar con límite de tiempo: en Windows el cierre de Chrome a veces se cuelga.
const timeout = (ms) => new Promise((r) => setTimeout(r, ms));
await Promise.race([browser.close(), timeout(5000)]);
if (server) await Promise.race([server.close(), timeout(5000)]);
process.exit(errors.length ? 1 : 0);
