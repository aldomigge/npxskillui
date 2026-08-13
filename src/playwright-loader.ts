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

/**
 * Configure how Playwright-backed extraction opens a browser.
 *
 * Defaults preserve the original behavior: bundled Chromium in headless mode.
 * When cdpEndpoint is set, calls to chromium.launch() are transparently routed
 * to an existing Chromium-based browser via connectOverCDP().
 */
export function configurePlaywrightBrowser(options: PlaywrightBrowserOptions = {}): void {
  browserOptions = {
    ...defaultBrowserOptions,
    ...options,
    cdpEndpoint: options.cdpEndpoint?.trim() || undefined,
  };
}

/**
 * Loads playwright from any location it might be installed:
 * 1. Bundled with the CLI (peer dep)
 * 2. In the user's cwd node_modules (local project install)
 * 3. In the global npm prefix (npm install -g playwright)
 *
 * Returns the playwright module or null if not found anywhere.
 */
export function loadPlaywright(): any | null {
  const playwright = loadRawPlaywright();
  if (!playwright) return null;

  const useDefaultChromium =
    browserOptions.browser === 'chromium' &&
    !browserOptions.headed &&
    !browserOptions.cdpEndpoint;

  // Preserve the original object and launch behavior when no opt-in browser
  // settings were requested.
  if (useDefaultChromium) return playwright;

  return wrapPlaywright(playwright);
}

function loadRawPlaywright(): any | null {
  // 1. Try standard require (works when playwright is in same node_modules tree)
  try {
    return require('playwright');
  } catch { /* fall through */ }

  // 2. Try from cwd (user ran: npm install playwright in their project)
  try {
    const cwdPath = path.join(process.cwd(), 'node_modules', 'playwright');
    return require(cwdPath);
  } catch { /* fall through */ }

  // 3. Try from global npm prefix (npm install -g playwright)
  try {
    const globalRoot = execSync('npm root -g', {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 5000,
    }).trim();
    return require(path.join(globalRoot, 'playwright'));
  } catch { /* fall through */ }

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

          if (browserOptions.browser === 'chrome') {
            nextOptions.channel = 'chrome';
          }

          if (browserOptions.headed) {
            nextOptions.headless = false;
          }

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

/**
 * Adapt a CDP-connected browser to the existing extractor contract.
 *
 * Existing extractors expect chromium.launch() to return a browser whose
 * newContext() creates an isolated context. For CDP we intentionally reuse the
 * browser's default context so cookies, sessions, extensions, and the real
 * browser environment remain available. browser.close() is left intact: for a
 * connected Playwright Browser it disconnects the client instead of shutting
 * down the externally-owned browser.
 */
function wrapConnectedBrowser(browser: any): any {
  return new Proxy(browser, {
    get(target, prop) {
      if (prop === 'newContext') {
        return async (contextOptions?: Record<string, unknown>) => {
          const existingContext = target.contexts()[0];
          if (existingContext) return wrapConnectedContext(existingContext);

          const context = await target.newContext(contextOptions);
          return wrapConnectedContext(context);
        };
      }

      return bindProperty(target, prop);
    },
  });
}

/**
 * Expose only pages created by the current extractor through context.pages().
 * This prevents legacy cleanup code from accidentally closing a user's
 * pre-existing Chrome tabs while still reusing the real default context.
 */
function wrapConnectedContext(context: any): any {
  const createdPages = new Set<any>();

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
        // The CDP default context belongs to the external browser and cannot be
        // closed independently. Pages created by SkillUI are closed explicitly.
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
