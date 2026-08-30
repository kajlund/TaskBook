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
  | { kind: 'archive' | 'delete'; collection: Collection }
  | null;
const lastKey = 'waymark:lastCollectionId';
const phaseKey = (id: string) => `waymark:lastPhase:${id}`;
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

@customElement('waymark-app')
export class WaymarkApp extends LitElement {
  @state() private collections: Collection[] = [];
  @state() private archived: Collection[] = [];
  @state() private selected: Collection | null = null;
  @state() private phases: Phase[] = [];
  @state() private tasks: Task[] = [];
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
        const remembered = localStorage.getItem(lastKey);
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
            const remembered = localStorage.getItem(phaseKey(collection.id));
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
      } else if (this.route.kind === 'archived') {
        const all = await api.collections(true);
        if (token !== this.loadId) return;
        this.archived = all.filter((item) => item.status === 'ARCHIVED');
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

  private sidebar() {
    return html`<aside class="sidebar">
      <div class="brand">Waymark<span>.</span></div>
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
      </div>
      ${
        this.tasks.length
          ? html`<div class="simple-list">
              ${this.tasks.map((task) => html`<div><i class=${task.completedAt ? 'ph ph-check-circle' : 'ph ph-circle'}></i><strong>${task.name}</strong>${task.dueDate ? html`<span>${task.dueDate}</span>` : nothing}</div>`)}
            </div>`
          : html`<div class="inline-empty">
              <i class="ph ph-list-checks"></i>
              <h3>No tasks yet</h3>
              <p>Task editing will be added in a later pass.</p>
            </div>`
      }
    </section>`;
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
                </div>
                ${
                  visibleTasks.length
                    ? html`<div class="simple-list">
                        ${visibleTasks.map((task) => html`<div><i class=${task.completedAt ? 'ph ph-check-circle' : 'ph ph-circle'}></i><strong>${task.name}</strong>${task.dueDate ? html`<span>${task.dueDate}</span>` : nothing}</div>`)}
                      </div>`
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
          <p>Task-focused views remain unchanged in this collection management pass.</p>
        </div>
      </header>
      <section class="workspace">
        <div class="inline-empty">
          <i class="ph ph-clock"></i>
          <h2>${title}</h2>
          <p>Select a collection from the sidebar to manage its context.</p>
        </div>
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
          >Name <span>Required</span><input name="name" .value=${collection?.name ?? ''} /></label
        >${this.errors.name ? html`<p class="field-error" role="alert">${this.errors.name}</p>` : nothing}<label
          >Description <span>Optional</span
          ><textarea name="description" rows="3">${collection?.description ?? ''}</textarea>
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
            >Start date <span>Optional</span
            ><input type="date" name="startDate" .value=${collection?.startDate ?? ''} /></label
          ><label
            >Target end date <span>Optional</span
            ><input
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
          >Name <span>Required</span><input name="name" .value=${phase?.name ?? ''} /></label
        >${this.errors.name ? html`<p class="field-error" role="alert">${this.errors.name}</p>` : nothing}<label
          >Description <span>Optional</span
          ><textarea name="description" rows="3">${phase?.description ?? ''}</textarea>
        </label>
        <div class="form-grid">
          <label
            >Start date <span>Optional</span
            ><input name="startDate" type="date" .value=${phase?.startDate ?? ''} /></label
          ><label
            >Target end date <span>Optional</span
            ><input
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
  render() {
    const content =
      this.route.kind === 'archived'
        ? this.archivedView()
        : this.route.kind === 'collection' || this.route.kind === 'root'
          ? this.collectionView()
          : this.utilityView();
    return html`<div class="shell collection-shell">${this.sidebar()}${content}</div>
      <div class="sr-only" aria-live="polite">${this.notice}</div>
      ${this.modal?.kind === 'form' ? this.formModal(this.modal.collection) : this.modal?.kind === 'archive' ? this.confirmModal(this.modal.collection, 'archive') : this.modal?.kind === 'delete' ? this.confirmModal(this.modal.collection, 'delete') : this.modal?.kind === 'phases' ? this.managePhasesModal() : this.modal?.kind === 'phase-form' ? this.phaseFormModal(this.modal.phase) : this.modal?.kind === 'phase-delete' ? this.phaseDeleteModal(this.modal.phase) : nothing}`;
  }
}
