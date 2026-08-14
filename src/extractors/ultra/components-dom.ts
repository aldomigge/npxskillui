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
}

/**
 * Ultra mode — Runtime Component Detector v2
 *
 * Detection now separates observation from classification:
 * - browser: collect rendered structure, HTML/ARIA semantics, classes, ancestry
 * - node: classify with semantic HTML/ARIA first, class naming second
 *
 * High-confidence semantic controls may be retained even when unique. Generic
 * structural patterns still require repetition before they become candidates.
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
        return `${tag}|role=${role}|type=${inputType}[${classes.join('.')}](${childStructure(el)})`;
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

      function hasSemanticSignal(el: Element, classes: string[]): boolean {
        const tag = el.tagName.toLowerCase();
        const role = (el.getAttribute('role') || '').toLowerCase();
        const classText = classes.join(' ').toLowerCase();
        if (['button', 'input', 'select', 'textarea', 'nav', 'table', 'dialog', 'li'].includes(tag)) return true;
        if (role && role !== 'presentation' && role !== 'none') return true;
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
