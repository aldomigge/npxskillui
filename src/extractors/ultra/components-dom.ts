import type { ComponentStyleSnapshot } from '../../types';
import { DOMComponent } from '../../types-ultra';
import { loadPlaywright } from '../../playwright-loader';
import {
  classifyDOMCandidate,
  deriveDOMComponentName,
  type DOMCandidateSummary,
} from './component-classifier';

interface RawDOMGroup extends DOMCandidateSummary {
  pattern: string;
  instances: number;
  htmlSnippet: string;
  measuredStyle: ComponentStyleSnapshot;
}

/**
 * Ultra mode — Runtime Component Detector v2
 *
 * Detection separates observation from classification:
 * - browser: collect rendered structure, HTML/ARIA semantics, classes, ancestry
 * - node: classify with semantic HTML/ARIA first, class naming second
 *
 * PR #6 also records a representative default-state computed style for each
 * runtime group. These values are measured source evidence, not generated CSS.
 */
export async function detectDOMComponents(url: string): Promise<DOMComponent[]> {
  const playwright = loadPlaywright();
  if (!playwright) return [];

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

    const rawGroups = await page.evaluate(() => {
      type BrowserCandidate = {
        pattern: string;
        instances: number;
        tag: string;
        role?: string;
        classes: string[];
        ancestorTags: string[];
        ancestorRoles: string[];
        ariaLabel?: string;
        inputType?: string;
        htmlSnippet: string;
        semanticSignal: boolean;
        measuredStyle: {
          backgroundColor: string;
          backgroundImage: string;
          color: string;
          borderColor: string;
          borderStyle: string;
          borderWidth: string;
          borderRadius: string;
          padding: string;
          gap: string;
          boxShadow: string;
          textShadow: string;
          opacity: string;
          transform: string;
          filter: string;
          outline: string;
          outlineColor: string;
          textDecoration: string;
          transition: string;
          fontFamily: string;
          fontSize: string;
          fontWeight: string;
          lineHeight: string;
          letterSpacing: string;
          display: string;
          alignItems: string;
          justifyContent: string;
          width: string;
          height: string;
          cursor: string;
        };
      };

      function stableClasses(el: Element): string[] {
        return Array.from(el.classList)
          .filter(className => {
            if (/^(js-|is-|has-|data-|aria-)/.test(className)) return false;
            if (/^(hover:|focus:|active:|sm:|md:|lg:|xl:|2xl:)/.test(className)) return false;
            return className.length >= 3 && className.length <= 80 && /^[a-zA-Z]/.test(className);
          })
          .sort()
          .slice(0, 6);
      }

      function childStructure(el: Element): string {
        return Array.from(el.children)
          .slice(0, 5)
          .map(child => {
            const tag = child.tagName.toLowerCase();
            const role = child.getAttribute('role');
            const grandchildren = Array.from(child.children)
              .slice(0, 3)
              .map(grandchild => grandchild.tagName.toLowerCase())
              .join(',');
            return `${tag}${role ? `:${role}` : ''}{${grandchildren}}`;
          })
          .join(',');
      }

      function fingerprint(el: Element, classes: string[]): string {
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role') || '';
        const inputType = el instanceof HTMLInputElement ? el.type : '';
        const semanticKey = classes.length === 0
          ? (el.getAttribute('aria-label') || el.getAttribute('name') || '').trim().slice(0, 80)
          : '';
        return `${tag}|role=${role}|type=${inputType}|key=${semanticKey}[${classes.join('.')}](${childStructure(el)})`;
      }

      function htmlSnippet(el: Element): string {
        const clone = el.cloneNode(true) as Element;
        const children = clone.querySelectorAll('*');
        if (children.length > 12) {
          Array.from(children).slice(12).forEach(child => child.remove());
        }
        clone.querySelectorAll('*').forEach(node => {
          if (node.children.length === 0 && node.textContent && node.textContent.length > 40) {
            node.textContent = node.textContent.slice(0, 40) + '…';
          }
        });
        return clone.outerHTML.replace(/\s+/g, ' ').slice(0, 700);
      }

      function ancestry(el: Element): { tags: string[]; roles: string[] } {
        const tags: string[] = [];
        const roles: string[] = [];
        let parent = el.parentElement;
        let depth = 0;
        while (parent && depth < 5) {
          tags.push(parent.tagName.toLowerCase());
          const role = parent.getAttribute('role');
          if (role) roles.push(role);
          parent = parent.parentElement;
          depth++;
        }
        return { tags, roles };
      }

      function measuredStyle(el: Element) {
        const s = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
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
      }

      function hasSemanticSignal(el: Element, classes: string[]): boolean {
        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const classText = classes.join(' ').toLowerCase();
        if (['button', 'input', 'select', 'textarea', 'nav', 'table', 'dialog'].includes(tag)) return true;
        if (role && role !== 'presentation' && role !== 'none') return true;
        if (tag === 'li' && el.closest('nav,[role="navigation"],[role="menu"]')) return true;
        if (tag === 'a') {
          if (el.closest('nav,[role="navigation"],[role="menu"]')) return true;
          if (/navigation|(^|[_-])nav([_-]|$)|menu|tabs?/.test(classText)) return true;
        }
        return /badge|chip|pill|status/.test(classText);
      }

      const selector = [
        '[class]',
        '[role]',
        'a',
        'button',
        'input',
        'select',
        'textarea',
        'nav',
        'table',
        'dialog',
        'li',
      ].join(',');

      const groups = new Map<string, BrowserCandidate>();

      document.querySelectorAll(selector).forEach(el => {
        const tag = el.tagName.toLowerCase();
        if (['html', 'body', 'main', 'head', 'script', 'style', 'link', 'meta'].includes(tag)) return;

        const rect = el.getBoundingClientRect();
        const classes = stableClasses(el);
        const semanticSignal = hasSemanticSignal(el, classes);
        const minimumWidth = semanticSignal ? 8 : 40;
        const minimumHeight = semanticSignal ? 8 : 20;
        if (rect.width < minimumWidth || rect.height < minimumHeight) return;

        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return;

        const pattern = fingerprint(el, classes);
        const current = groups.get(pattern);
        if (current) {
          current.instances++;
          current.semanticSignal = current.semanticSignal || semanticSignal;
          return;
        }

        const ancestors = ancestry(el);
        groups.set(pattern, {
          pattern,
          instances: 1,
          tag,
          role: el.getAttribute('role') || undefined,
          classes,
          ancestorTags: ancestors.tags,
          ancestorRoles: ancestors.roles,
          ariaLabel: el.getAttribute('aria-label') || undefined,
          inputType: el instanceof HTMLInputElement ? el.type : undefined,
          htmlSnippet: htmlSnippet(el),
          semanticSignal,
          measuredStyle: measuredStyle(el),
        });
      });

      return [...groups.values()]
        .filter(group => group.instances >= 3 || group.semanticSignal)
        .sort((a, b) => b.instances - a.instances)
        .slice(0, 120)
        .map(({ semanticSignal: _semanticSignal, ...group }) => group);
    }) as RawDOMGroup[];

    const components = rawGroups
      .map(group => {
        const classification = classifyDOMCandidate(group);
        if (group.instances < classification.minimumInstances) return null;

        return {
          name: deriveDOMComponentName(group),
          pattern: group.pattern,
          instances: group.instances,
          commonClasses: group.classes,
          htmlSnippet: group.htmlSnippet,
          category: classification.category,
          tag: group.tag,
          role: group.role,
          confidence: classification.confidence,
          reasons: classification.reasons,
          measuredStyle: group.measuredStyle,
          styleFingerprint: fingerprintMeasuredStyle(group.measuredStyle),
          attributes: {
            ariaLabel: group.ariaLabel,
            ariaRole: group.role,
            inputType: group.inputType,
          },
        } satisfies DOMComponent;
      })
      .filter((component): component is DOMComponent => component !== null)
      .sort((a, b) => {
        const confidenceDiff = (b.confidence || 0) - (a.confidence || 0);
        return confidenceDiff !== 0 ? confidenceDiff : b.instances - a.instances;
      })
      .slice(0, 40);

    await page.close();
    await browser.close();

    return components;
  } catch {
    await browser.close().catch(() => {});
    return [];
  }
}

function fingerprintMeasuredStyle(style: ComponentStyleSnapshot): string {
  return [
    style.backgroundColor,
    style.backgroundImage,
    style.color,
    style.borderColor,
    style.borderWidth,
    style.borderRadius,
    style.padding,
    style.boxShadow,
    style.fontFamily,
    style.fontSize,
    style.fontWeight,
    style.lineHeight,
    style.display,
  ].join('|');
}
