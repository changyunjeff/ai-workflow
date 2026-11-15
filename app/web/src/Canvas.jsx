import { memo, useEffect, useMemo, useRef } from 'react';
import { ReactFlow, Controls, Handle, Position, MarkerType, BaseEdge, getBezierPath, useNodesState } from '@xyflow/react';
import { ST, STOP_ID, buildEdges, cx, hasNoGate, kindClass, kindName, nodeState, nodeWidth, orderedNodes, stateText } from './graph.js';

const FIT = { padding: 0.12, maxZoom: 1 };
const ARIA = {
  'controls.ariaLabel': '画布控制',
  'controls.zoomIn.ariaLabel': '放大',
  'controls.zoomOut.ariaLabel': '缩小',
  'controls.fitView.ariaLabel': '一键看全',
  'controls.interactive.ariaLabel': '锁定画布',
};

// Invisible, non-connectable anchor points. Back edges use the top and bottom sides so they
// never run through the main row; the offsets keep them clear of the pin, badge and "no gate" tag.
function Anchor(props) {
  return <Handle className="hh" isConnectable={false} {...props} />;
}

function LineNode({ data }) {
  const { node, state, selected, here, count, nogate, mark } = data;
  const cls = ST[state][1];
  const text = stateText(node, state);
  return (
    <div className={cx('node', kindClass(node), cls, selected && 'sel')} style={{ width: nodeWidth(node) }} title={node.title}>
      <Anchor type="target" position={Position.Left} id="in" />
      <Anchor type="source" position={Position.Right} id="out" />
      <Anchor type="source" position={Position.Bottom} id="back-out-below" style={{ left: '25%' }} />
      <Anchor type="target" position={Position.Bottom} id="back-in-below" style={{ left: '30%' }} />
      <Anchor type="source" position={Position.Top} id="back-out-above" style={{ left: '72%' }} />
      <Anchor type="target" position={Position.Top} id="back-in-above" style={{ left: '72%' }} />
      <Anchor type="source" position={Position.Bottom} id="stop-out" style={{ left: '80%' }} />
      <Anchor type="target" position={Position.Top} id="stop-in" style={{ left: '72%' }} />
      <div className="kind">{kindName(node)}</div>
      <div className="title">{node.title}</div>
      <div className="st">{text}</div>
      {here && <span className="pin">这件活在这里</span>}
      {nogate && <span className="nogate">还没有门</span>}
      {mark && <span className={cx('chg', here && 'up')}>AI {mark}</span>}
      {count > 0 && <span className="count" title={`有 ${count} 件活在这里`}>{count} 件</span>}
    </div>
  );
}

function EdgeLabel({ x, y, data, anchor }) {
  if (!data.label) return null;
  const hot = data.kind === 'stop' ? (data.walked && 'hotred') : (data.backCount > 0 && 'hot');
  return (
    <text className={cx('elabel', hot)} x={x} y={y} style={anchor ? { textAnchor: anchor } : undefined}>
      {data.label}{data.backCount > 0 ? ` · 这件活已退回 ${data.backCount} 次` : ''}
    </text>
  );
}

const edgeClass = (data) => cx('edge', data.kind === 'back' && 'back', data.kind === 'stop' && 'stop', data.walked && 'walked');

// Forward edge (left to right): plain bezier.
function CurveEdge({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, markerEnd }) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition });
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} className={edgeClass(data)} interactionWidth={0} />
      <EdgeLabel x={labelX} y={labelY - 7} data={data} />
    </>
  );
}

// Edge to the stop node: straight down from the gate to a lane below all the back lanes, along
// that lane, then into the top of the stop node. Every gate uses the same lane, so the edges
// merge instead of crossing each other; each label sits beside its own drop.
function StopEdge({ sourceX, sourceY, targetX, targetY, data, markerEnd }) {
  const want = sourceY + data.depth;
  const laneY = targetY > sourceY + 30 ? Math.min(want, targetY - 14) : want;
  const dir = targetX >= sourceX ? 1 : -1;
  const down = targetY >= laneY ? 1 : -1;
  const r = Math.min(10, Math.abs(targetX - sourceX) / 2, Math.abs(laneY - sourceY) / 2);
  const r2 = Math.min(r, Math.abs(targetY - laneY) / 2);
  const path = [
    `M${sourceX},${sourceY}`,
    `L${sourceX},${laneY - r}`,
    `Q${sourceX},${laneY} ${sourceX + dir * r},${laneY}`,
    `L${targetX - dir * r2},${laneY}`,
    `Q${targetX},${laneY} ${targetX},${laneY + down * r2}`,
    `L${targetX},${targetY}`,
  ].join(' ');
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} className={edgeClass(data)} interactionWidth={0} />
      <EdgeLabel x={sourceX + 7} y={laneY - 7} data={data} anchor="start" />
    </>
  );
}

// Back edge: leaves vertically, runs along a fixed lane below (machine gate) or above (human gate)
// the row, and comes back in vertically. The lane depth is fixed, so long loops do not grow taller.
function LaneEdge({ sourceX, sourceY, targetX, targetY, data, markerEnd }) {
  const sign = data.side === 'below' ? 1 : -1;
  const laneY = sign > 0 ? Math.max(sourceY, targetY) + data.depth : Math.min(sourceY, targetY) - data.depth;
  const dir = targetX >= sourceX ? 1 : -1;
  const r = Math.min(12, Math.abs(targetX - sourceX) / 2);
  const path = [
    `M${sourceX},${sourceY}`,
    `L${sourceX},${laneY - sign * r}`,
    `Q${sourceX},${laneY} ${sourceX + dir * r},${laneY}`,
    `L${targetX - dir * r},${laneY}`,
    `Q${targetX},${laneY} ${targetX},${laneY - sign * r}`,
    `L${targetX},${targetY}`,
  ].join(' ');
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} className={edgeClass(data)} interactionWidth={0} />
      <EdgeLabel x={(sourceX + targetX) / 2} y={sign > 0 ? laneY + 15 : laneY - 7} data={data} />
    </>
  );
}

const nodeTypes = { line: LineNode };
const edgeTypes = { curve: CurveEdge, lane: LaneEdge, stop: StopEdge };

const COLOR = { fwd: ['#aab2be', '#1a8f4c'], back: ['#c9a368', '#b86e00'], stop: ['#d0a9a4', '#b8382b'] };

function toFlowEdges(line, item) {
  const walked = new Set(item?.walked || []);
  return buildEdges(line).map((e) => {
    const isWalked = walked.has(e.key);
    const back = e.kind === 'back';
    return {
      id: e.key,
      source: e.source,
      target: e.target,
      sourceHandle: back ? `back-out-${e.side}` : e.kind === 'stop' ? 'stop-out' : 'out',
      targetHandle: back ? `back-in-${e.side}` : e.kind === 'stop' ? 'stop-in' : 'in',
      type: back ? 'lane' : e.kind === 'stop' ? 'stop' : 'curve',
      data: { kind: e.kind, side: e.side, depth: e.depth, label: e.label, walked: isWalked, backCount: back ? item?.back?.[e.key] || 0 : 0 },
      markerEnd: { type: MarkerType.ArrowClosed, color: COLOR[e.kind][isWalked ? 1 : 0], width: 28, height: 28, markerUnits: 'userSpaceOnUse' },
      zIndex: isWalked ? 1 : 0,
      selectable: false, focusable: false, deletable: false, reconnectable: false,
    };
  });
}

function toFlowNodes(line, item, counts, sel, layout, marks) {
  return orderedNodes(line).map((node) => ({
    id: node.id,
    type: 'line',
    position: { x: layout[node.id][0], y: layout[node.id][1] },
    deletable: false,
    connectable: false,
    data: {
      node,
      state: nodeState(node, item),
      selected: sel === node.id,
      here: !!item && item.at === node.id,
      count: counts[node.id] || 0,
      nogate: node.id !== STOP_ID && hasNoGate(line, node),
      mark: marks?.[node.id] || '',
    },
  }));
}

function Canvas({ line, item, counts, sel, layout, marks, draggable = true, fitToken, onSelect, onLayoutChange }) {
  const desired = useMemo(() => toFlowNodes(line, item, counts, sel, layout, marks), [line, item, counts, sel, layout, marks]);
  const edges = useMemo(() => toFlowEdges(line, item), [line, item]);
  const [nodes, setNodes, onNodesChange] = useNodesState(desired);
  const nodesRef = useRef(nodes);
  nodesRef.current = nodes;
  const dragging = useRef(false);
  const flow = useRef(null);

  // Push new data into the existing node objects. Keep what React Flow measured, and while a
  // drag is in progress keep the dragged positions so a poll cannot yank the node back.
  useEffect(() => {
    setNodes((prev) => {
      const old = new Map(prev.map((n) => [n.id, n]));
      return desired.map((d) => {
        const p = old.get(d.id);
        return p ? { ...p, data: d.data, position: dragging.current ? p.position : d.position } : d;
      });
    });
  }, [desired, setNodes]);

  useEffect(() => {
    if (!fitToken) return undefined;
    const t = setTimeout(() => flow.current?.fitView({ ...FIT, duration: 200 }), 60);
    return () => clearTimeout(t);
  }, [fitToken]);

  const onNodeDragStop = (_event, node, dragged) => {
    dragging.current = false;
    const next = {};
    for (const n of nodesRef.current) next[n.id] = [Math.round(n.position.x), Math.round(n.position.y)];
    for (const n of dragged?.length ? dragged : [node]) next[n.id] = [Math.round(n.position.x), Math.round(n.position.y)];
    onLayoutChange(next);
  };

  return (
    <div className="canvas">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onInit={(instance) => { flow.current = instance; }}
        onNodeClick={(_event, node) => onSelect(node.id)}
        onPaneClick={() => onSelect(null)}
        onNodeDragStart={() => { dragging.current = true; }}
        onNodeDragStop={onNodeDragStop}
        nodeDragThreshold={4}
        nodesDraggable={draggable}
        nodesConnectable={false}
        elementsSelectable={false}
        nodesFocusable={false}
        edgesFocusable={false}
        edgesReconnectable={false}
        deleteKeyCode={null}
        selectionKeyCode={null}
        multiSelectionKeyCode={null}
        zoomOnDoubleClick={false}
        zoomOnScroll={false}
        preventScrolling={false}
        minZoom={0.3}
        maxZoom={2}
        fitView
        fitViewOptions={FIT}
        ariaLabelConfig={ARIA}
      >
        <Controls showInteractive={false} fitViewOptions={FIT} />
      </ReactFlow>
    </div>
  );
}

export default memo(Canvas);
