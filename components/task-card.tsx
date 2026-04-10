'use client';

import Image from 'next/image';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

import { hasCycle } from '@/lib/dependencyGraph';
import {
  formatDateTime,
  formatDurationHours,
  fromDateTimeLocalValue,
  getDueStatus,
  toDateTimeLocalValue,
} from '@/lib/task-formatters';
import type { TaskMutationPayload, TaskRecord } from '@/lib/task-types';

interface TaskCardProps {
  task: TaskRecord;
  tasks: TaskRecord[];
  earliestStart: string | null;
  isCriticalPath: boolean;
  isBlocked: boolean;
  isCompleted: boolean;
  isSelected: boolean;
  isDependencySelected?: boolean;
  onDelete: (taskId: number) => Promise<string | null>;
  onSave: (taskId: number, payload: TaskMutationPayload) => Promise<string | null>;
  onDependencyChange: (taskId: number, dependencyIds: number[]) => Promise<string | null>;
  onCompletionToggle: (taskId: number, isCompleted: boolean) => Promise<string | null>;
  onSelect: (taskId: number) => void;
}

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

function PlaceholderIcon() {
  return (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
      <rect x="3" y="4" width="18" height="16" rx="1.5" />
      <path d="m7 15 3-3 3 2 4-5 2 3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" strokeLinecap="round" />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="m4 20 4.5-1 9-9a2.12 2.12 0 0 0-3-3l-9 9L4 20Z" strokeLinecap="round" />
      <path d="m13.5 6.5 3 3" strokeLinecap="round" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="m5 12 4.2 4.2L19 6.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function durationFieldValue(value: number | null) {
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : '';
}

function urgencyBadge(status: ReturnType<typeof getDueStatus>, isCompleted: boolean) {
  if (isCompleted) {
    return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  }

  if (status === 'overdue') {
    return 'border-rose-200 bg-rose-50 text-rose-700';
  }

  if (status === 'dueSoon') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }

  if (status === 'scheduled') {
    return 'border-sky-200 bg-sky-50 text-sky-700';
  }

  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function urgencyLabel(status: ReturnType<typeof getDueStatus>, isCompleted: boolean) {
  if (isCompleted) {
    return 'Done';
  }

  if (status === 'overdue') {
    return 'Risk';
  }

  if (status === 'dueSoon') {
    return 'Risk';
  }

  if (status === 'scheduled') {
    return 'Deadline';
  }

  return 'No due date';
}

function surfaceClass(
  isCompleted: boolean,
  isBlocked: boolean,
  isCriticalPath: boolean,
  status: ReturnType<typeof getDueStatus>,
) {
  if (isCompleted) {
    return 'border-emerald-200 bg-emerald-50/30 shadow-[0_18px_40px_-28px_rgba(16,185,129,0.18)]';
  }

  if (status === 'overdue') {
    return 'border-rose-200 shadow-[0_18px_40px_-28px_rgba(225,29,72,0.32)]';
  }

  if (status === 'dueSoon') {
    return 'border-amber-200 shadow-[0_18px_40px_-28px_rgba(245,158,11,0.3)]';
  }

  if (isCriticalPath) {
    return 'border-sky-200 ring-1 ring-sky-100 shadow-[0_20px_45px_-30px_rgba(59,130,246,0.32)]';
  }

  if (isBlocked) {
    return 'border-slate-200 bg-slate-50/70';
  }

  return 'border-zinc-200';
}

function statusLabel(isCriticalPath: boolean, isBlocked: boolean) {
  if (isCriticalPath) {
    return 'Critical';
  }

  if (isBlocked) {
    return 'Blocked';
  }

  return 'Ready';
}

function dependencyLabel(dependencies: TaskRecord['dependencies']) {
  if (dependencies.length === 0) {
    return 'Flow is clear.';
  }

  return dependencies
    .slice(0, 3)
    .map((dependency) => `#${dependency.id}`)
    .join(' ');
}

export function TaskCard({
  task,
  tasks,
  earliestStart,
  isCriticalPath,
  isBlocked,
  isCompleted,
  isSelected,
  isDependencySelected = false,
  onDelete,
  onSave,
  onDependencyChange,
  onCompletionToggle,
  onSelect,
}: TaskCardProps) {
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isDependencyPanelOpen, setIsDependencyPanelOpen] = useState(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false);
  const [dependencySearch, setDependencySearch] = useState('');
  const [isImageLoaded, setIsImageLoaded] = useState(false);
  const [draftTitle, setDraftTitle] = useState(task.title);
  const [draftDueDate, setDraftDueDate] = useState(toDateTimeLocalValue(task.dueDate));
  const [draftDuration, setDraftDuration] = useState(durationFieldValue(task.estimatedDurationHours));
  const [draftDependencyIds, setDraftDependencyIds] = useState(task.dependencies.map((dependency) => dependency.id));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSyncingDependencies, setIsSyncingDependencies] = useState(false);
  const [isCompletionUpdating, setIsCompletionUpdating] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const dueStatus = getDueStatus(task.dueDate);

  useEffect(() => {
    setDraftTitle(task.title);
    setDraftDueDate(toDateTimeLocalValue(task.dueDate));
    setDraftDuration(durationFieldValue(task.estimatedDurationHours));
    setDraftDependencyIds(task.dependencies.map((dependency) => dependency.id));
    setDependencySearch('');
    setErrorMessage(null);
  }, [task]);

  useEffect(() => {
    setIsImageLoaded(false);
  }, [task.imageUrl]);

  function resetDraft() {
    setDraftTitle(task.title);
    setDraftDueDate(toDateTimeLocalValue(task.dueDate));
    setDraftDuration(durationFieldValue(task.estimatedDurationHours));
    setDraftDependencyIds(task.dependencies.map((dependency) => dependency.id));
    setErrorMessage(null);
  }

  function toggleDependency(dependencyId: number) {
    setDraftDependencyIds((currentIds) =>
      currentIds.includes(dependencyId)
        ? currentIds.filter((id) => id !== dependencyId)
        : [...currentIds, dependencyId],
    );
  }

  async function handleDependencyToggle(dependencyId: number) {
    const nextDependencyIds = draftDependencyIds.includes(dependencyId)
      ? draftDependencyIds.filter((id) => id !== dependencyId)
      : [...draftDependencyIds, dependencyId];

    setDraftDependencyIds(nextDependencyIds);
    setIsSyncingDependencies(true);
    setErrorMessage(null);

    const error = await onDependencyChange(task.id, nextDependencyIds);

    setIsSyncingDependencies(false);

    if (error) {
      setDraftDependencyIds(task.dependencies.map((dependency) => dependency.id));
      setErrorMessage(error);
    }
  }

  function wouldCreateCycle(candidateTaskId: number) {
    if (candidateTaskId === task.id) {
      return true;
    }

    if (draftDependencyIds.includes(candidateTaskId)) {
      return false;
    }

    return hasCycle(
      tasks.map((currentTask) => ({
        ...currentTask,
        dependencies:
          currentTask.id === task.id
            ? [...draftDependencyIds, candidateTaskId].map((dependencyId) => ({ id: dependencyId }))
            : currentTask.dependencies,
      })),
    );
  }

  async function handleSave() {
    const trimmedTitle = draftTitle.trim();

    if (!trimmedTitle) {
      setErrorMessage('Enter step name.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    const error = await onSave(task.id, {
      title: trimmedTitle,
      dueDate: fromDateTimeLocalValue(draftDueDate),
      estimatedDurationHours: draftDuration ? Number(draftDuration) : null,
      dependencyIds: draftDependencyIds,
    });

    setIsSubmitting(false);

    if (error) {
      setErrorMessage(error);
      return;
    }

    setIsEditorOpen(false);
  }

  async function handleDelete() {
    setIsSubmitting(true);
    setErrorMessage(null);

    const error = await onDelete(task.id);

    setIsSubmitting(false);
    setIsDeleteConfirmOpen(false);

    if (error) {
      setErrorMessage(error);
    }
  }

  async function handleCompletionAction() {
    setIsCompletionUpdating(true);
    setErrorMessage(null);

    const error = await onCompletionToggle(task.id, !isCompleted);

    setIsCompletionUpdating(false);

    if (error) {
      setErrorMessage(error);
    }
  }

  const dependencyCandidates = tasks
    .filter((candidate) => candidate.id !== task.id)
    .filter((candidate) => {
      const query = dependencySearch.trim().toLowerCase();

      if (!query) {
        return true;
      }

      return (
        String(candidate.id).includes(query) ||
        candidate.title.toLowerCase().includes(query)
      );
    });

  const deleteDialog =
    isDeleteConfirmOpen && typeof document !== 'undefined'
      ? createPortal(
          <div
            className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/35 px-4 backdrop-blur-[2px]"
            onClick={() => {
              if (!isSubmitting) {
                setIsDeleteConfirmOpen(false);
              }
            }}
          >
            <div
              className="w-full max-w-sm rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-zinc-500">Remove step</p>
              <h4 className="mt-2 text-lg font-semibold tracking-tight text-zinc-950">Delete Step #{task.id}?</h4>
              <p className="mt-2 text-sm leading-6 text-zinc-600">
                This will remove the step from the flow and update its linked dependencies.
              </p>

              <div className="mt-5 flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setIsDeleteConfirmOpen(false)}
                  disabled={isSubmitting}
                  className="rounded-full border border-zinc-200 px-4 py-2 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancel
                </button>

                <button
                  type="button"
                  onClick={() => {
                    void handleDelete();
                  }}
                  disabled={isSubmitting}
                  className="rounded-full bg-rose-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSubmitting ? 'Removing...' : 'Delete'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <article
        onClick={(event) => {
          event.stopPropagation();
          onSelect(task.id);
        }}
        className={[
          'flex h-full w-[272px] flex-none flex-col overflow-hidden rounded-2xl border bg-white shadow-sm transition duration-200 hover:-translate-y-0.5 hover:shadow-md',
          isSelected ? 'ring-2 ring-zinc-900/8 shadow-md' : '',
          isDependencySelected ? 'ring-2 ring-sky-200 ring-offset-1' : '',
          surfaceClass(isCompleted, isBlocked, isCriticalPath, dueStatus),
        ].join(' ')}
      >
      <div className="relative aspect-[16/8] overflow-hidden bg-zinc-100">
        {task.imageUrl ? (
          <>
            {!isImageLoaded ? <div className="absolute inset-0 shimmer bg-zinc-200" /> : null}
            <Image
              src={task.imageUrl}
              alt={task.title}
              fill
              sizes="(min-width: 1536px) 32vw, (min-width: 1280px) 38vw, (min-width: 1024px) 40vw, 100vw"
              className={[
                'object-cover transition duration-500',
                isImageLoaded ? 'opacity-100' : 'scale-[1.02] opacity-0',
              ].join(' ')}
              onLoadingComplete={() => setIsImageLoaded(true)}
            />
          </>
        ) : (
          <div className="flex h-full items-center justify-center bg-zinc-100 text-zinc-500">
            <div className="flex items-center gap-2 rounded-full border border-zinc-200 bg-white px-3 py-2 text-sm font-medium">
              <PlaceholderIcon />
              No preview
            </div>
          </div>
        )}

        <div className="absolute left-3 top-3 flex flex-wrap gap-2">
          <span
            className={[
              'rounded-full border px-2 py-1 text-[10px] font-semibold',
              urgencyBadge(dueStatus, isCompleted),
            ].join(' ')}
          >
            {urgencyLabel(dueStatus, isCompleted)}
          </span>
          {!isCompleted ? (
            <span className="rounded-full border border-zinc-200 bg-white/90 px-2 py-1 text-[10px] font-semibold text-zinc-700 backdrop-blur">
              {statusLabel(isCriticalPath, isBlocked)}
            </span>
          ) : null}
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-zinc-500">Step #{task.id}</p>
            <h3 className="mt-1 line-clamp-2 text-sm font-semibold tracking-tight text-zinc-950">{task.title}</h3>
          </div>

          <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsEditorOpen((current) => !current);
                  setErrorMessage(null);
                }}
                aria-label="Edit"
                title="Edit"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-zinc-200 text-zinc-700 transition hover:bg-zinc-50"
              >
                <EditIcon />
              </button>

              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsDeleteConfirmOpen(true);
                }}
                disabled={isSubmitting}
                aria-label="Remove"
                title="Remove"
                className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-rose-200 text-rose-600 transition hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <TrashIcon />
              </button>
          </div>
        </div>

        <div className="mt-4 space-y-2 text-xs text-zinc-600">
          <div className="flex items-center justify-between gap-3 rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
            <span className="inline-flex items-center gap-1.5">
              <CalendarIcon />
              Deadline
            </span>
            <span className="truncate font-medium text-zinc-900">
              {task.dueDate ? formatDateTime(task.dueDate) : 'No due date'}
            </span>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Effort</p>
              <p className="mt-1 text-sm font-medium text-zinc-900">{formatDurationHours(task.estimatedDurationHours)}</p>
            </div>
            <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Start</p>
              <p className="mt-1 text-sm font-medium text-zinc-900">
                {earliestStart ? formatDateTime(earliestStart) : 'Blocked'}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-500">
                <DependencyIcon />
                Blockers
              </div>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  setIsDependencyPanelOpen((current) => !current);
                }}
                className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-[10px] font-semibold text-zinc-600 transition hover:bg-zinc-50"
              >
                Manage
              </button>
            </div>
            <p className="mt-1 text-sm font-medium text-zinc-900">{dependencyLabel(task.dependencies)}</p>

            {isDependencyPanelOpen ? (
              <div className="mt-3 space-y-3">
                <input
                  type="text"
                  value={dependencySearch}
                  onChange={(event) => setDependencySearch(event.target.value)}
                  onClick={(event) => event.stopPropagation()}
                  placeholder="Search step"
                  className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
                />
                <div className="flex max-h-[112px] flex-wrap gap-2 overflow-y-auto pr-1">
                  {dependencyCandidates.map((candidate) => {
                    const isSelected = draftDependencyIds.includes(candidate.id);
                    const isDisabled = wouldCreateCycle(candidate.id);

                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          void handleDependencyToggle(candidate.id);
                        }}
                        disabled={isSyncingDependencies || (!isSelected && isDisabled)}
                        title={!isSelected && isDisabled ? 'Creates a loop' : undefined}
                        className={[
                          'rounded-full border px-2.5 py-1.5 text-[11px] transition',
                          isSelected
                            ? 'border-sky-200 bg-sky-50 text-sky-700'
                            : !isSelected && isDisabled
                              ? 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400'
                              : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50',
                        ].join(' ')}
                      >
                        #{candidate.id} <span className="ml-1 opacity-70">{candidate.title}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            {isSyncingDependencies ? (
              <p className="mt-2 text-[11px] text-zinc-500">Updating...</p>
            ) : null}
          </div>
        </div>

        {isCompleted ? (
          <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3 py-2.5">
            <div className="inline-flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckIcon />
              Completed
            </div>
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void handleCompletionAction();
              }}
              disabled={isCompletionUpdating}
              className="text-xs font-semibold text-emerald-700 transition hover:text-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isCompletionUpdating ? 'Updating...' : 'Reopen'}
            </button>
          </div>
        ) : !isBlocked ? (
          <div className="mt-4">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                void handleCompletionAction();
              }}
              disabled={isCompletionUpdating}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-4 py-2.5 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <CheckIcon />
              {isCompletionUpdating ? 'Updating...' : 'Done'}
            </button>
          </div>
        ) : null}

        {isEditorOpen ? (
          <div className="mt-4 border-t border-zinc-200 pt-4">
            <div className="grid gap-4">
              <label className="block">
                <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Step name</span>
                <input
                  type="text"
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
                />
              </label>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Deadline</span>
                  <input
                    type="datetime-local"
                    value={draftDueDate}
                    onChange={(event) => setDraftDueDate(event.target.value)}
                    className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
                  />
                </label>

                <label className="block">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Effort</span>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={draftDuration}
                    onChange={(event) => setDraftDuration(event.target.value)}
                    placeholder="1"
                    className="mt-2 w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
                  />
                </label>
              </div>

              <div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-500">Depends on</span>
                  <span className="text-xs text-zinc-500">{draftDependencyIds.length} selected</span>
                </div>

                {tasks.filter((candidate) => candidate.id !== task.id).length > 0 ? (
                  <div className="mt-3 flex max-h-[168px] flex-wrap gap-2 overflow-y-auto pr-1">
                    {tasks
                      .filter((candidate) => candidate.id !== task.id)
                      .map((candidate) => {
                        const isSelected = draftDependencyIds.includes(candidate.id);
                        const isDisabled = wouldCreateCycle(candidate.id);

                        return (
                          <button
                            key={candidate.id}
                            type="button"
                            onClick={() => toggleDependency(candidate.id)}
                            disabled={!isSelected && isDisabled}
                            title={!isSelected && isDisabled ? 'Creates a loop' : undefined}
                            className={[
                              'rounded-full border px-3 py-2 text-sm transition',
                              isSelected
                                ? 'border-sky-200 bg-sky-50 text-sky-700'
                                : !isSelected && isDisabled
                                  ? 'cursor-not-allowed border-zinc-200 bg-zinc-100 text-zinc-400'
                                  : 'border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50',
                            ].join(' ')}
                          >
                            #{candidate.id}
                          </button>
                        );
                      })}
                  </div>
                ) : (
                  <p className="mt-3 text-sm text-zinc-500">Add another step first.</p>
                )}
              </div>
            </div>

            {errorMessage ? (
              <div className="mt-4 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {errorMessage}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={handleSave}
                disabled={isSubmitting}
                className="rounded-full bg-zinc-950 px-4 py-2.5 text-sm font-semibold text-white transition hover:scale-[1.01] hover:bg-zinc-800 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSubmitting ? 'Saving...' : 'Save'}
              </button>

              <button
                type="button"
                onClick={() => {
                  resetDraft();
                  setIsEditorOpen(false);
                }}
                disabled={isSubmitting}
                className="rounded-full border border-zinc-200 px-4 py-2.5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                Reset
              </button>
            </div>
          </div>
        ) : null}
      </div>

      </article>
      {deleteDialog}
    </>
  );
}
