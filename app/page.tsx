'use client';

import { FormEvent, useEffect, useMemo, useRef, useState } from 'react';

import { TaskCard } from '@/components/task-card';
import { TaskGraph } from '@/components/task-graph';
import { calculateEarliestStart, getBlockedTaskIds, getCriticalPath } from '@/lib/dependencyGraph';
import { formatDurationHours, fromDateTimeLocalValue, getDueStatus } from '@/lib/task-formatters';
import type { TaskMutationPayload, TaskRecord } from '@/lib/task-types';

type TaskFilter = 'all' | 'ready' | 'blocked' | 'urgent' | 'critical';

function CalendarIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="5" width="18" height="16" rx="1.5" />
      <path d="M8 3v4M16 3v4M3 10h18" strokeLinecap="round" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DependencyIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M9 7H5a2 2 0 0 0-2 2v0a2 2 0 0 0 2 2h4m6-4h4a2 2 0 0 1 2 2v0a2 2 0 0 1-2 2h-4" />
      <path d="M8 12h8" strokeLinecap="round" />
    </svg>
  );
}

function SparklineIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 16l5-6 4 4 7-9" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 20h16" strokeLinecap="round" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m6 9 6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="11" cy="11" r="6" />
      <path d="m20 20-4.2-4.2" strokeLinecap="round" />
    </svg>
  );
}

function InboxIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 5h16v11h-4l-2 3h-4l-2-3H4V5Z" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

async function readErrorMessage(response: Response, fallback: string) {
  try {
    const data = await response.json();
    return typeof data?.error === 'string' ? data.error : fallback;
  } catch {
    return fallback;
  }
}

function applyOptimisticDependencies(
  tasks: TaskRecord[],
  taskId: number,
  dependencyIds: number[],
) {
  const taskMap = new Map(tasks.map((task) => [task.id, task]));

  return tasks.map((task) => {
    if (task.id === taskId) {
      return {
        ...task,
        dependencies: dependencyIds
          .map((dependencyId) => taskMap.get(dependencyId))
          .filter((dependency): dependency is TaskRecord => Boolean(dependency))
          .map((dependency) => ({
            id: dependency.id,
            title: dependency.title,
          })),
      };
    }

    const isDependent = dependencyIds.includes(task.id);
    const currentlyDependent = task.dependents.some((dependent) => dependent.id === taskId);

    if (isDependent && !currentlyDependent) {
      const changedTask = taskMap.get(taskId);

      if (!changedTask) {
        return task;
      }

      return {
        ...task,
        dependents: [
          ...task.dependents,
          {
            id: changedTask.id,
            title: changedTask.title,
          },
        ],
      };
    }

    if (!isDependent && currentlyDependent) {
      return {
        ...task,
        dependents: task.dependents.filter((dependent) => dependent.id !== taskId),
      };
    }

    return task;
  });
}

function applyOptimisticCompletion(tasks: TaskRecord[], taskId: number, isCompleted: boolean) {
  const completedAt = isCompleted ? new Date().toISOString() : null;

  return tasks.map((task) =>
    task.id === taskId
      ? {
          ...task,
          isCompleted,
          completedAt,
        }
      : task,
  );
}

function LoadingCard() {
  return (
    <div className="h-full w-[272px] flex-none overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
      <div className="aspect-[16/8] shimmer bg-zinc-200" />
      <div className="space-y-3 p-4">
        <div className="h-4 w-20 rounded-full bg-zinc-200" />
        <div className="h-5 w-3/4 rounded-full bg-zinc-200" />
        <div className="h-10 rounded-xl bg-zinc-100" />
        <div className="grid grid-cols-2 gap-2">
          <div className="h-14 rounded-xl bg-zinc-100" />
          <div className="h-14 rounded-xl bg-zinc-100" />
        </div>
      </div>
    </div>
  );
}

function filterTask(
  task: TaskRecord,
  activeFilter: TaskFilter,
  blockedTaskIds: Set<string>,
  criticalTaskIds: Set<string>,
) {
  if (activeFilter === 'all') {
    return true;
  }

  if (activeFilter === 'ready') {
    return !task.isCompleted && !blockedTaskIds.has(String(task.id));
  }

  if (activeFilter === 'blocked') {
    return !task.isCompleted && blockedTaskIds.has(String(task.id));
  }

  if (activeFilter === 'urgent') {
    const dueStatus = getDueStatus(task.dueDate);
    return !task.isCompleted && (dueStatus === 'overdue' || dueStatus === 'dueSoon');
  }

  if (activeFilter === 'critical') {
    return !task.isCompleted && criticalTaskIds.has(String(task.id));
  }

  return true;
}

function getTaskSortWeight(task: TaskRecord, criticalTaskIds: Set<string>, blockedTaskIds: Set<string>) {
  if (task.isCompleted) {
    return 5;
  }

  const dueStatus = getDueStatus(task.dueDate);

  if (dueStatus === 'overdue') {
    return 0;
  }

  if (dueStatus === 'dueSoon') {
    return 1;
  }

  if (criticalTaskIds.has(String(task.id))) {
    return 2;
  }

  if (!blockedTaskIds.has(String(task.id))) {
    return 3;
  }

  return 4;
}

export default function Home() {
  const [tasks, setTasks] = useState<TaskRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [newTaskTitle, setNewTaskTitle] = useState('');
  const [newTaskDueDate, setNewTaskDueDate] = useState('');
  const [newTaskDuration, setNewTaskDuration] = useState('');
  const [selectedDependencyIds, setSelectedDependencyIds] = useState<number[]>([]);
  const [isDependencyPickerOpen, setIsDependencyPickerOpen] = useState(false);
  const [dependencyQuery, setDependencyQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<TaskFilter>('all');
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const [isTaskBrowserOpen, setIsTaskBrowserOpen] = useState(false);
  const [taskBrowserQuery, setTaskBrowserQuery] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const laneRef = useRef<HTMLDivElement | null>(null);
  const taskCardRefs = useRef<Record<number, HTMLDivElement | null>>({});

  async function fetchTasks() {
    try {
      const response = await fetch('/api/todos');

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to load flow.'));
      }

      const data = (await response.json()) as TaskRecord[];
      setTasks(data);
      setPageError(null);
    } catch (error) {
      setPageError(error instanceof Error ? error.message : 'Unable to load flow.');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void fetchTasks();
  }, []);

  function toggleDependency(taskId: number) {
    setSelectedDependencyIds((currentIds) =>
      currentIds.includes(taskId) ? currentIds.filter((id) => id !== taskId) : [...currentIds, taskId],
    );
  }

  function handleCreateDependencyToggle(taskId: number) {
    toggleDependency(taskId);
    setDependencyQuery('');
  }

  function handleTaskInteraction(taskId: number) {
    if (isDependencyPickerOpen) {
      handleCreateDependencyToggle(taskId);
      return;
    }

    setSelectedTaskId(taskId);
  }

  async function handleCreateTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedTitle = newTaskTitle.trim();

    if (!trimmedTitle) {
      setCreateError('Enter step name.');
      return;
    }

    setIsCreating(true);
    setCreateError(null);

    try {
      const response = await fetch('/api/todos', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title: trimmedTitle,
          dueDate: fromDateTimeLocalValue(newTaskDueDate),
          estimatedDurationHours: newTaskDuration ? Number(newTaskDuration) : null,
          dependencyIds: selectedDependencyIds,
        } satisfies TaskMutationPayload),
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Unable to add step.'));
      }

      setNewTaskTitle('');
      setNewTaskDueDate('');
      setNewTaskDuration('');
      setSelectedDependencyIds([]);
      setIsDependencyPickerOpen(false);
      setDependencyQuery('');
      await fetchTasks();
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : 'Unable to add step.');
    } finally {
      setIsCreating(false);
    }
  }

  async function handleDeleteTask(taskId: number) {
    try {
      const response = await fetch(`/api/todos/${taskId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        return readErrorMessage(response, 'Unable to remove step.');
      }

      await fetchTasks();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Unable to remove step.';
    }
  }

  async function handleUpdateTask(taskId: number, payload: TaskMutationPayload) {
    try {
      const response = await fetch(`/api/todos/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        return readErrorMessage(response, 'Unable to update step.');
      }

      await fetchTasks();
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : 'Unable to update step.';
    }
  }

  async function handleDependencyChange(taskId: number, dependencyIds: number[]) {
    const previousTasks = tasks;
    setTasks((currentTasks) => applyOptimisticDependencies(currentTasks, taskId, dependencyIds));

    try {
      const response = await fetch(`/api/todos/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          dependencyIds,
        } satisfies TaskMutationPayload),
      });

      if (!response.ok) {
        setTasks(previousTasks);
        return readErrorMessage(response, 'Unable to update blockers.');
      }

      void fetchTasks();
      return null;
    } catch (error) {
      setTasks(previousTasks);
      return error instanceof Error ? error.message : 'Unable to update blockers.';
    }
  }

  async function handleCompletionToggle(taskId: number, isCompleted: boolean) {
    const previousTasks = tasks;
    setTasks((currentTasks) => applyOptimisticCompletion(currentTasks, taskId, isCompleted));

    try {
      const response = await fetch(`/api/todos/${taskId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          isCompleted,
        } satisfies TaskMutationPayload),
      });

      if (!response.ok) {
        setTasks(previousTasks);
        return readErrorMessage(response, 'Unable to update step progress.');
      }

      void fetchTasks();
      return null;
    } catch (error) {
      setTasks(previousTasks);
      return error instanceof Error ? error.message : 'Unable to update step progress.';
    }
  }

  const graphTasks = useMemo(
    () =>
      [...tasks].sort(
        (leftTask, rightTask) =>
          new Date(leftTask.createdAt).getTime() - new Date(rightTask.createdAt).getTime(),
      ),
    [tasks],
  );
  const earliestStartById = useMemo(() => calculateEarliestStart(graphTasks), [graphTasks]);
  const blockedTaskIds = useMemo(() => new Set(getBlockedTaskIds(graphTasks)), [graphTasks]);
  const criticalPath = useMemo(() => getCriticalPath(graphTasks), [graphTasks]);
  const criticalTaskIds = useMemo(() => new Set(criticalPath.nodeIds), [criticalPath.nodeIds]);
  const blockedCount = blockedTaskIds.size;
  const readyCount = Math.max(tasks.filter((task) => !task.isCompleted).length - blockedCount, 0);

  const sortedTasks = useMemo(() => {
    return [...graphTasks].sort((leftTask, rightTask) => {
      const leftWeight = getTaskSortWeight(leftTask, criticalTaskIds, blockedTaskIds);
      const rightWeight = getTaskSortWeight(rightTask, criticalTaskIds, blockedTaskIds);

      if (leftWeight !== rightWeight) {
        return leftWeight - rightWeight;
      }

      const leftDue = leftTask.dueDate ? new Date(leftTask.dueDate).getTime() : Number.POSITIVE_INFINITY;
      const rightDue = rightTask.dueDate ? new Date(rightTask.dueDate).getTime() : Number.POSITIVE_INFINITY;

      if (leftDue !== rightDue) {
        return leftDue - rightDue;
      }

      return new Date(rightTask.createdAt).getTime() - new Date(leftTask.createdAt).getTime();
    });
  }, [graphTasks, criticalTaskIds, blockedTaskIds]);

  const filteredTasks = sortedTasks.filter((task) =>
    filterTask(task, activeFilter, blockedTaskIds, criticalTaskIds),
  );

  useEffect(() => {
    if (filteredTasks.length === 0) {
      if (selectedTaskId !== null) {
        setSelectedTaskId(null);
      }
      return;
    }

    if (selectedTaskId === null) {
      return;
    }

    if (filteredTasks.some((task) => task.id === selectedTaskId)) {
      return;
    }

    setSelectedTaskId(null);
  }, [filteredTasks, selectedTaskId]);

  useEffect(() => {
    if (!selectedTaskId) {
      return;
    }

    const lane = laneRef.current;
    const card = taskCardRefs.current[selectedTaskId];

    if (!lane || !card) {
      return;
    }

    const laneRect = lane.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const targetScrollLeft =
      lane.scrollLeft + (cardRect.left - laneRect.left) - laneRect.width / 2 + cardRect.width / 2;

    lane.scrollTo({
      left: Math.max(0, targetScrollLeft),
      behavior: 'smooth',
    });
  }, [selectedTaskId, filteredTasks]);

  const filterItems: Array<{ key: TaskFilter; label: string; count: number }> = [
    { key: 'all', label: 'All', count: tasks.length },
    { key: 'ready', label: 'Ready', count: readyCount },
    { key: 'blocked', label: 'Blocked', count: blockedCount },
    { key: 'urgent', label: 'Risk', count: tasks.filter((task) => {
      const dueStatus = getDueStatus(task.dueDate);
      return !task.isCompleted && (dueStatus === 'overdue' || dueStatus === 'dueSoon');
    }).length },
    {
      key: 'critical',
      label: 'Critical',
      count: tasks.filter((task) => !task.isCompleted && criticalTaskIds.has(String(task.id))).length,
    },
  ];

  const taskBrowserTasks = sortedTasks.filter((task) => {
    const query = taskBrowserQuery.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return String(task.id).includes(query) || task.title.toLowerCase().includes(query);
  });

  const selectedDependencySet = useMemo(() => new Set(selectedDependencyIds), [selectedDependencyIds]);

  const createDependencyCandidates = sortedTasks.filter((task) => {
    const query = dependencyQuery.trim().toLowerCase();

    if (!query) {
      return true;
    }

    return String(task.id).includes(query) || task.title.toLowerCase().includes(query);
  });

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950">
      <div className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6 lg:px-8">
        <header className="mb-6 rounded-2xl border border-zinc-200 bg-white px-5 py-5 shadow-sm">
          <div className="max-w-4xl">
            <div className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-sm font-medium text-zinc-700">
              <SparklineIcon />
              FlowForge OS
            </div>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl xl:whitespace-nowrap">
              Move critical work forward with dependency clarity
            </h1>
          </div>
        </header>

        {pageError ? (
          <div className="mb-6 rounded-2xl border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
            {pageError}
          </div>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-[320px_620px_minmax(0,1fr)] xl:items-stretch">
          <section className="min-w-0 xl:h-[840px]">
            <div className="xl:sticky xl:top-6 xl:h-[840px]">
              <section className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">New step</p>
                    <h2 className="mt-2 text-xl font-semibold tracking-tight text-zinc-950">Create step</h2>
                  </div>
                  <div className="rounded-full bg-zinc-950 p-2.5 text-white">
                    <PlusIcon />
                  </div>
                </div>

                <form onSubmit={handleCreateTask} className="mt-5 flex min-h-0 flex-1 flex-col space-y-4">
                  <label className="block">
                    <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Step name</span>
                    <input
                      type="text"
                      value={newTaskTitle}
                      onChange={(event) => setNewTaskTitle(event.target.value)}
                      placeholder="Activity"
                      className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
                    />
                  </label>

                  <label className="block">
                    <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      <CalendarIcon />
                      Deadline
                    </span>
                    <input
                      type="datetime-local"
                      value={newTaskDueDate}
                      onChange={(event) => setNewTaskDueDate(event.target.value)}
                      className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
                    />
                  </label>

                  <label className="block">
                    <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                      <ClockIcon />
                      Effort
                    </span>
                    <input
                      type="number"
                      min="0.5"
                      step="0.5"
                      value={newTaskDuration}
                      onChange={(event) => setNewTaskDuration(event.target.value)}
                      placeholder="1"
                      className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
                    />
                  </label>

                  <div
                    className={[
                      'rounded-xl border border-zinc-200 bg-zinc-50 p-4',
                      isDependencyPickerOpen ? 'flex min-h-0 flex-1 flex-col' : '',
                    ].join(' ')}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                        <DependencyIcon />
                        Depends on
                      </span>
                      <button
                        type="button"
                        onClick={() => setIsDependencyPickerOpen((current) => !current)}
                        className="rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition hover:bg-zinc-50"
                      >
                        Manage
                      </button>
                    </div>

                    {isDependencyPickerOpen ? (
                      tasks.length > 0 ? (
                        <div
                          className={[
                            'mt-4 space-y-3',
                            isDependencyPickerOpen ? 'flex min-h-0 flex-1 flex-col' : '',
                          ].join(' ')}
                        >
                          {selectedDependencyIds.length > 0 ? (
                            <div className="flex flex-wrap gap-2">
                              {sortedTasks
                                .filter((task) => selectedDependencySet.has(task.id))
                                .map((task) => (
                                  <button
                                    key={task.id}
                                    type="button"
                                    onClick={() => handleCreateDependencyToggle(task.id)}
                                    className="rounded-full border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:bg-sky-100"
                                  >
                                    #{task.id} {task.title}
                                  </button>
                                ))}
                            </div>
                          ) : null}

                          <input
                            type="text"
                            value={dependencyQuery}
                            onChange={(event) => setDependencyQuery(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' && createDependencyCandidates.length > 0) {
                                event.preventDefault();
                                handleCreateDependencyToggle(createDependencyCandidates[0].id);
                              }
                            }}
                            placeholder="Search step"
                            className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
                          />

                          <p className="text-xs text-zinc-500">Search here, or click steps in the lane and map.</p>

                          <div
                            className={[
                              'flex flex-wrap gap-2 pr-1',
                              isDependencyPickerOpen ? 'min-h-0 flex-1 overflow-y-auto' : '',
                            ].join(' ')}
                          >
                            {createDependencyCandidates.slice(0, 18).map((task) => {
                              const isSelected = selectedDependencySet.has(task.id);

                              return (
                                <button
                                  key={task.id}
                                  type="button"
                                  onClick={() => handleCreateDependencyToggle(task.id)}
                                  className={[
                                    'rounded-full border px-3 py-2 text-sm transition',
                                    isSelected
                                      ? 'border-sky-200 bg-sky-50 text-sky-700'
                                      : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-100',
                                  ].join(' ')}
                                >
                                  #{task.id} <span className="opacity-70">{task.title}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ) : (
                        <p className="mt-4 text-sm text-zinc-500">Add another step first.</p>
                      )
                    ) : null}
                  </div>

                  {createError ? (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                      {createError}
                    </div>
                  ) : null}

                  <div className={isDependencyPickerOpen ? 'mt-auto pt-2' : 'pt-2'}>
                    <button
                    type="submit"
                    disabled={isCreating}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-zinc-950 px-5 py-3 text-sm font-semibold text-white transition hover:scale-[1.01] hover:bg-zinc-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <PlusIcon />
                    {isCreating ? 'Adding...' : 'Add to flow'}
                    </button>
                  </div>
                </form>
              </section>
            </div>
          </section>

          <section className="min-w-0 xl:h-[840px]">
            <div className="flex h-full flex-col rounded-2xl border border-zinc-200 bg-white shadow-sm">
              <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-5">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Workstream</p>
                  <h2 className="mt-2 text-2xl font-semibold tracking-tight text-zinc-950">Execution lane</h2>
                </div>

                <div className="flex items-center gap-2">
                  <div className="relative">
                    <button
                      type="button"
                      onClick={() => setIsFilterMenuOpen((current) => !current)}
                      className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                    >
                      <span>{filterItems.find((filter) => filter.key === activeFilter)?.label ?? 'All'}</span>
                      <span className="text-zinc-400">/</span>
                      <span className="text-zinc-500">
                        {filterItems.find((filter) => filter.key === activeFilter)?.count ?? tasks.length}
                      </span>
                      <ChevronDownIcon />
                    </button>

                    {isFilterMenuOpen ? (
                      <div className="absolute right-0 top-[calc(100%+8px)] z-20 min-w-[220px] overflow-hidden rounded-2xl border border-zinc-200 bg-white p-2 shadow-lg">
                        {filterItems.map((filter) => (
                          <button
                            key={filter.key}
                            type="button"
                            onClick={() => {
                              setActiveFilter(filter.key);
                              setIsFilterMenuOpen(false);
                            }}
                            className={[
                              'flex w-full items-center justify-between rounded-xl px-3 py-2 text-sm transition',
                              activeFilter === filter.key
                                ? 'bg-zinc-950 text-white'
                                : 'text-zinc-700 hover:bg-zinc-50',
                            ].join(' ')}
                          >
                            <span>{filter.label}</span>
                            <span className={activeFilter === filter.key ? 'text-white/70' : 'text-zinc-400'}>
                              {filter.count}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => setIsTaskBrowserOpen(true)}
                    className="inline-flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                  >
                    <SearchIcon />
                    Browse
                  </button>
                </div>
              </div>

              <div className="flex flex-1 flex-col min-h-0">
                <div
                  ref={laneRef}
                  onClick={() => {
                    setSelectedTaskId(null);
                    setIsFilterMenuOpen(false);
                  }}
                  className="lane-scrollbar flex flex-1 gap-4 overflow-x-auto overflow-y-hidden px-5 py-5"
                >
                  {isLoading ? (
                    <>
                      <LoadingCard />
                      <LoadingCard />
                      <LoadingCard />
                    </>
                  ) : filteredTasks.length === 0 ? (
                    <div className="flex h-full w-full items-center justify-center rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-5 text-center text-zinc-600">
                      <div>
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full border border-zinc-200 bg-white text-zinc-500">
                          <InboxIcon />
                        </div>
                        <p className="mt-4 text-lg font-semibold text-zinc-950">Add your first step to begin mapping execution flow.</p>
                        <p className="mt-2 text-sm leading-6" />
                      </div>
                    </div>
                  ) : (
                    filteredTasks.map((task) => (
                      <div
                        key={task.id}
                        ref={(element) => {
                          taskCardRefs.current[task.id] = element;
                        }}
                      >
                        <TaskCard
                          task={task}
                          tasks={graphTasks}
                          earliestStart={
                            earliestStartById[String(task.id)]?.toISOString() ?? new Date(task.createdAt).toISOString()
                          }
                          isCriticalPath={criticalTaskIds.has(String(task.id))}
                          isBlocked={blockedTaskIds.has(String(task.id))}
                          isCompleted={task.isCompleted}
                          isSelected={selectedTaskId === task.id}
                          isDependencySelected={selectedDependencySet.has(task.id)}
                          onDelete={handleDeleteTask}
                          onSave={handleUpdateTask}
                          onDependencyChange={handleDependencyChange}
                          onCompletionToggle={handleCompletionToggle}
                          onSelect={handleTaskInteraction}
                        />
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          </section>

          <section className="min-w-0 xl:h-[840px]">
            <TaskGraph
              tasks={graphTasks}
              activeTaskId={selectedTaskId}
              onActiveTaskChange={setSelectedTaskId}
              dependencyPickerOpen={isDependencyPickerOpen}
              selectedDependencyIds={selectedDependencyIds}
              onDependencyToggle={handleCreateDependencyToggle}
            />
          </section>
        </div>

        {isTaskBrowserOpen ? (
          <div
            className="fixed inset-0 z-40 flex items-center justify-center bg-zinc-950/30 px-4"
            onClick={() => setIsTaskBrowserOpen(false)}
          >
            <div
              className="w-full max-w-3xl rounded-2xl border border-zinc-200 bg-white shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-4 border-b border-zinc-200 px-5 py-4">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Workstream</p>
                  <h3 className="mt-1 text-xl font-semibold tracking-tight text-zinc-950">Browse</h3>
                </div>

                <button
                  type="button"
                  onClick={() => setIsTaskBrowserOpen(false)}
                  className="rounded-full border border-zinc-200 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                >
                  Done
                </button>
              </div>

              <div className="border-b border-zinc-200 px-5 py-4">
                <div className="flex items-center gap-3 rounded-xl border border-zinc-200 bg-white px-4 py-3">
                  <SearchIcon />
                  <input
                    type="text"
                    value={taskBrowserQuery}
                    onChange={(event) => setTaskBrowserQuery(event.target.value)}
                    placeholder="Search step"
                    className="w-full bg-transparent text-sm text-zinc-900 outline-none"
                  />
                </div>
              </div>

              <div className="max-h-[60vh] overflow-y-auto px-3 py-3">
                {taskBrowserTasks.length === 0 ? (
                  <div className="px-3 py-10 text-center text-sm text-zinc-500">No steps found.</div>
                ) : (
                  taskBrowserTasks.map((task) => {
                    const dueStatus = getDueStatus(task.dueDate);

                    return (
                      <button
                        key={task.id}
                        type="button"
                        onClick={() => {
                          setSelectedTaskId(task.id);
                          setIsTaskBrowserOpen(false);
                          setTaskBrowserQuery('');
                        }}
                        className={[
                          'flex w-full items-center justify-between gap-4 rounded-xl px-4 py-3 text-left transition',
                          selectedTaskId === task.id ? 'bg-zinc-950 text-white' : 'hover:bg-zinc-50',
                        ].join(' ')}
                      >
                        <div className="min-w-0">
                          <p
                            className={[
                              'text-[11px] font-semibold uppercase tracking-[0.14em]',
                              selectedTaskId === task.id ? 'text-white/70' : 'text-zinc-500',
                            ].join(' ')}
                          >
                            Step #{task.id}
                          </p>
                          <p className="mt-1 truncate text-sm font-medium">{task.title}</p>
                        </div>

                        <div
                          className={[
                            'shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold',
                            selectedTaskId === task.id
                              ? 'border-white/20 text-white'
                              : task.isCompleted
                                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                : dueStatus === 'overdue'
                                ? 'border-rose-200 bg-rose-50 text-rose-700'
                                : dueStatus === 'dueSoon'
                                  ? 'border-amber-200 bg-amber-50 text-amber-700'
                                  : blockedTaskIds.has(String(task.id))
                                    ? 'border-zinc-200 bg-zinc-100 text-zinc-600'
                                    : 'border-zinc-200 bg-zinc-50 text-zinc-600',
                          ].join(' ')}
                        >
                          {task.isCompleted
                            ? 'Done'
                            : blockedTaskIds.has(String(task.id))
                              ? 'Blocked'
                              : dueStatus === 'overdue'
                                ? 'Risk'
                                : dueStatus === 'dueSoon'
                                  ? 'Risk'
                                  : criticalTaskIds.has(String(task.id))
                                    ? 'Critical'
                                    : 'Ready'}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}


