export type VariableKind =
  | 'state'
  | 'result'
  | 'control'
  | 'data'
  | 'array'
  | 'event-table'
  | 'event-table-array';

export type ScalarValue = number | string | boolean;

export interface ModelVariable {
  name: string;
  kind: VariableKind;
  // For most kinds: a scalar seed value. For `array` kind: either a number
  // (length — array of N zeros) or an explicit number array (the seed).
  initialValue?: ScalarValue | number[];
  description?: string;
}

export interface ModelEvent {
  name: string;
  handler: string;
  description?: string;
}

export interface ModelNode {
  id: string;
  type: string;
  label?: string;
  position?: { x: number; y: number };
  data?: Record<string, unknown>;
}

export interface ModelEdge {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string;
  targetHandle?: string;
  label?: string;
  // Optional manual override of the bend point of the smooth-step path
  // (orthogonal segments with rounded corners). Stored as a dx/dy offset
  // from the natural midpoint of the segment, so dragging the source or
  // target node carries the bend with it.
  bend?: { dx: number; dy: number };
  // Legacy: cubic bezier control points from the previous edge style.
  // Loaded for backward compatibility but ignored by the current renderer.
  controlPoints?: [{ dx: number; dy: number }, { dx: number; dy: number }];
}

// One row of the Delta-T-constant events table. Each row binds a TEF
// (event-table variable) with the set of events that fall into each Δt
// bucket. The bucket fields are free-form strings — typically the user lists
// event names comma-separated or one per line.
export interface DeltaTRow {
  tef?: string;
  propios?: string;
  prevCommitted?: string;
  futureCommitted?: string;
}

// One row of the Tabla de Eventos Independientes (TEI). Only used when
// `metadata.eventTableMode === 'independent'`. Documents the structure of an
// event type — which event-table variable holds its instances, the
// unconditioned/conditioned successors, the condition expression, etc.
export interface TeiRow {
  // Event-table variable holding the future-event instances. Reference by
  // name (`v.name` of a ModelVariable with kind === 'event-table').
  tef?: string;
  // The user-typed event name. Acts as the row's identifier — referenced by
  // the `unconditionalNext`/`conditionalNext` fields of other rows.
  event: string;
  unconditionalNext?: string;
  conditionalNext?: string;
  // Free-form JavaScript expression evaluated at event time.
  condition?: string;
  // Variable (kind === 'data') whose value chains the next event.
  chainer?: string;
  regret?: boolean;
  vector?: boolean;
  // Variable (kind === 'control') whose value sets the dimension of the
  // associated TEF (e.g., N puestos en una cola → tabla con N entradas).
  dimension?: string;
}

export interface InitialEvent {
  time: number;
  name: string;
  payload?: unknown;
}

// Time-advance strategy of the DES model. `event-to-event` jumps to the next
// scheduled event (default); `delta-t-constant` walks fixed-size dt steps;
// `dynamic` switches to continuous-time integration (Stocks-Flows-Converters,
// Stella/iThink-style). The engine and editor both branch on this value.
export type SimulationType = 'event-to-event' | 'delta-t-constant' | 'dynamic';

// In EaE mode, choice of how event tables are organized. `unified` keeps a
// single combined table; `independent` (TEI) keeps one table per event type.
// Documentation-only flag — the engine doesn't branch on it.
export type EventTableMode = 'unified' | 'independent';

export interface ModelMetadata {
  name: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  // Title-block fields, surfaced and edited from the on-canvas Cuadro de
  // rótulo. They live in metadata (not on the node) so the value the user
  // sees on the title block is the same value persisted in the JSON.
  // `fecha` is intentionally absent — it's derived from the OS file mtime,
  // not stored. `builtWith` is "<appVersion>.<build>" stamped on every save.
  label?: string;
  creator?: string;
  version?: string;
  builtWith?: string;
  // Paper layout used for the print pipeline and the on-canvas page guides.
  // Persisted so opening a file restores the same red-line grid the author
  // intended.
  paperSize?: 'a4' | 'letter' | 'legal' | 'a3' | 'a5';
  paperOrientation?: 'portrait' | 'landscape';
  simulationType?: SimulationType;
  eventTableMode?: EventTableMode;
}

export interface BehaviorSection {
  variables: ModelVariable[];
  events: ModelEvent[];
  initialEvents?: InitialEvent[];
  tei?: TeiRow[];
  deltaT?: DeltaTRow[];
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface DiagramSection {
  nodes: ModelNode[];
  edges: ModelEdge[];
  viewport?: Viewport;
}

// === Dynamic simulation (Stella/iThink-style) ===
//
// Coexists with the discrete-event diagram in the same JSON file. The active
// editor surface is selected by `metadata.simulationType`; both sections may
// hold content simultaneously so a user can model the same system with both
// methodologies without copying files.
//
// Block kinds:
//   - 'stock'     reservoir / accumulator (rectangle on the canvas)
//   - 'converter' constant or formula (circle)
//   - 'cloud'     visual sink/source for flow endpoints — auto-created when a
//                 flow has no Stock at one end. Carries no expression.
//   - 'comment'   free text (no model semantics)
//   - 'label'     title/label box (no model semantics)
// Flows live in `flows[]` (not `blocks[]`) because their topology is
// (source, target) plus a regulator widget — closer to an edge than a node.
// Action connectors live in `connectors[]` and are dependency arrows from a
// Stock/Flow/Converter to a Flow/Converter.
export type DynamicBlockKind = 'stock' | 'converter' | 'cloud' | 'comment' | 'label';

export interface DynamicGraphicalFunction {
  inputExpression?: string; // empty/undefined → uses TIME
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  points: { x: number; y: number }[];
  mode: 'continuous' | 'discrete';
}

export interface DynamicBlock {
  id: string;
  kind: DynamicBlockKind;
  // Visible label / variable name. For stocks/converters this is the
  // identifier used in equations (after normalization to snake_case).
  // Clouds, comments and labels carry only display text — no equation use.
  name: string;
  position: { x: number; y: number };
  // Stock-only: expression evaluated once at STARTTIME for the initial value.
  initialExpression?: string;
  // Stock-only: clamp to ≥ 0 each step. Default true.
  nonNegative?: boolean;
  // Converter-only: rate/constant/formula evaluated each step. If a graphical
  // function is attached, this string holds its input expression and the
  // numeric body lives in `graphical`.
  expression?: string;
  graphical?: DynamicGraphicalFunction;
  units?: string;
  documentation?: string;
  // Display-only: free text for comment/label blocks (not used in equations).
  text?: string;
}

export interface DynamicFlow {
  id: string;
  name: string;
  // Stock id, cloud id, or null = auto-cloud.
  fromId: string | null;
  toId: string | null;
  // Tasa (rate) — JS-like expression evaluated each step.
  expression: string;
  // Only 'uniflow' supported in v1; biflow is roadmap.
  flowType: 'uniflow';
  units?: string;
  // Geometry of the pipe between endpoints. Each waypoint is in flow coords.
  waypoints?: { x: number; y: number }[];
  // 0..1 along the pipe; default 0.5.
  regulatorOffset?: number;
  documentation?: string;
}

export interface DynamicConnector {
  id: string;
  // Origin: any block (Stock | Flow | Converter — clouds/comments/labels not
  // allowed as origin).
  fromId: string;
  // Destination: Flow or Converter only (Stock not allowed — manual rule).
  toId: string;
  // Optional curvature factor 0..1 for the bezier; default 0.5.
  curvature?: number;
}

// Run controls for the continuous integrator.
export interface DynamicRunSpecs {
  startTime: number;
  stopTime: number; // must be > startTime
  dt: number; // > 0
  timeUnit:
    | 'Seconds'
    | 'Minutes'
    | 'Hours'
    | 'Days'
    | 'Weeks'
    | 'Months'
    | 'Quarters'
    | 'Years'
    | 'Time'
    | string;
  integrationMethod: 'Euler' | 'RK2' | 'RK4';
  pauseInterval?: number;
}

export interface DynamicSection {
  blocks: DynamicBlock[];
  flows: DynamicFlow[];
  connectors: DynamicConnector[];
  runSpecs: DynamicRunSpecs;
  // Optional viewport snapshot for the dynamic canvas.
  viewport?: Viewport;
}

export interface SimulationModel {
  schemaVersion: 2;
  metadata: ModelMetadata;
  behavior: BehaviorSection;
  diagram: DiagramSection;
  // Optional Stella-style continuous model. Independent of the discrete
  // `behavior`+`diagram` pair — both can coexist in one file.
  dynamic?: DynamicSection;
}

// === Canonical serialization ===
//
// Goal: produce byte-stable JSON for git diffs. Two semantically identical
// models must serialize identically. Strategy:
//   - fixed top-level key order: schemaVersion → metadata → behavior → diagram
//   - fixed key order inside every nested object
//   - arrays sorted by a stable key (name / id / time+name) so reordering in
//     the editor doesn't show up as a diff
//   - undefined optionals are stripped (not emitted as null)

const compareString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function sortById<T extends { id: string }>(arr: readonly T[]): T[] {
  return [...arr].sort((a, b) => compareString(a.id, b.id));
}

function canonicalMetadata(m: ModelMetadata): ModelMetadata {
  const out: ModelMetadata = { name: m.name };
  if (m.description !== undefined) out.description = m.description;
  if (m.createdAt !== undefined) out.createdAt = m.createdAt;
  if (m.updatedAt !== undefined) out.updatedAt = m.updatedAt;
  if (m.label !== undefined) out.label = m.label;
  if (m.creator !== undefined) out.creator = m.creator;
  if (m.version !== undefined) out.version = m.version;
  if (m.builtWith !== undefined) out.builtWith = m.builtWith;
  if (m.paperSize !== undefined) out.paperSize = m.paperSize;
  if (m.paperOrientation !== undefined) out.paperOrientation = m.paperOrientation;
  if (m.simulationType !== undefined) out.simulationType = m.simulationType;
  if (m.eventTableMode !== undefined) out.eventTableMode = m.eventTableMode;
  return out;
}

function canonicalVariable(v: ModelVariable): ModelVariable {
  const out: ModelVariable = { name: v.name, kind: v.kind };
  if (v.initialValue !== undefined) {
    out.initialValue = Array.isArray(v.initialValue) ? [...v.initialValue] : v.initialValue;
  }
  if (v.description !== undefined) out.description = v.description;
  return out;
}

function canonicalEvent(e: ModelEvent): ModelEvent {
  const out: ModelEvent = { name: e.name, handler: e.handler };
  if (e.description !== undefined) out.description = e.description;
  return out;
}

function canonicalInitialEvent(ie: InitialEvent): InitialEvent {
  const out: InitialEvent = { time: ie.time, name: ie.name };
  if (ie.payload !== undefined) out.payload = ie.payload;
  return out;
}

function canonicalDeltaTRow(r: DeltaTRow): DeltaTRow {
  const out: DeltaTRow = {};
  if (r.tef !== undefined && r.tef !== '') out.tef = r.tef;
  if (r.propios !== undefined && r.propios !== '') out.propios = r.propios;
  if (r.prevCommitted !== undefined && r.prevCommitted !== '') out.prevCommitted = r.prevCommitted;
  if (r.futureCommitted !== undefined && r.futureCommitted !== '')
    out.futureCommitted = r.futureCommitted;
  return out;
}

function canonicalTeiRow(r: TeiRow): TeiRow {
  const out: TeiRow = { event: r.event };
  if (r.tef !== undefined) out.tef = r.tef;
  if (r.unconditionalNext !== undefined) out.unconditionalNext = r.unconditionalNext;
  if (r.conditionalNext !== undefined) out.conditionalNext = r.conditionalNext;
  if (r.condition !== undefined) out.condition = r.condition;
  if (r.chainer !== undefined) out.chainer = r.chainer;
  if (r.regret !== undefined) out.regret = r.regret;
  if (r.vector !== undefined) out.vector = r.vector;
  if (r.dimension !== undefined) out.dimension = r.dimension;
  return out;
}

function canonicalNode(n: ModelNode): ModelNode {
  const out: ModelNode = { id: n.id, type: n.type };
  if (n.label !== undefined) out.label = n.label;
  if (n.position !== undefined) out.position = { x: n.position.x, y: n.position.y };
  if (n.data !== undefined) out.data = n.data;
  return out;
}

function canonicalDynamicGraphical(g: DynamicGraphicalFunction): DynamicGraphicalFunction {
  const out: DynamicGraphicalFunction = {
    xMin: g.xMin,
    xMax: g.xMax,
    yMin: g.yMin,
    yMax: g.yMax,
    points: g.points.map((p) => ({ x: p.x, y: p.y })),
    mode: g.mode,
  };
  if (g.inputExpression !== undefined && g.inputExpression !== '')
    out.inputExpression = g.inputExpression;
  return out;
}

function canonicalDynamicBlock(b: DynamicBlock): DynamicBlock {
  const out: DynamicBlock = {
    id: b.id,
    kind: b.kind,
    name: b.name,
    position: { x: b.position.x, y: b.position.y },
  };
  if (b.initialExpression !== undefined) out.initialExpression = b.initialExpression;
  if (b.nonNegative !== undefined) out.nonNegative = b.nonNegative;
  if (b.expression !== undefined) out.expression = b.expression;
  if (b.graphical !== undefined) out.graphical = canonicalDynamicGraphical(b.graphical);
  if (b.units !== undefined) out.units = b.units;
  if (b.documentation !== undefined) out.documentation = b.documentation;
  if (b.text !== undefined) out.text = b.text;
  return out;
}

function canonicalDynamicFlow(f: DynamicFlow): DynamicFlow {
  const out: DynamicFlow = {
    id: f.id,
    name: f.name,
    fromId: f.fromId,
    toId: f.toId,
    expression: f.expression,
    flowType: f.flowType,
  };
  if (f.units !== undefined) out.units = f.units;
  if (f.waypoints !== undefined)
    out.waypoints = f.waypoints.map((w) => ({ x: w.x, y: w.y }));
  if (f.regulatorOffset !== undefined) out.regulatorOffset = f.regulatorOffset;
  if (f.documentation !== undefined) out.documentation = f.documentation;
  return out;
}

function canonicalDynamicConnector(c: DynamicConnector): DynamicConnector {
  const out: DynamicConnector = { id: c.id, fromId: c.fromId, toId: c.toId };
  if (c.curvature !== undefined) out.curvature = c.curvature;
  return out;
}

function canonicalDynamicRunSpecs(r: DynamicRunSpecs): DynamicRunSpecs {
  const out: DynamicRunSpecs = {
    startTime: r.startTime,
    stopTime: r.stopTime,
    dt: r.dt,
    timeUnit: r.timeUnit,
    integrationMethod: r.integrationMethod,
  };
  if (r.pauseInterval !== undefined) out.pauseInterval = r.pauseInterval;
  return out;
}

function canonicalDynamic(d: DynamicSection): DynamicSection {
  const out: DynamicSection = {
    blocks: sortById(d.blocks).map(canonicalDynamicBlock),
    flows: sortById(d.flows).map(canonicalDynamicFlow),
    connectors: sortById(d.connectors).map(canonicalDynamicConnector),
    runSpecs: canonicalDynamicRunSpecs(d.runSpecs),
  };
  if (d.viewport)
    out.viewport = { x: d.viewport.x, y: d.viewport.y, zoom: d.viewport.zoom };
  return out;
}

function canonicalEdge(e: ModelEdge): ModelEdge {
  const out: ModelEdge = { id: e.id, source: e.source, target: e.target };
  if (e.sourceHandle !== undefined) out.sourceHandle = e.sourceHandle;
  if (e.targetHandle !== undefined) out.targetHandle = e.targetHandle;
  if (e.label !== undefined) out.label = e.label;
  if (e.bend !== undefined) out.bend = { dx: e.bend.dx, dy: e.bend.dy };
  if (e.controlPoints !== undefined) {
    out.controlPoints = [
      { dx: e.controlPoints[0].dx, dy: e.controlPoints[0].dy },
      { dx: e.controlPoints[1].dx, dy: e.controlPoints[1].dy },
    ];
  }
  return out;
}

export function canonicalize(model: SimulationModel): SimulationModel {
  const initialEvents = model.behavior.initialEvents;
  return {
    schemaVersion: 2,
    metadata: canonicalMetadata(model.metadata),
    behavior: {
      // User-controlled ordering matters: the Variables panel exposes a "Sort
      // by type" action and lets the user reorder freely. Persist the order
      // the user produced rather than re-sorting here.
      variables: model.behavior.variables.map(canonicalVariable),
      events: model.behavior.events.map(canonicalEvent),
      ...(initialEvents && initialEvents.length > 0
        ? {
            initialEvents: [...initialEvents]
              .sort((a, b) => a.time - b.time || compareString(a.name, b.name))
              .map(canonicalInitialEvent),
          }
        : {}),
      // TEI rows preserve the user's order — they're a sequence, not a set —
      // so we don't sort, but we still canonicalize each row's key order.
      ...(model.behavior.tei && model.behavior.tei.length > 0
        ? { tei: model.behavior.tei.map(canonicalTeiRow) }
        : {}),
      ...(model.behavior.deltaT && model.behavior.deltaT.length > 0
        ? { deltaT: model.behavior.deltaT.map(canonicalDeltaTRow) }
        : {}),
    },
    diagram: {
      nodes: sortById(model.diagram.nodes).map(canonicalNode),
      edges: sortById(model.diagram.edges).map(canonicalEdge),
      ...(model.diagram.viewport
        ? {
            viewport: {
              x: model.diagram.viewport.x,
              y: model.diagram.viewport.y,
              zoom: model.diagram.viewport.zoom,
            },
          }
        : {}),
    },
    // Emit `dynamic` only when there is actual content. An empty
    // section (no blocks/flows/connectors) is treated as "not used"
    // so files that only ever live in discrete mode don't grow a
    // useless dynamic block. The runSpecs alone aren't enough to
    // count as content.
    ...(model.dynamic &&
    (model.dynamic.blocks.length > 0 ||
      model.dynamic.flows.length > 0 ||
      model.dynamic.connectors.length > 0)
      ? { dynamic: canonicalDynamic(model.dynamic) }
      : {}),
  };
}
