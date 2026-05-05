// Paper size catalog, shared by Canvas (red page-boundary guides) and
// App.onPrint (tile size). All measurements in CSS px at 96 DPI.
//
// Conversion: 1 mm = 96 / 25.4 ≈ 3.7795 px.
//   A4     210 × 297   →  794  × 1123
//   Carta  216 × 279   →  816  × 1056
//   Legal  216 × 356   →  816  × 1344
//   A3     297 × 420   →  1123 × 1587
//   A5     148 × 210   →  559  × 794

export const PAPER_SIZES = {
  a4: { label: 'A4', w: 794, h: 1123 },
  letter: { label: 'Carta', w: 816, h: 1056 },
  legal: { label: 'Legal', w: 816, h: 1344 },
  a3: { label: 'A3', w: 1123, h: 1587 },
  a5: { label: 'A5', w: 559, h: 794 },
} as const;

export type PaperSizeKey = keyof typeof PAPER_SIZES;
export type PaperOrientation = 'portrait' | 'landscape';

// 1 cm at 96 DPI. Used as the printable-area margin on every side.
export const PRINT_MARGIN_PX = 38;

// Bottom strip reserved on every printed page for the page footer
// (version + N/T). Subtracted from the printable height so the diagram
// content never lands underneath the footer text.
export const PRINT_FOOTER_PX = 25;

// CSS @page size keyword for each paper key. Browsers map these to physical
// sizes when the user has the printer set to "Actual size" / 100%.
const CSS_PAGE_NAME: Record<PaperSizeKey, string> = {
  a4: 'A4',
  letter: 'Letter',
  legal: 'Legal',
  a3: 'A3',
  a5: 'A5',
};

// Content area available for diagram tiles. This is the "what fits on a
// page" rectangle — paper minus margins minus the footer strip. Both the
// canvas red guides and the print tile size read from this so the user's
// visual reference matches the printed output exactly.
export function printableArea(
  key: PaperSizeKey,
  orientation: PaperOrientation,
): { w: number; h: number } {
  const p = PAPER_SIZES[key];
  const w = orientation === 'landscape' ? p.h : p.w;
  const h = orientation === 'landscape' ? p.w : p.h;
  return {
    w: w - 2 * PRINT_MARGIN_PX,
    h: h - 2 * PRINT_MARGIN_PX - PRINT_FOOTER_PX,
  };
}

export function cssPageSize(
  key: PaperSizeKey,
  orientation: PaperOrientation,
): string {
  return `${CSS_PAGE_NAME[key]} ${orientation}`;
}
