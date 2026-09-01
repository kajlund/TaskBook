import { z } from 'zod';

export const uuidSchema = z.string().uuid();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
export const nullableDateSchema = dateSchema.nullable();
export const collectionStructureSchema = z.enum(['FLAT', 'PHASED']);
export const collectionStatusSchema = z.enum(['ACTIVE', 'PAUSED', 'COMPLETED', 'ARCHIVED']);
export const urgencySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

const trimmedName = z.string().trim().min(1).max(200);
const nullableText = z.string().trim().max(5000).nullable().optional();
const schedule = {
  startDate: nullableDateSchema.optional(),
  targetEndDate: nullableDateSchema.optional(),
};

const validSchedule = <T extends z.ZodRawShape>(shape: T) =>
  z
    .object(shape)
    .refine(
      (value: Record<string, unknown>) =>
        !value.startDate ||
        !value.targetEndDate ||
        String(value.targetEndDate) >= String(value.startDate),
      { message: 'Target end date cannot precede start date', path: ['targetEndDate'] },
    );

export const createCollectionSchema = validSchedule({
  name: trimmedName,
  description: nullableText,
  structure: collectionStructureSchema,
  status: collectionStatusSchema.optional().default('ACTIVE'),
  ...schedule,
});

export const updateCollectionSchema = validSchedule({
  name: trimmedName.optional(),
  description: nullableText,
  structure: collectionStructureSchema.optional(),
  status: collectionStatusSchema.optional(),
  ...schedule,
});

export const collectionListQuerySchema = z.object({
  status: collectionStatusSchema.optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});

export const createPhaseSchema = validSchedule({
  name: trimmedName,
  description: nullableText,
  ...schedule,
});

export const updatePhaseSchema = validSchedule({
  name: trimmedName.optional(),
  description: nullableText,
  ...schedule,
});

export const createTaskSchema = z.object({
  collectionId: uuidSchema,
  phaseId: uuidSchema.nullable().optional(),
  name: trimmedName,
  description: nullableText,
  urgency: urgencySchema.optional().default('MEDIUM'),
  dueDate: nullableDateSchema.optional(),
  waitingReason: z.string().trim().min(1).max(1000).nullable().optional(),
});

export const updateTaskSchema = createTaskSchema.omit({ collectionId: true }).partial();
export const reorderSchema = z.object({ orderedIds: z.array(uuidSchema).min(1) });
export const moveTaskSchema = createTaskSchema
  .omit({ collectionId: true, phaseId: true, urgency: true })
  .partial()
  .extend({
    destinationCollectionId: uuidSchema,
    destinationPhaseId: uuidSchema.nullable(),
    urgency: urgencySchema.optional(),
  });
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export const taskListQuerySchema = z.object({
  collectionId: uuidSchema.optional(),
  phaseId: uuidSchema.optional(),
  unassigned: z.enum(['true', 'false']).optional(),
  completed: z.enum(['true', 'false']).optional(),
  waiting: z.enum(['true', 'false']).optional(),
  urgency: urgencySchema.optional(),
  dueBefore: dateSchema.optional(),
  dueAfter: dateSchema.optional(),
  includeArchived: z.enum(['true', 'false']).optional(),
});
export const dependencySchema = z.object({ dependsOnTaskId: uuidSchema });

export type CollectionStructure = z.infer<typeof collectionStructureSchema>;
export type CollectionStatus = z.infer<typeof collectionStatusSchema>;
export type Urgency = z.infer<typeof urgencySchema>;
export type ApiSuccess<T> = { data: T; meta?: Record<string, unknown> };
export type ApiError = {
  error: { code: string; message: string; details?: unknown; requestId: string };
};
