import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hasCycle } from '@/lib/dependencyGraph';
import type { TaskMutationPayload } from '@/lib/task-types';

interface Params {
  params: {
    id: string;
  };
}

const todoRelationsInclude = {
  dependencies: {
    select: {
      id: true,
      title: true,
    },
  },
  dependents: {
    select: {
      id: true,
      title: true,
    },
  },
} satisfies Prisma.TodoInclude;

function normalizeDependencyIds(ids?: number[]) {
  if (!Array.isArray(ids)) {
    return [];
  }

  return Array.from(
    new Set(
      ids
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0),
    ),
  );
}

function parseDueDate(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (!value) {
    return null;
  }

  if (!(typeof value === 'string' || typeof value === 'number' || value instanceof Date)) {
    throw new Error('Invalid due date');
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid due date');
  }

  return date;
}

function parseEstimatedDurationHours(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  const duration =
    typeof value === 'number' || typeof value === 'string' ? Number(value) : Number.NaN;

  if (!Number.isFinite(duration) || duration <= 0) {
    throw new Error('Invalid duration');
  }

  return duration;
}

function parseCompletionStatus(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new Error('Invalid completion status');
  }

  return value;
}

export async function DELETE(request: Request, { params }: Params) {
  const id = parseInt(params.id);
  if (isNaN(id)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    await prisma.todo.delete({
      where: { id },
    });
    return NextResponse.json({ message: 'Workflow step deleted' }, { status: 200 });
  } catch (error) {
    return NextResponse.json({ error: 'Error deleting workflow step' }, { status: 500 });
  }
}

export async function PATCH(request: Request, { params }: Params) {
  const id = parseInt(params.id);

  if (Number.isNaN(id)) {
    return NextResponse.json({ error: 'Invalid ID' }, { status: 400 });
  }

  try {
    const { title, dueDate, estimatedDurationHours, dependencyIds, isCompleted } =
      (await request.json()) as TaskMutationPayload;
    const data: Prisma.TodoUpdateInput = {};

    if (title !== undefined) {
      const trimmedTitle = title.trim();

      if (!trimmedTitle) {
        return NextResponse.json({ error: 'Title is required' }, { status: 400 });
      }

      data.title = trimmedTitle;
    }

    const parsedDueDate = parseDueDate(dueDate);
    const parsedDuration = parseEstimatedDurationHours(estimatedDurationHours);
    const parsedCompletionStatus = parseCompletionStatus(isCompleted);

    if (parsedDueDate !== undefined) {
      data.dueDate = parsedDueDate;
    }

    if (parsedDuration !== undefined) {
      data.estimatedDurationHours = parsedDuration;
    }

    if (parsedCompletionStatus !== undefined) {
      data.isCompleted = parsedCompletionStatus;
      data.completedAt = parsedCompletionStatus ? new Date() : null;
    }

    if (dependencyIds !== undefined) {
      const parsedDependencyIds = normalizeDependencyIds(dependencyIds);

      if (parsedDependencyIds.includes(id)) {
        return NextResponse.json(
          { error: 'A task cannot depend on itself.' },
          { status: 400 },
        );
      }

      const allTodos = await prisma.todo.findMany({
        include: {
          dependencies: {
            select: {
              id: true,
              isCompleted: true,
            },
          },
        },
        orderBy: {
          createdAt: 'asc',
        },
      });

      const todoExists = allTodos.some((todo) => todo.id === id);

      if (!todoExists) {
        return NextResponse.json({ error: 'Workflow step not found' }, { status: 404 });
      }

      const allTodoIds = new Set(allTodos.map((todo) => todo.id));
      const missingDependency = parsedDependencyIds.find((dependencyId) => !allTodoIds.has(dependencyId));

      if (missingDependency) {
        return NextResponse.json(
          { error: 'One or more selected dependencies no longer exist.' },
          { status: 400 },
        );
      }

      if (parsedCompletionStatus) {
        const incompleteDependency = parsedDependencyIds.find((dependencyId) => {
          const dependency = allTodos.find((todo) => todo.id === dependencyId);
          return dependency ? !dependency.isCompleted : false;
        });

        if (incompleteDependency) {
          return NextResponse.json(
            { error: 'Complete blockers before marking this step done.' },
            { status: 400 },
          );
        }
      }

      const graphTasks = allTodos.map((todo) => ({
        id: todo.id,
        title: todo.title,
        createdAt: todo.createdAt,
        dueDate: todo.dueDate,
        estimatedDurationHours: todo.estimatedDurationHours,
        isCompleted: todo.isCompleted,
        completedAt: todo.completedAt,
        dependencies:
          todo.id === id
            ? parsedDependencyIds.map((dependencyId) => ({ id: dependencyId }))
            : todo.dependencies,
      }));

      if (hasCycle(graphTasks)) {
        return NextResponse.json(
          {
            error:
              'That dependency update would create a circular dependency. Choose a different task chain.',
          },
          { status: 400 },
        );
      }

      data.dependencies = {
        set: parsedDependencyIds.map((dependencyId) => ({ id: dependencyId })),
      };
    } else {
      const existingTodo = await prisma.todo.findUnique({
        where: {
          id,
        },
        select: {
          id: true,
          dependencies: {
            select: {
              id: true,
              isCompleted: true,
            },
          },
        },
      });

      if (!existingTodo) {
        return NextResponse.json({ error: 'Workflow step not found' }, { status: 404 });
      }

      if (parsedCompletionStatus && existingTodo.dependencies.some((dependency) => !dependency.isCompleted)) {
        return NextResponse.json(
          { error: 'Complete blockers before marking this step done.' },
          { status: 400 },
        );
      }
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: 'No updates were provided.' }, { status: 400 });
    }

    const todo = await prisma.todo.update({
      where: { id },
      data,
      include: todoRelationsInclude,
    });

    return NextResponse.json(todo);
  } catch (error) {
    if (error instanceof Error && error.message === 'Invalid due date') {
      return NextResponse.json({ error: 'Please provide a valid due date.' }, { status: 400 });
    }

    if (error instanceof Error && error.message === 'Invalid duration') {
      return NextResponse.json(
        { error: 'Estimated duration must be greater than zero.' },
        { status: 400 },
      );
    }

    if (error instanceof Error && error.message === 'Invalid completion status') {
      return NextResponse.json({ error: 'Please provide a valid completion status.' }, { status: 400 });
    }

    return NextResponse.json({ error: 'Error updating workflow step' }, { status: 500 });
  }
}
