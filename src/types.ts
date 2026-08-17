// ── Core Design Profile ──────────────────────────────────────────────

export interface DesignProfile {
  projectName: string;
  siteUrl?: string;
  favicon?: string | null;
  frameworks: Framework[];
  colors: ColorToken[];
  typography: TypographyToken[];
  spacing: SpacingScale;
  shadows: ShadowToken[];
  components: ComponentInfo[];
  breakpoints: Breakpoint[];
  cssVariables: CSSVariable[];
  borderRadius: string[];
  fontVarMap: Record<string, string>;
  antiPatterns: string[];
  designTraits: DesignTraits;
  animations: AnimationToken[];
  darkModeVars: DarkModeVar[];
  iconLibrary: string | null;
  stateLibrary: string | null;
  componentCategories: Record<ComponentCategory, string[]>;
  zIndexScale: number[];
  containerMaxWidth: string | null;
  fontSources: FontSource[];
  pageSections: PageSection[];
  motionTokens: MotionTokens;
}

export interface DesignTraits {
  isDark: boolean;
  hasShadows: boolean;
  hasGradients: boolean;
  hasRoundedFull: boolean;
  maxBorderRadius: number;
  primaryColorTemp: 'warm' | 'cool' | 'neutral';
  fontStyle: 'serif' | 'sans-serif' | 'monospace';
  density: 'compact' | 'standard' | 'spacious';
  hasAnimations: boolean;
  hasDarkMode: boolean;
  motionStyle: 'none' | 'subtle' | 'expressive';
}

export type ComponentCategory =
  | 'layout'
  | 'navigation'
  | 'data-display'
  | 'data-input'
  | 'feedback'
  | 'overlay'
  | 'typography'
  | 'media'
  | 'other';

export type ComponentEvidenceSource = 'source-code' | 'http-dom' | 'runtime-dom';

/** Representative computed style values measured from a rendered component. */
export interface ComponentStyleSnapshot {
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
}

export interface ComponentStyleDiff {
  property: string;
  from: string;
  to: string;
}

export interface ComponentStateEvidence {
  state: 'hover' | 'focus';
  style: ComponentStyleSnapshot;
  changes: ComponentStyleDiff[];
  screenshot?: string;
  label?: string;
  selector?: string;
  /** Exact page where this interaction state was measured. */
  pageUrl?: string;
}

/**
 * One independently observed piece of evidence that a UI component exists.
 *
 * Evidence is intentionally kept separate from ComponentInfo. Extractors can
 * contribute observations without having to agree on the final component name
 * or representation. The evidence pipeline is responsible for merging and
 * deduplicating those observations into ComponentInfo records.
 */
export interface ComponentEvidence {
  source: ComponentEvidenceSource;
  pageUrl?: string;
  selector?: string;
  tag?: string;
  role?: string;
  nameHint?: string;
  kindHint?: string;
  categoryHint?: ComponentCategory;
  classes: string[];
  attributes?: {
    ariaLabel?: string;
    ariaRole?: string;
    dataTestId?: string;
  };
  instances: number;
  structureFingerprint: string;
  styleFingerprint?: string;
  /** Representative default-state computed style measured at runtime. */
  measuredStyle?: ComponentStyleSnapshot;
  /** Hover/focus states matched back to this runtime observation. */
  stateEvidence?: ComponentStateEvidence[];
  htmlSnippet?: string;
  /** Confidence in this individual observation, from 0 to 1. */
  confidence: number;
  reasons: string[];
}

export interface AnimationToken {
  name: string;
  type: 'css-keyframe' | 'css-transition' | 'framer-motion' | 'spring';
  value: string;
  source: string;
}

export interface DarkModeVar {
  variable: string;
  lightValue: string;
  darkValue: string;
}

export type FrameworkId =
  | 'tailwind'
  | 'react'
  | 'vue'
  | 'next'
  | 'nuxt'
  | 'svelte'
  | 'angular'
  | 'css-in-js'
  | 'css-modules';

export interface Framework {
  id: FrameworkId;
  name: string;
  version?: string;
}

export type ColorRole =
  | 'background'
  | 'surface'
  | 'text-primary'
  | 'text-muted'
  | 'accent'
  | 'border'
  | 'danger'
  | 'success'
  | 'warning'
  | 'info'
  | 'unknown';

export interface ColorToken {
  hex: string;
  name?: string;
  role: ColorRole;
  frequency: number;
  source: 'tailwind' | 'css' | 'tokens-file' | 'component' | 'computed';
}

export type TypographyRole =
  | 'heading-1'
  | 'heading-2'
  | 'heading-3'
  | 'heading-4'
  | 'body'
  | 'caption'
  | 'code'
  | 'unknown';

export interface TypographyToken {
  role: TypographyRole;
  fontFamily: string;
  fontSize?: string;
  fontWeight?: string | number;
  lineHeight?: string;
  source: 'tailwind' | 'css' | 'tokens-file' | 'component' | 'computed';
}

export interface SpacingScale {
  base: number;
  values: number[];
  unit: 'px' | 'rem';
}

export type ShadowLevel = 'flat' | 'raised' | 'floating' | 'overlay';

export interface ShadowToken {
  value: string;
  level: ShadowLevel;
  name?: string;
}

export interface ComponentInfo {
  name: string;
  filePath: string;
  variants: string[];
  cssClasses: string[];
  jsxSnippet: string;
  props: string[];
  category: ComponentCategory;
  hasAnimation: boolean;
  animationDetails: string[];
  statePatterns: string[];
  tailwindPatterns: TailwindPattern;
  /** Highest observed instance count for this component on one page. */
  instances?: number;
  /** Pages where runtime/HTTP evidence for this component was observed. */
  pages?: string[];
  /** Aggregate confidence from the strongest evidence, from 0 to 1. */
  confidence?: number;
  /** Strongest representative default-state computed style. */
  measuredStyle?: ComponentStyleSnapshot;
  /** Runtime hover/focus evidence matched to this normalized component. */
  stateEvidence?: ComponentStateEvidence[];
  /** Provenance used to build this normalized component record. */
  evidence?: ComponentEvidence[];
}

export interface TailwindPattern {
  backgrounds: string[];
  borders: string[];
  spacing: string[];
  typography: string[];
  effects: string[];
  layout: string[];
  interactive: string[];
}

export interface Breakpoint {
  name: string;
  value: string;
  source: 'tailwind' | 'css';
}

export interface CSSVariable {
  name: string;
  value: string;
  property?: string;
}

export interface RawTokens {
  colors: Array<{ value: string; frequency: number; source: ColorToken['source']; name?: string }>;
  fonts: Array<{ family: string; size?: string; weight?: string | number; source: TypographyToken['source'] }>;
  spacingValues: number[];
  shadows: Array<{ value: string; name?: string }>;
  cssVariables: CSSVariable[];
  breakpoints: Breakpoint[];
  borderRadii: string[];
  gradients: string[];
  fontVarMap: Record<string, string>;
  animations: AnimationToken[];
  darkModeVars: DarkModeVar[];
  zIndexValues: number[];
  containerMaxWidth: string | null;
  fontSources: FontSource[];
  pageSections: PageSection[];
  transitionDurations: string[];
  transitionEasings: string[];
  favicon?: string | null;
  siteTitle?: string | null;
}

export interface FontSource {
  family: string;
  src: string;
  format?: string;
  weight?: string;
}

export interface PageSection {
  type: 'navigation' | 'hero' | 'features' | 'content' | 'cards' | 'faq' | 'footer' | 'cta' | 'stats' | 'testimonials';
  tag: string;
  classes: string[];
  childCount: number;
  description: string;
}

export interface MotionTokens {
  durations: string[];
  easings: string[];
  properties: string[];
}

export interface CLIOptions {
  dir?: string;
  repo?: string;
  url?: string;
  out: string;
  name?: string;
  skill: boolean;
  format: 'design-md' | 'skill' | 'both';
  mode: 'default' | 'ultra';
  screens: string;
  browser: 'chromium' | 'chrome';
  headed: boolean;
  cdpEndpoint?: string;
  agent: 'claude' | 'codex' | 'both';
}
