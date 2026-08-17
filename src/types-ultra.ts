import type {
  ComponentStateEvidence,
  ComponentStyleDiff,
  ComponentStyleSnapshot,
} from './types';

// ── Ultra Mode Types ─────────────────────────────────────────────────

export interface UltraOptions {
  /** Max pages to crawl (default: 5) */
  screens: number;
}

// ── Runtime discovery ────────────────────────────────────────────────

export interface PageDiscoveryStats {
  beforeElementCount: number;
  afterElementCount: number;
  beforeHeight: number;
  afterHeight: number;
  scrollPasses: number;
  grew: boolean;
}

export interface RuntimeDiscoveryPage {
  url: string;
  componentCount: number;
  discovery: PageDiscoveryStats;
}

// ── Screenshots ─────────────────────────────────────────────────────

export interface PageScreenshot {
  url: string;
  slug: string;
  /** Relative path inside skillDir: screens/pages/[slug].png */
  filePath: string;
  title: string;
  /** Bounded scroll/lazy-load stabilization performed before capture. */
  discovery?: PageDiscoveryStats;
}

export interface SectionScreenshot {
  page: string;
  index: number;
  /** Relative path inside skillDir: screens/sections/[page]-section-[index].png */
  filePath: string;
  selector: string;
  height: number;
  width: number;
}

// ── Interactions ─────────────────────────────────────────────────────

export type StyleSnapshot = ComponentStyleSnapshot;
export type StyleDiff = ComponentStyleDiff;

export interface InteractionRecord {
  componentType: 'button' | 'link' | 'input' | 'role-button';
  label: string;
  selector: string;
  index: number;
  /** Exact page where this interaction was captured. */
  pageUrl?: string;
  /** Stable identity signals used to link this interaction to DOMComponent. */
  nameHint?: string;
  tag?: string;
  role?: string;
  classes: string[];
  ariaLabel?: string;
  screenshots: {
    default?: string;
    hover?: string;
    focus?: string;
  };
  defaultStyles: StyleSnapshot;
  hoverStyles?: StyleSnapshot;
  focusStyles?: StyleSnapshot;
  hoverChanges: StyleDiff[];
  focusChanges: StyleDiff[];
  transitionValue: string;
}

// ── Layout ───────────────────────────────────────────────────────────

export interface LayoutRecord {
  tag: string;
  selector: string;
  display: string;
  flexDirection: string;
  flexWrap: string;
  justifyContent: string;
  alignItems: string;
  gap: string;
  rowGap: string;
  columnGap: string;
  padding: string;
  margin: string;
  gridTemplateColumns: string;
  gridTemplateRows: string;
  maxWidth: string;
  width: string;
  height: string;
  position: string;
  childCount: number;
  depth: number;
}

// ── DOM Components ───────────────────────────────────────────────────

export type DOMComponentCategory =
  | 'card'
  | 'list-item'
  | 'nav-item'
  | 'navigation'
  | 'form-field'
  | 'button'
  | 'badge'
  | 'table'
  | 'dialog'
  | 'unknown';

export interface DOMComponent {
  name: string;
  pattern: string;
  /** Highest instance count observed on one page. */
  instances: number;
  commonClasses: string[];
  htmlSnippet: string;
  category: DOMComponentCategory;
  /** Representative rendered tag for this structural pattern. */
  tag?: string;
  /** Explicit ARIA role when present. */
  role?: string;
  /** Confidence assigned by Runtime Component Detector v2. */
  confidence?: number;
  /** Human-readable evidence that produced the classification. */
  reasons?: string[];
  /** Representative default-state computed style from the rendered DOM. */
  measuredStyle?: ComponentStyleSnapshot;
  /** Stable fingerprint of the measured style subset. */
  styleFingerprint?: string;
  /** Hover/focus observations matched back from the interaction extractor. */
  stateEvidence?: ComponentStateEvidence[];
  /** Normalized pages where this exact structure/style observation appeared. */
  pages?: string[];
  /** Sum of instances across page observations; does not replace per-page max. */
  totalInstances?: number;
  attributes?: {
    ariaLabel?: string;
    ariaRole?: string;
    inputType?: string;
  };
}

// ── Animation Extraction ─────────────────────────────────────────────

export interface KeyframeStop {
  stop: string;                      // '0%', '50%', 'from', 'to'
  properties: Record<string, string>;
}

export interface ExtractedKeyframe {
  name: string;
  stops: KeyframeStop[];
  usedBy: string[];                  // selectors using this animation
  animDuration?: string;
  animEasing?: string;
  animDelay?: string;
  animIteration?: string;
  animFillMode?: string;
  animDirection?: string;
}

export interface ScrollFrame {
  scrollPercent: number;             // 0..100
  scrollY: number;                   // absolute px from top
  pageHeight: number;
  filePath: string;                  // screens/scroll/scroll-NN.png
}

export interface DetectedLibrary {
  name: string;
  version?: string;
  type: 'animation' | 'scroll' | 'physics' | '3d' | 'lottie' | 'other';
  cdn?: string;
}

export interface VideoInfo {
  index: number;
  src: string;
  poster?: string;
  autoplay: boolean;
  loop: boolean;
  muted: boolean;
  width?: number;
  height?: number;
  role: 'background' | 'content' | 'unknown';
  firstFramePath?: string;           // screens/scroll/video-N-frame.png
}

export interface ScrollAnimationPattern {
  selector: string;
  library: string;                   // 'gsap' | 'aos' | 'intersection-observer' | 'css' | 'lottie'
  attribute?: string;                // e.g. data-aos="fade-up"
  animationType: string;             // 'fade-in' | 'slide-up' | 'scale' | 'parallax' | 'sticky' | etc.
  duration?: string;
  delay?: string;
  easing?: string;
  count: number;                     // how many elements share this pattern
}

export interface CSSAnimationVar {
  name: string;
  value: string;
  category: 'duration' | 'easing' | 'delay' | 'animation' | 'other';
}

export interface FullAnimationResult {
  keyframes: ExtractedKeyframe[];
  scrollFrames: ScrollFrame[];
  libraries: DetectedLibrary[];
  videos: VideoInfo[];
  scrollPatterns: ScrollAnimationPattern[];
  animationVars: CSSAnimationVar[];
  globalTransitions: string[];
  canvasCount: number;
  webglDetected: boolean;
  lottieCount: number;
}

// ── Ultra Result ─────────────────────────────────────────────────────

export interface UltraResult {
  pageScreenshots: PageScreenshot[];
  sectionScreenshots: SectionScreenshot[];
  interactions: InteractionRecord[];
  layouts: LayoutRecord[];
  domComponents: DOMComponent[];
  runtimeDiscovery: RuntimeDiscoveryPage[];
  animations: FullAnimationResult;
}
