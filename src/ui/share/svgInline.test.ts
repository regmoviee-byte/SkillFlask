// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { inlineSvg, localUrl } from './svgInline';

const NS = 'http://www.w3.org/2000/svg';

/** A live drawing as a theme renders it: classes, var() in attributes, a hidden layer, text. */
function drawing(): SVGSVGElement {
  const host = document.createElement('div');
  host.innerHTML = `
    <svg class="pizza-svg" viewBox="0 0 160 260" aria-hidden="true" focusable="false" style="width: 140px">
      <defs><linearGradient id="g"><stop offset="0" class="stop-top" /></linearGradient></defs>
      <g class="slice" transform="translate(10 20)">
        <path class="crust" d="M0 0h10v10z" fill="var(--pizza-crust)" />
        <circle class="topping" cx="5" cy="5" r="2" />
      </g>
      <g class="hidden-layer"><rect width="4" height="4" /></g>
      <text class="label" x="4" y="12">Пицца 3</text>
    </svg>`;
  document.body.append(host);
  return host.querySelector('svg')!;
}

/** Computed styles as a browser would resolve them for the drawing above. */
function computedFor(overrides: Record<string, Record<string, string>> = {}) {
  const base: Record<string, string> = {
    fill: 'rgb(0, 0, 0)',
    stroke: 'none',
    'stroke-width': '1px',
    opacity: '1',
    transform: 'none',
    visibility: 'visible',
    display: 'inline',
    'font-family': 'Roboto, sans-serif',
    'font-size': '16px',
    'font-weight': '400',
    'text-anchor': 'start',
  };
  const byClass: Record<string, Record<string, string>> = {
    'pizza-svg': { opacity: '0.5', transform: 'matrix(1, 0, 0, 1, 0, 8)', display: 'block' },
    'stop-top': { 'stop-color': 'rgb(255, 200, 0)' },
    slice: { transform: 'matrix(1, 0, 0, 1, 10, 20)', 'transform-origin': '80px 130px', 'transform-box': 'fill-box' },
    crust: { fill: 'rgb(201, 137, 72)', stroke: 'rgb(90, 60, 30)', 'stroke-width': '2.5px' },
    topping: { fill: 'url("http://localhost:4173/#g")', opacity: '0.8' },
    'hidden-layer': { display: 'none' },
    label: { fill: 'rgb(28, 28, 30)', 'font-weight': '700', 'text-anchor': 'middle' },
    ...overrides,
  };
  return (el: Element) => {
    const own = byClass[el.getAttribute('class') ?? ''] ?? {};
    return { getPropertyValue: (name: string) => own[name] ?? base[name] ?? '' };
  };
}

function parse(markup: string): SVGSVGElement {
  return new DOMParser().parseFromString(markup, 'image/svg+xml').documentElement as unknown as SVGSVGElement;
}

describe('inlineSvg', () => {
  it('copies the computed paint of every element into its style, with var() resolved', () => {
    const out = parse(inlineSvg(drawing(), { width: 336, height: 546, computed: computedFor() }));
    const crust = out.querySelector('path')!;
    expect(crust.getAttribute('style')).toContain('fill:rgb(201, 137, 72)');
    expect(crust.getAttribute('style')).toContain('stroke:rgb(90, 60, 30)');
    expect(crust.getAttribute('style')).toContain('stroke-width:2.5px');
    expect(out.querySelector('stop')!.getAttribute('style')).toContain('stop-color:rgb(255, 200, 0)');
    // The inline style wins over the attribute the page resolved through a variable.
    expect(crust.getAttribute('style')).not.toContain('var(');
  });

  it('keeps transforms with their origin and box, and leaves the root’s placement to the page', () => {
    const out = parse(inlineSvg(drawing(), { width: 336, height: 546, computed: computedFor() }));
    const group = [...out.querySelectorAll('g')].find((g) => g.querySelector('path'))!;
    expect(group.getAttribute('style')).toContain('transform:matrix(1, 0, 0, 1, 10, 20)');
    expect(group.getAttribute('style')).toContain('transform-origin:80px 130px');
    expect(group.getAttribute('style')).toContain('transform-box:fill-box');
    // The attribute stays for an engine that does not reflect it into the computed style.
    expect(group.getAttribute('transform')).toBe('translate(10 20)');
    const root = out.getAttribute('style') ?? '';
    expect(root).not.toContain('opacity');
    expect(root).not.toContain('transform');
    // An element without a transform gets no origin.
    expect(out.querySelector('circle')!.getAttribute('style')).not.toContain('transform-origin');
  });

  it('points references at the document itself, drops hidden layers and the page’s classes', () => {
    const out = parse(inlineSvg(drawing(), { width: 336, height: 546, computed: computedFor() }));
    expect(out.querySelector('circle')!.getAttribute('style')).toContain('fill:url(#g)');
    expect(out.querySelectorAll('rect')).toHaveLength(0);
    expect(out.querySelector('[class]')).toBeNull();
  });

  it('writes font properties on text only, and skips initial values', () => {
    const out = parse(inlineSvg(drawing(), { width: 336, height: 546, computed: computedFor() }));
    const text = out.querySelector('text')!.getAttribute('style')!;
    expect(text).toContain('font-weight:700');
    expect(text).toContain('text-anchor:middle');
    expect(text).toContain('font-family:Roboto, sans-serif');
    const crust = out.querySelector('path')!.getAttribute('style')!;
    expect(crust).not.toContain('font-');
    expect(crust).not.toMatch(/(^|;)opacity:1(;|$)/);
    expect(crust).not.toContain('visibility');
    expect(out.querySelector('circle')!.getAttribute('style')).toContain('opacity:0.8');
  });

  it('makes a standalone document of a fixed size and leaves the live drawing untouched', () => {
    const live = drawing();
    const before = live.outerHTML;
    const markup = inlineSvg(live, { width: 336, height: 546, computed: computedFor() });
    const out = parse(markup);
    expect(out.namespaceURI).toBe(NS);
    expect(markup).toContain(`xmlns="${NS}"`);
    expect(out.getAttribute('width')).toBe('336');
    expect(out.getAttribute('height')).toBe('546');
    expect(out.getAttribute('viewBox')).toBe('0 0 160 260');
    expect(out.hasAttribute('aria-hidden')).toBe(false);
    expect(out.getAttribute('style') ?? '').not.toMatch(/(^|;)\s*width/);
    expect(live.outerHTML).toBe(before);
    expect(out.querySelector('text')!.textContent).toBe('Пицца 3');
  });

  it('reads the page’s real computed styles by default', () => {
    const style = document.createElement('style');
    style.textContent = '.crust { fill: rgb(1, 2, 3); }';
    document.head.append(style);
    try {
      const out = parse(inlineSvg(drawing(), { width: 10, height: 10 }));
      expect(out.querySelector('path')!.getAttribute('style')).toContain('fill:rgb(1, 2, 3)');
    } finally {
      style.remove();
    }
  });
});

describe('localUrl', () => {
  it('keeps only the fragment of a reference', () => {
    expect(localUrl('url("http://localhost:4173/#grad")')).toBe('url(#grad)');
    expect(localUrl("url('#clip')")).toBe('url(#clip)');
    expect(localUrl('url(#m)')).toBe('url(#m)');
    expect(localUrl('rgb(1, 2, 3)')).toBe('rgb(1, 2, 3)');
  });
});
