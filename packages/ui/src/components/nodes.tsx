import {
  Handle,
  Position,
  useReactFlow,
  type Node,
  type NodeProps,
  type NodeTypes,
} from '@xyflow/react';
import type { ChangeEvent } from 'react';
import { Fragment, useCallback, useContext } from 'react';
import { useTranslation } from 'react-i18next';
import { tokenize } from '../state/diagramAnalysis';
import { DiagramAnalysisContext } from '../state/diagramAnalysisContext';
import { TitleBlockContext, type TitleBlockBinding } from '../state/titleBlockContext';
import { fieldRules } from '../validation/fieldRules';

export type NodeKind =
  | 'initialConditions'
  | 'assignment'
  | 'decision'
  | 'routine'
  | 'salida'
  | 'connector'
  | 'comment'
  | 'titleBlock'
  | 'loop';

// Order is stable; UI labels live in the i18n catalog under `nodeTypes.<value>`.
export const NODE_TYPE_OPTIONS: { value: NodeKind }[] = [
  { value: 'initialConditions' },
  { value: 'assignment' },
  { value: 'decision' },
  { value: 'routine' },
  { value: 'loop' },
  { value: 'salida' },
  { value: 'connector' },
  { value: 'comment' },
  { value: 'titleBlock' },
];

export interface FlowNodeData extends Record<string, unknown> {
  label?: string;
  // decision-only — flips Sí/No vertices left-right
  flipped?: boolean;
  // connector-only — rotates the inner label 0/90/180/270
  rotation?: number;
  // loop-only — counter variable name + init/final expressions
  counter?: string;
  init?: string;
  final?: string;
  // routine-only — toggles "rutina" vs "función" semantics in the catedra
  // notation, used by NodePropertiesPanel.
  callKind?: 'routine' | 'function' | 'subroutine';
  formula?: string;
  assignTo?: string;
}

type FlowNodeT = Node<FlowNodeData>;

// Typed accessors so callers don't repeat `(n.data as { ... })?.x` everywhere.
// Accept the loose `Record<string, unknown>` shape so both React Flow's
// Node<FlowNodeData> and the shared schema's ModelNode (whose data is
// untyped) feed into the same helpers without casts on the call site.
type NodeLike = { data?: Record<string, unknown> | undefined };

export function nodeLabel(n: NodeLike): string {
  return typeof n.data?.label === 'string' ? n.data.label : '';
}
export function nodeFlipped(n: NodeLike): boolean {
  return Boolean(n.data?.flipped);
}
export function nodeRotation(n: NodeLike): number {
  return typeof n.data?.rotation === 'number' ? n.data.rotation : 0;
}

function useLabelSetter(id: string) {
  const rf = useReactFlow();
  return useCallback(
    (e: ChangeEvent<HTMLTextAreaElement>) => {
      const next = e.target.value;
      rf.setNodes((nodes) =>
        nodes.map((n) =>
          n.id === id ? { ...n, data: { ...(n.data ?? {}), label: next } } : n,
        ),
      );
    },
    [id, rf],
  );
}

function LabelInput({
  id,
  label,
  placeholder,
}: {
  id: string;
  label: string;
  placeholder: string;
}) {
  const onChange = useLabelSetter(id);
  const analysis = useContext(DiagramAnalysisContext);
  // The mirror serves two roles: (1) sizes the inline-block wrapper so the
  // textarea hugs the actual rendered text width, and (2) shows colored
  // token spans (red for identifiers used here but not declared in the
  // Variables panel). The textarea on top renders `color: transparent`, so
  // only the mirror's coloring is visible while typing remains normal.
  const showPlaceholder = label === '';
  const displayText = showPlaceholder ? placeholder : label;
  const lines = displayText.split('\n');
  const rows = lines.length;
  return (
    <span className="node-label__wrap">
      <span
        className={`node-label__mirror ${showPlaceholder ? 'node-label__mirror--placeholder' : ''}`}
        aria-hidden="true"
      >
        {lines.map((line, lineIdx) => (
          <span key={lineIdx} className="node-label__mirror-line">
            {line === ''
              ? ' '
              : showPlaceholder
                ? line
                : tokenize(line).map((tok, i) =>
                    tok.isIdent && fieldRules.diagramRefUndefined(tok.value, analysis) ? (
                      <span key={i} className="node-label__mirror-undef">
                        {tok.value}
                      </span>
                    ) : (
                      <Fragment key={i}>{tok.value}</Fragment>
                    ),
                  )}
          </span>
        ))}
      </span>
      <textarea
        // `nodrag` tells React Flow to skip drag-on-mousedown for this element
        // so clicking focuses it instead of dragging the node. `nopan` prevents
        // the canvas from panning while typing.
        className="node-label nodrag nopan"
        value={label}
        onChange={onChange}
        placeholder={placeholder}
        rows={rows}
        wrap="off"
        spellCheck={false}
      />
    </span>
  );
}

export function AssignmentNode({ id, data, selected }: NodeProps<FlowNodeT>) {
  return (
    <div className={`node node--assignment ${selected ? 'node--selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <LabelInput id={id} label={data.label ?? ''} placeholder="T = T+1" />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function InitialConditionsNode({ id, data, selected }: NodeProps<FlowNodeT>) {
  return (
    <div className={`node node--initial ${selected ? 'node--selected' : ''}`}>
      <LabelInput id={id} label={data.label ?? ''} placeholder="C.I." />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

// A rhombus inscribes the largest rectangle whose width/W + height/H ≤ 1
// (where W,H are the rhombus's bounding box). To keep the text rectangle WxH
// strictly inside, we want W_rhombus ≥ 2*W_text and H_rhombus ≥ 2*H_text. Pad
// each side by ~half the text dimension plus a small buffer so the longer the
// label, the wider the diamond grows.
function decisionPadding(label: string, placeholder: string): { x: number; y: number } {
  const text = label !== '' ? label : placeholder;
  const lines = text.split('\n');
  // Same +2 buffer as LabelInput's `cols` so the diamond matches the textarea's
  // visual width.
  const cols = Math.min(50, Math.max(...lines.map((l) => l.length), 3)) + 2;
  const rows = lines.length;
  // System-ui at 12px averages ~7px per char. Round up to err on the safe side.
  const textW = cols * 7.5 + 6;
  const textH = rows * 18 + 4;
  // Inscribed-rectangle math says padding ≥ textW/2 (per side) is enough; the
  // small additive (+6 / +4) absorbs stroke width and rounding so text never
  // touches the slanted edges.
  const padX = Math.max(20, Math.ceil(textW / 2 + 6));
  const padY = Math.max(12, Math.ceil(textH / 2 + 4));
  return { x: padX, y: padY };
}

export function DecisionNode({ id, data, selected }: NodeProps<FlowNodeT>) {
  const flipped = nodeFlipped({ data });
  const leftLabel = flipped ? 'no' : 'sí';
  const rightLabel = flipped ? 'sí' : 'no';
  const label = data.label ?? '';
  const pad = decisionPadding(label, 'A ≤ B');
  return (
    <div
      className={`node node--decision ${selected ? 'node--selected' : ''}`}
      style={{ padding: `${pad.y}px ${pad.x}px` }}
    >
      <svg className="node__shape" viewBox="0 0 140 80" preserveAspectRatio="none">
        {/* Explicit SVG attributes are fallbacks for html-to-image: defaults
             would render as black-fill / no-stroke. The screen CSS still
             overrides these for selection (celeste fill, blue stroke) and
             dark mode. */}
        <polygon
          points="70,0 140,40 70,80 0,40"
          fill="white"
          stroke="#444"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <Handle type="target" position={Position.Top} />
      <LabelInput id={id} label={label} placeholder="A ≤ B" />
      {/* Handle positions follow `flipped` so drag-to-connect from the
           visually-Si vertex creates an edge with sourceHandle="yes" (and
           "no" for the opposite vertex). floatingEdgeUtils' routing logic
           also honors `flipped`; both stay aligned. */}
      <Handle type="source" id="yes" position={flipped ? Position.Right : Position.Left} />
      <Handle type="source" id="no" position={flipped ? Position.Left : Position.Right} />
      <span
        className={`node--decision__side node--decision__side--left node--decision__side--${
          flipped ? 'no' : 'yes'
        }`}
      >
        {leftLabel}
      </span>
      <span
        className={`node--decision__side node--decision__side--right node--decision__side--${
          flipped ? 'yes' : 'no'
        }`}
      >
        {rightLabel}
      </span>
    </div>
  );
}

export function RoutineNode({ id, data, selected }: NodeProps<FlowNodeT>) {
  const analysis = useContext(DiagramAnalysisContext);
  const invalid = fieldRules.routineFunctionInvalid(data, analysis.dataVarNames);
  const isGenData = (data as { callKind?: unknown })?.callKind === 'function';
  return (
    <div
      className={`node node--routine ${selected ? 'node--selected' : ''} ${
        invalid ? 'node--invalid' : ''
      } ${isGenData ? 'node--gen-data' : ''}`}
    >
      <svg className="node__shape" viewBox="0 0 140 60" preserveAspectRatio="none">
        <polygon
          points="20,0 120,0 140,30 120,60 20,60 0,30"
          fill="white"
          stroke="#444"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <Handle type="target" position={Position.Top} />
      <LabelInput id={id} label={data.label ?? ''} placeholder="generar IA" />
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

export function SalidaNode({ id, data, selected }: NodeProps<FlowNodeT>) {
  const label = data.label ?? '';
  const text = label !== '' ? label : 'imprimir PTO';
  const rows = text.split('\n').length;
  // The wave's peak sits at y≈38.5/50 ≈ 77% of the SVG height, so we need
  // textarea bottom < 0.77 × box height. Solving for padding-bottom:
  //   padBottom ≥ 0.30 × (padTop + textH) + buffer
  // textH approximates `rows × line-height(15.6) + textarea-padding(4)`. The
  // dynamic value replaces the previous percentage-of-width padding, which
  // failed for narrow boxes (now common since the textarea hugs the text).
  const textH = rows * 16 + 4;
  const padBottom = Math.ceil((6 + textH) * 0.32) + 4;
  return (
    <div
      className={`node node--salida ${selected ? 'node--selected' : ''}`}
      style={{ paddingBottom: `${padBottom}px` }}
    >
      {/* "Document" / data output symbol: top, left, right edges straight,
           bottom edge a stretched-S wave. Drawn as an SVG path because the
           curve can't be expressed as a polygon. */}
      <svg className="node__shape" viewBox="0 0 140 50" preserveAspectRatio="none">
        <path
          d="M 0,0 L 140,0 L 140,42 C 105,54 35,30 0,42 Z"
          fill="white"
          stroke="#444"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <Handle type="target" position={Position.Top} />
      <LabelInput id={id} label={label} placeholder="imprimir PTO" />
    </div>
  );
}

export function ConnectorNode({ id, data, selected }: NodeProps<FlowNodeT>) {
  // Rotation is purely visual (the label rotates inside the circle). Edges
  // route to the closest side regardless via floatingEdgeUtils, so rotation
  // doesn't affect connectivity — it's just a layout aid.
  const rotation = nodeRotation({ data }) % 360;
  return (
    <div className={`node node--connector ${selected ? 'node--selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" id="t-left" position={Position.Left} />
      <Handle type="target" id="t-right" position={Position.Right} />
      <Handle type="target" id="t-bottom" position={Position.Bottom} />
      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" id="s-top" position={Position.Top} />
      <Handle type="source" id="s-left" position={Position.Left} />
      <Handle type="source" id="s-right" position={Position.Right} />
      <div
        className="node--connector__inner"
        style={rotation ? { transform: `rotate(${rotation}deg)` } : undefined}
      >
        <LabelInput id={id} label={data.label ?? ''} placeholder="A" />
      </div>
    </div>
  );
}

// AutoCAD-style title block. No handles (cannot connect), thicker border, and
// a small grid of editable fields stored on `data`. Lives on the canvas like
// any other node so it gets dragged, snapped, exported and printed alongside
// the diagram.
type EditableTitleKey = 'label' | 'creator' | 'version';

const SETTER_BY_KEY: Record<EditableTitleKey, keyof TitleBlockBinding> = {
  label: 'setLabel',
  creator: 'setCreator',
  version: 'setVersion',
};

function TitleBlockField({
  fieldKey,
  binding,
  placeholder,
}: {
  fieldKey: EditableTitleKey;
  binding: TitleBlockBinding;
  placeholder: string;
}) {
  const value = binding[fieldKey];
  const setter = binding[SETTER_BY_KEY[fieldKey]] as (v: string) => void;
  const onChange = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => setter(e.target.value),
    [setter],
  );
  return (
    <input
      className="title-block__input nodrag nopan"
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      spellCheck={false}
    />
  );
}

// "2026-05-01T13:42:08.000Z" → "2026-05-01 13:42". Empty string when there's
// no mtime yet (unsaved file).
function formatFecha(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TitleBlockNode({ selected }: NodeProps<FlowNodeT>) {
  const binding = useContext(TitleBlockContext);
  const { t } = useTranslation();
  if (!binding) {
    return (
      <div className={`node node--titleBlock ${selected ? 'node--selected' : ''}`}>
        {t('titleBlock.noBinding')}
      </div>
    );
  }
  return (
    <div className={`node node--titleBlock ${selected ? 'node--selected' : ''}`}>
      <div className="title-block__row">
        <span className="title-block__label">{t('titleBlock.title')}</span>
        <TitleBlockField
          fieldKey="label"
          binding={binding}
          placeholder={t('titleBlock.titlePlaceholder')}
        />
      </div>
      <div className="title-block__row">
        <span className="title-block__label">{t('titleBlock.author')}</span>
        <TitleBlockField
          fieldKey="creator"
          binding={binding}
          placeholder={t('titleBlock.authorPlaceholder')}
        />
      </div>
      <div className="title-block__row">
        <span className="title-block__label">{t('titleBlock.date')}</span>
        <span className="title-block__readonly" title={t('titleBlock.dateTooltip')}>
          {formatFecha(binding.fecha) || t('titleBlock.empty')}
        </span>
      </div>
      <div className="title-block__row">
        <span className="title-block__label">{t('titleBlock.version')}</span>
        <TitleBlockField
          fieldKey="version"
          binding={binding}
          placeholder={t('titleBlock.versionPlaceholder')}
        />
      </div>
    </div>
  );
}

// Free-floating annotation. No handles, so React Flow won't allow connections.
// Used for comments / call-outs in the diagram that aren't part of the flow.
export function CommentNode({ id, data, selected }: NodeProps<FlowNodeT>) {
  return (
    <div className={`node node--comment ${selected ? 'node--selected' : ''}`}>
      <LabelInput id={id} label={data.label ?? ''} placeholder="comentario" />
    </div>
  );
}

// For-loop block: a circle with a horizontal diameter line and a vertical
// half-line in the lower half. Top half shows the counter variable; the two
// lower quadrants hold the init and final expressions. Runtime semantics are
// in `flowchartStepper`: first entry → counter = init, subsequent entries →
// counter += 1, then test counter <= final to choose body / exit.
export function LoopNode({ id, data, selected }: NodeProps<FlowNodeT>) {
  const rf = useReactFlow();
  const counter = typeof data.counter === 'string' ? data.counter : '';
  const init = typeof data.init === 'string' ? data.init : '';
  const final = typeof data.final === 'string' ? data.final : '';
  const setField = useCallback(
    (key: 'counter' | 'init' | 'final') =>
      (e: ChangeEvent<HTMLInputElement>) => {
        const next = e.target.value;
        rf.setNodes((nodes) =>
          nodes.map((n) =>
            n.id === id ? { ...n, data: { ...(n.data ?? {}), [key]: next } } : n,
          ),
        );
      },
    [id, rf],
  );
  return (
    <div className={`node node--loop ${selected ? 'node--selected' : ''}`}>
      <svg className="node__shape" viewBox="0 0 100 100" preserveAspectRatio="none">
        <circle
          cx="50"
          cy="50"
          r="48"
          fill="white"
          stroke="#444"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="2"
          y1="50"
          x2="98"
          y2="50"
          stroke="#444"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
        <line
          x1="50"
          y1="50"
          x2="50"
          y2="98"
          stroke="#444"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <Handle type="target" position={Position.Top} />
      <input
        className="loop__counter nodrag nopan"
        value={counter}
        onChange={setField('counter')}
        placeholder="i"
        spellCheck={false}
      />
      <input
        className="loop__init nodrag nopan"
        value={init}
        onChange={setField('init')}
        placeholder="1"
        spellCheck={false}
      />
      <input
        className="loop__final nodrag nopan"
        value={final}
        onChange={setField('final')}
        placeholder="N"
        spellCheck={false}
      />
      {/* "Continue" handles on both sides — the user picks whichever fits the
           layout. The runtime treats both as the loop-back edge. */}
      <Handle type="source" id="yes" position={Position.Right} />
      <Handle type="source" id="yes-left" position={Position.Left} />
      <Handle type="source" id="no" position={Position.Bottom} />
    </div>
  );
}

export const NODE_TYPES: NodeTypes = {
  initialConditions: InitialConditionsNode,
  assignment: AssignmentNode,
  decision: DecisionNode,
  routine: RoutineNode,
  salida: SalidaNode,
  connector: ConnectorNode,
  comment: CommentNode,
  titleBlock: TitleBlockNode,
  loop: LoopNode,
};
