import { LitElement, html, nothing } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import {
  api,
  type Collection,
  type CollectionInput,
  type CollectionStatus,
  type Phase,
  type Task,
} from '../services/api-client';

type Route =
  | { kind: 'collection'; id: string }
  | { kind: 'today' | 'upcoming' | 'done' | 'archived' }
  | { kind: 'root' };
type Modal =
  | { kind: 'form'; collection?: Collection }
  | { kind: 'archive' | 'delete'; collection: Collection }
  | null;
const lastKey = 'waymark:lastCollectionId';
const readRoute = (): Route => {
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
    return html`<section class="workspace">
      <div class="phase-nav" aria-label="Phases">
        <button class="current">
          <span><i class="ph ph-tray"></i></span><b>Backlog</b
          ><small>${this.tasks.filter((task) => !task.phaseId).length} tasks</small></button
        >${this.phases.map((phase, index) => html`<button disabled><span>${index + 1}</span><b>${phase.name}</b><small>${this.tasks.filter((task) => task.phaseId === phase.id).length} tasks</small></button>`)}
      </div>
      <div class="inline-empty">
        <i class="ph ph-stack"></i>
        <h3>${this.phases.length ? 'Backlog' : 'No phases yet'}</h3>
        <p>Phase and task editing are intentionally unavailable in this pass.</p>
      </div>
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
  render() {
    const content =
      this.route.kind === 'archived'
        ? this.archivedView()
        : this.route.kind === 'collection' || this.route.kind === 'root'
          ? this.collectionView()
          : this.utilityView();
    return html`<div class="shell collection-shell">${this.sidebar()}${content}</div>
      <div class="sr-only" aria-live="polite">${this.notice}</div>
      ${this.modal?.kind === 'form' ? this.formModal(this.modal.collection) : this.modal?.kind === 'archive' ? this.confirmModal(this.modal.collection, 'archive') : this.modal?.kind === 'delete' ? this.confirmModal(this.modal.collection, 'delete') : nothing}`;
  }
}
