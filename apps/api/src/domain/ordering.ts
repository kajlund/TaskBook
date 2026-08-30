import { DomainError } from '../errors/domain-error.js';

export function validateReorder(currentIds: string[], orderedIds: string[]) {
  if (
    currentIds.length !== orderedIds.length ||
    new Set(orderedIds).size !== orderedIds.length ||
    currentIds.some((id) => !orderedIds.includes(id))
  ) {
    throw new DomainError(
      'INVALID_REORDER',
      'Reorder must contain every item in the scope exactly once',
      422,
    );
  }

  return orderedIds.map((id, position) => ({ id, position }));
}
