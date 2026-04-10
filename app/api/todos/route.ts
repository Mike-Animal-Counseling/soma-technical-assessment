import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getTaskPreviewImage } from '@/lib/pexels';
import type { TaskMutationPayload } from '@/lib/task-types';

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

export async function GET() {
  try {
    const todos = await prisma.todo.findMany({
      include: todoRelationsInclude,
      orderBy: {
        createdAt: 'desc',
      },
    });
    return NextResponse.json(todos);
  } catch (error) {
    return NextResponse.json({ error: 'Error fetching workflow steps' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { title, dueDate, estimatedDurationHours, dependencyIds, isCompleted } =
      (await request.json()) as TaskMutationPayload;
    const trimmedTitle = title?.trim();

    if (!trimmedTitle) {
      return NextResponse.json({ error: 'Title is required' }, { status: 400 });
    }

    const parsedDependencyIds = normalizeDependencyIds(dependencyIds);
    const parsedDueDate = parseDueDate(dueDate);
    const parsedDuration = parseEstimatedDurationHours(estimatedDurationHours);
    const parsedCompletionStatus = parseCompletionStatus(isCompleted);

    if (parsedDependencyIds.length > 0) {
      const existingDependencies = await prisma.todo.findMany({
        where: {
          id: {
            in: parsedDependencyIds,
          },
        },
        select: {
          id: true,
          isCompleted: true,
        },
      });

      if (existingDependencies.length !== parsedDependencyIds.length) {
        return NextResponse.json(
          { error: 'One or more selected dependencies no longer exist.' },
          { status: 400 },
        );
      }

      if (parsedCompletionStatus && existingDependencies.some((dependency) => !dependency.isCompleted)) {
        return NextResponse.json(
          { error: 'Complete blockers before marking this step done.' },
          { status: 400 },
        );
      }
    }

    const existingTasks = await prisma.todo.findMany({
      select: {
        imageUrl: true,
      },
      where: {
        imageUrl: {
          not: null,
        },
      },
    });

    const previewImagePromise = getTaskPreviewImage(trimmedTitle, {
      existingImageUrls: existingTasks
        .map((task) => task.imageUrl)
        .filter((imageUrl): imageUrl is string => Boolean(imageUrl)),
    });

    let todo = await prisma.todo.create({
      data: {
        title: trimmedTitle,
        dueDate: parsedDueDate ?? undefined,
        estimatedDurationHours: parsedDuration ?? undefined,
        isCompleted: parsedCompletionStatus ?? undefined,
        completedAt: parsedCompletionStatus ? new Date() : undefined,
        dependencies:
          parsedDependencyIds.length > 0
            ? {
                connect: parsedDependencyIds.map((id) => ({ id })),
              }
            : undefined,
      },
      include: todoRelationsInclude,
    });

    const imageUrl = await previewImagePromise;

    if (imageUrl) {
      todo = await prisma.todo.update({
        where: {
          id: todo.id,
        },
        data: {
          imageUrl,
        },
        include: todoRelationsInclude,
      });
    }

    return NextResponse.json(todo, { status: 201 });
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

    return NextResponse.json({ error: 'Error creating workflow step' }, { status: 500 });
  }
}
