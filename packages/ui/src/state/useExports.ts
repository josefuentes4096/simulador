import { getNodesBounds } from '@xyflow/react';
import { jsPDF } from 'jspdf';
import { useCallback } from 'react';
import type {
  SimulationSnapshot,
  ScheduledEvent,
  TraceSample,
} from '@simulador/shared';
import {
  captureDiagramPng,
  captureDiagramSvg,
  getDiagramTarget,
  pngDataUrlToBytes,
  svgDataUrlToText,
} from '../export/captureCanvas';
import { traceToCsv } from '../export/csv';
import { toDrawioXml } from '../export/drawio';
import { toCpp, toGo, toJava } from '../export/sourceCode';
import { i18n } from '../locales';
import type { ModelState } from './useModelState';

const tt = (key: string, params?: Record<string, unknown>): string =>
  i18n.t(key, params) as unknown as string;

export type ExportKind =
  | 'png'
  | 'pdf'
  | 'svg'
  | 'csv'
  | 'json'
  | 'drawio'
  | 'cpp'
  | 'java'
  | 'go';

// Padding around the diagram bounds when exporting an image. Keeps the
// outermost nodes from sitting flush against the image border.
const EXPORT_PADDING = 40;

export function useOnExport(
  model: ModelState,
  snapshot: SimulationSnapshot | null,
  trace: TraceSample[],
  log: ScheduledEvent[],
  setError: (msg: string | null) => void,
) {
  return useCallback(
    async (kind: ExportKind) => {
      setError(null);
      const baseName = model.name || 'model';
      try {
        if (kind === 'png' || kind === 'pdf' || kind === 'svg') {
          const target = getDiagramTarget();
          if (model.nodes.length === 0) throw new Error(tt('errors.emptyDiagram'));
          const bounds = getNodesBounds(model.nodes);
          const imageWidth = Math.ceil(bounds.width + EXPORT_PADDING * 2);
          const imageHeight = Math.ceil(bounds.height + EXPORT_PADDING * 2);
          const captureOpts = {
            width: imageWidth,
            height: imageHeight,
            translateX: EXPORT_PADDING - bounds.x,
            translateY: EXPORT_PADDING - bounds.y,
          };

          if (kind === 'svg') {
            const dataUrl = await captureDiagramSvg(target, captureOpts);
            const svg = svgDataUrlToText(dataUrl);
            await window.simulador.exportSvg(svg, `${baseName}.svg`);
            return;
          }
          const dataUrl = await captureDiagramPng(target, captureOpts);
          if (kind === 'png') {
            await window.simulador.exportPng(
              pngDataUrlToBytes(dataUrl),
              `${baseName}.png`,
            );
          } else {
            // PDF: page sized to the bounds (in pt, 1pt ≈ 1.33 css px) so
            // the diagram fills the page. Orientation follows aspect ratio.
            const orientation = imageWidth >= imageHeight ? 'landscape' : 'portrait';
            const pdf = new jsPDF({
              orientation,
              unit: 'pt',
              format: [imageWidth, imageHeight],
              compress: true,
            });
            pdf.addImage(dataUrl, 'PNG', 0, 0, imageWidth, imageHeight);
            const arrayBuffer = pdf.output('arraybuffer');
            await window.simulador.exportPdf(
              new Uint8Array(arrayBuffer),
              `${baseName}.pdf`,
            );
          }
        } else if (kind === 'csv') {
          const csv = traceToCsv(trace, model.variables);
          await window.simulador.exportCsv(csv, `${baseName}-trace.csv`);
        } else if (kind === 'json') {
          const payload = {
            model: model.serialize(),
            results: { snapshot, trace, eventLog: log },
            exportedAt: new Date().toISOString(),
          };
          await window.simulador.exportJson(
            JSON.stringify(payload, null, 2),
            `${baseName}-results.json`,
          );
        } else if (kind === 'drawio') {
          const xml = toDrawioXml(model.serialize());
          await window.simulador.exportDrawio(xml, `${baseName}.drawio`);
        } else if (kind === 'cpp') {
          const code = toCpp(model.serialize());
          await window.simulador.exportCpp(code, `${baseName}.cpp`);
        } else if (kind === 'java') {
          const code = toJava(model.serialize());
          await window.simulador.exportJava(code, `Simulation.java`);
        } else if (kind === 'go') {
          const code = toGo(model.serialize());
          await window.simulador.exportGo(code, `${baseName}.go`);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [log, model, snapshot, trace, setError],
  );
}
