import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  api,
  type Collection,
  type CollectionInput,
  type CollectionStatus,
  type Phase,
  type PhaseInput,
  type Task,
  type TaskInput,
} from '../services/api-client';

type Route =
  | { kind: 'collection'; id: string; destination?: 'backlog' | 'phase'; phaseId?: string }
  | { kind: 'today' | 'upcoming' | 'done' | 'archived' }
  | { kind: 'root' };
type Modal =
  | { kind: 'form'; collection?: Collection }
  | { kind: 'phases' }
  | { kind: 'phase-form'; phase?: Phase }
  | { kind: 'phase-delete'; phase: Phase }
  | { kind: 'task-form'; task?: Task }
  | { kind: 'task-archive'; task: Task }
  | { kind: 'task-delete'; task: Task }
  | { kind: 'archive' | 'delete'; collection: Collection }
  | null;
const lastKey = 'taskbook:lastCollectionId';
const legacyLastKey = 'waymark:lastCollectionId';
const phaseKey = (id: string) => `taskbook:lastPhase:${id}`;
const legacyPhaseKey = (id: string) => `waymark:lastPhase:${id}`;
const readStoredSelection = (key: string, legacyKey: string) => {
  const current = localStorage.getItem(key);
  if (current !== null) return current;
  const legacy = localStorage.getItem(legacyKey);
  if (legacy === null) return null;
  try {
    localStorage.setItem(key, legacy);
  } catch {
    return legacy;
  }
  return localStorage.getItem(key) ?? legacy;
};
const readRoute = (): Route => {
  const phase = location.pathname.match(/^\/collections\/([^/]+)\/phases\/([^/]+)$/);
  if (phase?.[1] && phase[2])
    return {
      kind: 'collection',
      id: decodeURIComponent(phase[1]),
      destination: 'phase',
      phaseId: decodeURIComponent(phase[2]),
    };
  const backlog = location.pathname.match(/^\/collections\/([^/]+)\/backlog$/);
  if (backlog?.[1])
    return { kind: 'collection', id: decodeURIComponent(backlog[1]), destination: 'backlog' };
  const match = location.pathname.match(/^\/collections\/([^/]+)$/);
  if (match?.[1]) return { kind: 'collection', id: decodeURIComponent(match[1]) };
  const kind = location.pathname.slice(1);
  return ['today', 'upcoming', 'done', 'archived'].includes(kind)
    ? { kind: kind as 'today' | 'upcoming' | 'done' | 'archived' }
    : { kind: 'root' };
};

@customElement('taskbook-app')
export class TaskBookApp extends LitElement {
  @state() private collections: Collection[] = [];
  @state() private archived: Collection[] = [];
  @state() private selected: Collection | null = null;
  @state() private phases: Phase[] = [];
  @state() private tasks: Task[] = [];
  @state() private taskDetail: Task | null = null;
  @state() private archivedTasks: Task[] = [];
  @state() private route = readRoute();
  @state() private loading = true;
  @state() private error = '';
  @state() private notice = '';
  @state() private modal: Modal = null;
  @state() private submitting = false;
  @state() private errors: Record<string, string> = {};
  @state() private actionsOpen = false;
  private loadId = 0;
  private draggedId: string | null = null;
  private draggedPhaseId: string | null = null;
  private draggedTaskId: string | null = null;
  private returnFocus: HTMLElement | null = null;

  createRenderRoot() {
    return this;
  }
  connectedCallback() {
    super.connectedCallback();
    addEventListener('popstate', this.onPopState);
    void this.initialize();
  }
  disconnectedCallback() {
    removeEventListener('popstate', this.onPopState);
    super.disconnectedCallback();
  }
  private onPopState = () => {
    this.route = readRoute();
    void this.loadRoute();
  };
  private async initialize() {
    try {
      this.collections = await api.collections();
      if (this.route.kind === 'root') {
        const remembered = readStoredSelection(lastKey, legacyLastKey);
        const next = this.collections.find((item) => item.id === remembered) ?? this.collections[0];
        if (next) return this.navigate(`/collections/${next.id}`, true);
      }
      await this.loadRoute();
    } catch (error) {
      this.fail(error);
    }
  }
  private navigate(path: string, replace = false) {
    history[replace ? 'replaceState' : 'pushState']({}, '', path);
    this.route = readRoute();
    void this.loadRoute();
  }
  private fail(error: unknown) {
    this.loading = false;
    this.error = error instanceof Error ? error.message : 'Something went wrong';
  }
  private async loadRoute() {
    const token = ++this.loadId;
    this.loading = true;
    this.error = '';
    this.selected = null;
    this.phases = [];
    this.tasks = [];
    this.taskDetail = null;
    try {
      if (this.route.kind === 'collection') {
        const collection = await api.collection(this.route.id);
        const [tasks, phases] = await Promise.all([
          api.tasks(collection.id),
          collection.structure === 'PHASED' ? api.phases(collection.id) : Promise.resolve([]),
        ]);
        if (token !== this.loadId) return;
        if (collection.status === 'ARCHIVED') return this.navigate('/archived', true);
        this.selected = collection;
        this.tasks = tasks;
        this.phases = phases;
        localStorage.setItem(lastKey, collection.id);
        if (collection.structure === 'PHASED') {
          if (!this.route.destination) {
            const remembered = readStoredSelection(
              phaseKey(collection.id),
              legacyPhaseKey(collection.id),
            );
            const target = phases.find((phase) => phase.id === remembered) ?? phases[0];
            return this.navigate(
              target
                ? `/collections/${collection.id}/phases/${target.id}`
                : `/collections/${collection.id}/backlog`,
              true,
            );
          }
          if (this.route.destination === 'phase') {
            const phaseId = this.route.phaseId;
            const target = phases.find((phase) => phase.id === phaseId);
            if (target) localStorage.setItem(phaseKey(collection.id), target.id);
          }
        }
        const taskId = new URLSearchParams(location.search).get('task');
        if (taskId) {
          const routePhaseId = this.route.phaseId;
          const contextTasks =
            collection.structure === 'FLAT'
              ? tasks
              : this.route.destination === 'phase'
                ? tasks.filter((task) => task.phaseId === routePhaseId)
                : tasks.filter((task) => !task.phaseId);
          if (contextTasks.some((task) => task.id === taskId))
            this.taskDetail = await api.task(taskId);
        }
      } else if (this.route.kind === 'archived') {
        const [all, archivedTasks] = await Promise.all([
          api.collections(true),
          api.tasks({ includeArchived: true }),
        ]);
        if (token !== this.loadId) return;
        this.archived = all.filter((item) => item.status === 'ARCHIVED');
        this.archivedTasks = archivedTasks.filter((task) => task.archivedAt !== null);
      } else if (
        this.route.kind === 'today' ||
        this.route.kind === 'upcoming' ||
        this.route.kind === 'done'
      ) {
        const today = new Date().toLocaleDateString('en-CA');
        this.tasks = await api.tasks(
          this.route.kind === 'today'
            ? { completed: false, dueBefore: today }
            : this.route.kind === 'upcoming'
              ? { completed: false, dueAfter: today }
              : { completed: true },
        );
        const taskId = new URLSearchParams(location.search).get('task');
        if (taskId && this.tasks.some((task) => task.id === taskId))
          this.taskDetail = await api.task(taskId);
      }
    } catch (error) {
      if (token === this.loadId) this.fail(error);
    } finally {
      if (token === this.loadId) this.loading = false;
    }
  }

  private openModal(modal: Exclude<Modal, null>, source?: HTMLElement) {
    this.returnFocus = source ?? (document.activeElement as HTMLElement);
    this.modal = modal;
    this.actionsOpen = false;
    this.errors = {};
    void this.updateComplete.then(() => {
      const dialog = document.querySelector<HTMLDialogElement>('dialog');
      if (dialog && !dialog.open) dialog.showModal();
      dialog?.querySelector<HTMLElement>('input, button')?.focus();
    });
  }
  private closeModal = () => {
    if (this.submitting) return;
    this.modal = null;
    void this.updateComplete.then(() => this.returnFocus?.focus());
  };
  private trap(event: KeyboardEvent) {
    if (event.key === 'Escape' && this.modal?.kind === 'form') {
      event.preventDefault();
      this.closeModal();
    }
    if (event.key !== 'Tab') return;
    const items = [
      ...(event.currentTarget as HTMLElement).querySelectorAll<HTMLElement>(
        'button,input,textarea,select',
      ),
    ].filter((item) => !item.hasAttribute('disabled'));
    if (event.shiftKey && document.activeElement === items[0]) {
      event.preventDefault();
      items.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === items.at(-1)) {
      event.preventDefault();
      items[0]?.focus();
    }
  }
  private formData(form: HTMLFormElement): CollectionInput | null {
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const startDate = String(data.get('startDate') ?? '') || null;
    const targetEndDate = String(data.get('targetEndDate') ?? '') || null;
    const errors: Record<string, string> = {};
    if (!name) errors.name = 'Enter a collection name.';
    if (startDate && targetEndDate && targetEndDate < startDate)
      errors.targetEndDate = 'Target end date cannot be before the start date.';
    this.errors = errors;
    if (Object.keys(errors).length) {
      void this.updateComplete.then(() =>
        form.querySelector<HTMLElement>(`[name="${Object.keys(errors)[0]}"]`)?.focus(),
      );
      return null;
    }
    return {
      name,
      description: String(data.get('description') ?? '').trim() || null,
      structure: String(data.get('structure')) as CollectionInput['structure'],
      ...(data.get('status') && { status: String(data.get('status')) as CollectionStatus }),
      startDate,
      targetEndDate,
    };
  }
  private async save(event: SubmitEvent) {
    event.preventDefault();
    if (this.submitting || this.modal?.kind !== 'form') return;
    const input = this.formData(event.currentTarget as HTMLFormElement);
    if (!input) return;
    this.submitting = true;
    const existing = this.modal.collection;
    try {
      const saved = existing
        ? await api.updateCollection(existing.id, input)
        : await api.createCollection(input);
      this.collections = await api.collections();
      this.modal = null;
      this.notice = existing ? 'Collection updated.' : 'Collection created.';
      this.navigate(`/collections/${saved.id}`, Boolean(existing));
      void this.updateComplete.then(() =>
        document.querySelector<HTMLElement>('#collection-title')?.focus(),
      );
    } catch (error) {
      this.errors = { form: error instanceof Error ? error.message : 'Could not save collection.' };
    } finally {
      this.submitting = false;
    }
  }
  private async archiveSelected() {
    if (this.modal?.kind !== 'archive') return;
    this.submitting = true;
    try {
      await api.archiveCollection(this.modal.collection.id);
      localStorage.removeItem(lastKey);
      this.collections = await api.collections();
      this.modal = null;
      this.notice = 'Collection archived.';
      const next = this.collections[0];
      this.navigate(next ? `/collections/${next.id}` : '/', true);
    } catch (error) {
      this.errors = {
        form: error instanceof Error ? error.message : 'Could not archive collection.',
      };
    } finally {
      this.submitting = false;
    }
  }
  private async restore(collection: Collection) {
    try {
      const restored = await api.restoreCollection(collection.id);
      this.collections = await api.collections();
      this.notice = 'Collection restored.';
      this.navigate(`/collections/${restored.id}`);
    } catch (error) {
      this.notice = error instanceof Error ? error.message : 'Could not restore collection.';
    }
  }
  private async deleteArchived() {
    if (this.modal?.kind !== 'delete') return;
    this.submitting = true;
    try {
      await api.deleteCollection(this.modal.collection.id);
      this.modal = null;
      this.notice = 'Collection permanently deleted.';
      await this.loadRoute();
    } catch (error) {
      this.errors = {
        form: error instanceof Error ? error.message : 'Could not delete collection.',
      };
    } finally {
      this.submitting = false;
    }
  }
  private async persistOrder(
    next: Collection[],
    previous: Collection[],
    moved: Collection,
    position: number,
  ) {
    this.collections = next;
    try {
      await api.reorderCollections(next.map((item) => item.id));
      this.notice = `Moved ${moved.name} to position ${position + 1}.`;
      void this.updateComplete.then(() =>
        document.querySelector<HTMLElement>(`[data-id="${moved.id}"]`)?.focus(),
      );
    } catch (error) {
      this.collections = previous;
      this.notice = error instanceof Error ? error.message : 'Could not reorder collections.';
    }
  }
  private move(id: string, delta: number) {
    const from = this.collections.findIndex((item) => item.id === id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= this.collections.length) return;
    const previous = [...this.collections];
    const next = [...previous];
    [next[from], next[to]] = [next[to]!, next[from]!];
    void this.persistOrder(next, previous, next[to]!, to);
  }
  private drop(targetId: string) {
    if (!this.draggedId || this.draggedId === targetId) return;
    const from = this.collections.findIndex((item) => item.id === this.draggedId);
    const to = this.collections.findIndex((item) => item.id === targetId);
    if (from < 0 || to < 0) return;
    const previous = [...this.collections];
    const next = [...previous];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    this.draggedId = null;
    void this.persistOrder(next, previous, moved!, to);
  }

  private phaseInput(form: HTMLFormElement): PhaseInput | null {
    const data = new FormData(form);
    const name = String(data.get('name') ?? '').trim();
    const startDate = String(data.get('startDate') ?? '') || null;
    const targetEndDate = String(data.get('targetEndDate') ?? '') || null;
    const errors: Record<string, string> = {};
    if (!name) errors.name = 'Enter a phase name.';
    if (startDate && targetEndDate && targetEndDate < startDate)
      errors.targetEndDate = 'Target end date cannot be before the start date.';
    this.errors = errors;
    if (Object.keys(errors).length) return null;
    return {
      name,
      description: String(data.get('description') ?? '').trim() || null,
      startDate,
      targetEndDate,
    };
  }
  private async savePhase(event: SubmitEvent) {
    event.preventDefault();
    if (!this.selected || this.modal?.kind !== 'phase-form') return;
    const input = this.phaseInput(event.currentTarget as HTMLFormElement);
    if (!input) return;
    this.submitting = true;
    const existing = this.modal.phase;
    try {
      const saved = existing
        ? await api.updatePhase(existing.id, input)
        : await api.createPhase(this.selected.id, input);
      this.phases = await api.phases(this.selected.id);
      this.modal = { kind: 'phases' };
      this.notice = existing ? 'Phase updated.' : 'Phase created.';
      this.navigate(`/collections/${this.selected.id}/phases/${saved.id}`, Boolean(existing));
      void this.updateComplete.then(() =>
        document.querySelector<HTMLElement>('#phase-title')?.focus(),
      );
    } catch (error) {
      this.errors = { form: error instanceof Error ? error.message : 'Could not save phase.' };
    } finally {
      this.submitting = false;
    }
  }
  private async persistPhaseOrder(next: Phase[], previous: Phase[], moved: Phase) {
    this.phases = next.map((phase, position) => ({ ...phase, position }));
    try {
      await api.reorderPhases(
        this.selected!.id,
        next.map((phase) => phase.id),
      );
      this.phases = await api.phases(this.selected!.id);
      this.notice = `Moved ${moved.name} to position ${this.phases.findIndex((p) => p.id === moved.id) + 1}.`;
      void this.updateComplete.then(() =>
        document.querySelector<HTMLElement>(`[data-phase-id="${moved.id}"]`)?.focus(),
      );
    } catch (error) {
      this.phases = previous;
      this.notice = error instanceof Error ? error.message : 'Could not reorder phases.';
    }
  }
  private movePhase(id: string, delta: number) {
    const from = this.phases.findIndex((phase) => phase.id === id),
      to = from + delta;
    if (from < 0 || to < 0 || to >= this.phases.length) return;
    const previous = [...this.phases],
      next = [...previous];
    [next[from], next[to]] = [next[to]!, next[from]!];
    void this.persistPhaseOrder(next, previous, next[to]!);
  }
  private dropPhase(targetId: string) {
    if (!this.draggedPhaseId || this.draggedPhaseId === targetId) return;
    const previous = [...this.phases],
      next = [...previous];
    const from = next.findIndex((phase) => phase.id === this.draggedPhaseId),
      to = next.findIndex((phase) => phase.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    this.draggedPhaseId = null;
    void this.persistPhaseOrder(next, previous, moved!);
  }
  private async confirmDeletePhase() {
    if (!this.selected || this.modal?.kind !== 'phase-delete') return;
    const deleted = this.modal.phase;
    const index = this.phases.findIndex((phase) => phase.id === deleted.id);
    this.submitting = true;
    try {
      await api.deletePhase(deleted.id);
      const next = this.phases.filter((phase) => phase.id !== deleted.id);
      this.phases = next;
      this.modal = { kind: 'phases' };
      this.notice = 'Phase deleted.';
      if (this.route.kind === 'collection' && this.route.phaseId === deleted.id) {
        const destination = next[index] ?? next[index - 1];
        this.navigate(
          destination
            ? `/collections/${this.selected.id}/phases/${destination.id}`
            : `/collections/${this.selected.id}/backlog`,
          true,
        );
      }
    } catch (error) {
      this.errors = { form: error instanceof Error ? error.message : 'Could not delete phase.' };
    } finally {
      this.submitting = false;
    }
  }

  private taskContextPhase() {
    return this.selected?.structure === 'PHASED' &&
      this.route.kind === 'collection' &&
      this.route.destination === 'phase'
      ? (this.route.phaseId ?? null)
      : null;
  }
  private selectTask(task: Task) {
    const query = new URLSearchParams(location.search);
    query.set('task', task.id);
    history.pushState({}, '', `${location.pathname}?${query}`);
    void api
      .task(task.id)
      .then((detail) => {
        this.taskDetail = detail;
        void this.updateComplete.then(() =>
          document.querySelector<HTMLElement>('#task-inspector-title')?.focus(),
        );
      })
      .catch((error) => this.fail(error));
  }
  private closeTask = () => {
    const query = new URLSearchParams(location.search);
    query.delete('task');
    history.pushState({}, '', `${location.pathname}${query.size ? `?${query}` : ''}`);
    this.taskDetail = null;
  };
  private async reloadTasks() {
    if (this.route.kind === 'collection' && this.selected) {
      [this.tasks, this.phases, this.selected] = await Promise.all([
        api.tasks(this.selected.id),
        this.selected.structure === 'PHASED' ? api.phases(this.selected.id) : Promise.resolve([]),
        api.collection(this.selected.id),
      ]);
    } else await this.loadRoute();
  }
  private taskInput(form: HTMLFormElement, existing?: Task): TaskInput | null {
    const data = new FormData(form),
      name = String(data.get('name') ?? '').trim();
    if (!name) {
      this.errors = { name: 'Enter a task name.' };
      void this.updateComplete.then(() => form.querySelector<HTMLElement>('[name=name]')?.focus());
      return null;
    }
    const collectionId = String(
      data.get('collectionId') ?? existing?.collectionId ?? this.selected?.id ?? '',
    );
    return {
      collectionId,
      phaseId: String(data.get('phaseId') ?? '') || null,
      name,
      description: String(data.get('description') ?? '').trim() || null,
      urgency: String(data.get('urgency') ?? 'MEDIUM') as Task['urgency'],
      dueDate: String(data.get('dueDate') ?? '') || null,
      waitingReason: String(data.get('waitingReason') ?? '').trim() || null,
    };
  }
  private async saveTask(event: SubmitEvent) {
    event.preventDefault();
    if (this.submitting || this.modal?.kind !== 'task-form') return;
    const existing = this.modal.task,
      input = this.taskInput(event.currentTarget as HTMLFormElement, existing);
    if (!input) return;
    this.submitting = true;
    try {
      let saved: Task;
      if (existing) {
        const oldPhase = existing.phaseId;
        saved = await api.updateTask(existing.id, {
          name: input.name,
          description: input.description,
          urgency: input.urgency,
          dueDate: input.dueDate,
          waitingReason: input.waitingReason,
        });
        if (oldPhase !== input.phaseId)
          saved = await api.moveTask(
            existing.id,
            input.phaseId,
            this.tasks.filter((task) => task.phaseId === input.phaseId && !task.archivedAt).length,
          );
      } else saved = await api.createTask(input);
      this.modal = null;
      this.notice = existing ? 'Task updated.' : 'Task created.';
      await this.reloadTasks();
      this.selectTask(saved);
    } catch (error) {
      this.errors = { form: error instanceof Error ? error.message : 'Could not save task.' };
    } finally {
      this.submitting = false;
    }
  }
  private async toggleTask(task: Task) {
    const previous = [...this.tasks];
    this.tasks = this.tasks.map((item) =>
      item.id === task.id
        ? { ...item, completedAt: task.completedAt ? null : new Date().toISOString() }
        : item,
    );
    try {
      const updated = await api.completeTask(task.id, Boolean(task.completedAt));
      this.notice = updated.completedAt ? `${task.name} completed.` : `${task.name} reopened.`;
      await this.reloadTasks();
      if (this.taskDetail?.id === task.id) this.taskDetail = await api.task(task.id);
    } catch (error) {
      this.tasks = previous;
      this.notice = error instanceof Error ? error.message : 'Could not update task.';
    }
  }
  private async archiveTask() {
    if (this.modal?.kind !== 'task-archive') return;
    this.submitting = true;
    try {
      const task = this.modal.task;
      await api.archiveTask(task.id);
      this.modal = null;
      this.closeTask();
      await this.reloadTasks();
      this.notice = `${task.name} archived.`;
    } catch (error) {
      this.errors = { form: error instanceof Error ? error.message : 'Could not archive task.' };
    } finally {
      this.submitting = false;
    }
  }
  private async restoreTask(task: Task) {
    try {
      await api.archiveTask(task.id, true);
      this.notice = `${task.name} restored.`;
      await this.loadRoute();
    } catch (error) {
      this.notice = error instanceof Error ? error.message : 'Could not restore task.';
    }
  }
  private async deleteArchivedTask() {
    if (this.modal?.kind !== 'task-delete') return;
    this.submitting = true;
    try {
      const task = this.modal.task;
      await api.deleteTask(task.id);
      this.modal = null;
      this.notice = `${task.name} permanently deleted.`;
      await this.loadRoute();
    } catch (error) {
      this.errors = { form: error instanceof Error ? error.message : 'Could not delete task.' };
    } finally {
      this.submitting = false;
    }
  }
  private async persistTaskOrder(next: Task[], previous: Task[], moved: Task) {
    const positions = new Map(next.map((task, position) => [task.id, position]));
    this.tasks = this.tasks.map((task) =>
      positions.has(task.id) ? { ...task, position: positions.get(task.id)! } : task,
    );
    try {
      await api.reorderTasks(next.map((task) => task.id));
      this.notice = `Moved ${moved.name} to position ${next.indexOf(moved) + 1}.`;
      void this.updateComplete.then(() =>
        document.querySelector<HTMLElement>(`[data-task-id="${moved.id}"]`)?.focus(),
      );
    } catch (error) {
      this.tasks = previous;
      this.notice = error instanceof Error ? error.message : 'Could not reorder tasks.';
    }
  }
  private moveTaskOrder(id: string, delta: number, scope: Task[]) {
    const from = scope.findIndex((task) => task.id === id),
      to = from + delta;
    if (from < 0 || to < 0 || to >= scope.length) return;
    const previous = [...this.tasks],
      next = [...scope];
    [next[from], next[to]] = [next[to]!, next[from]!];
    void this.persistTaskOrder(next, previous, next[to]!);
  }
  private dropTask(targetId: string, scope: Task[]) {
    if (!this.draggedTaskId || this.draggedTaskId === targetId) return;
    const previous = [...this.tasks],
      next = [...scope],
      from = next.findIndex((task) => task.id === this.draggedTaskId),
      to = next.findIndex((task) => task.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    this.draggedTaskId = null;
    void this.persistTaskOrder(next, previous, moved!);
  }

  private sidebar() {
    return html`<aside class="sidebar">
      <div class="brand"><img src="/brand/taskbook-horizontal.svg" alt="TaskBook"></div>
      <nav aria-label="Primary">
        ${(['today', 'upcoming', 'done'] as const).map(
          (name) =>
            html`<a
              href="/${name}"
              class=${this.route.kind === name ? 'active' : ''}
              aria-current=${this.route.kind === name ? 'page' : nothing}
              @click=${(event: MouseEvent) => {
                event.preventDefault();
                this.navigate(`/${name}`);
              }}
              ><i
                class=${name === 'today' ? 'ph ph-calendar-blank' : name === 'upcoming' ? 'ph ph-list-bullets' : 'ph ph-check-circle'}
              ></i
              >${name[0]!.toUpperCase()}${name.slice(1)}</a
            >`,
        )}
        <div class="nav-section">
          <small>COLLECTIONS</small
          ><button
            class="icon-button"
            aria-label="Create collection"
            @click=${(event: MouseEvent) => this.openModal({ kind: 'form' }, event.currentTarget as HTMLElement)}
          >
            <i class="ph ph-plus"></i>
          </button>
        </div>
        <div class="collection-list">
          ${this.collections.map(
            (collection, index) =>
              html`<div
                class="collection-nav-row"
                draggable="true"
                @dragstart=${() => (this.draggedId = collection.id)}
                @dragover=${(event: DragEvent) => event.preventDefault()}
                @drop=${() => this.drop(collection.id)}
              >
                <button class="drag" aria-label=${`Drag ${collection.name}`}>
                  <i class="ph ph-dots-six-vertical"></i></button
                ><a
                  href=${`/collections/${collection.id}`}
                  data-id=${collection.id}
                  class=${this.route.kind === 'collection' && this.route.id === collection.id ? 'active' : ''}
                  aria-current=${this.route.kind === 'collection' && this.route.id === collection.id ? 'page' : nothing}
                  @click=${(event: MouseEvent) => {
                    event.preventDefault();
                    this.navigate(`/collections/${collection.id}`);
                  }}
                  ><i
                    class=${collection.structure === 'FLAT' ? 'ph ph-list-checks' : 'ph ph-stack'}
                  ></i
                  ><span>${collection.name}</span></a
                ><span class="row-moves"
                  ><button
                    aria-label=${`Move ${collection.name} up`}
                    ?disabled=${index === 0}
                    @click=${() => this.move(collection.id, -1)}
                  >
                    <i class="ph ph-caret-up"></i></button
                  ><button
                    aria-label=${`Move ${collection.name} down`}
                    ?disabled=${index === this.collections.length - 1}
                    @click=${() => this.move(collection.id, 1)}
                  >
                    <i class="ph ph-caret-down"></i></button
                ></span>
              </div>`,
          )}
        </div>
        <button
          class="new-collection"
          @click=${(event: MouseEvent) => this.openModal({ kind: 'form' }, event.currentTarget as HTMLElement)}
        >
          <i class="ph ph-plus"></i>New collection</button
        ><a
          href="/archived"
          class=${this.route.kind === 'archived' ? 'active' : ''}
          aria-current=${this.route.kind === 'archived' ? 'page' : nothing}
          @click=${(event: MouseEvent) => {
            event.preventDefault();
            this.navigate('/archived');
          }}
          ><i class="ph ph-archive"></i>Archived collections</a
        >
      </nav>
    </aside>`;
  }
  private empty() {
    return html`<main class="route-state">
      <i class="ph ph-list-checks"></i>
      <h1>No collections yet</h1>
      <p>Create a collection to start organizing your tasks.</p>
      <button
        class="primary"
        @click=${(event: MouseEvent) => this.openModal({ kind: 'form' }, event.currentTarget as HTMLElement)}
      >
        <i class="ph ph-plus"></i>Create collection
      </button>
    </main>`;
  }
  private collectionView() {
    if (this.loading)
      return html`<main class="route-state" aria-busy="true">
        <div class="spinner"></div>
        <p>Loading collection…</p>
      </main>`;
    if (this.error)
      return html`<main class="route-state">
        <i class="ph ph-folder-dashed"></i>
        <h1>Collection not found</h1>
        <p>${this.error}</p>
        <button class="primary" @click=${() => this.navigate('/')}>
          Choose another collection
        </button>
      </main>`;
    if (!this.selected) return this.empty();
    const item = this.selected;
    const percent = Math.round(item.progress.ratio * 100);
    return html`<main>
      <header class="collection">
        <div>
          <h1 id="collection-title" tabindex="-1">${item.name}</h1>
          ${item.description ? html`<p>${item.description}</p>` : nothing}
          <p class="schedule">
            <i class="ph ph-calendar-blank"></i
            >${item.startDate || item.targetEndDate ? `${item.startDate ?? 'No start'} – ${item.targetEndDate ?? 'No target'}` : 'No schedule'}
          </p>
        </div>
        <div class="collection-actions">
          <span class=${`status status-${item.status.toLowerCase()}`}
            >${item.status.toLowerCase()}</span
          ><button
            class="outline"
            aria-expanded=${this.actionsOpen}
            @click=${() => (this.actionsOpen = !this.actionsOpen)}
          >
            <i class="ph ph-dots-three"></i>Collection actions</button
          >${
            this.actionsOpen
              ? html`<div class="action-menu">
                  <button
                    @click=${(event: MouseEvent) => this.openModal({ kind: 'form', collection: item }, event.currentTarget as HTMLElement)}
                  >
                    <i class="ph ph-pencil-simple"></i>Edit collection</button
                  ><button
                    class="danger-text"
                    @click=${(event: MouseEvent) => this.openModal({ kind: 'archive', collection: item }, event.currentTarget as HTMLElement)}
                  >
                    <i class="ph ph-archive"></i>Archive collection
                  </button>
                </div>`
              : nothing
          }
        </div>
      </header>
      <section class="collection-summary">
        <div>
          <small>PROGRESS</small>
          <div class="progress"><i style=${`width:${percent}%`}></i></div>
          <p>
            ${item.progress.completed} of ${item.progress.total} active tasks complete · ${percent}%
          </p>
        </div>
        <div>
          <small>ORGANIZATION</small>
          <p>
            <i class=${item.structure === 'FLAT' ? 'ph ph-list-checks' : 'ph ph-stack'}></i
            >${item.structure === 'FLAT' ? 'Simple task list' : 'Organized into phases'}
          </p>
        </div>
      </section>
      ${item.structure === 'FLAT' ? this.flatView() : this.phasedView()}
    </main>`;
  }
  private flatView() {
    return html`<section class="workspace">
      <div class="section-title">
        <h2>Tasks <span>${this.tasks.length}</span></h2>
        <button
          class="primary"
          @click=${(event: MouseEvent) => this.openModal({ kind: 'task-form' }, event.currentTarget as HTMLElement)}
        >
          <i class="ph ph-plus"></i>Add task
        </button>
      </div>
      ${
        this.tasks.length
          ? this.taskList(this.tasks)
          : html`<div class="inline-empty">
              <i class="ph ph-list-checks"></i>
              <h3>No tasks yet</h3>
              <p>Add the first task to this collection.</p>
            </div>`
      }
    </section>`;
  }
  private taskList(scope: Task[], contextual = false) {
    return html`<div class="task-list">
      ${scope.map((task, index) => {
        const collection = this.collections.find((item) => item.id === task.collectionId),
          phase = this.phases.find((item) => item.id === task.phaseId);
        return html`<article
          class=${task.isWaiting || task.waitingReason ? 'waiting-task' : ''}
          draggable=${!contextual}
          @dragstart=${() => (this.draggedTaskId = task.id)}
          @dragover=${(event: DragEvent) => event.preventDefault()}
          @drop=${() => this.dropTask(task.id, scope)}
        >
          <button
            class="drag"
            data-task-id=${task.id}
            aria-label=${`Drag ${task.name}`}
            @keydown=${(event: KeyboardEvent) => {
              if (event.altKey && event.key === 'ArrowUp') this.moveTaskOrder(task.id, -1, scope);
              if (event.altKey && event.key === 'ArrowDown') this.moveTaskOrder(task.id, 1, scope);
            }}
          >
            <i class="ph ph-dots-six-vertical"></i></button
          ><button
            class=${`check ${task.completedAt ? 'done' : ''}`}
            aria-label=${task.completedAt ? `Reopen ${task.name}` : `Complete ${task.name}`}
            @click=${() => this.toggleTask(task)}
          >
            <i class="ph ph-check"></i></button
          ><button class="task-name" @click=${() => this.selectTask(task)}>
            <strong class=${task.completedAt ? 'struck' : ''}>${task.name}</strong
            >${contextual ? html`<small>${collection?.name ?? 'Collection'} · ${phase?.name ?? (collection?.structure === 'PHASED' ? 'Backlog' : 'Task list')}</small>` : nothing}</button
          ><span class=${`urgency ${task.urgency.toLowerCase()}`}
            ><i></i>${task.urgency.toLowerCase()}</span
          ><span>${task.dueDate ?? 'No due date'}</span
          >${task.isWaiting || task.waitingReason ? html`<span class="blocked-label"><i class="ph ph-pause-circle"></i>Waiting</span>` : nothing}${
            !contextual
              ? html`<span class="task-moves"
                  ><button
                    aria-label=${`Move ${task.name} up`}
                    ?disabled=${index === 0}
                    @click=${() => this.moveTaskOrder(task.id, -1, scope)}
                  >
                    <i class="ph ph-caret-up"></i></button
                  ><button
                    aria-label=${`Move ${task.name} down`}
                    ?disabled=${index === scope.length - 1}
                    @click=${() => this.moveTaskOrder(task.id, 1, scope)}
                  >
                    <i class="ph ph-caret-down"></i></button
                ></span>`
              : nothing
          }
        </article>`;
      })}
    </div>`;
  }
  private phasedView() {
    const phaseId = this.route.kind === 'collection' ? this.route.phaseId : undefined;
    const selected =
      this.route.kind === 'collection' && this.route.destination === 'phase'
        ? this.phases.find((phase) => phase.id === phaseId)
        : undefined;
    const unknown =
      this.route.kind === 'collection' && this.route.destination === 'phase' && !selected;
    const selectedIndex = selected ? this.phases.indexOf(selected) : -1;
    const visibleTasks = selected
      ? this.tasks.filter((task) => task.phaseId === selected.id)
      : this.tasks.filter((task) => !task.phaseId);
    const earlierIncomplete = selected
      ? this.phases.slice(0, selectedIndex).filter((phase) => !phase.isComplete)
      : [];
    return html`<section class="workspace">
      <div class="phase-toolbar">
        <div>
          <button
            class="outline"
            ?disabled=${selectedIndex <= 0}
            @click=${() => this.navigate(`/collections/${this.selected!.id}/phases/${this.phases[selectedIndex - 1]?.id}`)}
          >
            <i class="ph ph-arrow-left"></i>Previous phase</button
          ><button
            class="outline"
            ?disabled=${selectedIndex < 0 || selectedIndex >= this.phases.length - 1}
            @click=${() => this.navigate(`/collections/${this.selected!.id}/phases/${this.phases[selectedIndex + 1]?.id}`)}
          >
            Next phase<i class="ph ph-arrow-right"></i>
          </button>
        </div>
        <button
          class="outline manage-phases"
          @click=${(event: MouseEvent) => this.openModal({ kind: 'phases' }, event.currentTarget as HTMLElement)}
        >
          <i class="ph ph-sliders-horizontal"></i>Manage phases
        </button>
      </div>
      <div class="phase-nav" aria-label="Phases">
        <button
          class=${!selected && !unknown ? 'current' : ''}
          @click=${() => this.navigate(`/collections/${this.selected!.id}/backlog`)}
        >
          <span><i class="ph ph-tray"></i></span><b>Backlog</b
          ><small>${this.tasks.filter((task) => !task.phaseId).length} tasks</small></button
        >${this.phases.map((phase, index) => html`<button class=${`${selected?.id === phase.id ? 'current' : ''} ${phase.isComplete ? 'complete' : ''}`} @click=${() => this.navigate(`/collections/${this.selected!.id}/phases/${phase.id}`)}><span>${phase.isComplete ? html`<i class="ph ph-check"></i>` : index + 1}</span><b>${phase.name}</b><small>${phase.completedTaskCount}/${phase.taskCount} complete</small></button>`)}
      </div>
      ${
        unknown
          ? html`<div class="inline-empty">
              <i class="ph ph-warning-circle"></i>
              <h3>Phase not found</h3>
              <p>This phase does not exist in ${this.selected!.name}.</p>
              <button
                class="primary"
                @click=${() => this.navigate(`/collections/${this.selected!.id}/backlog`, true)}
              >
                Open backlog
              </button>
            </div>`
          : html`<div class="phase-layout">
              <div class="phase-content">
                <div class="section-title">
                  <h2>${selected?.name ?? 'Backlog'} <span>${visibleTasks.length}</span></h2>
                  <button
                    class="primary"
                    @click=${(event: MouseEvent) => this.openModal({ kind: 'task-form' }, event.currentTarget as HTMLElement)}
                  >
                    <i class="ph ph-plus"></i>Add task
                  </button>
                </div>
                ${
                  visibleTasks.length
                    ? this.taskList(visibleTasks)
                    : html`<div class="inline-empty">
                        <i class=${selected ? 'ph ph-stack' : 'ph ph-tray'}></i>
                        <h3>No tasks yet</h3>
                        <p>
                          ${selected ? 'This phase is incomplete until it contains completed work.' : 'Unassigned tasks will appear in the backlog.'}
                        </p>
                      </div>`
                }
              </div>
              ${
                selected
                  ? html`<aside class="phase-inspector">
                      <small>PHASE ${selected.position + 1} OF ${this.phases.length}</small>
                      <h2 id="phase-title" tabindex="-1">${selected.name}</h2>
                      <p>${selected.description ?? 'No description or goal provided.'}</p>
                      <p class="schedule">
                        <i class="ph ph-calendar-blank"></i
                        >${selected.startDate || selected.targetEndDate ? `${selected.startDate ?? 'No start'} – ${selected.targetEndDate ?? 'No target'}` : 'No schedule'}
                      </p>
                      <hr />
                      <dl>
                        <dt>Tasks</dt>
                        <dd>${selected.taskCount}</dd>
                        <dt>Completed</dt>
                        <dd>${selected.completedTaskCount}</dd>
                        <dt>Progress</dt>
                        <dd>${Math.round(selected.progress * 100)}%</dd>
                        <dt>Status</dt>
                        <dd>
                          ${selected.taskCount === 0 ? 'No tasks yet' : selected.isComplete ? 'Complete' : 'In progress'}
                        </dd>
                      </dl>
                      ${
                        earlierIncomplete.length
                          ? html`<div class="advisory">
                              <b>Earlier incomplete phases</b>
                              <p>${earlierIncomplete.map((phase) => phase.name).join(', ')}</p>
                            </div>`
                          : nothing
                      }
                    </aside>`
                  : nothing
              }
            </div>`
      }
    </section>`;
  }
  private archivedView() {
    if (this.loading)
      return html`<main class="route-state" aria-busy="true">
        <div class="spinner"></div>
        <p>Loading archived collections…</p>
      </main>`;
    return html`<main>
      <header class="collection">
        <div>
          <small>COLLECTIONS</small>
          <h1>Archived collections</h1>
          <p>Restore collections or permanently remove data you no longer need.</p>
        </div>
      </header>
      <section class="workspace archived-list">
        ${
          this.archived.length
            ? this.archived.map(
                (item) =>
                  html`<article>
                    <i class=${item.structure === 'FLAT' ? 'ph ph-list-checks' : 'ph ph-stack'}></i>
                    <div>
                      <h2>${item.name}</h2>
                      <p>${item.description ?? 'No description'}</p>
                    </div>
                    <button class="outline" @click=${() => this.restore(item)}>Restore</button
                    ><button
                      class="danger-text-button"
                      @click=${async (event: MouseEvent) => {
                        try {
                          const detail = await api.collection(item.id);
                          this.openModal(
                            { kind: 'delete', collection: detail },
                            event.currentTarget as HTMLElement,
                          );
                        } catch (error) {
                          this.notice =
                            error instanceof Error
                              ? error.message
                              : 'Could not load deletion details.';
                        }
                      }}
                    >
                      <i class="ph ph-trash"></i>Permanently delete
                    </button>
                  </article>`,
              )
            : html`<div class="inline-empty">
                <i class="ph ph-archive"></i>
                <h2>No archived collections</h2>
                <p>Archived collections will appear here.</p>
              </div>`
        }
      </section>
      <section class="workspace archived-list">
        <div class="section-title">
          <h2>Archived tasks <span>${this.archivedTasks.length}</span></h2>
        </div>
        ${
          this.archivedTasks.length
            ? this.archivedTasks.map(
                (task) =>
                  html`<article>
                    <i class="ph ph-check-square-offset"></i>
                    <div>
                      <h2>${task.name}</h2>
                      <p>
                        ${this.collections.find((item) => item.id === task.collectionId)?.name ?? 'Collection'}
                      </p>
                    </div>
                    <button class="outline" @click=${() => this.restoreTask(task)}>
                      <i class="ph ph-arrow-counter-clockwise"></i>Restore task</button
                    ><button
                      class="danger-text-button"
                      @click=${async (event: MouseEvent) => {
                        try {
                          this.openModal(
                            { kind: 'task-delete', task: await api.task(task.id) },
                            event.currentTarget as HTMLElement,
                          );
                        } catch (error) {
                          this.notice =
                            error instanceof Error ? error.message : 'Could not load task details.';
                        }
                      }}
                    >
                      <i class="ph ph-trash"></i>Permanently delete
                    </button>
                  </article>`,
              )
            : html`<p>No archived tasks.</p>`
        }
      </section>
    </main>`;
  }
  private utilityView() {
    const title =
      this.route.kind === 'today' ? 'Today' : this.route.kind === 'upcoming' ? 'Upcoming' : 'Done';
    return html`<main>
      <header class="collection">
        <div>
          <small>FOCUS</small>
          <h1>${title}</h1>
          <p>
            ${this.route.kind === 'today' ? 'Overdue tasks first, followed by tasks due today.' : this.route.kind === 'upcoming' ? 'Incomplete tasks grouped by their future due date.' : 'Recently completed tasks, newest first.'}
          </p>
        </div>
        ${this.route.kind === 'today' ? html`<button class="primary" @click=${(event: MouseEvent) => this.openModal({ kind: 'task-form' }, event.currentTarget as HTMLElement)}><i class="ph ph-plus"></i>Add task</button>` : nothing}
      </header>
      <section class="workspace">
        ${
          this.tasks.length
            ? this.route.kind === 'upcoming'
              ? [...new Set(this.tasks.map((task) => task.dueDate!))].map(
                  (date) =>
                    html`<section class="date-group">
                      <h2>
                        ${new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </h2>
                      ${this.taskList(
                        this.tasks.filter((task) => task.dueDate === date),
                        true,
                      )}
                    </section>`,
                )
              : this.taskList(this.tasks, true)
            : html`<div class="inline-empty">
                <i class="ph ph-clock"></i>
                <h2>No ${title.toLowerCase()} tasks</h2>
                <p>
                  ${this.route.kind === 'done' ? 'Completed tasks will appear here.' : 'Nothing needs your attention in this view.'}
                </p>
              </div>`
        }
      </section>
    </main>`;
  }

  private formModal(collection?: Collection) {
    return html`<dialog
      class="modal"
      aria-modal="true"
      aria-labelledby="modal-title"
      @keydown=${this.trap}
    >
      <form @submit=${this.save} novalidate>
        <div class="modal-heading">
          <div>
            <small>COLLECTION</small>
            <h2 id="modal-title">${collection ? 'Edit collection' : 'New collection'}</h2>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Close dialog"
            @click=${this.closeModal}
          >
            <i class="ph ph-x"></i>
          </button>
        </div>
        ${this.errors.form ? html`<p class="form-error" role="alert">${this.errors.form}</p>` : nothing}<label
          ><span class="field-label">Name <b aria-hidden="true">*</b></span
          ><input name="name" required .value=${collection?.name ?? ''} /></label
        >${this.errors.name ? html`<p class="field-error" role="alert">${this.errors.name}</p>` : nothing}<label
          >Description<textarea name="description" rows="3">
${collection?.description ?? ''}</textarea>
        </label>
        <fieldset>
          <legend>Organization</legend>
          <label class="choice"
            ><input
              type="radio"
              name="structure"
              value="FLAT"
              .checked=${!collection || collection.structure === 'FLAT'}
            /><i class="ph ph-list-checks"></i
            ><span
              ><b>Simple task list</b><small>Tasks ordered directly in the collection</small></span
            ></label
          ><label class="choice"
            ><input
              type="radio"
              name="structure"
              value="PHASED"
              .checked=${collection?.structure === 'PHASED'}
            /><i class="ph ph-stack"></i
            ><span
              ><b>Organized into phases</b><small>Ordered phases with a backlog</small></span
            ></label
          >
        </fieldset>
        <div class="form-grid">
          <label
            >Start date<input
              type="date"
              name="startDate"
              .value=${collection?.startDate ?? ''} /></label
          ><label
            >Target end date<input
              type="date"
              name="targetEndDate"
              .value=${collection?.targetEndDate ?? ''}
            />${this.errors.targetEndDate ? html`<small class="field-error" role="alert">${this.errors.targetEndDate}</small>` : nothing}</label
          >
        </div>
        ${
          collection
            ? html`<label
                >Status<select name="status" .value=${collection.status}>
                  <option value="ACTIVE">Active</option>
                  <option value="PAUSED">Paused</option>
                  <option value="COMPLETED">Completed</option>
                </select></label
              >`
            : nothing
        }
        <div class="modal-actions">
          <button type="button" class="outline" @click=${this.closeModal}>Cancel</button
          ><button class="primary" ?disabled=${this.submitting}>
            ${this.submitting ? 'Saving…' : collection ? 'Save changes' : 'Create collection'}
          </button>
        </div>
      </form>
    </dialog>`;
  }
  private confirmModal(item: Collection, kind: 'archive' | 'delete') {
    const impact = item.deletionImpact;
    return html`<dialog
      class="modal confirmation"
      aria-modal="true"
      aria-labelledby="confirm-title"
      @keydown=${this.trap}
    >
      <div class="danger-icon">
        <i class=${kind === 'archive' ? 'ph ph-archive' : 'ph ph-trash'}></i>
      </div>
      <h2 id="confirm-title">
        ${kind === 'archive' ? 'Archive' : 'Permanently delete'} ${item.name}?
      </h2>
      ${kind === 'archive' ? html`<p>The collection will disappear from the active sidebar. Its phases and tasks will be preserved, and it can be restored later.</p>` : html`<p>This removes <b>${impact?.phases ?? 0} phases</b>, <b>${impact?.tasks ?? 0} tasks</b>, and <b>${impact?.dependencyLinks ?? 0} dependency links</b>. This cannot be undone.</p>`}${this.errors.form ? html`<p class="form-error" role="alert">${this.errors.form}</p>` : nothing}
      <div class="modal-actions">
        <button class="outline" @click=${this.closeModal}>Cancel</button
        ><button
          class="danger"
          ?disabled=${this.submitting}
          @click=${kind === 'archive' ? this.archiveSelected : this.deleteArchived}
        >
          ${this.submitting ? 'Working…' : kind === 'archive' ? 'Archive collection' : 'Permanently delete'}
        </button>
      </div>
    </dialog>`;
  }
  private managePhasesModal() {
    return html`<dialog
      class="modal phase-manager"
      aria-modal="true"
      aria-labelledby="modal-title"
      @keydown=${this.trap}
    >
      <div class="modal-heading">
        <div>
          <small>COLLECTION PHASES</small>
          <h2 id="modal-title">Manage phases</h2>
        </div>
        <button class="icon-button" aria-label="Close dialog" @click=${this.closeModal}>
          <i class="ph ph-x"></i>
        </button>
      </div>
      <p>Drag phases into order, or use the move buttons. Changes are saved immediately.</p>
      <div class="managed-phases">
        ${this.phases.map(
          (phase, index) =>
            html`<div
              class="managed-phase"
              draggable="true"
              @dragstart=${() => (this.draggedPhaseId = phase.id)}
              @dragover=${(event: DragEvent) => event.preventDefault()}
              @drop=${() => this.dropPhase(phase.id)}
            >
              <button
                class="drag"
                data-phase-id=${phase.id}
                aria-label=${`Drag ${phase.name}`}
                @keydown=${(event: KeyboardEvent) => {
                  if (event.altKey && event.key === 'ArrowUp') this.movePhase(phase.id, -1);
                  if (event.altKey && event.key === 'ArrowDown') this.movePhase(phase.id, 1);
                }}
              >
                <i class="ph ph-dots-six-vertical"></i>
              </button>
              <div>
                <b>${phase.name}</b
                ><small
                  >${phase.taskCount} ${phase.taskCount === 1 ? 'task' : 'tasks'} ·
                  ${Math.round(phase.progress * 100)}%</small
                >
              </div>
              <button
                class="icon-button"
                aria-label=${`Move ${phase.name} up`}
                ?disabled=${index === 0}
                @click=${() => this.movePhase(phase.id, -1)}
              >
                <i class="ph ph-caret-up"></i></button
              ><button
                class="icon-button"
                aria-label=${`Move ${phase.name} down`}
                ?disabled=${index === this.phases.length - 1}
                @click=${() => this.movePhase(phase.id, 1)}
              >
                <i class="ph ph-caret-down"></i></button
              ><button
                class="icon-button"
                aria-label=${`Edit ${phase.name}`}
                @click=${() => this.openModal({ kind: 'phase-form', phase })}
              >
                <i class="ph ph-pencil-simple"></i></button
              ><button
                class="icon-button danger-text"
                aria-label=${phase.taskCount ? `Cannot delete ${phase.name}: tasks must be moved or deleted first` : `Delete ${phase.name}`}
                @click=${() => (phase.taskCount ? (this.notice = `${phase.name} cannot be deleted. Move or delete its tasks first, including archived tasks.`) : this.openModal({ kind: 'phase-delete', phase }))}
              >
                <i class="ph ph-trash"></i>
              </button>
            </div>`,
        )}
      </div>
      <div class="modal-actions">
        <button class="primary" @click=${() => this.openModal({ kind: 'phase-form' })}>
          <i class="ph ph-plus"></i>Add phase</button
        ><button class="outline" @click=${this.closeModal}>Done</button>
      </div>
    </dialog>`;
  }
  private phaseFormModal(phase?: Phase) {
    return html`<dialog
      class="modal"
      aria-modal="true"
      aria-labelledby="modal-title"
      @keydown=${this.trap}
    >
      <form @submit=${this.savePhase} novalidate>
        <div class="modal-heading">
          <div>
            <small>PHASE</small>
            <h2 id="modal-title">${phase ? 'Edit phase' : 'New phase'}</h2>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Close dialog"
            @click=${() => this.openModal({ kind: 'phases' })}
          >
            <i class="ph ph-x"></i>
          </button>
        </div>
        ${this.errors.form ? html`<p class="form-error" role="alert">${this.errors.form}</p>` : nothing}<label
          ><span class="field-label">Name <b aria-hidden="true">*</b></span
          ><input name="name" required .value=${phase?.name ?? ''} /></label
        >${this.errors.name ? html`<p class="field-error" role="alert">${this.errors.name}</p>` : nothing}<label
          >Description<textarea name="description" rows="3">${phase?.description ?? ''}</textarea>
        </label>
        <div class="form-grid">
          <label
            >Start date<input
              name="startDate"
              type="date"
              .value=${phase?.startDate ?? ''} /></label
          ><label
            >Target end date<input
              name="targetEndDate"
              type="date"
              .value=${phase?.targetEndDate ?? ''}
            />${this.errors.targetEndDate ? html`<small class="field-error" role="alert">${this.errors.targetEndDate}</small>` : nothing}</label
          >
        </div>
        <div class="modal-actions">
          <button type="button" class="outline" @click=${() => this.openModal({ kind: 'phases' })}>
            Cancel</button
          ><button class="primary" ?disabled=${this.submitting}>
            ${this.submitting ? 'Saving…' : phase ? 'Save changes' : 'Create phase'}
          </button>
        </div>
      </form>
    </dialog>`;
  }
  private phaseDeleteModal(phase: Phase) {
    return html`<dialog
      class="modal confirmation"
      aria-modal="true"
      aria-labelledby="confirm-title"
      @keydown=${this.trap}
    >
      <div class="danger-icon"><i class="ph ph-trash"></i></div>
      <h2 id="confirm-title">Delete ${phase.name}?</h2>
      <p>This empty phase will be permanently deleted. No tasks will be moved or deleted.</p>
      ${this.errors.form ? html`<p class="form-error" role="alert">${this.errors.form}</p>` : nothing}
      <div class="modal-actions">
        <button class="outline" @click=${() => this.openModal({ kind: 'phases' })}>Cancel</button
        ><button class="danger" ?disabled=${this.submitting} @click=${this.confirmDeletePhase}>
          ${this.submitting ? 'Deleting…' : 'Delete phase'}
        </button>
      </div>
    </dialog>`;
  }
  private taskFormModal(task?: Task) {
    const collectionId = task?.collectionId ?? this.selected?.id ?? this.collections[0]?.id ?? '';
    const collection = this.collections.find((item) => item.id === collectionId);
    const phaseId = task?.phaseId ?? this.taskContextPhase();
    return html`<dialog
      class="modal"
      aria-modal="true"
      aria-labelledby="modal-title"
      @keydown=${this.trap}
    >
      <form @submit=${this.saveTask} novalidate>
        <div class="modal-heading">
          <div>
            <small>TASK</small>
            <h2 id="modal-title">${task ? 'Edit task' : 'New task'}</h2>
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label="Close dialog"
            @click=${this.closeModal}
          >
            <i class="ph ph-x"></i>
          </button>
        </div>
        ${this.errors.form ? html`<p class="form-error" role="alert">${this.errors.form}</p>` : nothing}<label
          ><span class="field-label">Name <b aria-hidden="true">*</b></span
          ><input name="name" required .value=${task?.name ?? ''} /></label
        >${this.errors.name ? html`<p class="field-error" role="alert">${this.errors.name}</p>` : nothing}<label
          >Description<textarea
            name="description"
            rows="3"
            .value=${task?.description ?? ''}
          ></textarea></label
        ><label
          ><span class="field-label">Collection <b aria-hidden="true">*</b></span
          ><select name="collectionId" required ?disabled=${Boolean(task || this.selected)}>
            ${this.collections.map(
              (item) =>
                html`<option value=${item.id} ?selected=${item.id === collectionId}>
                  ${item.name}
                </option>`,
            )}
          </select></label
        >${
          collection?.structure === 'PHASED'
            ? html`<label
                >Phase<select name="phaseId">
                  <option value="" ?selected=${!phaseId}>Backlog</option>
                  ${this.phases.map(
                    (phase) =>
                      html`<option value=${phase.id} ?selected=${phase.id === phaseId}>
                        ${phase.name}
                      </option>`,
                  )}
                </select></label
              >`
            : html`<input type="hidden" name="phaseId" value="" />`
        }
        <div class="form-grid">
          <label
            >Urgency<select name="urgency" .value=${task?.urgency ?? 'MEDIUM'}>
              <option value="LOW">Low</option>
              <option value="MEDIUM">Medium</option>
              <option value="HIGH">High</option>
              <option value="CRITICAL">Critical</option>
            </select></label
          ><label>Due date<input type="date" name="dueDate" .value=${task?.dueDate ?? ''} /></label>
        </div>
        <label
          >Waiting reason<input name="waitingReason" .value=${task?.waitingReason ?? ''}
        /></label>
        <div class="modal-actions">
          <button type="button" class="outline" @click=${this.closeModal}>Cancel</button
          ><button class="primary" ?disabled=${this.submitting}>
            ${this.submitting ? 'Saving…' : task ? 'Save changes' : 'Create task'}
          </button>
        </div>
      </form>
    </dialog>`;
  }
  private taskArchiveModal(task: Task) {
    return html`<dialog
      class="modal confirmation"
      aria-modal="true"
      aria-labelledby="confirm-title"
      @keydown=${this.trap}
    >
      <div class="danger-icon"><i class="ph ph-archive"></i></div>
      <h2 id="confirm-title">Archive ${task.name}?</h2>
      <p>The task will leave active lists but can be restored from Archived collections.</p>
      ${this.errors.form ? html`<p class="form-error" role="alert">${this.errors.form}</p>` : nothing}
      <div class="modal-actions">
        <button class="outline" @click=${this.closeModal}>Cancel</button
        ><button class="danger" ?disabled=${this.submitting} @click=${this.archiveTask}>
          ${this.submitting ? 'Archiving…' : 'Archive task'}
        </button>
      </div>
    </dialog>`;
  }
  private taskDeleteModal(task: Task) {
    const links = (task.dependencies?.length ?? 0) + (task.blockedTasks?.length ?? 0);
    return html`<dialog
      class="modal confirmation"
      aria-modal="true"
      aria-labelledby="confirm-title"
      @keydown=${this.trap}
    >
      <div class="danger-icon"><i class="ph ph-trash"></i></div>
      <h2 id="confirm-title">Permanently delete ${task.name}?</h2>
      <p>
        This removes the archived task and ${links} dependency ${links === 1 ? 'link' : 'links'}.
        This cannot be undone.
      </p>
      ${this.errors.form ? html`<p class="form-error" role="alert">${this.errors.form}</p>` : nothing}
      <div class="modal-actions">
        <button class="outline" @click=${this.closeModal}>Cancel</button
        ><button class="danger" ?disabled=${this.submitting} @click=${this.deleteArchivedTask}>
          ${this.submitting ? 'Deleting…' : 'Permanently delete'}
        </button>
      </div>
    </dialog>`;
  }
  private taskInspector() {
    const task = this.taskDetail;
    if (!task) return nothing;
    const collection = this.collections.find((item) => item.id === task.collectionId),
      phase = this.phases.find((item) => item.id === task.phaseId);
    const eligible = this.tasks.filter(
      (item) =>
        item.collectionId === task.collectionId &&
        item.id !== task.id &&
        !item.archivedAt &&
        !task.dependencies?.some((dependency) => dependency.id === item.id),
    );
    return html`<aside class="task-inspector" aria-label="Task details">
      <div class="inspector-heading">
        <small>TASK</small
        ><button class="icon-button" aria-label="Close task inspector" @click=${this.closeTask}>
          <i class="ph ph-x"></i>
        </button>
      </div>
      <h2 id="task-inspector-title" tabindex="-1">${task.name}</h2>
      <button class="outline" @click=${() => this.toggleTask(task)}>
        <i class=${task.completedAt ? 'ph ph-arrow-counter-clockwise' : 'ph ph-check'}></i
        >${task.completedAt ? 'Reopen task' : 'Mark complete'}
      </button>
      <p>${task.description ?? 'No description.'}</p>
      <dl>
        <dt>Collection</dt>
        <dd>${collection?.name ?? 'Unknown'}</dd>
        <dt>Location</dt>
        <dd>${phase?.name ?? (collection?.structure === 'PHASED' ? 'Backlog' : 'Task list')}</dd>
        <dt>Urgency</dt>
        <dd>${task.urgency}</dd>
        <dt>Due date</dt>
        <dd>${task.dueDate ?? 'None'}</dd>
        <dt>Waiting</dt>
        <dd>${task.isWaiting ? (task.waitingReason ?? 'Blocked by a dependency') : 'No'}</dd>
        <dt>Created</dt>
        <dd>${new Date(task.createdAt).toLocaleString()}</dd>
        <dt>Updated</dt>
        <dd>${new Date(task.updatedAt).toLocaleString()}</dd>
      </dl>
      <hr />
      <h3>Dependencies</h3>
      ${
        task.dependencies?.length
          ? html`<ul class="dependency-list">
              ${task.dependencies.map(
                (dependency) =>
                  html`<li>
                    <span
                      ><i
                        class=${dependency.completedAt ? 'ph ph-check-circle' : 'ph ph-circle'}
                      ></i
                      >${dependency.name}</span
                    ><button
                      class="icon-button"
                      aria-label=${`Remove ${dependency.name} dependency`}
                      @click=${async () => {
                        try {
                          await api.removeDependency(task.id, dependency.id);
                          this.taskDetail = await api.task(task.id);
                          this.notice = 'Dependency removed.';
                        } catch (error) {
                          this.notice =
                            error instanceof Error ? error.message : 'Could not remove dependency.';
                        }
                      }}
                    >
                      <i class="ph ph-x"></i>
                    </button>
                  </li>`,
              )}
            </ul>`
          : html`<p>No dependencies.</p>`
      }${
        eligible.length
          ? html`<label class="dependency-add"
              >Add dependency<select id="dependency-choice">
                <option value="">Choose a task</option>
                ${eligible.map((item) => html`<option value=${item.id}>${item.name}</option>`)}</select
              ><button
                class="outline"
                @click=${async () => {
                  const id = document.querySelector<HTMLSelectElement>('#dependency-choice')?.value;
                  if (!id) return;
                  try {
                    await api.addDependency(task.id, id);
                    this.taskDetail = await api.task(task.id);
                    this.notice = 'Dependency added.';
                  } catch (error) {
                    this.notice =
                      error instanceof Error ? error.message : 'Could not add dependency.';
                  }
                }}
              >
                Add
              </button></label
            >`
          : nothing
      }
      <h3>Tasks blocked by this task</h3>
      ${
        task.blockedTasks?.length
          ? html`<ul>
              ${task.blockedTasks.map((item) => html`<li>${item.name}</li>`)}
            </ul>`
          : html`<p>None.</p>`
      }
      <div class="inspector-actions">
        <button
          class="outline"
          @click=${(event: MouseEvent) => this.openModal({ kind: 'task-form', task }, event.currentTarget as HTMLElement)}
        >
          <i class="ph ph-pencil-simple"></i>Edit task</button
        ><button
          class="danger-text-button"
          @click=${(event: MouseEvent) => this.openModal({ kind: 'task-archive', task }, event.currentTarget as HTMLElement)}
        >
          <i class="ph ph-archive"></i>Archive task
        </button>
      </div>
    </aside>`;
  }
  render() {
    const content =
      this.route.kind === 'archived'
        ? this.archivedView()
        : this.route.kind === 'collection' || this.route.kind === 'root'
          ? this.collectionView()
          : this.utilityView();
    return html`<div class="shell collection-shell">${this.sidebar()}${content}</div>
      ${this.taskInspector()}
      <div class="sr-only" aria-live="polite">${this.notice}</div>
      ${this.modal?.kind === 'form' ? this.formModal(this.modal.collection) : this.modal?.kind === 'archive' ? this.confirmModal(this.modal.collection, 'archive') : this.modal?.kind === 'delete' ? this.confirmModal(this.modal.collection, 'delete') : this.modal?.kind === 'phases' ? this.managePhasesModal() : this.modal?.kind === 'phase-form' ? this.phaseFormModal(this.modal.phase) : this.modal?.kind === 'phase-delete' ? this.phaseDeleteModal(this.modal.phase) : this.modal?.kind === 'task-form' ? this.taskFormModal(this.modal.task) : this.modal?.kind === 'task-archive' ? this.taskArchiveModal(this.modal.task) : this.modal?.kind === 'task-delete' ? this.taskDeleteModal(this.modal.task) : nothing}`;
  }
}
