import { toPng, toSvg } from 'html-to-image';
import { i18n } from '../locales';

// Shared building blocks for the html-to-image capture used by PNG / PDF /
// SVG export and by the print pipeline. Centralized here so the filter rules,
// the viewport target lookup, and the style transform stay in lock-step
// across all five entry points.

export const DEFAULT_PIXEL_RATIO = 2;

// Excludes overlays that should never end up in exported / printed output:
// minimap, on-canvas zoom controls, the React Flow attribution badge.
export function exportFilter(node: HTMLElement | SVGElement): boolean {
  if (!(node instanceof HTMLElement)) return true;
  return (
    !node.classList.contains('react-flow__minimap') &&
    !node.classList.contains('react-flow__controls') &&
    !node.classList.contains('react-flow__attribution')
  );
}

// Throws if React Flow hasn't mounted its viewport yet (caller decided
// nothing is on screen to export).
export function getDiagramTarget(): HTMLElement {
  const t = document.querySelector<HTMLElement>('.react-flow__viewport');
  if (!t) throw new Error(i18n.t('errors.noDiagram') as unknown as string);
  return t;
}

export interface CaptureOpts {
  width: number;
  height: number;
  // Translation applied to the viewport's transform during capture. The
  // diagram is shifted so the desired flow region lands at image px (0,0).
  translateX: number;
  translateY: number;
  pixelRatio?: number;
}

function styleFor(opts: CaptureOpts) {
  return {
    width: `${opts.width}px`,
    height: `${opts.height}px`,
    transform: `translate(${opts.translateX}px, ${opts.translateY}px) scale(1)`,
  };
}

export function captureDiagramPng(
  target: HTMLElement,
  opts: CaptureOpts,
): Promise<string> {
  return toPng(target, {
    backgroundColor: '#ffffff',
    cacheBust: true,
    pixelRatio: opts.pixelRatio ?? DEFAULT_PIXEL_RATIO,
    width: opts.width,
    height: opts.height,
    style: styleFor(opts),
    filter: exportFilter,
  });
}

export function captureDiagramSvg(
  target: HTMLElement,
  opts: CaptureOpts,
): Promise<string> {
  return toSvg(target, {
    backgroundColor: '#ffffff',
    cacheBust: true,
    width: opts.width,
    height: opts.height,
    style: styleFor(opts),
    filter: exportFilter,
  });
}

// Decode an html-to-image SVG data URL ("data:image/svg+xml;charset=utf-8,…")
// into raw markup. Used by the SVG export path.
export function svgDataUrlToText(dataUrl: string): string {
  return decodeURIComponent(dataUrl.slice(dataUrl.indexOf(',') + 1));
}

// Decode a PNG data URL into a Uint8Array. Avoids `fetch(dataUrl)` because
// CSP's connect-src doesn't whitelist `data:` in this app.
export function pngDataUrlToBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const buffer = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
  return buffer;
}
