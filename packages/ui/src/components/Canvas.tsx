import {
  Background,
  BackgroundVariant,
  ConnectionMode,
  Controls,
  MarkerType,
  MiniMap,
  ReactFlow,
  ViewportPortal,
  addEdge,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type FinalConnectionState,
  type Node,
  type OnEdgesChange,
  type OnNodesChange,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { Dispatch, SetStateAction, MouseEvent as ReactMouseEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { FloatingEdge } from './FloatingEdge';
import { NODE_TYPES, nodeFlipped, nodeRotation, type FlowNodeData } from './nodes';
import { DYNAMIC_NODE_TYPES } from './dynamicNodes';
import { DYNAMIC_EDGE_TYPES } from './dynamicEdges';

// Merge both node-type maps: keys don't overlap (Stella uses
// stock/stellaConverter/cloud/stellaComment/stellaLabel; discrete uses
// initialConditions/assignment/...) so we can hand React Flow one combined
// dictionary regardless of the active simulationType. Only the palette
// filters which kinds are creatable.
const ALL_NODE_TYPES = { ...NODE_TYPES, ...DYNAMIC_NODE_TYPES };

const EDGE_TYPES: EdgeTypes = { floating: FloatingEdge, ...DYNAMIC_EDGE_TYPES };

const GRID_SIZE = 15;
const DOT_SIZE = 1.6;

// Half-extent of the page-guide overlay in flow coords. 12000 px easily
// covers any reasonable diagram and is cheap to render as N≈30 lines.
const PAGE_GUIDE_RANGE = 12000;

const DEFAULT_EDGE_OPTIONS = {
  type: 'floating',
  markerEnd: { type: MarkerType.ArrowClosed, width: 18, height: 18, color: '#444' },
  style: { strokeWidth: 1.5, stroke: '#444' },
};

interface Props {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: OnNodesChange<Node>;
  onEdgesChange: OnEdgesChange<Edge>;
  setNodes: Dispatch<SetStateAction<Node[]>>;
  setEdges: Dispatch<SetStateAction<Edge[]>>;
  viewport: Viewport;
  setViewport: Dispatch<SetStateAction<Viewport>>;
  onSave: () => void;
  onOpen: () => void;
  onUndo: () => void;
  onRedo: () => void;
  connectMode: boolean;
  setConnectMode: Dispatch<SetStateAction<boolean>>;
  // Dynamic-mode tool: 'flow' / 'connector' = drawing mode, null/undefined
  // = arrow/select. Drives both handle-drag interpretation and the
  // click-click pattern.
  dynamicEdgeMode?: 'flow' | 'connector' | null;
  // Pending source for the click-click edge pattern. Lifted to App so the
  // orphan-cloud sweep can spare a cloud that's currently the pending
  // endpoint of an in-progress flow draw.
  pendingSource: string | null;
  setPendingSource: Dispatch<SetStateAction<string | null>>;
  snapToGrid: boolean;
  // Printable area of the currently-selected paper size. Drives the red
  // page-boundary guides; matches the tile size in App.onPrint so the on-
  // canvas grid lines up exactly with the printed output.
  pageWidth: number;
  pageHeight: number;
  // Currently-executing block (program counter). When this changes and the
  // node is offscreen, the canvas auto-pans to bring it into view — useful
  // when stepping into a subroutine or following a GOTO across the diagram.
  pc: string | null;
  // Mutable getter that returns the next "good place" to drop a new node
  // (in flow coordinates). Canvas updates this on pane / node click. App
  // calls it when the user picks a block from the toolbar.
  newNodePosRef: { current: () => { x: number; y: number } };
}

interface ClipboardData {
  nodes: Node[];
  edges: Edge[];
}

export function Canvas({
  nodes,
  edges,
  onNodesChange,
  onEdgesChange,
  setNodes,
  setEdges,
  viewport,
  setViewport,
  onSave,
  onOpen,
  onUndo,
  onRedo,
  connectMode,
  setConnectMode,
  dynamicEdgeMode,
  pendingSource,
  setPendingSource,
  snapToGrid,
  pageWidth,
  pageHeight,
  pc,
  newNodePosRef,
}: Props) {
  const { t } = useTranslation();
  const rf = useReactFlow();
  const containerRef = useRef<HTMLDivElement | null>(null);
  // Last canvas click in flow coordinates. Updated by onPaneClick and
  // onNodeClick so toolbar adds drop near where the user is looking.
  const lastClickFlowRef = useRef<{ x: number; y: number } | null>(null);

  // When the PC moves, pan the viewport to bring the active node into view
  // ONLY if it's currently offscreen. Avoids jittery re-centering on small
  // forward steps; smoothly follows on subroutine calls / GOTOs.
  useEffect(() => {
    if (!pc) return;
    const node = rf.getNode(pc);
    if (!node) return;
    const w = node.measured?.width ?? 100;
    const h = node.measured?.height ?? 50;
    const cx = node.position.x + w / 2;
    const cy = node.position.y + h / 2;

    const { x: vx, y: vy, zoom } = rf.getViewport();
    const screenX = cx * zoom + vx;
    const screenY = cy * zoom + vy;

    const container = containerRef.current;
    if (!container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const margin = 80;
    const offscreen =
      screenX < margin ||
      screenX > cw - margin ||
      screenY < margin ||
      screenY > ch - margin;

    if (offscreen) {
      rf.setCenter(cx, cy, { duration: 400, zoom });
    }
  }, [pc, rf]);

  // Local clipboard for copy/paste/cut. Stored as a ref so we don't trigger
  // re-renders when it changes — the value is only read inside event handlers.
  const clipboardRef = useRef<ClipboardData | null>(null);

  // Pending source while drawing an arrow in connect mode (click → click).

  // Alignment guides shown while dragging a node. `vx` is the x-coordinate
  // (flow coords) of the vertical guide line; `hy` is the y-coordinate of the
  // horizontal guide. Both null when no alignment is active.
  const [dragGuides, setDragGuides] = useState<{ vx: number | null; hy: number | null }>({
    vx: null,
    hy: null,
  });

  const ALIGN_TOLERANCE = 5; // flow-coord pixels

  const onNodeDrag = useCallback(
    (_evt: ReactMouseEvent, node: Node) => {
      const w = node.measured?.width ?? 100;
      const h = node.measured?.height ?? 50;
      const cx = node.position.x + w / 2;
      const cy = node.position.y + h / 2;
      let vx: number | null = null;
      let hy: number | null = null;
      for (const other of nodes) {
        if (other.id === node.id) continue;
        const ow = other.measured?.width ?? 100;
        const oh = other.measured?.height ?? 50;
        const ocx = other.position.x + ow / 2;
        const ocy = other.position.y + oh / 2;
        if (vx === null && Math.abs(ocx - cx) <= ALIGN_TOLERANCE) vx = ocx;
        if (hy === null && Math.abs(ocy - cy) <= ALIGN_TOLERANCE) hy = ocy;
        if (vx !== null && hy !== null) break;
      }
      setDragGuides((prev) =>
        prev.vx === vx && prev.hy === hy ? prev : { vx, hy },
      );
    },
    [nodes],
  );

  const onNodeDragStop = useCallback(
    (_evt: ReactMouseEvent, node: Node, dragged: Node[]) => {
      setDragGuides({ vx: null, hy: null });
      if (!snapToGrid) return;
      // Snap-on-release: round the dragged-anchor's *center* (not its top-left)
      // to the nearest grid intersection so the visible grid dots run through
      // the node's vertical and horizontal centerlines. The same delta is
      // applied to every co-dragged node, preserving relative spacing in a
      // multi-selection.
      const w = node.measured?.width ?? 100;
      const h = node.measured?.height ?? 50;
      const cx = node.position.x + w / 2;
      const cy = node.position.y + h / 2;
      const targetCx = Math.round(cx / GRID_SIZE) * GRID_SIZE;
      const targetCy = Math.round(cy / GRID_SIZE) * GRID_SIZE;
      const dx = targetCx - cx;
      const dy = targetCy - cy;
      if (dx === 0 && dy === 0) return;
      const ids = new Set(dragged.map((n) => n.id));
      setNodes((ns) =>
        ns.map((n) =>
          ids.has(n.id)
            ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
            : n,
        ),
      );
    },
    [snapToGrid, setNodes],
  );

  // Cancel pending source when leaving connect mode (discrete or dynamic).
  useEffect(() => {
    if (!connectMode && !dynamicEdgeMode) setPendingSource(null);
  }, [connectMode, dynamicEdgeMode]);

  // Shared Stella-edge creation logic: validates the Flow / Action Connector
  // rules of the manual and pushes a new edge if everything checks out.
  // Used by both the click-click flow (onNodeClick) and the handle-drag
  // flow (onConnect) so the rules live in one place. Returns true when the
  // edge was added, false when validation rejected the request.
  const tryAddStellaEdge = useCallback(
    (sourceId: string, targetId: string, tool: 'flow' | 'connector'): boolean => {
      const srcNode = nodes.find((n) => n.id === sourceId);
      const tgtNode = nodes.find((n) => n.id === targetId);
      if (!srcNode || !tgtNode) return false;
      const srcType = srcNode.type ?? '';
      const tgtType = tgtNode.type ?? '';
      if (
        srcType === 'stellaComment' ||
        srcType === 'stellaLabel' ||
        tgtType === 'stellaComment' ||
        tgtType === 'stellaLabel'
      ) {
        return false;
      }
      const isStockOrCloud = (t: string) => t === 'stock' || t === 'cloud';
      if (tool === 'flow') {
        if (!isStockOrCloud(srcType) || !isStockOrCloud(tgtType)) return false;
        if (srcType === 'cloud' && tgtType === 'cloud') return false;
      } else {
        if (tgtType === 'stock') return false;
        if (srcType !== 'stock' && srcType !== 'stellaConverter') return false;
        if (tgtType !== 'stellaConverter') return false;
        // Cycle detection on connector subgraph (Stocks break ciclos).
        const adj = new Map<string, string[]>();
        for (const e of edges) {
          if (e.type !== 'connector') continue;
          if (!adj.has(e.source)) adj.set(e.source, []);
          adj.get(e.source)!.push(e.target);
        }
        if (!adj.has(sourceId)) adj.set(sourceId, []);
        adj.get(sourceId)!.push(targetId);
        const seen = new Set<string>();
        const stack = [targetId];
        while (stack.length > 0) {
          const node = stack.pop()!;
          if (node === sourceId) return false;
          if (seen.has(node)) continue;
          seen.add(node);
          for (const nxt of adj.get(node) ?? []) stack.push(nxt);
        }
      }
      const newEdge: Edge = {
        id: `${tool}_${Date.now()}_${Math.floor(Math.random() * 1000)}`,
        source: sourceId,
        target: targetId,
        type: tool,
        data:
          tool === 'flow'
            ? { name: '', expression: '', flowType: 'uniflow' as const }
            : {},
      };
      setEdges((es) => [...es, newEdge]);
      return true;
    },
    [edges, nodes, setEdges],
  );

  const onNodeClick = useCallback(
    (_evt: ReactMouseEvent, node: Node) => {
      // Anchor next-add to the right of the clicked node so toolbar adds land
      // near the user's focus.
      const w = node.measured?.width ?? 80;
      lastClickFlowRef.current = {
        x: node.position.x + w + 30,
        y: node.position.y,
      };
      // Dynamic-mode click-source-then-click-target. Mirrors connectMode but
      // for Stella edges. The first node click marks the source; the second
      // click commits the edge (or cancels if same node). The Flow / Action
      // Connector validation logic in onConnect is reused via a synthesized
      // params object so the rules stay in one place.
      if (dynamicEdgeMode) {
        if (!pendingSource) {
          setPendingSource(node.id);
        } else if (pendingSource === node.id) {
          setPendingSource(null);
        } else {
          tryAddStellaEdge(pendingSource, node.id, dynamicEdgeMode);
          setPendingSource(null);
        }
        return;
      }
      if (!connectMode) return;
      if (!pendingSource) {
        setPendingSource(node.id);
      } else if (pendingSource === node.id) {
        setPendingSource(null);
      } else {
        const stamp = Date.now().toString(36);
        const newEdge: Edge = {
          id: `e_c${stamp}`,
          source: pendingSource,
          target: node.id,
          type: 'floating',
        };
        setEdges((es) => [...es, newEdge]);
        setPendingSource(null);
      }
    },
    [connectMode, dynamicEdgeMode, pendingSource, setEdges, tryAddStellaEdge],
  );

  const onPaneClick = useCallback(
    (evt: ReactMouseEvent) => {
      const flowPos = rf.screenToFlowPosition({ x: evt.clientX, y: evt.clientY });
      // Record the click in flow coordinates so the next toolbar add lands
      // exactly there.
      lastClickFlowRef.current = flowPos;
      // Dynamic Flow tool: a click on empty pane has two distinct meanings
      // depending on whether there's a pending source.
      //
      //   (a) No pending source yet → user is starting a flow at a free
      //       endpoint. We spawn a Cloud at the click and mark it as
      //       pending. The next click on a Stock commits an *inflow*
      //       (cloud → Stock).
      //   (b) Pending source is a Stock → user finished an outgoing flow
      //       at a free endpoint. We spawn a Cloud at the click and the
      //       flow goes Stock → cloud (outflow).
      //
      // Both paths bypass tryAddStellaEdge for the auto-cloud because the
      // cloud we just synthesized isn't in the closure's `nodes` snapshot
      // yet — going through validation would fail and leave an orphan
      // cloud with no edge.
      if (dynamicEdgeMode === 'flow') {
        if (!pendingSource) {
          // (a) Start an inflow at a free endpoint.
          const cloudId = `cloud_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          setNodes((ns) => [
            ...ns,
            {
              id: cloudId,
              type: 'cloud',
              position: { x: flowPos.x - 30, y: flowPos.y - 18 },
              data: { name: '' },
            },
          ]);
          setPendingSource(cloudId);
          return;
        }
        const src = nodes.find((n) => n.id === pendingSource);
        if (src && (src.type === 'stock' || src.type === 'cloud')) {
          // (b) Close a flow at a free endpoint. Refuse cloud→cloud (no
          // integrating Stock to make it meaningful) and unwind the
          // pending-cloud-with-no-flow that case would leave dangling.
          if (src.type === 'cloud') {
            setPendingSource(null);
            return;
          }
          const cloudId = `cloud_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          const flowId = `flow_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
          setNodes((ns) => [
            ...ns,
            {
              id: cloudId,
              type: 'cloud',
              position: { x: flowPos.x - 30, y: flowPos.y - 18 },
              data: { name: '' },
            },
          ]);
          setEdges((es) => [
            ...es,
            {
              id: flowId,
              source: pendingSource,
              target: cloudId,
              type: 'flow',
              data: { name: '', expression: '', flowType: 'uniflow' as const },
            },
          ]);
          setPendingSource(null);
          return;
        }
      }
      // Cancel pending in any other mode-with-pending state.
      if ((connectMode || dynamicEdgeMode) && pendingSource) setPendingSource(null);
    },
    [connectMode, dynamicEdgeMode, nodes, pendingSource, rf, setEdges, setNodes],
  );

  // Keep the parent's getter pointing at fresh values (rf, container) every
  // render. Plain assignment is fine — the ref isn't React state.
  newNodePosRef.current = () => {
    if (lastClickFlowRef.current) {
      // Tiny jitter so consecutive adds at the same anchor don't perfectly
      // stack on each other.
      return {
        x: lastClickFlowRef.current.x + (Math.random() - 0.5) * 30,
        y: lastClickFlowRef.current.y + (Math.random() - 0.5) * 30,
      };
    }
    const rect = containerRef.current?.getBoundingClientRect();
    if (rect) {
      return rf.screenToFlowPosition({
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
      });
    }
    return { x: 100, y: 100 };
  };

  const pendingSourceLabel = useMemo(() => {
    if (!pendingSource) return null;
    const n = nodes.find((nd) => nd.id === pendingSource);
    if (!n) return pendingSource;
    const label = (n.data as { label?: string } | undefined)?.label;
    return typeof label === 'string' && label.trim() !== '' ? label : pendingSource;
  }, [nodes, pendingSource]);
  // When a connection drag in dynamic mode is released over empty pane, we
  // need to spawn an auto-cloud at the drop position and create a flow into
  // it. React Flow gives us the source side via `connectionState.fromNode`
  // and the screen position of the drop. Only fires for the Flow tool — the
  // Action Connector tool requires both ends to be real blocks.
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
      if (connectionState.isValid) return; // a normal node-to-node connection happened
      if (dynamicEdgeMode !== 'flow') return;
      const fromNode = connectionState.fromNode;
      if (!fromNode) return;
      const fromType = fromNode.type ?? '';
      // Only Stocks (or existing Clouds) can spawn a flow.
      if (fromType !== 'stock' && fromType !== 'cloud') return;
      // Compute drop position in flow coordinates. Touch events expose
      // touches[0]; mouse events expose clientX/Y directly.
      let clientX: number;
      let clientY: number;
      if ('clientX' in event) {
        clientX = event.clientX;
        clientY = event.clientY;
      } else {
        const t = event.changedTouches?.[0];
        if (!t) return;
        clientX = t.clientX;
        clientY = t.clientY;
      }
      const drop = rf.screenToFlowPosition({ x: clientX, y: clientY });
      const cloudId = `cloud_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      const flowId = `flow_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
      // Always treat the drag as "outflow" — fromNode is the source of the
      // pipe and the new cloud is the sink. To make an inflow, the user can
      // first drop a Cloud manually and then drag from it to the Stock.
      setNodes((ns) => [
        ...ns,
        {
          id: cloudId,
          type: 'cloud',
          position: { x: drop.x - 30, y: drop.y - 18 },
          data: { name: '' },
        },
      ]);
      setEdges((es) => [
        ...es,
        {
          id: flowId,
          source: fromNode.id,
          target: cloudId,
          type: 'flow',
          data: { name: '', expression: '', flowType: 'uniflow' as const },
        },
      ]);
    },
    [dynamicEdgeMode, rf, setNodes, setEdges],
  );

  const onConnect = useCallback(
    (params: Connection) => {
      // Are we drawing a Stella edge via handle-drag? Detect by source/target
      // node types — discrete edges fall through to addEdge below.
      const STELLA_KINDS = new Set([
        'stock',
        'stellaConverter',
        'cloud',
        'stellaComment',
        'stellaLabel',
      ]);
      const srcNode = nodes.find((n) => n.id === params.source);
      const tgtNode = nodes.find((n) => n.id === params.target);
      const isDynamic =
        (srcNode && STELLA_KINDS.has(srcNode.type ?? '')) ||
        (tgtNode && STELLA_KINDS.has(tgtNode.type ?? ''));
      if (isDynamic && srcNode && tgtNode && params.source && params.target) {
        const tool: 'flow' | 'connector' = dynamicEdgeMode ?? 'connector';
        tryAddStellaEdge(params.source, params.target, tool);
        return;
      }
      setEdges((eds) => addEdge(params, eds));
    },
    [dynamicEdgeMode, nodes, setEdges, tryAddStellaEdge],
  );

  // Keyboard shortcuts: undo/redo, save/open, copy/paste/cut, plus the
  // existing Space-to-flip-decision. The handler is mounted once and reads
  // every dependency through a ref so it never reattaches — without this,
  // typing inside any node label would tear down and re-add the document
  // listener on every keystroke (because nodes/edges change every keystroke).
  const keyShortcutsRef = useRef({
    connectMode,
    pendingSource,
    nodes,
    edges,
    onSave,
    onOpen,
    onUndo,
    onRedo,
    setConnectMode,
    setNodes,
    setEdges,
  });
  keyShortcutsRef.current = {
    connectMode,
    pendingSource,
    nodes,
    edges,
    onSave,
    onOpen,
    onUndo,
    onRedo,
    setConnectMode,
    setNodes,
    setEdges,
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const h = keyShortcutsRef.current;
      const ae = document.activeElement;
      const inInput = Boolean(
        ae &&
          (ae.tagName === 'INPUT' ||
            ae.tagName === 'TEXTAREA' ||
            (ae as HTMLElement).isContentEditable),
      );

      // Escape: cancel pending connection source first, then exit connect mode
      if (e.key === 'Escape' && !inInput) {
        if (h.connectMode) {
          if (h.pendingSource) {
            setPendingSource(null);
          } else {
            h.setConnectMode(false);
          }
          e.preventDefault();
          return;
        }
      }

      // Space (no modifier) → flip selected decision nodes; rotate selected
      // connectors 90° clockwise. Both gestures share the key because they're
      // the same idea: cycle through orientations of the selected block.
      if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !inInput) {
        let touched = false;
        h.setNodes((ns) =>
          ns.map((n) => {
            if (!n.selected) return n;
            const data = n.data as FlowNodeData | undefined;
            if (n.type === 'decision') {
              touched = true;
              return { ...n, data: { ...(data ?? {}), flipped: !nodeFlipped({ data }) } };
            }
            if (n.type === 'connector') {
              touched = true;
              return {
                ...n,
                data: { ...(data ?? {}), rotation: (nodeRotation({ data }) + 90) % 360 },
              };
            }
            return n;
          }),
        );
        if (touched) e.preventDefault();
        return;
      }

      if (!(e.ctrlKey || e.metaKey)) return;
      const key = e.key.toLowerCase();

      // Save / Open work even from an input — they're chrome-level actions.
      if (key === 's') {
        e.preventDefault();
        h.onSave();
        return;
      }
      if (key === 'o') {
        e.preventDefault();
        h.onOpen();
        return;
      }

      // The rest defer to native browser behavior when typing in an input
      // (so the user can Ctrl+Z / Ctrl+A / Ctrl+C / Ctrl+V text in labels).
      if (inInput) return;

      if (key === 'a') {
        e.preventDefault();
        h.setNodes((ns) => ns.map((n) => (n.selected ? n : { ...n, selected: true })));
        h.setEdges((es) => es.map((eg) => (eg.selected ? eg : { ...eg, selected: true })));
        return;
      }
      if (key === 'z') {
        e.preventDefault();
        if (e.shiftKey) h.onRedo();
        else h.onUndo();
        return;
      }
      if (key === 'y') {
        e.preventDefault();
        h.onRedo();
        return;
      }
      if (key === 'c' || key === 'x') {
        const selectedNodes = h.nodes.filter((n) => n.selected);
        if (selectedNodes.length === 0) return;
        const ids = new Set(selectedNodes.map((n) => n.id));
        const innerEdges = h.edges.filter(
          (eg) => ids.has(eg.source) && ids.has(eg.target),
        );
        clipboardRef.current = { nodes: selectedNodes, edges: innerEdges };
        if (key === 'x') {
          h.setNodes((ns) => ns.filter((n) => !ids.has(n.id)));
          h.setEdges((es) =>
            es.filter((eg) => !ids.has(eg.source) && !ids.has(eg.target) && !eg.selected),
          );
        }
        e.preventDefault();
        return;
      }
      if (key === 'v') {
        const cb = clipboardRef.current;
        if (!cb || cb.nodes.length === 0) return;
        const stamp =
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID().slice(0, 8)
            : Date.now().toString(36);
        const idMap = new Map<string, string>();
        const newNodes: Node[] = cb.nodes.map((n, i) => {
          const newNodeId = `${n.id}_p${stamp}_${i}`;
          idMap.set(n.id, newNodeId);
          return {
            ...n,
            id: newNodeId,
            position: { x: n.position.x + 30, y: n.position.y + 30 },
            selected: true,
          };
        });
        const newEdges: Edge[] = cb.edges.map((eg, j) => ({
          ...eg,
          id: `e_p${stamp}_${j}`,
          source: idMap.get(eg.source) ?? eg.source,
          target: idMap.get(eg.target) ?? eg.target,
          selected: true,
        }));
        h.setNodes((ns) => [...ns.map((n) => ({ ...n, selected: false })), ...newNodes]);
        h.setEdges((es) => [...es.map((eg) => ({ ...eg, selected: false })), ...newEdges]);
        e.preventDefault();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);


  // Positions of every page-boundary line in flow coords. Recomputed when
  // the user changes paper size or orientation.
  const pageGuides = useMemo(() => {
    const verticals: number[] = [];
    const startK = Math.ceil(-PAGE_GUIDE_RANGE / pageWidth);
    const endK = Math.floor(PAGE_GUIDE_RANGE / pageWidth);
    for (let k = startK; k <= endK; k++) verticals.push(k * pageWidth);
    const horizontals: number[] = [];
    const startJ = Math.ceil(-PAGE_GUIDE_RANGE / pageHeight);
    const endJ = Math.floor(PAGE_GUIDE_RANGE / pageHeight);
    for (let j = startJ; j <= endJ; j++) horizontals.push(j * pageHeight);
    return { verticals, horizontals };
  }, [pageWidth, pageHeight]);

  // Highlight the pending source node by toggling a CSS class directly on
  // its rendered DOM element. Patching here instead of cloning the entire
  // nodes array avoids triggering a React Flow rerender every time connect
  // mode flips.
  useEffect(() => {
    if (!pendingSource) return undefined;
    const sel = `.react-flow__node[data-id="${CSS.escape(pendingSource)}"]`;
    const el = document.querySelector(sel);
    if (!el) return undefined;
    el.classList.add('node--connect-source');
    return () => el.classList.remove('node--connect-source');
  }, [pendingSource]);

  return (
    <div
      ref={containerRef}
      className={`canvas ${
        connectMode || dynamicEdgeMode ? 'canvas--connecting' : ''
      }`}
    >
      {connectMode && (
        <div className="canvas__banner" role="status">
          {pendingSource
            ? t('canvas.connectPickTarget', { label: pendingSourceLabel ?? '' })
            : t('canvas.connectPickSource')}
        </div>
      )}
      {dynamicEdgeMode && (
        <div className="canvas__banner" role="status">
          {(() => {
            if (dynamicEdgeMode === 'flow') {
              return pendingSource
                ? t('dynamic.canvas.flowPickTargetWithCloud')
                : t('dynamic.canvas.flowPickSource');
            }
            return pendingSource
              ? t('dynamic.canvas.connectorPickTarget')
              : t('dynamic.canvas.connectorPickSource');
          })()}
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={ALL_NODE_TYPES}
        edgeTypes={EDGE_TYPES}
        defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        onNodeClick={onNodeClick}
        onPaneClick={onPaneClick}
        onNodeDrag={onNodeDrag}
        onNodeDragStop={onNodeDragStop}
        viewport={viewport}
        onViewportChange={setViewport}
        deleteKeyCode={['Delete', 'Backspace']}
        connectionRadius={60}
        /* Loose mode lets a drag start from any handle on a Stella node and
           end at any handle on another, regardless of source/target type.
           Without it, the user has to find the exact source-flavored handle
           on the rim of the rectangle to even start a flow drag. */
        connectionMode={ConnectionMode.Loose}
      >
        {/* `offset={DOT_SIZE / 2}` cancels the internal `(1 + gap/2)` shift that
            xyflow's Background applies when offset is 0, so each dot's center
            lands exactly at flow coordinates (k·GRID_SIZE, j·GRID_SIZE). The
            snap math rounds node centers to those same coordinates, so the
            grid dots run through every snapped node's vertical and horizontal
            centerlines. */}
        <Background
          variant={BackgroundVariant.Dots}
          gap={GRID_SIZE}
          size={DOT_SIZE}
          offset={DOT_SIZE / 2}
          color="#94a3b8"
        />
        <Controls />
        <MiniMap position="top-right" pannable zoomable />
        {/* Page-boundary guides. Anchored at flow origin (0,0); the print
            pipeline tiles from the same anchor so what the user sees here is
            exactly what ends up on each printed page. */}
        <ViewportPortal>
          <svg
            style={{
              position: 'absolute',
              left: -PAGE_GUIDE_RANGE,
              top: -PAGE_GUIDE_RANGE,
              width: 2 * PAGE_GUIDE_RANGE,
              height: 2 * PAGE_GUIDE_RANGE,
              pointerEvents: 'none',
              overflow: 'visible',
            }}
          >
            {pageGuides.verticals.map((x) => (
              <line
                key={`pv${x}`}
                x1={PAGE_GUIDE_RANGE + x}
                y1={0}
                x2={PAGE_GUIDE_RANGE + x}
                y2={2 * PAGE_GUIDE_RANGE}
                stroke="#dc2626"
                strokeWidth={0.7}
                strokeDasharray="6 4"
                opacity={0.55}
              />
            ))}
            {pageGuides.horizontals.map((y) => (
              <line
                key={`ph${y}`}
                x1={0}
                y1={PAGE_GUIDE_RANGE + y}
                x2={2 * PAGE_GUIDE_RANGE}
                y2={PAGE_GUIDE_RANGE + y}
                stroke="#dc2626"
                strokeWidth={0.7}
                strokeDasharray="6 4"
                opacity={0.55}
              />
            ))}
          </svg>
        </ViewportPortal>
        {(dragGuides.vx !== null || dragGuides.hy !== null) && (
          <ViewportPortal>
            <svg
              style={{
                position: 'absolute',
                left: -100000,
                top: -100000,
                width: 200000,
                height: 200000,
                pointerEvents: 'none',
                overflow: 'visible',
              }}
            >
              {dragGuides.vx !== null && (
                <line
                  x1={dragGuides.vx + 100000}
                  y1={0}
                  x2={dragGuides.vx + 100000}
                  y2={200000}
                  stroke="#3b82f6"
                  strokeWidth={1}
                  strokeDasharray="4,3"
                />
              )}
              {dragGuides.hy !== null && (
                <line
                  x1={0}
                  y1={dragGuides.hy + 100000}
                  x2={200000}
                  y2={dragGuides.hy + 100000}
                  stroke="#3b82f6"
                  strokeWidth={1}
                  strokeDasharray="4,3"
                />
              )}
            </svg>
          </ViewportPortal>
        )}
      </ReactFlow>
    </div>
  );
}
