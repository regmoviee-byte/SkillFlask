import { describe, expect, it } from 'vitest';
import manifestSource from '../../public/manifest.webmanifest?raw';
import indexHtml from '../../index.html?raw';

// The web app manifest (the installed browser app) and its icons: valid JSON, the fields
// browsers need to offer installation, every icon present with the size it claims.

const icons = import.meta.glob('../../public/icons/*.png', { query: '?inline', import: 'default', eager: true }) as Record<string, string>;
const favicon = import.meta.glob('../../public/favicon.svg', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

/** Width and height from a PNG's IHDR chunk. */
function pngSize(dataUrl: string): [number, number] {
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  expect([...bytes.slice(1, 4)].map((b) => String.fromCharCode(b)).join('')).toBe('PNG');
  const view = new DataView(bytes.buffer);
  return [view.getUint32(16), view.getUint32(20)];
}

const publicFile = (src: string) => `../../public/${src}`;

describe('manifest.webmanifest', () => {
  const manifest = JSON.parse(manifestSource) as {
    name: string;
    short_name: string;
    start_url: string;
    scope: string;
    display: string;
    lang: string;
    background_color: string;
    theme_color: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
    related_applications?: { platform: string; url: string }[];
    prefer_related_applications?: boolean;
  };

  it('has what browsers need to install the app, with relative paths', () => {
    expect(manifest.name).toBe('Skill Flask');
    expect(manifest.short_name).toBe('Skill Flask');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('ru');
    // The site lives under /SkillFlask/: nothing may start at the host root.
    expect(manifest.start_url.startsWith('./')).toBe(true);
    expect(manifest.scope).toBe('./');
    for (const icon of manifest.icons) expect(icon.src.startsWith('/')).toBe(false);
    // The light tokens' background (tokens.css --color-bg).
    expect(manifest.background_color).toBe('#f2f2f7');
    expect(manifest.theme_color).toBe('#f2f2f7');
  });

  it('names itself as its related web app, so a browser tab can tell it is installed (homeScreen.ts)', () => {
    // Relative to the manifest's own URL, like the icons; never preferred over itself.
    expect(manifest.related_applications).toEqual([{ platform: 'webapp', url: 'manifest.webmanifest' }]);
    expect(manifest.prefer_related_applications).toBe(false);
  });

  it('lists 192 and 512 PNGs, a maskable 512 and the SVG, all present at their sizes', () => {
    const png = manifest.icons.filter((icon) => icon.type === 'image/png');
    expect(png.map((icon) => `${icon.sizes} ${icon.purpose ?? 'any'}`).sort()).toEqual(['192x192 any', '512x512 any', '512x512 maskable']);
    for (const icon of png) {
      const data = icons[publicFile(icon.src)];
      expect(data, icon.src).toBeDefined();
      const [w, h] = pngSize(data!);
      expect(`${w}x${h}`).toBe(icon.sizes);
    }
    const svg = manifest.icons.find((icon) => icon.type === 'image/svg+xml');
    expect(svg && favicon[publicFile(svg.src)]).toContain('<svg');
  });

  it('is linked from index.html with the apple-touch-icon (180) and the iOS title', () => {
    expect(indexHtml).toContain('<link rel="manifest" href="./manifest.webmanifest" />');
    expect(indexHtml).toContain('<meta name="apple-mobile-web-app-title" content="Skill Flask" />');
    const apple = indexHtml.match(/<link rel="apple-touch-icon" href="\.\/([^"]+)"/)?.[1];
    expect(apple).toBe('icons/apple-touch-icon.png');
    expect(pngSize(icons[publicFile(apple!)]!)).toEqual([180, 180]);
  });
});
