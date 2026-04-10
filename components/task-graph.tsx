'use client';

import Image from 'next/image';
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import { useEffect, useMemo, useState } from 'react';

import { createGraphEdgeId, serializeGraph } from '@/lib/dependencyGraph';
import { formatDateTime, formatDurationHours, getDueStatus } from '@/lib/task-formatters';
import type { TaskRecord } from '@/lib/task-types';

interface TaskGraphProps {
  tasks: TaskRecord[];
  activeTaskId: number | null;
  onActiveTaskChange: (taskId: number | null) => void;
  dependencyPickerOpen?: boolean;
  selectedDependencyIds?: number[];
  onDependencyToggle?: (taskId: number) => void;
}

interface TaskFlowData extends Record<string, unknown> {
  title: string;
  imageUrl: string | null;
  durationHours: number;
  dueDate: string | null;
  isCompleted: boolean;
  isBlocked: boolean;
  isReady: boolean;
  isCriticalPath: boolean;
  isActive: boolean;
  isInFocusChain: boolean;
  isFaded: boolean;
  isDependencySelected: boolean;
}

type TaskFlowNode = Node<TaskFlowData, 'taskNode'>;

const NODE_WIDTH = 288;
const NODE_HEIGHT = 206;
const COLUMN_GAP = 88;
const ROW_GAP = 44;
const COLUMN_WIDTH = NODE_WIDTH + COLUMN_GAP;
const ROW_HEIGHT = NODE_HEIGHT + ROW_GAP;

function PlaceholderIcon() {
  return (
    <svg className="h-4.5 w-4.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="m7 15 3-3 3 2 4-5 2 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function collectReachable(seedId: string, adjacencyMap: Map<string, string[]>) {
  const visited = new Set<string>();
  const stack = [seedId];

  while (stack.length > 0) {
    const currentId = stack.pop();

    if (!currentId) {
      continue;
    }

    for (const nextId of adjacencyMap.get(currentId) ?? []) {
      if (!visited.has(nextId)) {
        visited.add(nextId);
        stack.push(nextId);
      }
    }
  }

  return visited;
}

function collectFocusedSubgraph(
  seedId: string,
  dependencyMap: Map<string, string[]>,
  dependentMap: Map<string, string[]>,
) {
  const nodeIds = new Set<string>([seedId]);
  const edgeIds = new Set<string>();

  const upstreamStack = [seedId];

  while (upstreamStack.length > 0) {
    const currentId = upstreamStack.pop();

    if (!currentId) {
      continue;
    }

    for (const dependencyId of dependencyMap.get(currentId) ?? []) {
      edgeIds.add(createGraphEdgeId(dependencyId, currentId));

      if (!nodeIds.has(dependencyId)) {
        nodeIds.add(dependencyId);
        upstreamStack.push(dependencyId);
      }
    }
  }

  const downstreamStack = [seedId];

  while (downstreamStack.length > 0) {
    const currentId = downstreamStack.pop();

    if (!currentId) {
      continue;
    }

    for (const dependentId of dependentMap.get(currentId) ?? []) {
      edgeIds.add(createGraphEdgeId(currentId, dependentId));

      if (!nodeIds.has(dependentId)) {
        nodeIds.add(dependentId);
        downstreamStack.push(dependentId);
      }
    }
  }

  return { nodeIds, edgeIds };
}

function TaskGraphNode({ id, data, selected }: NodeProps<TaskFlowNode>) {
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const dueStatus = getDueStatus(data.dueDate);

  useEffect(() => {
    setIsImageLoaded(false);
  }, [data.imageUrl]);

  return (
    <div
      className={[
        'graph-node-shell w-[288px] overflow-hidden rounded-2xl border bg-white shadow-sm transition',
        data.isActive ? 'border-zinc-900 ring-2 ring-zinc-100 shadow-md' : '',
        !data.isActive && data.isInFocusChain ? 'ring-1 ring-zinc-200 shadow-[0_0_0_6px_rgba(255,255,255,0.92),0_18px_40px_-34px_rgba(24,24,27,0.22)]' : '',
        data.isDependencySelected ? 'border-sky-300 ring-2 ring-sky-100' : '',
        !data.isActive && data.isCompleted ? 'border-emerald-200 bg-emerald-50/40' : '',
        !data.isActive && !data.isCompleted && data.isReady ? 'shadow-md' : '',
        !data.isActive && !data.isCompleted && dueStatus === 'overdue' ? 'border-rose-200' : '',
        !data.isActive && !data.isCompleted && dueStatus === 'dueSoon' ? 'border-amber-200' : '',
        !data.isActive && !data.isCompleted && data.isBlocked ? 'border-zinc-200 bg-zinc-50' : '',
        data.isFaded
          ? 'opacity-25'
          : data.isActive
            ? 'opacity-100'
            : data.isInFocusChain
              ? data.isCompleted
                ? 'opacity-72'
                : 'opacity-55'
              : '',
        selected ? 'shadow-md' : '',
      ].join(' ')}
    >
      <Handle type="target" position={Position.Left} className="!h-3 !w-3 !border-2 !border-white !bg-zinc-400" />

      <div className="relative aspect-[16/7] overflow-hidden border-b border-zinc-200 bg-zinc-100">
        {data.imageUrl ? (
          <>
            {!isImageLoaded ? <div className="absolute inset-0 shimmer bg-zinc-200" /> : null}
            <Image
              src={data.imageUrl}
              alt={data.title}
              fill
              sizes="288px"
              className={['object-cover transition duration-500', isImageLoaded ? 'opacity-100' : 'opacity-0'].join(' ')}
              onLoadingComplete={() => setIsImageLoaded(true)}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-zinc-500">
            <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium">
              <PlaceholderIcon />
              No preview
            </div>
          </div>
        )}

        <div
          className={[
            'absolute left-3 top-3 h-9 w-1.5 rounded-full backdrop-blur',
            data.isCompleted ? 'bg-emerald-500/90' : 'bg-white/85',
          ].join(' ')}
        />
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Step #{id}</p>
          {data.isCompleted ? (
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-[10px] font-semibold text-emerald-700">
              Done
            </span>
          ) : null}
        </div>
        <p className="mt-1 line-clamp-2 text-sm font-semibold text-zinc-950">{data.title}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px] text-zinc-500">
          <span>{formatDurationHours(data.durationHours)}</span>
          <span className="text-zinc-300">/</span>
          <span>{data.dueDate ? formatDateTime(data.dueDate) : 'No due date'}</span>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="!h-3 !w-3 !border-2 !border-white !bg-zinc-400" />
    </div>
  );
}

const nodeTypes = {
  taskNode: TaskGraphNode,
};

function buildFlow(tasks: TaskRecord[], activeTaskId: number | null, selectedDependencyIds: number[] = []) {
  const graph = serializeGraph(tasks);
  const tasksByDepth = new Map<number, typeof graph.nodes>();
  const dependencyMap = new Map<string, string[]>();
  const dependentMap = new Map<string, string[]>();
  const activeKey = activeTaskId ? String(activeTaskId) : null;
  const selectedDependencySet = new Set(selectedDependencyIds.map(String));

  tasks.forEach((task) => {
    dependencyMap.set(
      String(task.id),
      task.dependencies.map((dependency) => String(dependency.id)),
    );
    dependentMap.set(
      String(task.id),
      task.dependents.map((dependent) => String(dependent.id)),
    );
  });

  const upstreamIds = activeKey ? collectReachable(activeKey, dependencyMap) : new Set<string>();
  const downstreamIds = activeKey ? collectReachable(activeKey, dependentMap) : new Set<string>();
  const focusedSubgraph = activeKey
    ? collectFocusedSubgraph(activeKey, dependencyMap, dependentMap)
    : { nodeIds: new Set<string>(), edgeIds: new Set<string>() };
  const focusIds = activeKey
    ? focusedSubgraph.nodeIds
    : new Set<string>([...Array.from(upstreamIds), ...Array.from(downstreamIds)]);

  graph.nodes.forEach((node) => {
    const depth = node.data.depth;
    const existingNodes = tasksByDepth.get(depth) ?? [];
    existingNodes.push(node);
    tasksByDepth.set(depth, existingNodes);
  });

  const flowNodes: TaskFlowNode[] = [];

  Array.from(tasksByDepth.entries())
    .sort(([leftDepth], [rightDepth]) => leftDepth - rightDepth)
    .forEach(([depth, nodesAtDepth]) => {
      nodesAtDepth
        .sort((leftNode, rightNode) => {
          const leftStart = new Date(leftNode.data.earliestStart).getTime();
          const rightStart = new Date(rightNode.data.earliestStart).getTime();

          if (leftStart !== rightStart) {
            return leftStart - rightStart;
          }

          return leftNode.data.title.localeCompare(rightNode.data.title);
        })
        .forEach((node, index) => {
          flowNodes.push({
            id: node.id,
            type: 'taskNode',
            draggable: false,
            selectable: true,
            position: {
              x: depth * COLUMN_WIDTH,
              y: index * ROW_HEIGHT,
            },
            data: {
              title: node.data.title,
              imageUrl: node.data.imageUrl,
              durationHours: node.data.durationHours,
              dueDate: node.data.dueDate,
              isCompleted: node.data.isCompleted,
              isBlocked: node.data.isBlocked,
              isReady: !node.data.isCompleted && !node.data.isBlocked,
              isCriticalPath: node.data.isCriticalPath,
              isActive: node.id === activeKey,
              isInFocusChain: activeKey ? focusIds.has(node.id) : false,
              isFaded: activeKey ? !focusIds.has(node.id) : node.data.isBlocked,
              isDependencySelected: selectedDependencySet.has(node.id),
            },
          });
        });
    });

  const flowEdges: Edge[] = graph.edges.map((edge) => {
    const isFocusEdge = activeKey ? focusedSubgraph.edgeIds.has(edge.id) : false;
    const isCriticalEdge = edge.data.isCriticalPath;
    const targetNode = graph.nodes.find((node) => node.id === edge.target);
    const targetIsBlocked = targetNode?.data.isBlocked ?? false;
    const targetIsCompleted = targetNode?.data.isCompleted ?? false;

    return {
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'smoothstep',
      animated: activeKey ? isFocusEdge : false,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 18,
        height: 18,
        color: activeKey
          ? isFocusEdge
            ? '#18181b'
            : '#d4d4d8'
          : targetIsBlocked
            ? '#d4d4d8'
            : targetIsCompleted
              ? '#a7f3d0'
              : '#71717a',
      },
      style: {
        stroke: activeKey
          ? isFocusEdge
            ? '#18181b'
            : '#d4d4d8'
          : targetIsBlocked
            ? '#d4d4d8'
            : targetIsCompleted
              ? '#86efac'
              : '#71717a',
        strokeWidth: activeKey ? (isFocusEdge ? 3.2 : 1.2) : targetIsBlocked ? 1.15 : 1.9,
        opacity: activeKey ? (isFocusEdge ? 1 : 0.28) : targetIsBlocked ? 0.24 : targetIsCompleted ? 0.5 : 0.88,
      },
    };
  });

  return {
    graph,
    flowNodes,
    flowEdges,
    focusCount: focusIds.size,
  };
}

function EmptyGraphState({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-6 text-center">
      <div className="max-w-md">
        <p className="text-lg font-semibold text-zinc-950">{title}</p>
        {description ? <p className="mt-2 text-sm leading-6 text-zinc-600">{description}</p> : null}
      </div>
    </div>
  );
}

function TaskGraphCanvas({
  tasks,
  activeTaskId,
  onActiveTaskChange,
  dependencyPickerOpen = false,
  selectedDependencyIds = [],
  onDependencyToggle,
}: TaskGraphProps) {
  const { fitView, getZoom, setCenter } = useReactFlow();
  const { graph, flowNodes, flowEdges } = useMemo(
    () => buildFlow(tasks, activeTaskId, selectedDependencyIds),
    [tasks, activeTaskId, selectedDependencyIds],
  );

  useEffect(() => {
    if (tasks.length === 0 || flowEdges.length === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      fitView({
        duration: 300,
        padding: 0.16,
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [fitView, tasks.length, flowEdges.length]);

  useEffect(() => {
    if (!activeTaskId) {
      return;
    }

    const activeNode = flowNodes.find((node) => node.id === String(activeTaskId));

    if (!activeNode) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setCenter(activeNode.position.x + NODE_WIDTH / 2, activeNode.position.y + NODE_HEIGHT / 2, {
        duration: 320,
        zoom: getZoom(),
      });
    });

    return () => window.cancelAnimationFrame(frame);
  }, [activeTaskId, flowNodes, getZoom, setCenter]);

  if (tasks.length === 0) {
    return (
      <EmptyGraphState
        title="Add your first step to begin mapping execution flow."
        description=""
      />
    );
  }

  if (graph.edges.length === 0) {
    return (
      <EmptyGraphState
        title="Link steps to reveal the critical route."
        description=""
      />
    );
  }

  return (
    <div className="h-full overflow-hidden rounded-2xl border border-zinc-200 bg-white">
      <ReactFlow
        nodes={flowNodes}
        edges={flowEdges}
        nodeTypes={nodeTypes}
        fitView
        proOptions={{ hideAttribution: true }}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        minZoom={0.45}
        maxZoom={1.35}
        onNodeClick={(_, node) => {
          if (dependencyPickerOpen && onDependencyToggle) {
            onDependencyToggle(Number(node.id));
            return;
          }

          onActiveTaskChange(Number(node.id));
        }}
        onPaneClick={() => {
          if (dependencyPickerOpen) {
            return;
          }

          onActiveTaskChange(null);
        }}
      >
        <Background color="#e4e4e7" gap={24} />
        <Controls
          showInteractive={false}
          className="[&>button]:!border-zinc-200 [&>button]:!bg-white [&>button]:!text-zinc-700"
        />
      </ReactFlow>
    </div>
  );
}

export function TaskGraph({
  tasks,
  activeTaskId,
  onActiveTaskChange,
  dependencyPickerOpen = false,
  selectedDependencyIds = [],
  onDependencyToggle,
}: TaskGraphProps) {
  const { graph } = useMemo(
    () => buildFlow(tasks, activeTaskId, selectedDependencyIds),
    [tasks, activeTaskId, selectedDependencyIds],
  );
  const workCount = tasks.filter((task) => !task.isCompleted).length;
  const blockedCount = graph.blockedTaskIds.length;
  const riskCount = tasks.filter((task) => !task.isCompleted && getDueStatus(task.dueDate) === 'overdue').length;
  const routeEta = formatDurationHours(graph.criticalPath.totalDurationHours, 0);

  return (
    <section className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 px-5 py-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="min-w-0 shrink-0">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">System map</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-950 xl:whitespace-nowrap">Critical lane</h2>
          </div>

          <div className="grid grid-cols-2 gap-2 xl:grid-cols-4">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Work</p>
              <p className="mt-1.5 text-lg font-semibold text-zinc-950">{workCount}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Blocked</p>
              <p className="mt-1.5 text-lg font-semibold text-zinc-950">{blockedCount}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Risk</p>
              <p className="mt-1.5 text-lg font-semibold text-zinc-950">{riskCount}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-zinc-500">Route ETA</p>
              <p className="mt-1.5 text-lg font-semibold text-zinc-950">
                {routeEta}
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 min-h-0 p-5">
        <ReactFlowProvider>
          <TaskGraphCanvas
            tasks={tasks}
            activeTaskId={activeTaskId}
            onActiveTaskChange={onActiveTaskChange}
            dependencyPickerOpen={dependencyPickerOpen}
            selectedDependencyIds={selectedDependencyIds}
            onDependencyToggle={onDependencyToggle}
          />
        </ReactFlowProvider>
      </div>
    </section>
  );
}

