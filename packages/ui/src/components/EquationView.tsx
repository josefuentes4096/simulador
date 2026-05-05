import type { Edge, Node } from '@xyflow/react';
import { useMemo } from 'react';
import { generateEquations } from '../dynamic/equationGenerator';

interface Props {
  nodes: Node[];
  edges: Edge[];
}

// Read-only auto-generated view of the model in equation form. Lives as a
// canvas overlay (toggled by the Model / Equation tabs in App.tsx).
export function EquationView({ nodes, edges }: Props) {
  const lines = useMemo(() => generateEquations(nodes, edges), [nodes, edges]);
  return (
    <div className="equation-view">
      <pre className="equation-view__body">
        {lines.map((l, i) => (
          <div key={i} className={l.kind === 'header' ? 'equation-view__header' : ''}>
            {l.text}
          </div>
        ))}
      </pre>
    </div>
  );
}
