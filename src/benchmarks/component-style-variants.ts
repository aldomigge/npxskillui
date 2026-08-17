import type { ComponentStyleSnapshot } from '../types';
import type { DOMComponent, InteractionRecord } from '../types-ultra';
import { domComponentToEvidence, mergeComponentEvidence } from '../extractors/component-evidence';
import { attachInteractionsToDOMComponents } from '../extractors/ultra/component-interactions';

function main(): void {
  const enabledStyle = styleSnapshot();
  const disabledStyle: ComponentStyleSnapshot = {
    ...enabledStyle,
    backgroundColor: 'rgb(64, 73, 90)',
    color: 'rgb(111, 111, 111)',
    cursor: 'not-allowed',
  };
  const hoverStyle: ComponentStyleSnapshot = {
    ...enabledStyle,
    backgroundColor: 'rgb(20, 152, 248)',
  };
  const focusStyle: ComponentStyleSnapshot = {
    ...enabledStyle,
    outline: 'rgb(255, 255, 255) none 0px',
  };

  const enabled: DOMComponent = {
    name: 'Button',
    pattern: 'enabled-button',
    instances: 1,
    commonClasses: ['Button_blue__abc', 'Button_btn__def', 'HeaderRightButtons_text-btn__ghi'],
    htmlSnippet: '<button>REGISTRAR</button>',
    category: 'button',
    tag: 'button',
    confidence: 0.98,
    measuredStyle: enabledStyle,
    styleFingerprint: 'enabled-style',
  };

  const disabled: DOMComponent = {
    name: 'Button',
    pattern: 'disabled-button',
    instances: 1,
    commonClasses: ['Button_blue__abc', 'Button_btn__def', 'Button_disabled__xyz'],
    htmlSnippet: '<button disabled>REGISTRAR</button>',
    category: 'button',
    tag: 'button',
    confidence: 0.98,
    measuredStyle: disabledStyle,
    styleFingerprint: 'disabled-style',
  };

  const interaction: InteractionRecord = {
    componentType: 'button',
    label: 'REGISTRAR',
    selector: 'button:nth-of-type(1)',
    index: 1,
    pageUrl: 'https://fixture.local/',
    nameHint: 'Button',
    tag: 'button',
    classes: ['Button_blue__abc', 'Button_btn__def', 'HeaderRightButtons_text-btn__ghi'],
    screenshots: {
      default: 'screens/states/button-1-default.png',
      hover: 'screens/states/button-1-hover.png',
      focus: 'screens/states/button-1-focus.png',
    },
    defaultStyles: enabledStyle,
    hoverStyles: hoverStyle,
    focusStyles: focusStyle,
    hoverChanges: [
      { property: 'backgroundColor', from: enabledStyle.backgroundColor, to: hoverStyle.backgroundColor },
    ],
    focusChanges: [
      { property: 'outline', from: enabledStyle.outline, to: focusStyle.outline },
    ],
    transitionValue: enabledStyle.transition,
  };

  const enriched = attachInteractionsToDOMComponents([enabled, disabled], [interaction]);
  const enabledResult = enriched.find(component => component.pattern === 'enabled-button')!;
  const disabledResult = enriched.find(component => component.pattern === 'disabled-button')!;

  let passed = 0;
  expectEqual(enabledResult.stateEvidence?.length, 2, 'enabled variant should receive hover/focus'); passed++;
  expectEqual(disabledResult.stateEvidence, undefined, 'disabled sibling variant must not receive enabled states'); passed++;
  expectEqual(
    enabledResult.stateEvidence?.every(state => state.pageUrl === 'https://fixture.local/'),
    true,
    'matched states should preserve their exact capture page'
  ); passed++;
  expectEqual(
    enabledResult.stateEvidence?.every(state => state.label?.includes('https://fixture.local/')),
    true,
    'rendered state labels should expose capture-page provenance'
  ); passed++;

  const merged = mergeComponentEvidence([], [
    domComponentToEvidence(enabledResult, 'https://fixture.local/'),
    domComponentToEvidence(disabledResult, 'https://fixture.local/'),
  ]);
  const canonical = merged[0];

  expectEqual(merged.length, 1, 'same canonical Button name should still normalize to one component'); passed++;
  expectEqual(canonical.measuredStyle, undefined, 'conflicting measured variants must not flatten into one default style'); passed++;
  expectEqual(canonical.stateEvidence, undefined, 'conflicting variants must not flatten their states together'); passed++;
  expectEqual(canonical.evidence?.length, 2, 'both measured variants must remain preserved as evidence'); passed++;
  expectEqual(canonical.evidence?.[0]?.stateEvidence?.length, 2, 'enabled evidence should retain its own states'); passed++;
  expectEqual(canonical.evidence?.[1]?.stateEvidence, undefined, 'disabled evidence should remain state-free'); passed++;

  console.log('Measured component variant isolation benchmark');
  console.log(`  variant isolation cases: ${passed}/10`);
  console.log('  state provenance cases:  2/2');
  console.log('  status:                 PASS');
}

function styleSnapshot(): ComponentStyleSnapshot {
  return {
    backgroundColor: 'rgb(0, 131, 231)',
    backgroundImage: 'none',
    color: 'rgb(255, 255, 255)',
    borderColor: 'rgb(0, 0, 0)',
    borderStyle: 'none',
    borderWidth: '0px',
    borderRadius: '10px',
    padding: '0px 70px',
    gap: 'normal',
    boxShadow: 'none',
    textShadow: 'none',
    opacity: '1',
    transform: 'none',
    filter: 'none',
    outline: 'rgb(255, 255, 255) none 3px',
    outlineColor: 'rgb(255, 255, 255)',
    textDecoration: 'none solid rgb(255, 255, 255)',
    transition: '0.2s ease-in-out',
    fontFamily: 'Arial',
    fontSize: '14px',
    fontWeight: '700',
    lineHeight: 'normal',
    letterSpacing: 'normal',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: '201.47px',
    height: '45px',
    cursor: 'pointer',
  };
}

function expectEqual<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`Benchmark failed: ${message}. Expected ${String(expected)}, got ${String(actual)}`);
  }
}

main();
