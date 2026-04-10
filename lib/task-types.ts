export interface TaskLink {
  id: number;
  title: string;
}

export interface TaskRecord {
  id: number;
  title: string;
  createdAt: string;
  dueDate: string | null;
  imageUrl: string | null;
  estimatedDurationHours: number | null;
  isCompleted: boolean;
  completedAt: string | null;
  dependencies: TaskLink[];
  dependents: TaskLink[];
}

export interface TaskMutationPayload {
  title?: string;
  dueDate?: string | null;
  estimatedDurationHours?: number | null;
  isCompleted?: boolean;
  dependencyIds?: number[];
}
