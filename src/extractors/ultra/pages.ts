import * as fs from 'fs';
import * as path from 'path';
import { PageScreenshot, SectionScreenshot } from '../../types-ultra';
import { loadPlaywright } from '../../playwright-loader';
import { normalizeDiscoveryUrl, stabilizePageForDiscovery } from './discovery';

/**
 * Ultra mode — Page & Section Screenshots
 *
 * 1. Crawl up to `maxPages` safe internal links from the origin URL
 * 2. Perform bounded scroll/lazy-load stabilization on each page
 * 3. Take a full-page screenshot for each (screens/pages/[slug].png)
 * 4. Detect major sections and clip one screenshot per section
 *
 * The successfully captured page list is also reused by the runtime component
 * discovery pipeline, so screenshot crawling and component crawling cannot
 * silently drift into two different page corpora.
 */
export async function capturePageScreenshots(
  originUrl: string,
  skillDir: string,
  maxPages: number
): Promise<{ pages: PageScreenshot[]; sections: SectionScreenshot[] }> {
  const playwright = loadPlaywright();
  if (!playwright) return { pages: [], sections: [] };

  const pagesDir = path.join(skillDir, 'screens', 'pages');
  const sectionsDir = path.join(skillDir, 'screens', 'sections');
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.mkdirSync(sectionsDir, { recursive: true });

  const pages: PageScreenshot[] = [];
  const sections: SectionScreenshot[] = [];

  const browser = await playwright.chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });

  try {
    const origin = new URL(originUrl).origin;
    const visited = new Set<string>();
    const queue: string[] = [originUrl];
    const limit = Math.max(1, maxPages || 1);

    while (queue.length > 0 && pages.length < limit) {
      const requestedUrl = queue.shift()!;
      const normalized = normalizeDiscoveryUrl(requestedUrl);
      if (visited.has(normalized)) continue;
      visited.add(normalized);

      let page: any | undefined;
      try {
        page = await context.newPage();
        await page.goto(requestedUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        await page.waitForTimeout(1200);

        const discovery = await stabilizePageForDiscovery(page);
        const resolvedUrl = page.url() || requestedUrl;
        const slug = urlToSlug(resolvedUrl);
        const pageFile = path.join(pagesDir, `${slug}.png`);

        // Full-page screenshot after lazy content has had a bounded discovery pass.
        await page.screenshot({ path: pageFile, fullPage: true });
        const title = await page.title().catch(() => slug);

        pages.push({
          url: resolvedUrl,
          slug,
          filePath: `screens/pages/${slug}.png`,
          title: title || slug,
          discovery,
        });

        // Section screenshots
        const sectionData = await page.evaluate(() => {
          const SECTION_SELECTORS = [
            'section',
            'article',
            'header',
            'footer',
            'nav',
            'main > div',
            'main > section',
            '[class*="section"]',
            '[class*="hero"]',
            '[class*="features"]',
            '[class*="pricing"]',
            '[class*="testimonial"]',
            '[class*="faq"]',
            '[class*="cta"]',
          ];

          const candidates: Array<{
            selector: string;
            rect: { x: number; y: number; width: number; height: number };
          }> = [];

          for (const sel of SECTION_SELECTORS) {
            const els = document.querySelectorAll(sel);
            els.forEach((el) => {
              const rect = el.getBoundingClientRect();
              const scrollTop = window.scrollY || document.documentElement.scrollTop;
              if (rect.width >= window.innerWidth * 0.6 && rect.height >= 200) {
                candidates.push({
                  selector: sel,
                  rect: {
                    x: Math.max(0, rect.left),
                    y: Math.max(0, rect.top + scrollTop),
                    width: Math.min(rect.width, 1440),
                    height: Math.min(rect.height, 1200),
                  },
                });
              }
            });
          }

          const deduped: typeof candidates = [];
          for (const candidate of candidates) {
            const overlap = deduped.some(
              existing => Math.abs(existing.rect.y - candidate.rect.y) < 50
            );
            if (!overlap) deduped.push(candidate);
          }

          return deduped.slice(0, 10);
        });

        for (let i = 0; i < sectionData.length; i++) {
          const sec = sectionData[i];
          const secFile = `${slug}-section-${i + 1}.png`;
          const secPath = path.join(sectionsDir, secFile);

          try {
            await page.screenshot({
              path: secPath,
              clip: {
                x: sec.rect.x,
                y: sec.rect.y,
                width: sec.rect.width,
                height: sec.rect.height,
              },
            });
            sections.push({
              page: slug,
              index: i + 1,
              filePath: `screens/sections/${secFile}`,
              selector: sec.selector,
              height: Math.round(sec.rect.height),
              width: Math.round(sec.rect.width),
            });
          } catch {
            // Section clip failed — skip without losing the page.
          }
        }

        // Discover safe internal links only after stabilization so lazy nav/content
        // can contribute routes. Query/hash-only variants are deduplicated later.
        if (pages.length < limit) {
          const links = await page.evaluate((pageOrigin: string) => {
            const unsafePath = /\/(logout|log-out|signout|sign-out|delete|remove|disconnect|api)(\/|$)/i;
            const assetPath = /\.(pdf|zip|png|jpe?g|webp|gif|svg|ico|css|js|xml|json|txt|mp4|webm|woff2?|ttf|otf)$/i;

            return Array.from(document.querySelectorAll('a[href]'))
              .map(anchor => (anchor as HTMLAnchorElement).href)
              .filter(href => {
                try {
                  const url = new URL(href);
                  return url.origin === pageOrigin
                    && /^https?:$/.test(url.protocol)
                    && !assetPath.test(url.pathname)
                    && !unsafePath.test(url.pathname)
                    && !url.hash;
                } catch {
                  return false;
                }
              })
              .slice(0, 40);
          }, origin);

          for (const link of links) {
            const key = normalizeDiscoveryUrl(link);
            const queued = queue.some(candidate => normalizeDiscoveryUrl(candidate) === key);
            if (!visited.has(key) && !queued) queue.push(link);
          }
        }
      } catch {
        // Page failed — continue with next internal route.
      } finally {
        try {
          if (page && !page.isClosed?.()) await page.close();
        } catch {}
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  return { pages, sections };
}

function urlToSlug(url: string): string {
  try {
    const parsed = new URL(url);
    const rel = parsed.pathname.replace(/^\//, '').replace(/\/$/, '') || 'home';
    return rel
      .replace(/[^a-zA-Z0-9/]/g, '-')
      .replace(/\//g, '--')
      .replace(/-{2,}/g, '-')
      .slice(0, 60) || 'home';
  } catch {
    return 'home';
  }
}
