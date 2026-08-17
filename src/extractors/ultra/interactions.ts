import * as fs from 'fs';
import * as path from 'path';
import { InteractionRecord, StyleDiff, StyleSnapshot } from '../../types-ultra';
import { loadPlaywright } from '../../playwright-loader';
import {
  deriveDOMComponentName,
  type DOMCandidateSummary,
} from './component-classifier';

const TRACKED_PROPS: (keyof StyleSnapshot)[] = [
  'backgroundColor',
  'backgroundImage',
  'color',
  'borderColor',
  'borderWidth',
  'borderRadius',
  'boxShadow',
  'textShadow',
  'opacity',
  'transform',
  'filter',
  'outline',
  'outlineColor',
  'textDecoration',
  'cursor',
];

const INTERACTIVE_SELECTORS: Array<{
  type: InteractionRecord['componentType'];
  selector: string;
}> = [
  { type: 'button', selector: 'button:not([disabled])' },
  { type: 'role-button', selector: '[role="button"]:not([disabled])' },
  { type: 'link', selector: 'a[href]:not([href^="#"]):not([href^="mailto"])' },
  { type: 'input', selector: 'input:not([type="hidden"]):not([disabled])' },
];

/**
 * Ultra mode — Micro-Interaction Extractor
 *
 * Captures default/hover/focus computed styles plus enough semantic identity
 * (tag, role, stable classes, component name hint) to link each observation
 * back to Runtime Component Detector records.
 */
export async function captureInteractions(
  url: string,
  skillDir: string
): Promise<InteractionRecord[]> {
  const playwright = loadPlaywright();
  if (!playwright) return [];

  const statesDir = path.join(skillDir, 'screens', 'states');
  fs.mkdirSync(statesDir, { recursive: true });

  const records: InteractionRecord[] = [];

  const browser = await playwright.chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(3000);

    for (const { type, selector } of INTERACTIVE_SELECTORS) {
      try {
        // Find up to 3 visible elements of this type.
        const elements = await page.locator(selector).all();
        const visible = [];
        for (const el of elements) {
          try {
            const box = await el.boundingBox();
            if (box && box.width > 0 && box.height > 0 && box.width < 800) {
              visible.push(el);
              if (visible.length >= 3) break;
            }
          } catch { /* skip */ }
        }

        for (let i = 0; i < visible.length; i++) {
          const el = visible[i];
          const prefix = `${type}-${i + 1}`;

          try {
            const identity = await el.evaluate((node: Element) => {
              const stableClasses = Array.from(node.classList)
                .filter(className => {
                  if (/^(js-|is-|has-|data-|aria-)/.test(className)) return false;
                  if (/^(hover:|focus:|active:|sm:|md:|lg:|xl:|2xl:)/.test(className)) return false;
                  return className.length >= 3 && className.length <= 80 && /^[a-zA-Z]/.test(className);
                })
                .sort()
                .slice(0, 6);

              const ancestorTags: string[] = [];
              const ancestorRoles: string[] = [];
              let parent = node.parentElement;
              let depth = 0;
              while (parent && depth < 5) {
                ancestorTags.push(parent.tagName.toLowerCase());
                const parentRole = parent.getAttribute('role');
                if (parentRole) ancestorRoles.push(parentRole);
                parent = parent.parentElement;
                depth++;
              }

              const label = (node as HTMLElement).innerText?.trim()
                || node.getAttribute('aria-label')
                || node.getAttribute('placeholder')
                || node.getAttribute('type')
                || node.tagName.toLowerCase();

              return {
                label: label.slice(0, 40),
                tag: node.tagName.toLowerCase(),
                role: node.getAttribute('role') || undefined,
                classes: stableClasses,
                ancestorTags,
                ancestorRoles,
                ariaLabel: node.getAttribute('aria-label') || undefined,
                inputType: node instanceof HTMLInputElement ? node.type : undefined,
              };
            });

            const summary: DOMCandidateSummary = {
              tag: identity.tag,
              role: identity.role,
              classes: identity.classes,
              ancestorTags: identity.ancestorTags,
              ancestorRoles: identity.ancestorRoles,
              ariaLabel: identity.ariaLabel,
              inputType: identity.inputType,
            };
            const nameHint = deriveDOMComponentName(summary);

            // ── Default state ─────────────────────────────────────
            const defaultStyles = await getStyles(el);
            const defaultFile = `${prefix}-default.png`;
            await screenshotElement(el, path.join(statesDir, defaultFile));

            // ── Hover state ───────────────────────────────────────
            let hoverStyles: StyleSnapshot | null = null;
            let hoverFile: string | undefined;
            try {
              await el.hover({ force: true, timeout: 3000 });
              await page.waitForTimeout(300);
              hoverStyles = await getStyles(el);
              hoverFile = `${prefix}-hover.png`;
              await screenshotElement(el, path.join(statesDir, hoverFile));
              await page.mouse.move(0, 0);
              await page.waitForTimeout(200);
            } catch { /* hover not supported */ }

            // ── Focus state ───────────────────────────────────────
            let focusStyles: StyleSnapshot | null = null;
            let focusFile: string | undefined;
            try {
              await el.focus({ timeout: 3000 });
              await page.waitForTimeout(300);
              focusStyles = await getStyles(el);
              focusFile = `${prefix}-focus.png`;
              await screenshotElement(el, path.join(statesDir, focusFile));
              await page.evaluate(() => (document.activeElement as HTMLElement)?.blur?.());
              await page.waitForTimeout(200);
            } catch { /* focus not supported */ }

            const hoverChanges = hoverStyles
              ? diffStyles(defaultStyles, hoverStyles)
              : [];
            const focusChanges = focusStyles
              ? diffStyles(defaultStyles, focusStyles)
              : [];

            records.push({
              componentType: type,
              label: identity.label || type,
              selector: `${selector}:nth-of-type(${i + 1})`,
              index: i + 1,
              nameHint,
              tag: identity.tag,
              role: identity.role,
              classes: identity.classes,
              ariaLabel: identity.ariaLabel,
              screenshots: {
                default: `screens/states/${defaultFile}`,
                hover: hoverFile ? `screens/states/${hoverFile}` : undefined,
                focus: focusFile ? `screens/states/${focusFile}` : undefined,
              },
              defaultStyles,
              hoverStyles: hoverStyles || undefined,
              focusStyles: focusStyles || undefined,
              hoverChanges,
              focusChanges,
              transitionValue: defaultStyles.transition,
            });
          } catch { /* element failed — skip */ }
        }
      } catch { /* selector failed — skip */ }
    }

    await page.close();
  } finally {
    await browser.close().catch(() => {});
  }

  return records;
}

async function getStyles(el: any): Promise<StyleSnapshot> {
  return el.evaluate((node: Element) => {
    const s = window.getComputedStyle(node);
    const rect = node.getBoundingClientRect();
    return {
      backgroundColor: s.backgroundColor,
      backgroundImage: s.backgroundImage,
      color: s.color,
      borderColor: s.borderColor,
      borderStyle: s.borderStyle,
      borderWidth: s.borderWidth,
      borderRadius: s.borderRadius,
      padding: s.padding,
      gap: s.gap,
      boxShadow: s.boxShadow,
      textShadow: s.textShadow,
      opacity: s.opacity,
      transform: s.transform,
      filter: s.filter,
      outline: s.outline,
      outlineColor: s.outlineColor,
      textDecoration: s.textDecoration,
      transition: s.transition,
      fontFamily: s.fontFamily,
      fontSize: s.fontSize,
      fontWeight: s.fontWeight,
      lineHeight: s.lineHeight,
      letterSpacing: s.letterSpacing,
      display: s.display,
      alignItems: s.alignItems,
      justifyContent: s.justifyContent,
      width: `${Math.round(rect.width * 100) / 100}px`,
      height: `${Math.round(rect.height * 100) / 100}px`,
      cursor: s.cursor,
    };
  });
}

async function screenshotElement(el: any, filePath: string): Promise<void> {
  try {
    await el.screenshot({ path: filePath });
  } catch {
    // Element screenshot failed — ignore
  }
}

function diffStyles(before: StyleSnapshot, after: StyleSnapshot): StyleDiff[] {
  const diffs: StyleDiff[] = [];
  for (const prop of TRACKED_PROPS) {
    const b = before[prop] || '';
    const a = after[prop] || '';
    if (b !== a && a !== '') {
      diffs.push({ property: prop, from: b, to: a });
    }
  }
  return diffs;
}
