import * as path from 'path';
import { execSync } from 'child_process';

export type SkillUIBrowser = 'chromium' | 'chrome';

export interface PlaywrightBrowserOptions {
  browser?: SkillUIBrowser;
  headed?: boolean;
  cdpEndpoint?: string;
}

const defaultBrowserOptions: Required<Omit<PlaywrightBrowserOptions, 'cdpEndpoint'>> = {
  browser: 'chromium',
  headed: false,
};

let browserOptions: PlaywrightBrowserOptions = { ...defaultBrowserOptions };

export function configurePlaywrightBrowser(options: PlaywrightBrowserOptions = {}): void {
  browserOptions = {
    ...defaultBrowserOptions,
    ...options,
    cdpEndpoint: options.cdpEndpoint?.trim() || undefined,
  };
}

/**
 * Whether SkillUI is using a browser runtime that differs from the legacy
 * bundled headless Chromium path.
 */
export function hasCustomPlaywrightBrowser(): boolean {
  return (
    browserOptions.browser === 'chrome' ||
    !!browserOptions.headed ||
    !!browserOptions.cdpEndpoint
  );
}

export function loadPlaywright(): any | null {
  const playwright = loadRawPlaywright();
  if (!playwright) return null;

  if (!hasCustomPlaywrightBrowser()) return playwright;
  return wrapPlaywright(playwright);
}

function loadRawPlaywright(): any | null {
  try {
    return require('playwright');
  } catch {}

  try {
    const cwdPath = path.join(process.cwd(), 'node_modules', 'playwright');
    return require(cwdPath);
  } catch {}

  try {
    const globalRoot = execSync('npm root -g', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    return require(path.join(globalRoot, 'playwright'));
  } catch {}

  return null;
}

function wrapPlaywright(playwright: any): any {
  const chromium = playwright.chromium;

  const wrappedChromium = new Proxy(chromium, {
    get(target, prop) {
      if (prop === 'launch') {
        return async (launchOptions: Record<string, unknown> = {}) => {
          if (browserOptions.cdpEndpoint) {
            const connectedBrowser = await target.connectOverCDP(browserOptions.cdpEndpoint);
            return wrapConnectedBrowser(connectedBrowser);
          }

          const nextOptions: Record<string, unknown> = { ...launchOptions };
          if (browserOptions.browser === 'chrome') nextOptions.channel = 'chrome';
          if (browserOptions.headed) nextOptions.headless = false;
          return target.launch(nextOptions);
        };
      }

      return bindProperty(target, prop);
    },
  });

  return new Proxy(playwright, {
    get(target, prop) {
      if (prop === 'chromium') return wrappedChromium;
      return bindProperty(target, prop);
    },
  });
}

function wrapConnectedBrowser(browser: any): any {
  const createdPages = new Set<any>();

  return new Proxy(browser, {
    get(target, prop) {
      if (prop === 'newContext') {
        return async (contextOptions?: Record<string, unknown>) => {
          const existingContext = target.contexts()[0];
          if (existingContext) return wrapConnectedContext(existingContext, createdPages);
          const context = await target.newContext(contextOptions);
          return wrapConnectedContext(context, createdPages);
        };
      }

      if (prop === 'close') {
        return async (...args: unknown[]) => {
          for (const page of Array.from(createdPages)) {
            try {
              if (!page.isClosed?.()) await page.close();
            } catch {}
          }
          createdPages.clear();
          return target.close(...args);
        };
      }

      return bindProperty(target, prop);
    },
  });
}

function wrapConnectedContext(context: any, createdPages: Set<any>): any {
  return new Proxy(context, {
    get(target, prop) {
      if (prop === 'newPage') {
        return async () => {
          const page = await target.newPage();
          createdPages.add(page);
          page.once?.('close', () => createdPages.delete(page));
          return page;
        };
      }

      if (prop === 'pages') {
        return () => Array.from(createdPages).filter(page => !page.isClosed?.());
      }

      if (prop === 'close') {
        return async () => {};
      }

      return bindProperty(target, prop);
    },
  });
}

function bindProperty(target: any, prop: string | symbol): any {
  const value = Reflect.get(target, prop, target);
  return typeof value === 'function' ? value.bind(target) : value;
}
