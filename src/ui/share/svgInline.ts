// A progress theme's drawing as a standalone SVG document (v0.5 package 19, the share card).
// On screen a theme is painted by CSS: classes in the theme's stylesheet, the design tokens and
// the skill colour's --liquid-* variables, WAAPI transforms mid-flight. An SVG drawn into a
// canvas through an <img> sees none of that — it is a separate document without the page's
// styles. So the drawing is cloned and every element of the clone gets the properties that
// paint it, read from the live element's computed style: colours resolved, var() gone, the
// transform where the animation left it. The clone is then serialized with fixed pixel sizes.

/** What paints an SVG element: copied from the computed style onto the clone's `style`. */
export const INLINED_PROPERTIES = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-miterlimit',
  'opacity',
  'transform',
  'transform-origin',
  'transform-box',
  'visibility',
  'stop-color',
  'stop-opacity',
  'clip-path',
  'clip-rule',
  'mask',
  'filter',
  'mix-blend-mode',
  'paint-order',
  'vector-effect',
  'shape-rendering',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'text-anchor',
  'dominant-baseline',
] as const;

/**
 * Values that paint nothing different from the property's initial value: left out to keep
 * the document small (a skyline has hundreds of windows). Presentation attributes stay on the
 * clone as they are: an engine that does not reflect one into the computed style (a transform
 * attribute, say) still draws it from the attribute.
 */
const INITIAL: Partial<Record<(typeof INLINED_PROPERTIES)[number], readonly string[]>> = {
  'fill-opacity': ['1'],
  'fill-rule': ['nonzero'],
  'stroke-opacity': ['1'],
  'stroke-dasharray': ['none'],
  'stroke-dashoffset': ['0', '0px'],
  'stroke-miterlimit': ['4'],
  opacity: ['1'],
  transform: ['none'],
  'transform-box': ['view-box'],
  visibility: ['visible'],
  'clip-path': ['none'],
  'clip-rule': ['nonzero'],
  mask: ['none'],
  filter: ['none'],
  'mix-blend-mode': ['normal'],
  'paint-order': ['normal'],
  'vector-effect': ['none'],
  'shape-rendering': ['auto'],
  'stop-opacity': ['1'],
  'font-style': ['normal'],
  'letter-spacing': ['normal'],
  'text-anchor': ['start'],
  'dominant-baseline': ['auto'],
};

/** Where the page placed the drawing (its size, a crossfade, a lift): not part of the drawing. */
const PAGE_ONLY = new Set(['opacity', 'transform', 'transform-origin', 'transform-box', 'filter', 'mix-blend-mode', 'visibility']);

/** Only an element with a transform needs its origin. */
const TRANSFORM_ONLY = new Set(['transform-origin', 'transform-box']);

/** Text properties matter only where text is drawn. */
const TEXT_ONLY = new Set(['font-family', 'font-size', 'font-weight', 'font-style', 'letter-spacing', 'text-anchor', 'dominant-baseline']);
const TEXT_ELEMENTS = new Set(['text', 'tspan', 'textPath']);

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * `url("http://host/page#grad")` → `url(#grad)`: a computed reference may carry the page's
 * address, which inside the standalone document would point nowhere.
 */
export function localUrl(value: string): string {
  return value.replace(/url\(\s*(["']?)[^"')]*?(#[^"')]+)\1\s*\)/g, 'url($2)');
}

export interface InlineOptions {
  /** Pixel size of the serialized drawing (its viewBox is kept, so it scales). */
  width: number;
  height: number;
  /** The computed style of a live element; getComputedStyle by default (tests pass a fake). */
  computed?: (element: Element) => Pick<CSSStyleDeclaration, 'getPropertyValue'>;
}

/**
 * The drawing as a standalone SVG document: every element's paint inlined from the live one,
 * hidden elements (display: none) dropped, sizes fixed. The live element is never touched.
 */
export function inlineSvg(source: SVGSVGElement, { width, height, computed = (el) => getComputedStyle(el) }: InlineOptions): string {
  const clone = source.cloneNode(true) as SVGSVGElement;
  const drop: Element[] = [];

  const visit = (live: Element, copy: Element, root: boolean) => {
    const style = computed(live);
    if (!root && style.getPropertyValue('display') === 'none') {
      drop.push(copy);
      return;
    }
    const tag = live.localName;
    const hasTransform = (style.getPropertyValue('transform').trim() || 'none') !== 'none';
    const declarations: string[] = [];
    for (const property of INLINED_PROPERTIES) {
      if (root && PAGE_ONLY.has(property)) continue;
      if (TRANSFORM_ONLY.has(property) && !hasTransform) continue;
      if (TEXT_ONLY.has(property) && !TEXT_ELEMENTS.has(tag)) continue;
      const value = style.getPropertyValue(property).trim();
      if (!value || INITIAL[property]?.includes(value)) continue;
      declarations.push(`${property}:${localUrl(value)}`);
    }
    // The page's classes mean nothing without its stylesheet; the inline style replaces them.
    copy.removeAttribute('class');
    if (declarations.length > 0) copy.setAttribute('style', declarations.join(';'));
    else copy.removeAttribute('style');
    const liveChildren = live.children;
    const copyChildren = copy.children;
    for (let i = 0; i < liveChildren.length; i++) {
      const next = copyChildren[i];
      if (next) visit(liveChildren[i]!, next, false);
    }
  };
  visit(source, clone, true);
  for (const element of drop) element.remove();

  // As a namespace declaration: a plain `xmlns` attribute would be serialized next to the one
  // the serializer writes for an SVG element, and the document would not parse.
  clone.setAttributeNS('http://www.w3.org/2000/xmlns/', 'xmlns', SVG_NS);
  clone.setAttribute('width', String(width));
  clone.setAttribute('height', String(height));
  clone.removeAttribute('aria-hidden');
  clone.removeAttribute('focusable');
  clone.removeAttribute('role');
  clone.removeAttribute('aria-label');
  return new XMLSerializer().serializeToString(clone);
}
