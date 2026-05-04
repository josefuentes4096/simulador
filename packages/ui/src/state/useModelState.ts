import {
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
} from '@xyflow/react';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useState } from 'react';
import {
  canonicalize,
  type DeltaTRow,
  type DynamicBlock,
  type DynamicConnector,
  type DynamicFlow,
  type DynamicRunSpecs,
  type EventTableMode,
  type InitialEvent,
  type ModelEvent,
  type ModelVariable,
  type SimulationModel,
  type SimulationType,
  type TeiRow,
  type Viewport,
} from '@simulador/shared';

const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

// Defaults for the dynamic-simulation run specs. Match the spec's
// "razonable" default: From=0, To=12 Months, dt=0.25, Euler.
const DEFAULT_DYNAMIC_RUN_SPECS: DynamicRunSpecs = {
  startTime: 0,
  stopTime: 12,
  dt: 0.25,
  timeUnit: 'Months',
  integrationMethod: 'Euler',
};

export type FlowNode = Node;
export type FlowEdge = Edge;

export interface ModelState {
  // The model's `metadata.name` and `metadata.description`. Read-only at
  // the API surface — set indirectly via load() / by saving with a new path.
  name: string;
  description: string;
  // Title-block fields. Surfaced as top-level state so the on-canvas Cuadro
  // de rótulo can edit them directly and the values round-trip through the
  // JSON metadata block. `fecha` is OS-derived (file mtime) and stored as
  // App-level state, not here. `builtWith` is the "v.B" stamp updated on
  // every save (handled in App.onSave) but kept here so load/serialize
  // see it as plain state.
  label: string;
  setLabel: (label: string) => void;
  creator: string;
  setCreator: (creator: string) => void;
  version: string;
  setVersion: (version: string) => void;
  builtWith: string;
  setBuiltWith: (builtWith: string) => void;
  paperSize: 'a4' | 'letter' | 'legal' | 'a3' | 'a5';
  setPaperSize: (s: 'a4' | 'letter' | 'legal' | 'a3' | 'a5') => void;
  paperOrientation: 'portrait' | 'landscape';
  setPaperOrientation: (o: 'portrait' | 'landscape') => void;
  simulationType: SimulationType;
  setSimulationType: (t: SimulationType) => void;
  eventTableMode: EventTableMode;
  setEventTableMode: (m: EventTableMode) => void;
  tei: TeiRow[];
  setTei: Dispatch<SetStateAction<TeiRow[]>>;
  deltaT: DeltaTRow[];
  setDeltaT: Dispatch<SetStateAction<DeltaTRow[]>>;
  breakpoints: Set<string>;
  setBreakpoints: Dispatch<SetStateAction<Set<string>>>;
  nodes: FlowNode[];
  setNodes: Dispatch<SetStateAction<FlowNode[]>>;
  onNodesChange: OnNodesChange<FlowNode>;
  edges: FlowEdge[];
  setEdges: Dispatch<SetStateAction<FlowEdge[]>>;
  onEdgesChange: OnEdgesChange<FlowEdge>;
  variables: ModelVariable[];
  setVariables: Dispatch<SetStateAction<ModelVariable[]>>;
  events: ModelEvent[];
  setEvents: Dispatch<SetStateAction<ModelEvent[]>>;
  initialEvents: InitialEvent[];
  setInitialEvents: Dispatch<SetStateAction<InitialEvent[]>>;
  viewport: Viewport;
  setViewport: Dispatch<SetStateAction<Viewport>>;
  // Dynamic-simulation slice. Independent of the discrete diagram above.
  // Held as React Flow nodes/edges (not the schema types) so the dynamic
  // canvas behaves naturally — drag/select/snapping all "just work". The
  // schema-level conversion (DynamicBlock/DynamicFlow/DynamicConnector)
  // happens only in load() and serialize().
  dynamicNodes: FlowNode[];
  setDynamicNodes: Dispatch<SetStateAction<FlowNode[]>>;
  onDynamicNodesChange: OnNodesChange<FlowNode>;
  dynamicEdges: FlowEdge[];
  setDynamicEdges: Dispatch<SetStateAction<FlowEdge[]>>;
  onDynamicEdgesChange: OnEdgesChange<FlowEdge>;
  dynamicRunSpecs: DynamicRunSpecs;
  setDynamicRunSpecs: Dispatch<SetStateAction<DynamicRunSpecs>>;
  dynamicViewport: Viewport;
  setDynamicViewport: Dispatch<SetStateAction<Viewport>>;
  load: (model: SimulationModel) => void;
  serialize: () => SimulationModel;
}

export function useModelState(): ModelState {
  const [name, setName] = useState('untitled');
  const [description, setDescription] = useState('');
  const [label, setLabel] = useState('');
  const [creator, setCreator] = useState('');
  const [version, setVersion] = useState('');
  const [builtWith, setBuiltWith] = useState('');
  const [paperSize, setPaperSize] = useState<'a4' | 'letter' | 'legal' | 'a3' | 'a5'>('a4');
  const [paperOrientation, setPaperOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [simulationType, setSimulationType] = useState<SimulationType>('event-to-event');
  const [eventTableMode, setEventTableMode] = useState<EventTableMode>('unified');
  const [tei, setTei] = useState<TeiRow[]>([]);
  const [deltaT, setDeltaT] = useState<DeltaTRow[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<FlowEdge>([]);
  const [variables, setVariables] = useState<ModelVariable[]>([]);
  const [events, setEvents] = useState<ModelEvent[]>([]);
  const [initialEvents, setInitialEvents] = useState<InitialEvent[]>([]);
  const [breakpoints, setBreakpoints] = useState<Set<string>>(new Set());
  const [viewport, setViewport] = useState<Viewport>(DEFAULT_VIEWPORT);
  // Dynamic canvas: separate React Flow state so drag/select doesn't bleed
  // between the discrete and dynamic diagrams.
  const [dynamicNodes, setDynamicNodes, onDynamicNodesChange] = useNodesState<FlowNode>([]);
  const [dynamicEdges, setDynamicEdges, onDynamicEdgesChange] = useEdgesState<FlowEdge>([]);
  const [dynamicRunSpecs, setDynamicRunSpecs] = useState<DynamicRunSpecs>(
    DEFAULT_DYNAMIC_RUN_SPECS,
  );
  const [dynamicViewport, setDynamicViewport] = useState<Viewport>(DEFAULT_VIEWPORT);

  const load = useCallback(
    (model: SimulationModel): void => {
      setName(model.metadata.name);
      setDescription(model.metadata.description ?? '');
      setLabel(model.metadata.label ?? '');
      setCreator(model.metadata.creator ?? '');
      setVersion(model.metadata.version ?? '');
      setBuiltWith(model.metadata.builtWith ?? '');
      setPaperSize(model.metadata.paperSize ?? 'a4');
      setPaperOrientation(model.metadata.paperOrientation ?? 'portrait');
      setSimulationType(model.metadata.simulationType ?? 'event-to-event');
      setEventTableMode(model.metadata.eventTableMode ?? 'unified');
      const newBreakpoints = new Set<string>();
      setNodes(
        model.diagram.nodes.map((n): FlowNode => {
          // Migrations of obsolete `type` values so older saved files keep
          // loading cleanly:
          //   - "output" → "salida"  (avoid React Flow reserved name)
          //   - "label"  → "connector"  (Etiqueta was removed; connectors
          //                              cover the same "no-op routing marker"
          //                              role and accept edges from any side)
          let type = n.type;
          if (type === 'output') type = 'salida';
          else if (type === 'label') type = 'connector';
          // Breakpoints persist as `data.breakpoint = true` per node. Move
          // them into the side-car Set used by the run loop so the rest of
          // the app keeps reading from one place.
          if ((n.data as { breakpoint?: boolean } | undefined)?.breakpoint) {
            newBreakpoints.add(n.id);
          }
          // Legacy migration: subroutine calls used to carry their target
          // variable in `data.assignTo`. New convention encodes it in the
          // label as `Y = X` (Y = receiver, X = procedure). Rewrite the
          // label and drop assignTo on load so the rest of the app sees
          // only the new format.
          let label = n.label ?? '';
          const incoming = (n.data ?? {}) as { callKind?: unknown; assignTo?: unknown };
          if (
            type === 'routine' &&
            incoming.callKind === 'subroutine' &&
            typeof incoming.assignTo === 'string' &&
            incoming.assignTo.trim() !== ''
          ) {
            const proc = label.trim();
            if (proc !== '' && !label.includes('=')) {
              label = `${incoming.assignTo.trim()} = ${proc}`;
            }
          }
          const data: Record<string, unknown> = { label, ...(n.data ?? {}) };
          // Strip the legacy field so the new shape is the canonical one.
          if (type === 'routine' && data.callKind === 'subroutine') {
            delete data.assignTo;
          }
          return {
            id: n.id,
            type,
            data,
            position: n.position ?? { x: 0, y: 0 },
          };
        }),
      );
      setBreakpoints(newBreakpoints);
      setEdges(
        model.diagram.edges.map((e): FlowEdge => {
          const data: Record<string, unknown> = {};
          if (e.bend !== undefined) data['bend'] = e.bend;
          // Legacy controlPoints are preserved on the in-memory edge so a
          // round-trip Save/Open doesn't lose them, but the renderer no
          // longer reads them.
          if (e.controlPoints !== undefined) data['controlPoints'] = e.controlPoints;
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            type: 'floating',
            ...(e.sourceHandle !== undefined ? { sourceHandle: e.sourceHandle } : {}),
            ...(e.targetHandle !== undefined ? { targetHandle: e.targetHandle } : {}),
            ...(e.label !== undefined ? { label: e.label } : {}),
            ...(Object.keys(data).length > 0 ? { data } : {}),
          };
        }),
      );
      // Migrate legacy `kind: 'input'` (removed in 2026-05) to 'control', which
      // now plays the same role: parameters fixed at run start.
      setVariables(
        model.behavior.variables.map((v) =>
          (v.kind as string) === 'input' ? { ...v, kind: 'control' } : v,
        ),
      );
      setEvents(model.behavior.events);
      setInitialEvents(model.behavior.initialEvents ?? []);
      setTei(model.behavior.tei ?? []);
      setDeltaT(model.behavior.deltaT ?? []);
      setViewport(model.diagram.viewport ?? DEFAULT_VIEWPORT);
      // Dynamic section is optional. When absent (most existing files), we
      // reset the slice to empty/defaults so a freshly loaded discrete file
      // doesn't carry over leftover stocks from a previous session.
      const dyn = model.dynamic;
      // Map schema kinds to React Flow `node.type`. Stays in sync with the
      // mapping used by the BlockPalette when minting new nodes.
      const RF_TYPE_BY_KIND: Record<string, string> = {
        stock: 'stock',
        converter: 'stellaConverter',
        cloud: 'cloud',
        comment: 'stellaComment',
        label: 'stellaLabel',
      };
      setDynamicNodes(
        (dyn?.blocks ?? []).map(
          (b): FlowNode => ({
            id: b.id,
            type: RF_TYPE_BY_KIND[b.kind] ?? 'stock',
            position: { x: b.position.x, y: b.position.y },
            data: {
              name: b.name,
              ...(b.initialExpression !== undefined
                ? { initialExpression: b.initialExpression }
                : {}),
              ...(b.nonNegative !== undefined ? { nonNegative: b.nonNegative } : {}),
              ...(b.expression !== undefined ? { expression: b.expression } : {}),
              ...(b.units !== undefined ? { units: b.units } : {}),
              ...(b.documentation !== undefined ? { documentation: b.documentation } : {}),
              ...(b.text !== undefined ? { text: b.text } : {}),
              ...(b.graphical !== undefined ? { graphical: b.graphical } : {}),
            },
          }),
        ),
      );
      // Flows + connectors both live in dynamicEdges. Distinguish via
      // `edge.type`. Fase 4 will introduce the actual edge components; here
      // we just hydrate the data so a round-trip survives.
      const flowEdges: FlowEdge[] = (dyn?.flows ?? []).map((f) => ({
        id: f.id,
        source: f.fromId ?? '',
        target: f.toId ?? '',
        type: 'flow',
        data: {
          name: f.name,
          expression: f.expression,
          flowType: f.flowType,
          ...(f.units !== undefined ? { units: f.units } : {}),
          ...(f.waypoints !== undefined ? { waypoints: f.waypoints } : {}),
          ...(f.regulatorOffset !== undefined ? { regulatorOffset: f.regulatorOffset } : {}),
          ...(f.documentation !== undefined ? { documentation: f.documentation } : {}),
          // Track the schema-level "null = cloud" intent in case load() sees
          // a flow whose endpoint is missing in `blocks` (we'd have to invent
          // a cloud node). v1 saves cloud blocks explicitly so this path is
          // unused, but the data field keeps it lossless.
          fromCloud: f.fromId === null,
          toCloud: f.toId === null,
        },
      }));
      const connEdges: FlowEdge[] = (dyn?.connectors ?? []).map((c) => ({
        id: c.id,
        source: c.fromId,
        target: c.toId,
        type: 'connector',
        data: { ...(c.curvature !== undefined ? { curvature: c.curvature } : {}) },
      }));
      setDynamicEdges([...flowEdges, ...connEdges]);
      setDynamicRunSpecs(dyn?.runSpecs ?? DEFAULT_DYNAMIC_RUN_SPECS);
      setDynamicViewport(dyn?.viewport ?? DEFAULT_VIEWPORT);
    },
    [setDynamicEdges, setDynamicNodes, setEdges, setNodes],
  );

  const serialize = useCallback((): SimulationModel => {
    const raw: SimulationModel = {
      schemaVersion: 2,
      metadata: {
        name,
        ...(description ? { description } : {}),
        ...(label ? { label } : {}),
        ...(creator ? { creator } : {}),
        ...(version ? { version } : {}),
        ...(builtWith ? { builtWith } : {}),
        ...(paperSize !== 'a4' ? { paperSize } : {}),
        ...(paperOrientation !== 'portrait' ? { paperOrientation } : {}),
        ...(simulationType !== 'event-to-event' ? { simulationType } : {}),
        ...(eventTableMode !== 'unified' ? { eventTableMode } : {}),
      },
      behavior: {
        variables,
        events,
        ...(initialEvents.length > 0 ? { initialEvents } : {}),
        ...(tei.length > 0 ? { tei } : {}),
        ...(deltaT.length > 0 ? { deltaT } : {}),
      },
      diagram: {
        nodes: nodes.map((n) => {
          // `label` is hoisted to a top-level field by canonicalNode; everything
          // else under `data` (e.g. flipped, callKind, formula) is preserved as-is.
          // Breakpoints live in the side-car Set; merge them in here so the
          // saved JSON carries `data.breakpoint = true` for each.
          const { label: _drop, breakpoint: _dropBp, ...rest } = (n.data ?? {}) as Record<
            string,
            unknown
          >;
          const data = { ...rest };
          if (breakpoints.has(n.id)) data.breakpoint = true;
          const hasData = Object.keys(data).length > 0;
          return {
            id: n.id,
            type: n.type ?? 'default',
            label: typeof n.data?.['label'] === 'string' ? (n.data['label'] as string) : '',
            position: n.position,
            ...(hasData ? { data } : {}),
          };
        }),
        edges: edges.map((e) => {
          const dataAny = (e.data ?? {}) as {
            bend?: { dx: number; dy: number };
            controlPoints?: [{ dx: number; dy: number }, { dx: number; dy: number }];
          };
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            ...(typeof e.sourceHandle === 'string' ? { sourceHandle: e.sourceHandle } : {}),
            ...(typeof e.targetHandle === 'string' ? { targetHandle: e.targetHandle } : {}),
            ...(typeof e.label === 'string' ? { label: e.label } : {}),
            ...(dataAny.bend ? { bend: dataAny.bend } : {}),
            ...(dataAny.controlPoints ? { controlPoints: dataAny.controlPoints } : {}),
          };
        }),
        viewport: { x: viewport.x, y: viewport.y, zoom: viewport.zoom },
      },
      // Always pass the dynamic section through; canonicalize() will drop it
      // if there's nothing in it. Keeping it here means a user can switch the
      // type combo back and forth without losing in-memory dynamic content.
      dynamic: {
        blocks: dynamicNodes.map((n): DynamicBlock => {
          // React Flow `node.type` → schema `kind`. Inverse of the table in
          // load(). Anything unrecognized falls back to 'stock' for safety.
          const KIND_BY_RF_TYPE: Record<string, DynamicBlock['kind']> = {
            stock: 'stock',
            stellaConverter: 'converter',
            cloud: 'cloud',
            stellaComment: 'comment',
            stellaLabel: 'label',
          };
          const kind = KIND_BY_RF_TYPE[n.type ?? 'stock'] ?? 'stock';
          const data = (n.data ?? {}) as Record<string, unknown>;
          const block: DynamicBlock = {
            id: n.id,
            kind,
            name: typeof data['name'] === 'string' ? data['name'] : '',
            position: { x: n.position.x, y: n.position.y },
          };
          if (typeof data['initialExpression'] === 'string')
            block.initialExpression = data['initialExpression'];
          if (typeof data['nonNegative'] === 'boolean') block.nonNegative = data['nonNegative'];
          if (typeof data['expression'] === 'string') block.expression = data['expression'];
          if (typeof data['units'] === 'string') block.units = data['units'];
          if (typeof data['documentation'] === 'string')
            block.documentation = data['documentation'];
          if (typeof data['text'] === 'string') block.text = data['text'];
          if (data['graphical'] !== undefined)
            block.graphical = data['graphical'] as DynamicBlock['graphical'];
          return block;
        }),
        flows: dynamicEdges
          .filter((e) => e.type === 'flow')
          .map((e): DynamicFlow => {
            const data = (e.data ?? {}) as Record<string, unknown>;
            const flow: DynamicFlow = {
              id: e.id,
              name: typeof data['name'] === 'string' ? data['name'] : '',
              fromId: data['fromCloud'] === true ? null : e.source,
              toId: data['toCloud'] === true ? null : e.target,
              expression: typeof data['expression'] === 'string' ? data['expression'] : '',
              flowType: 'uniflow',
            };
            if (typeof data['units'] === 'string') flow.units = data['units'];
            if (Array.isArray(data['waypoints']))
              flow.waypoints = data['waypoints'] as DynamicFlow['waypoints'];
            if (typeof data['regulatorOffset'] === 'number')
              flow.regulatorOffset = data['regulatorOffset'];
            if (typeof data['documentation'] === 'string')
              flow.documentation = data['documentation'];
            return flow;
          }),
        connectors: dynamicEdges
          .filter((e) => e.type === 'connector')
          .map((e): DynamicConnector => {
            const data = (e.data ?? {}) as Record<string, unknown>;
            const conn: DynamicConnector = { id: e.id, fromId: e.source, toId: e.target };
            if (typeof data['curvature'] === 'number') conn.curvature = data['curvature'];
            return conn;
          }),
        runSpecs: dynamicRunSpecs,
        viewport: dynamicViewport,
      },
    };
    // Canonical form so "Save" produces git-diffable JSON.
    return canonicalize(raw);
  }, [
    breakpoints,
    builtWith,
    creator,
    description,
    edges,
    events,
    initialEvents,
    label,
    name,
    nodes,
    deltaT,
    eventTableMode,
    paperOrientation,
    paperSize,
    simulationType,
    tei,
    variables,
    version,
    viewport,
    dynamicNodes,
    dynamicEdges,
    dynamicRunSpecs,
    dynamicViewport,
  ]);

  return {
    name,
    description,
    label,
    setLabel,
    creator,
    setCreator,
    version,
    setVersion,
    builtWith,
    setBuiltWith,
    paperSize,
    setPaperSize,
    paperOrientation,
    setPaperOrientation,
    simulationType,
    setSimulationType,
    eventTableMode,
    setEventTableMode,
    tei,
    setTei,
    deltaT,
    setDeltaT,
    breakpoints,
    setBreakpoints,
    nodes,
    setNodes,
    onNodesChange,
    edges,
    setEdges,
    onEdgesChange,
    variables,
    setVariables,
    events,
    setEvents,
    initialEvents,
    setInitialEvents,
    viewport,
    setViewport,
    dynamicNodes,
    setDynamicNodes,
    onDynamicNodesChange,
    dynamicEdges,
    setDynamicEdges,
    onDynamicEdgesChange,
    dynamicRunSpecs,
    setDynamicRunSpecs,
    dynamicViewport,
    setDynamicViewport,
    load,
    serialize,
  };
}
