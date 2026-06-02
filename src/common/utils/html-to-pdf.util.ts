import { existsSync } from 'fs';
import puppeteer, { type Browser } from 'puppeteer-core';

let browserPromise: Promise<Browser> | null = null;

function chromiumCandidates(): string[] {
  if (process.platform === 'win32') {
    return [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    ];
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  }
  return [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
}

export function resolveChromiumExecutable(): string {
  const fromEnv = process.env.PUPPETEER_EXECUTABLE_PATH?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  for (const path of chromiumCandidates()) {
    if (existsSync(path)) return path;
  }
  throw new Error(
    'PDF export requires Google Chrome or Microsoft Edge. Install a browser or set PUPPETEER_EXECUTABLE_PATH to its executable.',
  );
}

function launchBrowser(): Promise<Browser> {
  return puppeteer.launch({
    headless: true,
    executablePath: resolveChromiumExecutable(),
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    browserPromise = launchBrowser();
  }
  return browserPromise;
}

export type HtmlToPdfOptions = {
  format?: 'A4' | 'Letter';
  printBackground?: boolean;
  preferCSSPageSize?: boolean;
};

/** Renders self-contained HTML (inline styles, data-URI images) to a PDF buffer. */
export async function renderHtmlToPdfBuffer(
  html: string,
  options: HtmlToPdfOptions = {},
): Promise<Buffer> {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 60_000 });
    const pdf = await page.pdf({
      format: options.format ?? 'A4',
      printBackground: options.printBackground ?? true,
      preferCSSPageSize: options.preferCSSPageSize ?? true,
    });
    return Buffer.from(pdf);
  } finally {
    await page.close();
  }
}

/** Close shared Chromium instance (e.g. on app shutdown). */
export async function closeHtmlToPdfBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise;
  browserPromise = null;
  await browser.close();
}
