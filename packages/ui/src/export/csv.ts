import type { ModelVariable, TraceSample } from '@simulador/shared';

function csvEscape(s: string): string {
  if (/[,"\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function traceToCsv(trace: TraceSample[], variables: ModelVariable[]): string {
  const numericNames = variables
    .filter((v) => {
      if (typeof v.initialValue === 'number') return true;
      // Fall back to scanning the trace for numeric values.
      return trace.some((s) => typeof s.state[v.name] === 'number');
    })
    .map((v) => v.name);

  const header = ['time', ...numericNames].map(csvEscape).join(',');
  const lines: string[] = [header];

  for (const sample of trace) {
    const row: string[] = [Number(sample.time.toFixed(6)).toString()];
    for (const name of numericNames) {
      const v = sample.state[name];
      row.push(typeof v === 'number' ? Number(v.toFixed(6)).toString() : '');
    }
    lines.push(row.join(','));
  }
  return lines.join('\n') + '\n';
}
