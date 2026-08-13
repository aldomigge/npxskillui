import * as fs from 'fs';
import * as path from 'path';
import { hasCustomPlaywrightBrowser, loadPlaywright } from './playwright-loader';

/**
 * Capture the homepage screenshot.
 *
 * Backward compatibility:
 * - Legacy bundled headless Chromium flow: keep using microlink.io.
 * - Custom browser flow (Chrome, headed, or CDP): use the same configured
 *   Playwright runtime as the rest of the extraction pipeline.
 */
export async function captureScreenshot(
  url: string,
  skillDir: string
): Promise<string | null> {
  const screenshotsDir = path.join(skillDir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  if (hasCustomPlaywrightBrowser()) {
    return captureWithPlaywright(url, screenshotsDir);
  }

  return captureWithMicrolink(url, screenshotsDir);
}

async function captureWithPlaywright(
  url: string,
  screenshotsDir: string
): Promise<string | null> {
  const playwright = loadPlaywright();
  if (!playwright) return null;

  let browser: any = null;
  let page: any = null;

  try {
    browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    const destPath = path.join(screenshotsDir, 'homepage.png');
    await page.screenshot({ path: destPath, fullPage: true });
    return 'screenshots/homepage.png';
  } catch {
    return null;
  } finally {
    try { if (page && !page.isClosed?.()) await page.close(); } catch {}
    try { if (browser) await browser.close(); } catch {}
  }
}

async function captureWithMicrolink(
  url: string,
  screenshotsDir: string
): Promise<string | null> {
  try {
    const apiUrl = `https://api.microlink.io?url=${encodeURIComponent(url)}&screenshot=true&meta=false&embed=screenshot.url&waitFor=2000`;

    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'skillui/1.0' },
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';

    if (contentType.startsWith('image/')) {
      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.length < 1000) return null;
      const ext = contentType.includes('png') ? 'png' : 'jpg';
      const destPath = path.join(screenshotsDir, `homepage.${ext}`);
      fs.writeFileSync(destPath, buffer);
      return `screenshots/homepage.${ext}`;
    }

    const text = await res.text();
    try {
      const json = JSON.parse(text) as any;
      const screenshotUrl = json?.data?.screenshot?.url;
      if (!screenshotUrl) return null;

      const imgRes = await fetch(screenshotUrl, { signal: AbortSignal.timeout(20000) });
      if (!imgRes.ok) return null;
      const buffer = Buffer.from(await imgRes.arrayBuffer());
      if (buffer.length < 1000) return null;
      const destPath = path.join(screenshotsDir, 'homepage.jpg');
      fs.writeFileSync(destPath, buffer);
      return 'screenshots/homepage.jpg';
    } catch {
      return null;
    }
  } catch {
    return null;
  }
}
