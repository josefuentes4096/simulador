import { getNodesBounds } from '@xyflow/react';
import { useCallback } from 'react';
import {
  captureDiagramPng,
  getDiagramTarget,
} from '../export/captureCanvas';
import { i18n } from '../locales';
import { cssPageSize, printableArea, PRINT_FOOTER_PX } from '../printPages';
import type { ModelState } from './useModelState';

const tt = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(key, params) as unknown as string;

// HTML-escape user-controlled strings before splicing them into the iframe
// document. The iframe runs outside React so JSX escaping doesn't apply.
function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Builds the inner-content HTML for the summary page (TIPO + VARIABLES +
// EVENTOS). The caller wraps this in a `.page page--summary` div with the
// footer. Same translations as the on-screen panels — the user sees the
// same labels in the printout.
function buildSummaryInnerHtml(model: ModelState): string {
  const tipoLabel =
    model.simulationType === 'event-to-event'
      ? tt('simulationType.eventToEvent')
      : tt('simulationType.deltaTConstant');

  const varRows =
    model.variables.length === 0
      ? `<tr><td colspan="4" class="empty">—</td></tr>`
      : model.variables
          .map(
            (v) =>
              `<tr>
            <td>${esc(v.name)}</td>
            <td>${esc(tt('variables.kindLabel.' + v.kind))}</td>
            <td>${esc(v.initialValue !== undefined ? String(v.initialValue) : '')}</td>
            <td>${esc(v.description ?? '')}</td>
          </tr>`,
          )
          .join('');

  let eventsContent = '';
  if (model.simulationType === 'event-to-event') {
    const modeLabel =
      model.eventTableMode === 'unified'
        ? tt('events.unified')
        : tt('events.independent');
    const plural = model.eventTableMode === 'unified';
    const teiHeader = `<thead><tr>
      <th>${esc(tt('events.tei.tef'))}</th>
      <th>${esc(tt('events.tei.event'))}</th>
      <th>${esc(tt(plural ? 'events.tei.unconditionalNextPlural' : 'events.tei.unconditionalNext'))}</th>
      <th>${esc(tt(plural ? 'events.tei.conditionalNextPlural' : 'events.tei.conditionalNext'))}</th>
      <th>${esc(tt('events.tei.condition'))}</th>
      <th>${esc(tt('events.tei.chainer'))}</th>
      <th>${esc(tt('events.tei.regret'))}</th>
      <th>${esc(tt('events.tei.vector'))}</th>
      <th>${esc(tt('events.tei.dimension'))}</th>
    </tr></thead>`;
    const teiRows =
      model.tei.length === 0
        ? `<tr><td colspan="9" class="empty">—</td></tr>`
        : model.tei
            .map(
              (r) =>
                `<tr>
              <td>${esc(r.tef ?? '')}</td>
              <td>${esc(r.event)}</td>
              <td>${esc(r.unconditionalNext ?? '')}</td>
              <td>${esc(r.conditionalNext ?? '')}</td>
              <td class="code">${esc(r.condition ?? '')}</td>
              <td>${esc(r.chainer ?? '')}</td>
              <td class="ck">${r.regret ? '✓' : ''}</td>
              <td class="ck">${r.vector ? '✓' : ''}</td>
              <td>${esc(r.dimension ?? '')}</td>
            </tr>`,
            )
            .join('');
    eventsContent = `
      <p class="mode">${esc(modeLabel)}</p>
      <table class="tei-table">${teiHeader}<tbody>${teiRows}</tbody></table>
    `;
  } else {
    const dtHeader = `<thead><tr>
      <th>${esc(tt('events.deltaT.tef'))}</th>
      <th>${esc(tt('events.deltaT.propios'))}</th>
      <th>${esc(tt('events.deltaT.prevCommitted'))}</th>
      <th>${esc(tt('events.deltaT.futureCommitted'))}</th>
    </tr></thead>`;
    const dtRows =
      model.deltaT.length === 0
        ? `<tr><td colspan="4" class="empty">—</td></tr>`
        : model.deltaT
            .map(
              (r) =>
                `<tr>
              <td>${esc(r.tef ?? '')}</td>
              <td>${esc(r.propios ?? '')}</td>
              <td>${esc(r.prevCommitted ?? '')}</td>
              <td>${esc(r.futureCommitted ?? '')}</td>
            </tr>`,
            )
            .join('');
    eventsContent = `<table>${dtHeader}<tbody>${dtRows}</tbody></table>`;
  }

  return `
    <h1>${esc(model.name || 'untitled')}</h1>
    <section>
      <h2>${esc(tt('simulationType.header'))}</h2>
      <p>${esc(tipoLabel)}</p>
    </section>
    <section>
      <h2>${esc(tt('variables.header'))}</h2>
      <table>
        <thead><tr>
          <th>${esc(tt('variables.colName'))}</th>
          <th>${esc(tt('variables.colKind'))}</th>
          <th>${esc(tt('variables.colInit'))}</th>
          <th>${esc(tt('variables.colDescription'))}</th>
        </tr></thead>
        <tbody>${varRows}</tbody>
      </table>
    </section>
    <section>
      <h2>${esc(tt('events.header'))}</h2>
      ${eventsContent}
    </section>
  `;
}

// Multi-page tile-based print pipeline. Anchors the page grid at flow origin
// (0,0) so the on-canvas red guides match every printed sheet. Tile size is
// driven by the model's persisted paper size + orientation.
export function useOnPrint(
  model: ModelState,
  setError: (msg: string | null) => void,
) {
  return useCallback(async () => {
    setError(null);
    try {
      const target = getDiagramTarget();
      if (model.nodes.length === 0) throw new Error(tt('errors.emptyDiagram'));

      const { w: PAGE_W, h: PAGE_H } = printableArea(
        model.paperSize,
        model.paperOrientation,
      );
      const PIXEL_RATIO = 2;

      const bounds = getNodesBounds(model.nodes);
      // Which pages does the bounding rect span? `floor((right edge - 1)/W)`
      // so a diagram ending exactly on a page boundary doesn't request an
      // empty extra column / row.
      const minCol = Math.floor(bounds.x / PAGE_W);
      const maxCol = Math.floor((bounds.x + bounds.width - 1) / PAGE_W);
      const minRow = Math.floor(bounds.y / PAGE_H);
      const maxRow = Math.floor((bounds.y + bounds.height - 1) / PAGE_H);
      const cols = maxCol - minCol + 1;
      const rows = maxRow - minRow + 1;

      // Capture the whole spanning rect once, then slice via canvas. Far
      // cheaper than calling toPng N times.
      const captureMinX = minCol * PAGE_W;
      const captureMinY = minRow * PAGE_H;
      const captureW = cols * PAGE_W;
      const captureH = rows * PAGE_H;

      const fullPng = await captureDiagramPng(target, {
        width: captureW,
        height: captureH,
        translateX: -captureMinX,
        translateY: -captureMinY,
        pixelRatio: PIXEL_RATIO,
      });

      const fullImg = await new Promise<HTMLImageElement>((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error(tt('errors.imageDecode')));
        im.src = fullPng;
      });

      // True if any node's bounding rect overlaps the tile rect. Skips
      // edges (endpoints sit on nodes, so an edge can't make a tile
      // non-empty unless one of its endpoints does). Avoids printing a
      // blank page when the diagram covers an L-shape.
      const tileHasContent = (tileFlowX: number, tileFlowY: number): boolean => {
        for (const n of model.nodes) {
          const nx = n.position.x;
          const ny = n.position.y;
          const nw = n.measured?.width ?? 100;
          const nh = n.measured?.height ?? 50;
          if (
            nx < tileFlowX + PAGE_W &&
            nx + nw > tileFlowX &&
            ny < tileFlowY + PAGE_H &&
            ny + nh > tileFlowY
          ) {
            return true;
          }
        }
        return false;
      };

      const tiles: string[] = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const tileFlowX = (minCol + c) * PAGE_W;
          const tileFlowY = (minRow + r) * PAGE_H;
          if (!tileHasContent(tileFlowX, tileFlowY)) continue;
          const cv = document.createElement('canvas');
          cv.width = PAGE_W * PIXEL_RATIO;
          cv.height = PAGE_H * PIXEL_RATIO;
          const ctx = cv.getContext('2d');
          if (!ctx) throw new Error(tt('errors.canvasContext'));
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, cv.width, cv.height);
          const srcX = c * PAGE_W * PIXEL_RATIO;
          const srcY = r * PAGE_H * PIXEL_RATIO;
          const srcW = Math.min(fullImg.naturalWidth - srcX, PAGE_W * PIXEL_RATIO);
          const srcH = Math.min(fullImg.naturalHeight - srcY, PAGE_H * PIXEL_RATIO);
          if (srcW > 0 && srcH > 0) {
            ctx.drawImage(fullImg, srcX, srcY, srcW, srcH, 0, 0, srcW, srcH);
          }
          tiles.push(cv.toDataURL('image/png'));
        }
      }
      if (tiles.length === 0) throw new Error(tt('errors.emptyDiagram'));

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);
      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;
      if (!doc || !win) {
        document.body.removeChild(iframe);
        throw new Error(tt('errors.printFrame'));
      }
      const cssSize = cssPageSize(model.paperSize, model.paperOrientation);
      const title = (model.name || 'Simulador').replace(/[<>"&]/g, '');
      const footerLeft = `Simulador v${model.builtWith || __APP_VERSION__} · @josefuentes4096`;
      // Summary takes 1 logical page + N tiles. If summary content overflows
      // it'll occupy multiple physical pages but the displayed total stays
      // the same (rare case, model would have to be very long).
      const total = tiles.length + 1;
      const summaryPage = `<div class="page page--summary">${buildSummaryInnerHtml(model)}<div class="page__footer"><span>${footerLeft}</span><span class="page__num">1/${total}</span></div></div>`;
      const tilePagesHtml = tiles
        .map(
          (t, i) =>
            `<div class="page"><img src="${t}" /><div class="page__footer"><span>${footerLeft}</span><span class="page__num">${i + 2}/${total}</span></div></div>`,
        )
        .join('');
      doc.open();
      doc.write(`<!DOCTYPE html><html><head><title>${title}</title>
<style>
  @page { size: ${cssSize}; margin: 1cm; }
  html, body { margin: 0; padding: 0; }
  .page {
    width: ${PAGE_W}px;
    height: ${PAGE_H + PRINT_FOOTER_PX}px;
    page-break-after: always;
    position: relative;
    overflow: hidden;
  }
  .page:last-child { page-break-after: auto; }
  .page img {
    display: block;
    width: ${PAGE_W}px;
    height: ${PAGE_H}px;
  }
  .page__footer {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: ${PRINT_FOOTER_PX}px;
    padding: 0 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    font-family: system-ui, sans-serif;
    font-size: 10px;
    font-style: italic;
    color: #555;
  }
  .page__footer .page__num { font-style: normal; font-variant-numeric: tabular-nums; }
  /* Summary page — TIPO / VARIABLES / EVENTOS in print form. Lets content
     flow naturally; if it overflows the page, the browser breaks at the
     next @page boundary. */
  .page--summary {
    overflow: visible;
    padding: 12px 14px ${PRINT_FOOTER_PX + 4}px;
    box-sizing: border-box;
    font-family: system-ui, sans-serif;
    font-size: 11px;
    color: #1d1d1f;
    line-height: 1.35;
  }
  .page--summary h1 {
    font-size: 16px;
    font-weight: 600;
    margin: 0 0 10px;
    padding-bottom: 4px;
    border-bottom: 1px solid #888;
  }
  .page--summary h2 {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #555;
    margin: 14px 0 6px;
  }
  .page--summary section { margin-bottom: 6px; }
  .page--summary p { margin: 0 0 4px; }
  .page--summary p.mode { font-style: italic; color: #555; margin: 0 0 6px; }
  .page--summary table {
    width: 100%;
    border-collapse: collapse;
    font-size: 10px;
    table-layout: fixed;
  }
  .page--summary th, .page--summary td {
    padding: 3px 4px;
    border: 1px solid #ccc;
    text-align: left;
    vertical-align: top;
    word-wrap: break-word;
    overflow-wrap: break-word;
  }
  .page--summary th {
    background: #f3f3f3;
    font-weight: 600;
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .page--summary td.ck { text-align: center; }
  .page--summary td.code {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 9px;
  }
  .page--summary td.empty { text-align: center; color: #999; font-style: italic; }
  /* TEI table is wide (9 cols); shrink the font further so columns fit. */
  .page--summary table.tei-table { font-size: 9px; }
  .page--summary table.tei-table th { font-size: 8px; }
</style>
</head><body>${summaryPage}${tilePagesHtml}</body></html>`);
      doc.close();
      const cleanup = () => {
        setTimeout(() => {
          if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
        }, 1000);
      };
      // Wait for every tile image to load before triggering print —
      // otherwise the print engine may snapshot blank pages.
      const imgs = Array.from(doc.querySelectorAll('img'));
      const pending = imgs.filter((im) => !im.complete);
      const triggerPrint = () => {
        win.focus();
        win.print();
        cleanup();
      };
      if (pending.length === 0) {
        triggerPrint();
      } else {
        let remaining = pending.length;
        const onDone = () => {
          remaining -= 1;
          if (remaining === 0) triggerPrint();
        };
        for (const im of pending) {
          im.addEventListener('load', onDone, { once: true });
          im.addEventListener('error', onDone, { once: true });
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [model, setError]);
}
