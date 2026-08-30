import { DomainError } from '../errors/domain-error.js';

export type DependencyEdge = { taskId: string; dependsOnTaskId: string };

export function assertAcyclic(taskId: string, dependsOnTaskId: string, edges: DependencyEdge[]) {
  if (taskId === dependsOnTaskId)
    throw new DomainError('SELF_DEPENDENCY', 'A task cannot depend on itself', 409);
  const graph = new Map<string, string[]>();
  for (const edge of [...edges, { taskId, dependsOnTaskId }])
    graph.set(edge.taskId, [...(graph.get(edge.taskId) ?? []), edge.dependsOnTaskId]);
  const visit = (node: string, visiting: Set<string>, visited: Set<string>) => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of graph.get(node) ?? []) if (visit(next, visiting, visited)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };

  if (visit(taskId, new Set(), new Set()))
    throw new DomainError('DEPENDENCY_CYCLE', 'Dependency would create a cycle', 409);
}
