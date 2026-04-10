export type DependencyGraphTaskId = number | string;

type DependencyReference = DependencyGraphTaskId | { id: DependencyGraphTaskId };

export interface DependencyGraphTask {
  id: DependencyGraphTaskId;
  title: string;
  createdAt?: Date | string | null;
  dueDate?: Date | string | null;
  imageUrl?: string | null;
  estimatedDurationHours?: number | null;
  isCompleted?: boolean;
  completedAt?: Date | string | null;
  dependencies?: DependencyReference[];
}

export interface CriticalPathResult {
  totalDurationHours: number;
  nodeIds: string[];
  edgeIds: string[];
}

export interface SerializedGraphNode {
  id: string;
  data: {
    title: string;
    dueDate: string | null;
    imageUrl: string | null;
    durationHours: number;
    earliestStart: string;
    dependencyCount: number;
    isCompleted: boolean;
    isBlocked: boolean;
    isCriticalPath: boolean;
    depth: number;
  };
}

export interface SerializedGraphEdge {
  id: string;
  source: string;
  target: string;
  data: {
    isCriticalPath: boolean;
  };
}

export interface SerializedGraph {
  nodes: SerializedGraphNode[];
  edges: SerializedGraphEdge[];
  blockedTaskIds: string[];
  criticalPath: CriticalPathResult;
}

interface NormalizedTask {
  id: string;
  index: number;
  title: string;
  createdAt: Date | null;
  dueDate: Date | null;
  imageUrl: string | null;
  durationHours: number;
  remainingDurationHours: number;
  isCompleted: boolean;
  completedAt: Date | null;
  dependencyIds: string[];
  rawTask: DependencyGraphTask;
}

const DEFAULT_DURATION_HOURS = 1;

function toTaskKey(id: DependencyGraphTaskId) {
  return String(id);
}

function getDependencyKey(dependency: DependencyReference) {
  if (typeof dependency === "object" && dependency !== null && "id" in dependency) {
    return toTaskKey(dependency.id);
  }

  return toTaskKey(dependency);
}

function getDurationHours(task: DependencyGraphTask) {
  const duration = task.estimatedDurationHours;

  if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) {
    return DEFAULT_DURATION_HOURS;
  }

  return duration;
}

function getRemainingDurationHours(task: DependencyGraphTask) {
  return task.isCompleted ? 0 : getDurationHours(task);
}

function parseDate(value?: Date | string | null) {
  if (!value) {
    return null;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addHours(date: Date, hours: number) {
  return new Date(date.getTime() + hours * 60 * 60 * 1000);
}

function laterDate(a: Date, b: Date) {
  return a.getTime() >= b.getTime() ? a : b;
}

function buildGraph(tasks: DependencyGraphTask[]) {
  const taskMap = new Map<string, NormalizedTask>();

  tasks.forEach((task, index) => {
    taskMap.set(toTaskKey(task.id), {
      id: toTaskKey(task.id),
      index,
      title: task.title,
      createdAt: parseDate(task.createdAt),
      dueDate: parseDate(task.dueDate),
      imageUrl: task.imageUrl ?? null,
      durationHours: getDurationHours(task),
      remainingDurationHours: getRemainingDurationHours(task),
      isCompleted: Boolean(task.isCompleted),
      completedAt: parseDate(task.completedAt),
      dependencyIds: [],
      rawTask: task,
    });
  });

  tasks.forEach((task) => {
    const taskKey = toTaskKey(task.id);
    const node = taskMap.get(taskKey);

    if (!node) {
      return;
    }

    const dependencyIds = Array.from(
      new Set((task.dependencies ?? []).map(getDependencyKey)),
    ).filter((dependencyId) => taskMap.has(dependencyId));

    node.dependencyIds = dependencyIds;
  });

  const dependentsMap = new Map<string, string[]>();
  const indegreeMap = new Map<string, number>();

  taskMap.forEach((task) => {
    dependentsMap.set(task.id, []);
    indegreeMap.set(task.id, task.dependencyIds.length);
  });

  taskMap.forEach((task) => {
    task.dependencyIds.forEach((dependencyId) => {
      dependentsMap.get(dependencyId)?.push(task.id);
    });
  });

  dependentsMap.forEach((dependents) => {
    dependents.sort((a, b) => {
      const aIndex = taskMap.get(a)?.index ?? 0;
      const bIndex = taskMap.get(b)?.index ?? 0;
      return aIndex - bIndex;
    });
  });

  return { taskMap, dependentsMap, indegreeMap };
}

export function createGraphEdgeId(sourceId: DependencyGraphTaskId, targetId: DependencyGraphTaskId) {
  return `${toTaskKey(sourceId)}->${toTaskKey(targetId)}`;
}

export function hasCycle(tasks: DependencyGraphTask[]) {
  const { taskMap } = buildGraph(tasks);
  const visitState = new Map<string, "visiting" | "visited">();

  const visit = (taskId: string): boolean => {
    const task = taskMap.get(taskId);

    if (!task) {
      return false;
    }

    visitState.set(taskId, "visiting");

    for (const dependencyId of task.dependencyIds) {
      if (dependencyId === taskId) {
        return true;
      }

      const dependencyState = visitState.get(dependencyId);

      if (dependencyState === "visiting") {
        return true;
      }

      if (dependencyState !== "visited" && visit(dependencyId)) {
        return true;
      }
    }

    visitState.set(taskId, "visited");
    return false;
  };

  for (const taskId of Array.from(taskMap.keys())) {
    if (visitState.get(taskId) !== "visited" && visit(taskId)) {
      return true;
    }
  }

  return false;
}

export function getTopologicalOrder(tasks: DependencyGraphTask[]) {
  const { taskMap, dependentsMap, indegreeMap } = buildGraph(tasks);
  const queue = Array.from(indegreeMap.entries())
    .filter(([, indegree]) => indegree === 0)
    .map(([taskId]) => taskId)
    .sort((a, b) => {
      const aIndex = taskMap.get(a)?.index ?? 0;
      const bIndex = taskMap.get(b)?.index ?? 0;
      return aIndex - bIndex;
    });

  const order: DependencyGraphTask[] = [];

  while (queue.length > 0) {
    const taskId = queue.shift();

    if (!taskId) {
      continue;
    }

    const task = taskMap.get(taskId);

    if (!task) {
      continue;
    }

    order.push(task.rawTask);

    for (const dependentId of dependentsMap.get(taskId) ?? []) {
      const remainingDependencies = (indegreeMap.get(dependentId) ?? 0) - 1;
      indegreeMap.set(dependentId, remainingDependencies);

      if (remainingDependencies === 0) {
        queue.push(dependentId);
        queue.sort((a, b) => {
          const aIndex = taskMap.get(a)?.index ?? 0;
          const bIndex = taskMap.get(b)?.index ?? 0;
          return aIndex - bIndex;
        });
      }
    }
  }

  return order.length === tasks.length ? order : [];
}

export function calculateEarliestStart(
  tasks: DependencyGraphTask[],
  referenceDate = new Date(),
) {
  const { taskMap } = buildGraph(tasks);
  const order = getTopologicalOrder(tasks);
  const earliestStartById: Record<string, Date> = {};

  if (order.length !== tasks.length) {
    return earliestStartById;
  }

  order.forEach((task) => {
    const taskId = toTaskKey(task.id);
    const node = taskMap.get(taskId);

    if (!node) {
      return;
    }

    const baselineStart = node.createdAt ? laterDate(referenceDate, node.createdAt) : referenceDate;
    let earliestStart = baselineStart;

    for (const dependencyId of node.dependencyIds) {
      const dependencyStart = earliestStartById[dependencyId];
      const dependency = taskMap.get(dependencyId);

      if (!dependencyStart || !dependency) {
        continue;
      }

      const dependencyEnd =
        dependency.isCompleted && dependency.completedAt
          ? dependency.completedAt
          : addHours(dependencyStart, dependency.durationHours);

      earliestStart = laterDate(earliestStart, dependencyEnd);
    }

    earliestStartById[taskId] = earliestStart;
  });

  return earliestStartById;
}

export function getBlockedTaskIds(tasks: DependencyGraphTask[]) {
  const { taskMap } = buildGraph(tasks);

  return Array.from(taskMap.values())
    .filter(
      (task) =>
        !task.isCompleted &&
        task.dependencyIds.some((dependencyId) => !taskMap.get(dependencyId)?.isCompleted),
    )
    .map((task) => task.id);
}

export function getCriticalPath(tasks: DependencyGraphTask[]): CriticalPathResult {
  const { taskMap, dependentsMap } = buildGraph(tasks);
  const order = getTopologicalOrder(tasks);

  if (order.length !== tasks.length) {
    return {
      totalDurationHours: 0,
      nodeIds: [],
      edgeIds: [],
    };
  }

  const distanceById: Record<string, number> = {};
  const previousById: Record<string, string | null> = {};

  order.forEach((task) => {
    const taskId = toTaskKey(task.id);
    const node = taskMap.get(taskId);

    if (!node) {
      return;
    }

    if (node.dependencyIds.length === 0) {
      distanceById[taskId] = node.remainingDurationHours;
      previousById[taskId] = null;
    }

    for (const dependentId of dependentsMap.get(taskId) ?? []) {
      const dependent = taskMap.get(dependentId);

      if (!dependent) {
        continue;
      }

      const candidateDistance =
        (distanceById[taskId] ?? node.remainingDurationHours) + dependent.remainingDurationHours;

      if (candidateDistance > (distanceById[dependentId] ?? -Infinity)) {
        distanceById[dependentId] = candidateDistance;
        previousById[dependentId] = taskId;
      }
    }
  });

  let criticalTaskId: string | null = null;
  let maxDistance = 0;

  Object.entries(distanceById).forEach(([taskId, distance]) => {
    if (distance > maxDistance) {
      maxDistance = distance;
      criticalTaskId = taskId;
    }
  });

  if (!criticalTaskId) {
    return {
      totalDurationHours: 0,
      nodeIds: [],
      edgeIds: [],
    };
  }

  const nodeIds: string[] = [];
  let cursor: string | null = criticalTaskId;

  while (cursor) {
    nodeIds.unshift(cursor);
    cursor = previousById[cursor] ?? null;
  }

  const edgeIds = nodeIds.slice(1).map((taskId, index) => createGraphEdgeId(nodeIds[index], taskId));

  return {
    totalDurationHours: maxDistance,
    nodeIds,
    edgeIds,
  };
}

export function serializeGraph(tasks: DependencyGraphTask[]): SerializedGraph {
  const { taskMap } = buildGraph(tasks);
  const order = getTopologicalOrder(tasks);
  const earliestStartById = calculateEarliestStart(tasks);
  const criticalPath = getCriticalPath(tasks);
  const criticalNodes = new Set(criticalPath.nodeIds);
  const criticalEdges = new Set(criticalPath.edgeIds);
  const blockedTaskIds = getBlockedTaskIds(tasks);
  const blockedTasks = new Set(blockedTaskIds);
  const depthById: Record<string, number> = {};

  order.forEach((task) => {
    const taskId = toTaskKey(task.id);
    const node = taskMap.get(taskId);

    if (!node) {
      return;
    }

    depthById[taskId] =
      node.dependencyIds.length === 0
        ? 0
        : Math.max(...node.dependencyIds.map((dependencyId) => (depthById[dependencyId] ?? 0) + 1));
  });

  const nodes: SerializedGraphNode[] = Array.from(taskMap.values()).map((task) => ({
    id: task.id,
    data: {
      title: task.title,
      dueDate: task.dueDate?.toISOString() ?? null,
      imageUrl: task.imageUrl,
      durationHours: task.durationHours,
      earliestStart: (earliestStartById[task.id] ?? new Date()).toISOString(),
      dependencyCount: task.dependencyIds.length,
      isCompleted: task.isCompleted,
      isBlocked: blockedTasks.has(task.id),
      isCriticalPath: criticalNodes.has(task.id),
      depth: depthById[task.id] ?? 0,
    },
  }));

  const edges: SerializedGraphEdge[] = Array.from(taskMap.values()).flatMap((task) =>
    task.dependencyIds.map((dependencyId) => ({
      id: createGraphEdgeId(dependencyId, task.id),
      source: dependencyId,
      target: task.id,
      data: {
        isCriticalPath: criticalEdges.has(createGraphEdgeId(dependencyId, task.id)),
      },
    })),
  );

  return {
    nodes,
    edges,
    blockedTaskIds,
    criticalPath,
  };
}
