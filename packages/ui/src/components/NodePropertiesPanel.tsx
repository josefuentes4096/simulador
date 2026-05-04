import type { Dispatch, SetStateAction } from 'react';
import type { Edge, Node } from '@xyflow/react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DynamicGraphicalFunction } from '@simulador/shared';
import { parse, ParseError } from '../dynamic/expr/parse';
import { extractReferences } from '../dynamic/expr/refs';
import { TokenizeError } from '../dynamic/expr/tokenize';
import { GraphicalFunctionEditor } from './GraphicalFunctionEditor';

interface Props {
  nodes: Node[];
  setNodes: Dispatch<SetStateAction<Node[]>>;
  // Optional edge slice — when provided, the panel can render flow-edge
  // properties (name, expression, ...) for a single selected edge in
  // dynamic mode.
  edges?: Edge[];
  setEdges?: Dispatch<SetStateAction<Edge[]>>;
  breakpoints: Set<string>;
  setBreakpoints: Dispatch<SetStateAction<Set<string>>>;
}

type CallKind = 'routine' | 'function' | 'subroutine';

interface RoutineData {
  callKind?: CallKind;
  formula?: string;
  assignTo?: string;
}

const STELLA_KINDS = new Set([
  'stock',
  'stellaConverter',
  'cloud',
  'stellaComment',
  'stellaLabel',
]);

export function NodePropertiesPanel({
  nodes,
  setNodes,
  edges,
  setEdges,
  breakpoints,
  setBreakpoints,
}: Props) {
  const { t } = useTranslation();
  const selectedNodes = useMemo(() => nodes.filter((n) => n.selected), [nodes]);
  const selected = selectedNodes.length === 1 ? selectedNodes[0] : null;
  const selectedEdges = useMemo(
    () => (edges ?? []).filter((e) => e.selected),
    [edges],
  );
  const selectedEdge = selectedEdges.length === 1 ? selectedEdges[0] : null;

  const updateData = useCallback(
    (id: string, patch: (prev: Record<string, unknown>) => Record<string, unknown>) => {
      setNodes((ns) =>
        ns.map((n) => (n.id === id ? { ...n, data: patch(n.data ?? {}) } : n)),
      );
    },
    [setNodes],
  );

  const updateEdgeData = useCallback(
    (id: string, patch: (prev: Record<string, unknown>) => Record<string, unknown>) => {
      if (!setEdges) return;
      setEdges((es) =>
        es.map((e) => (e.id === id ? { ...e, data: patch(e.data ?? {}) } : e)),
      );
    },
    [setEdges],
  );

  const toggleBreakpoint = useCallback(
    (id: string) => {
      setBreakpoints((cur) => {
        const next = new Set(cur);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
    [setBreakpoints],
  );

  return (
    <section className="panel">
      <header className="panel__header">
        <h3>{t('props.header')}</h3>
      </header>

      {selectedNodes.length === 0 && selectedEdges.length === 0 && (
        <p className="panel__empty">{t('props.empty')}</p>
      )}
      {selectedNodes.length > 1 && (
        <p className="panel__empty">
          {t('props.multiSelected', { count: selectedNodes.length })}
        </p>
      )}

      {selected && (
        <>
          <p className="node-props__type">
            {selected.type
              ? (t(`nodeTypes.${selected.type}`) as string)
              : t('props.unknownType')}
            <span className="node-props__id"> · {selected.id}</span>
          </p>

          {selected.type === 'routine' ? (
            <RoutineProperties node={selected} updateData={updateData} />
          ) : null}

          {STELLA_KINDS.has(selected.type ?? '') ? (
            <DynamicBlockProperties
              node={selected}
              updateData={updateData}
              nodes={nodes}
              edges={edges ?? []}
            />
          ) : null}

          {/* Breakpoints are a discrete-mode debugger feature — Stella blocks
              don't participate in step-by-step DES execution. */}
          {!STELLA_KINDS.has(selected.type ?? '') && (
            <label className="node-props__row">
              <span className="node-props__label">{t('props.breakpoint')}</span>
              <input
                type="checkbox"
                checked={breakpoints.has(selected.id)}
                onChange={() => toggleBreakpoint(selected.id)}
              />
            </label>
          )}
        </>
      )}

      {selected === null && selectedEdge !== null && selectedEdge.type === 'flow' && (
        <FlowEdgeProperties
          edge={selectedEdge}
          updateData={updateEdgeData}
          nodes={nodes}
          edges={edges ?? []}
        />
      )}
    </section>
  );
}

function RoutineProperties({
  node,
  updateData,
}: {
  node: Node;
  updateData: (
    id: string,
    patch: (prev: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
}) {
  const { t } = useTranslation();
  const data = (node.data ?? {}) as RoutineData;
  const callKind: CallKind =
    data.callKind === 'subroutine' || data.callKind === 'function'
      ? data.callKind
      : 'function';
  const formula = data.formula ?? '';
  const label =
    typeof (node.data as { label?: unknown } | undefined)?.label === 'string'
      ? ((node.data as { label: string }).label).trim()
      : '';

  const onKindChange = (next: CallKind) => {
    updateData(node.id, (prev) => {
      const out: Record<string, unknown> = { ...prev, callKind: next };
      if (next !== 'function') delete out.formula;
      delete out.assignTo;
      return out;
    });
  };

  const onFormulaChange = (next: string) => {
    updateData(node.id, (prev) => {
      const out: Record<string, unknown> = { ...prev };
      if (next === '') delete out.formula;
      else out.formula = next;
      return out;
    });
  };

  return (
    <div className="node-props">
      <label className="node-props__row">
        <span className="node-props__label">{t('props.kind')}</span>
        <select
          className="node-props__control"
          value={callKind}
          onChange={(e) => onKindChange(e.target.value as CallKind)}
        >
          <option value="function">{t('props.kindFunction')}</option>
          <option value="subroutine">{t('props.kindSubroutine')}</option>
        </select>
      </label>

      {callKind === 'function' && (
        <>
          <label className="node-props__row node-props__row--stack">
            <span className="node-props__label">{t('props.formula')}</span>
            <textarea
              className="node-props__control node-props__formula"
              value={formula}
              onChange={(e) => onFormulaChange(e.target.value)}
              placeholder="RND()"
              rows={2}
              spellCheck={false}
            />
          </label>
          <p className="node-props__hint">
            {label
              ? t('props.functionLinks', { name: label })
              : t('props.functionNeedsLabel')}
          </p>
        </>
      )}

      {callKind === 'subroutine' && (
        <p className="node-props__hint">{t('props.subroutineHint')}</p>
      )}
    </div>
  );
}

// Validate a Stella expression against the Required Inputs derived from the
// graph. Returns a list of human-readable problems (empty if all OK).
type Translate = (key: string, opts?: Record<string, unknown>) => string;
function validateExpression(
  source: string,
  required: string[],
  t: Translate,
): string[] {
  if (source.trim() === '') return [];
  let refs: Set<string>;
  try {
    refs = extractReferences(parse(source));
  } catch (err) {
    const detail =
      err instanceof ParseError || err instanceof TokenizeError
        ? err.message
        : (err as Error).message;
    return [t('dynamic.validation.parseError', { detail })];
  }
  const issues: string[] = [];
  for (const r of required) {
    if (!refs.has(r)) {
      issues.push(t('dynamic.validation.requiredInputUnused', { name: r }));
    }
  }
  for (const r of refs) {
    if (!required.includes(r)) {
      issues.push(t('dynamic.validation.referencedNoConnector', { name: r }));
    }
  }
  return issues;
}

// Compute the names of variables that have a connector arrow pointing at the
// given block (or flow). Walks the connector subgraph.
function computeRequiredInputs(targetId: string, nodes: Node[], edges: Edge[]): string[] {
  const out: string[] = [];
  for (const e of edges) {
    if (e.type !== 'connector') continue;
    if (e.target !== targetId) continue;
    const src = nodes.find((n) => n.id === e.source);
    if (!src) continue;
    const name = (src.data as { name?: string } | undefined)?.name;
    if (typeof name === 'string' && name !== '') out.push(name);
  }
  return out;
}

function DynamicBlockProperties({
  node,
  updateData,
  nodes,
  edges,
}: {
  node: Node;
  updateData: (
    id: string,
    patch: (prev: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
  nodes: Node[];
  edges: Edge[];
}) {
  const { t } = useTranslation();
  const data = (node.data ?? {}) as Record<string, unknown>;
  const name = (data['name'] as string | undefined) ?? '';
  const required = useMemo(
    () => computeRequiredInputs(node.id, nodes, edges),
    [node.id, nodes, edges],
  );

  const setField = (key: string, value: unknown) => {
    updateData(node.id, (prev) => {
      const out = { ...prev };
      if (value === '' || value === undefined) delete out[key];
      else out[key] = value;
      return out;
    });
  };

  const isStock = node.type === 'stock';
  const isConverter = node.type === 'stellaConverter';
  const isCloud = node.type === 'cloud';
  const isCommentOrLabel = node.type === 'stellaComment' || node.type === 'stellaLabel';

  return (
    <div className="node-props">
      {!isCloud && (
        <label className="node-props__row">
          <span className="node-props__label">{t('dynamic.props.name')}</span>
          <input
            className="node-props__control"
            type="text"
            value={name}
            onChange={(e) => setField('name', e.target.value)}
            spellCheck={false}
          />
        </label>
      )}

      {isStock && (
        <>
          <label className="node-props__row node-props__row--stack">
            <span className="node-props__label">{t('dynamic.props.initialValue')}</span>
            <textarea
              className="node-props__control node-props__formula"
              value={(data['initialExpression'] as string | undefined) ?? ''}
              onChange={(e) => setField('initialExpression', e.target.value)}
              placeholder="0"
              rows={1}
              spellCheck={false}
            />
          </label>
          <label className="node-props__row">
            <span className="node-props__label">{t('dynamic.props.nonNegative')}</span>
            <input
              type="checkbox"
              checked={(data['nonNegative'] as boolean | undefined) ?? true}
              onChange={(e) => setField('nonNegative', e.target.checked)}
            />
          </label>
        </>
      )}

      {isConverter && (
        <>
          <label className="node-props__row node-props__row--stack">
            <span className="node-props__label">{t('dynamic.props.equation')}</span>
            <textarea
              className="node-props__control node-props__formula"
              value={(data['expression'] as string | undefined) ?? ''}
              onChange={(e) => setField('expression', e.target.value)}
              placeholder="0"
              rows={2}
              spellCheck={false}
            />
          </label>
          <RequiredInputsList required={required} />
          <ValidationHints
            issues={validateExpression(
              (data['expression'] as string | undefined) ?? '',
              required,
              t,
            )}
          />
          <GraphicalToggle
            graphical={data['graphical'] as DynamicGraphicalFunction | undefined}
            onSave={(g) => setField('graphical', g)}
            onClear={() => setField('graphical', undefined)}
          />
        </>
      )}

      {isCommentOrLabel && (
        <label className="node-props__row node-props__row--stack">
          <span className="node-props__label">{t('dynamic.props.text')}</span>
          <textarea
            className="node-props__control"
            value={(data['text'] as string | undefined) ?? ''}
            onChange={(e) => setField('text', e.target.value)}
            rows={3}
            spellCheck={false}
          />
        </label>
      )}

      {isCloud && (
        <p className="node-props__hint">{t('dynamic.props.cloudHint')}</p>
      )}

      {!isCloud && !isCommentOrLabel && (
        <>
          <label className="node-props__row">
            <span className="node-props__label">{t('dynamic.props.units')}</span>
            <input
              className="node-props__control"
              type="text"
              value={(data['units'] as string | undefined) ?? ''}
              onChange={(e) => setField('units', e.target.value)}
            />
          </label>
          <label className="node-props__row node-props__row--stack">
            <span className="node-props__label">{t('dynamic.props.documentation')}</span>
            <textarea
              className="node-props__control"
              value={(data['documentation'] as string | undefined) ?? ''}
              onChange={(e) => setField('documentation', e.target.value)}
              rows={2}
            />
          </label>
        </>
      )}
    </div>
  );
}

function FlowEdgeProperties({
  edge,
  updateData,
  nodes,
  edges,
}: {
  edge: Edge;
  updateData: (
    id: string,
    patch: (prev: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
  nodes: Node[];
  edges: Edge[];
}) {
  const { t } = useTranslation();
  const data = (edge.data ?? {}) as Record<string, unknown>;
  const name = (data['name'] as string | undefined) ?? '';
  const expression = (data['expression'] as string | undefined) ?? '';
  const required = useMemo(
    () => computeRequiredInputs(edge.id, nodes, edges),
    [edge.id, nodes, edges],
  );

  const setField = (key: string, value: unknown) => {
    updateData(edge.id, (prev) => {
      const out = { ...prev };
      if (value === '' || value === undefined) delete out[key];
      else out[key] = value;
      return out;
    });
  };

  return (
    <div className="node-props">
      <p className="node-props__type">
        {t('dynamic.props.flowLabel')}
        <span className="node-props__id"> · {edge.id}</span>
      </p>
      <label className="node-props__row">
        <span className="node-props__label">{t('dynamic.props.name')}</span>
        <input
          className="node-props__control"
          type="text"
          value={name}
          onChange={(e) => setField('name', e.target.value)}
        />
      </label>
      <label className="node-props__row node-props__row--stack">
        <span className="node-props__label">{t('dynamic.props.equation')}</span>
        <textarea
          className="node-props__control node-props__formula"
          value={expression}
          onChange={(e) => setField('expression', e.target.value)}
          placeholder="0"
          rows={2}
          spellCheck={false}
        />
      </label>
      <RequiredInputsList required={required} />
      <ValidationHints issues={validateExpression(expression, required, t)} />
      <label className="node-props__row">
        <span className="node-props__label">{t('dynamic.props.units')}</span>
        <input
          className="node-props__control"
          type="text"
          value={(data['units'] as string | undefined) ?? ''}
          onChange={(e) => setField('units', e.target.value)}
        />
      </label>
      <label className="node-props__row node-props__row--stack">
        <span className="node-props__label">{t('dynamic.props.documentation')}</span>
        <textarea
          className="node-props__control"
          value={(data['documentation'] as string | undefined) ?? ''}
          onChange={(e) => setField('documentation', e.target.value)}
          rows={2}
        />
      </label>
    </div>
  );
}

// Toggles a converter between formula-only and graphical function modes.
// When graphical is set, the engine samples the curve instead of evaluating
// the expression at runtime.
function GraphicalToggle({
  graphical,
  onSave,
  onClear,
}: {
  graphical: DynamicGraphicalFunction | undefined;
  onSave: (g: DynamicGraphicalFunction) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="node-props__row" style={{ gap: 6 }}>
        <button type="button" onClick={() => setOpen(true)}>
          {graphical ? t('dynamic.props.editGraphical') : t('dynamic.props.becomeGraphical')}
        </button>
        {graphical && (
          <button
            type="button"
            onClick={onClear}
            title={t('dynamic.props.removeGraphicalTitle')}
          >
            {t('dynamic.props.clearGraphical')}
          </button>
        )}
      </div>
      {open && (
        <GraphicalFunctionEditor
          initial={graphical}
          onClose={() => setOpen(false)}
          onSave={(g) => {
            onSave(g);
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function RequiredInputsList({ required }: { required: string[] }) {
  const { t } = useTranslation();
  if (required.length === 0) {
    return <p className="node-props__hint">{t('dynamic.props.noRequiredInputs')}</p>;
  }
  return (
    <div className="node-props__row node-props__row--stack">
      <span className="node-props__label">{t('dynamic.props.requiredInputs')}</span>
      <div className="node-props__control">
        {required.map((r) => (
          <code key={r} style={{ marginRight: 6 }}>
            {r}
          </code>
        ))}
      </div>
    </div>
  );
}

function ValidationHints({ issues }: { issues: string[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="node-props__hint" style={{ color: '#c0392b' }}>
      {issues.map((m, i) => (
        <li key={i}>{m}</li>
      ))}
    </ul>
  );
}
