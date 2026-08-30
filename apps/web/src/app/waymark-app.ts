import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
type Task = {
  id: string;
  name: string;
  due: string;
  urgency: string;
  done: boolean;
  dependency?: string;
};
const phaseData = [
  { name: 'Discovery', count: '3 / 3' },
  { name: 'Planning', count: '1 / 3' },
  { name: 'Design', count: '0 / 4' },
  { name: 'Development', count: '0 / 3' },
  { name: 'Launch', count: '0 / 2' },
];
const initialTasks: Task[] = [
  {
    id: '2.1',
    name: 'Define information architecture',
    due: 'Aug 31, 2026',
    urgency: 'High',
    done: false,
  },
  { id: '2.2', name: 'Content strategy', due: 'Sep 2, 2026', urgency: 'Medium', done: true },
  {
    id: '2.3',
    name: 'Sitemap',
    due: 'Sep 3, 2026',
    urgency: 'Medium',
    done: false,
    dependency: '2.1',
  },
];
@customElement('waymark-app')
export class WaymarkApp extends LitElement {
  @state() private selectedPhase = 1;
  @state() private tasks = [...initialTasks];
  @state() private inspector = 'phase';
  @state() private menuOpen = false;
  @state() private live = '';
  createRenderRoot() {
    return this;
  }
  private move(index: number, delta: number) {
    const next = index + delta;
    if (next < 0 || next >= this.tasks.length) return;
    const copy = [...this.tasks];
    [copy[index], copy[next]] = [copy[next]!, copy[index]!];
    this.tasks = copy;
    this.live = `Moved ${copy[next]!.name} to position ${next + 1}`;
  }
  private toggle(task: Task) {
    this.tasks = this.tasks.map((t) => (t.id === task.id ? { ...t, done: !t.done } : t));
    this.live = `${task.name} ${task.done ? 'reopened' : 'completed'}`;
  }
  render() {
    const phase = phaseData[this.selectedPhase]!;
    return html` <div class="shell">
        <header class="mobilebar">
          <button
            class="icon"
            @click=${() => (this.menuOpen = !this.menuOpen)}
            aria-label="Open navigation"
          >
            <i class="ph ph-list"></i></button
          ><strong>Waymark</strong>
        </header>
        <aside class=${this.menuOpen ? 'sidebar open' : 'sidebar'}>
          <div class="brand">Waymark<span>.</span></div>
          <nav aria-label="Primary">
            <a><i class="ph ph-tray"></i>Inbox</a
            ><a><i class="ph ph-calendar-blank"></i>Today <b>3</b></a
            ><a><i class="ph ph-list-bullets"></i>Upcoming</a
            ><a><i class="ph ph-check-circle"></i>Done</a><small>COLLECTIONS</small
            ><a><i class="ph ph-user"></i>Personal</a
            ><a class="selected"><i class="ph ph-briefcase"></i>Work</a
            ><small>TASK COLLECTIONS</small
            ><a class="active"><i class="ph ph-folder"></i>Website Redesign</a
            ><a><i class="ph ph-folder"></i>Replace Server Storage</a
            ><a><i class="ph ph-folder"></i>Personal Administration</a
            ><a><i class="ph ph-folder"></i>Home Maintenance</a>
          </nav>
          <div class="account">
            <i class="ph ph-gear"></i>Settings<br /><span>AM</span> Avery Morgan
          </div>
        </aside>
        <main>
          <header class="collection">
            <div>
              <h1>Website Redesign <i class="ph ph-star"></i></h1>
              <p><i class="ph ph-calendar-blank"></i> Aug 17 – Oct 30, 2026 (11 weeks)</p>
            </div>
            <button class="outline"><i class="ph ph-stack"></i>Manage phases</button>
          </header>
          <section class="phase-nav" aria-label="Phases">
            ${phaseData.map(
              (p, i) =>
                html`<button
                  class=${i === this.selectedPhase ? 'current' : i < this.selectedPhase ? 'complete' : ''}
                  @click=${() => {
                    this.selectedPhase = i;
                    this.inspector = 'phase';
                  }}
                >
                  <span>${i < this.selectedPhase ? html`<i class="ph ph-check"></i>` : i + 1}</span
                  ><b>${p.name}</b><small>${p.count}</small>
                </button>`,
            )}
          </section>
          <section class="workspace">
            <div class="section-title">
              <h2>${phase.name} <span>${this.tasks.length} tasks</span></h2>
              <div class="progress">
                <i
                  style=${`width:${(this.tasks.filter((t) => t.done).length / this.tasks.length) * 100}%`}
                ></i>
              </div>
              <small
                >${this.tasks.filter((t) => t.done).length} of ${this.tasks.length} complete</small
              >
            </div>
            <button class="primary"><i class="ph ph-plus"></i>Add task</button>
            <div class="table" role="table" aria-label="Planning tasks">
              <div class="thead" role="row">
                <span></span><span>#</span><span>TASK</span><span>DUE</span><span>URGENCY</span
                ><span>DEPENDENCY</span><span></span>
              </div>
              ${this.tasks.map(
                (task, index) =>
                  html`<div
                    class=${this.inspector === task.id ? 'task selected-task' : 'task'}
                    role="row"
                    @click=${() => (this.inspector = task.id)}
                  >
                    <button class="drag" aria-label="Reorder ${task.name}">
                      <i class="ph ph-dots-six-vertical"></i></button
                    ><span>${task.id}</span
                    ><button
                      class=${task.done ? 'check done' : 'check'}
                      @click=${(e: Event) => {
                        e.stopPropagation();
                        this.toggle(task);
                      }}
                      aria-label=${task.done ? `Reopen ${task.name}` : `Complete ${task.name}`}
                    >
                      <i class="ph ph-check"></i></button
                    ><strong class=${task.done ? 'struck' : ''}>${task.name}</strong
                    ><span>${task.due}</span
                    ><span class=${`urgency ${task.urgency.toLowerCase()}`}
                      ><i></i>${task.urgency}</span
                    ><span>${task.dependency ?? '—'}</span
                    ><span class="moves"
                      ><button
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this.move(index, -1);
                        }}
                        aria-label="Move up"
                      >
                        <i class="ph ph-arrow-up"></i></button
                      ><button
                        @click=${(e: Event) => {
                          e.stopPropagation();
                          this.move(index, 1);
                        }}
                        aria-label="Move down"
                      >
                        <i class="ph ph-arrow-down"></i></button
                    ></span>
                  </div>`,
              )}
            </div>
          </section>
          <footer>
            <button
              class="outline"
              @click=${() => (this.selectedPhase = Math.max(0, this.selectedPhase - 1))}
            >
              <i class="ph ph-arrow-left"></i>Previous phase</button
            ><span>Phase ${this.selectedPhase + 1} of 5</span
            ><button
              class="primary"
              @click=${() => (this.selectedPhase = Math.min(4, this.selectedPhase + 1))}
            >
              Next phase<i class="ph ph-arrow-right"></i>
            </button>
          </footer>
        </main>
        <aside class="inspector">
          <div class="inspector-icon"><i class="ph ph-folder"></i></div>
          <small>${this.inspector === 'phase' ? 'PHASE DETAILS' : 'TASK DETAILS'}</small>
          <h2>
            ${this.inspector === 'phase' ? phase.name : this.tasks.find((t) => t.id === this.inspector)?.name}
          </h2>
          <p>
            ${this.inspector === 'phase' ? `Phase ${this.selectedPhase + 1} of 5` : 'Planning · Website Redesign'}
          </p>
          <hr />
          <small>GOAL</small>
          <p>Define the structure, content, and technical foundation for the new site.</p>
          <hr />
          <small>TARGET DATES</small>
          <dl>
            <dt>Start date</dt>
            <dd>Aug 31, 2026</dd>
            <dt>End date</dt>
            <dd>Sep 4, 2026</dd>
            <dt>Duration</dt>
            <dd>1 week</dd>
          </dl>
          <hr />
          <small>COMPLETION RULE</small>
          <p>All active tasks in this phase must be completed.</p>
        </aside>
      </div>
      <div class="sr-only" aria-live="polite">${this.live}</div>`;
  }
}
