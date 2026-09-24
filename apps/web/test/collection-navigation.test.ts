// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../src/app/taskbook-app';

const flat = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Personal',
  description: 'Everyday responsibilities',
  structure: 'FLAT',
  status: 'ACTIVE',
  startDate: null,
  targetEndDate: null,
  position: 0,
  progress: { completed: 0, total: 0, ratio: 0 },
};
const phased = {
  ...flat,
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Website Redesign',
  structure: 'PHASED',
  position: 1,
};
const phasedTwo = {
  ...phased,
  id: '77777777-7777-4777-8777-777777777777',
  name: 'Product Launch',
  position: 2,
};
const task = {
  id: '33333333-3333-4333-8333-333333333333',
  collectionId: phased.id,
  phaseId: null,
  name: 'Review launch',
  description: null,
  urgency: 'MEDIUM',
  dueDate: null,
  completedAt: null,
  waitingReason: null,
  position: 0,
  createdAt: '2026-08-30T10:00:00.000Z',
  updatedAt: '2026-08-30T10:00:00.000Z',
  archivedAt: null,
  dependencies: [],
  blockedTasks: [],
  isWaiting: false,
};
const flatTask = {
  ...task,
  id: '55555555-5555-4555-8555-555555555555',
  collectionId: flat.id,
  name: 'First task',
};
const secondFlatTask = {
  ...flatTask,
  id: '66666666-6666-4666-8666-666666666666',
  name: 'Second task',
  position: 1,
};
const phase = {
  id: '44444444-4444-4444-8444-444444444444',
  collectionId: phased.id,
  name: 'Planning',
  description: null,
  position: 0,
  progress: { completed: 0, total: 0, ratio: 0 },
};
const destinationPhase = {
  ...phase,
  id: '88888888-8888-4888-8888-888888888888',
  collectionId: phasedTwo.id,
  name: 'Delivery',
};

const response = (data: unknown) =>
  Promise.resolve(new Response(JSON.stringify({ data }), { status: 200 }));

function mockApi() {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/collections')) return response([flat, phased]);
      if (url.includes(`/collections/${flat.id}`)) return response(flat);
      if (url.includes(`/collections/${phased.id}/phases`)) return response([]);
      if (url.includes(`/collections/${phased.id}`)) return response(phased);
      if (url.endsWith(`/tasks/${task.id}`)) return response(task);
      if (url.includes('/tasks?collectionId=')) return response([]);
      return Promise.resolve(new Response('{}', { status: 404 }));
    }),
  );
}

async function settle(element: HTMLElement & { updateComplete: Promise<unknown> }) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await element.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await element.updateComplete;
}

async function waitFor(check: () => boolean) {
  for (let attempt = 0; attempt < 20; attempt++) {
    if (check()) return;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  expect(check()).toBe(true);
}

describe('collection navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    history.replaceState({}, '', '/');
    mockApi();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders API collections without legacy Groups or Projects sections', async () => {
    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);
    expect(element.textContent).toContain('Personal');
    expect(element.textContent).toContain('Website Redesign');
    expect(element.textContent).not.toContain('GROUPS');
    expect(element.textContent).not.toContain('PROJECTS');
  });

  it('selecting a collection changes the URL and rendered context', async () => {
    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);
    const link = element.querySelector<HTMLAnchorElement>(`a[href="/collections/${phased.id}"]`)!;
    link.click();
    await settle(element);
    expect(location.pathname).toBe(`/collections/${phased.id}/backlog`);
    expect(element.querySelector('#collection-title')?.textContent).toBe('Website Redesign');
    expect(link.getAttribute('aria-current')).toBe('page');
  });

  it('restores a collection context from a direct URL', async () => {
    history.replaceState({}, '', `/collections/${phased.id}`);
    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);
    expect(element.querySelector('#collection-title')?.textContent).toBe('Website Redesign');
  });

  it('migrates the legacy collection selection without deleting it', async () => {
    localStorage.setItem('waymark:lastCollectionId', phased.id);
    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);
    expect(localStorage.getItem('taskbook:lastCollectionId')).toBe(phased.id);
    expect(localStorage.getItem('waymark:lastCollectionId')).toBe(phased.id);
  });

  it('migrates the legacy phase selection without deleting it', async () => {
    history.replaceState({}, '', `/collections/${phased.id}`);
    localStorage.setItem(`waymark:lastPhase:${phased.id}`, phase.id);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/collections')) return response([flat, phased]);
        if (url.includes(`/collections/${phased.id}/phases`)) return response([phase]);
        if (url.includes(`/collections/${phased.id}`)) return response(phased);
        if (url.includes('/tasks?collectionId=')) return response([]);
        return Promise.resolve(new Response('{}', { status: 404 }));
      }),
    );
    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);
    expect(localStorage.getItem(`taskbook:lastPhase:${phased.id}`)).toBe(phase.id);
    expect(localStorage.getItem(`waymark:lastPhase:${phased.id}`)).toBe(phase.id);
  });

  it('reorders rendered tasks immediately with the arrow controls', async () => {
    history.replaceState({}, '', `/collections/${flat.id}`);
    const fetchMock = vi.fn((input: string | URL) => {
      const url = String(input);
      if (url.endsWith('/collections')) return response([flat, phased]);
      if (url.includes(`/collections/${flat.id}`)) return response(flat);
      if (url.includes(`/tasks?collectionId=${flat.id}`))
        return response([flatTask, secondFlatTask]);
      if (url.endsWith('/tasks/reorder')) return response([]);
      return Promise.resolve(new Response('{}', { status: 404 }));
    });
    vi.stubGlobal('fetch', fetchMock);
    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);
    element.querySelector<HTMLButtonElement>(`[aria-label="Move ${flatTask.name} down"]`)!.click();
    await settle(element);
    expect(
      [...element.querySelectorAll('.task-name strong')].map((node) => node.textContent),
    ).toEqual([secondFlatTask.name, flatTask.name]);
    const reorderCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/tasks/reorder'),
    )!;
    expect(JSON.parse(String((reorderCall[1] as RequestInit).body))).toEqual({
      orderedIds: [secondFlatTask.id, flatTask.id],
    });
  });

  it('reorders rendered tasks immediately with drag and drop', async () => {
    history.replaceState({}, '', `/collections/${flat.id}`);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/collections')) return response([flat, phased]);
        if (url.includes(`/collections/${flat.id}`)) return response(flat);
        if (url.includes(`/tasks?collectionId=${flat.id}`))
          return response([flatTask, secondFlatTask]);
        if (url.endsWith('/tasks/reorder')) return response([]);
        return Promise.resolve(new Response('{}', { status: 404 }));
      }),
    );
    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);
    const rows = element.querySelectorAll<HTMLElement>('.task-list article');
    rows[0]!.dispatchEvent(new Event('dragstart', { bubbles: true }));
    rows[1]!.dispatchEvent(new Event('drop', { bubbles: true }));
    await settle(element);
    expect(
      [...element.querySelectorAll('.task-name strong')].map((node) => node.textContent),
    ).toEqual([secondFlatTask.name, flatTask.name]);
  });

  it("shows the task's actual collection in the edit dialog", async () => {
    history.replaceState({}, '', `/collections/${phased.id}/backlog?task=${task.id}`);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/collections')) return response([flat, phased]);
        if (url.includes(`/collections/${phased.id}/phases`)) return response([]);
        if (url.includes(`/collections/${phased.id}`)) return response(phased);
        if (url.endsWith(`/tasks/${task.id}`)) return response(task);
        if (url.includes(`/tasks?collectionId=${phased.id}`)) return response([task]);
        return Promise.resolve(new Response('{}', { status: 404 }));
      }),
    );
    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);
    const edit = [...element.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Edit task'),
    )!;
    edit.click();
    await settle(element);
    const select = element.querySelector<HTMLSelectElement>('select[name="collectionId"]')!;
    expect(select.value).toBe(phased.id);
    expect(select.disabled).toBe(false);
    expect(select.selectedOptions[0]?.textContent).toContain('Website Redesign');
    expect([...select.options].map((option) => option.textContent)).toEqual([
      expect.stringContaining('Personal'),
      expect.stringContaining('Website Redesign'),
    ]);
    expect(element.querySelector('dialog')?.textContent).not.toMatch(
      /(?:Description|Due date|Waiting reason)\s*>/,
    );
  });

  it('loads ordered destination phases and defaults a new phased collection to Backlog', async () => {
    history.replaceState({}, '', `/collections/${phased.id}/backlog?task=${task.id}`);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/collections')) return response([flat, phased, phasedTwo]);
        if (url.includes(`/collections/${phasedTwo.id}/phases`))
          return response([destinationPhase]);
        if (url.includes(`/collections/${phased.id}/phases`)) return response([]);
        if (url.includes(`/collections/${phased.id}`)) return response(phased);
        if (url.endsWith(`/tasks/${task.id}`)) return response(task);
        if (url.includes(`/tasks?collectionId=${phased.id}`)) return response([task]);
        return Promise.resolve(new Response('{}', { status: 404 }));
      }),
    );
    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);
    [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Edit task'))!
      .click();
    await settle(element);
    const collection = element.querySelector<HTMLSelectElement>('select[name="collectionId"]')!;
    collection.value = phasedTwo.id;
    collection.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(element);
    const phaseSelect = element.querySelector<HTMLSelectElement>('select[name="phaseId"]')!;
    expect(phaseSelect.value).toBe('');
    expect([...phaseSelect.options].map((option) => option.textContent?.trim())).toEqual([
      'Backlog',
      'Delivery',
    ]);
  });

  it('moves a task atomically, retains form edits, and opens its destination context', async () => {
    history.replaceState({}, '', `/collections/${phased.id}/backlog?task=${task.id}`);
    let moveBody: Record<string, unknown> | undefined;
    const moved = { ...task, collectionId: flat.id, name: 'Edited launch review' };
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith(`/tasks/${task.id}/move`)) {
          moveBody = JSON.parse(String(init?.body));
          return response(moved);
        }
        if (url.endsWith('/collections')) return response([flat, phased]);
        if (url.includes(`/collections/${phased.id}/phases`)) return response([]);
        if (url.includes(`/collections/${phased.id}`)) return response(phased);
        if (url.includes(`/collections/${flat.id}`)) return response(flat);
        if (url.endsWith(`/tasks/${task.id}`)) return response(moveBody ? moved : task);
        if (url.includes(`/tasks?collectionId=${phased.id}`)) return response([task]);
        if (url.includes(`/tasks?collectionId=${flat.id}`)) return response([moved]);
        return Promise.resolve(new Response('{}', { status: 404 }));
      }),
    );
    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);
    [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Edit task'))!
      .click();
    await settle(element);
    element.querySelector<HTMLInputElement>('input[name="name"]')!.value = moved.name;
    const collection = element.querySelector<HTMLSelectElement>('select[name="collectionId"]')!;
    collection.value = flat.id;
    collection.dispatchEvent(new Event('change', { bubbles: true }));
    await settle(element);
    expect(element.querySelector('select[name="phaseId"]')).toBeNull();
    expect(element.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe(moved.name);
    element
      .querySelector<HTMLFormElement>('dialog form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await waitFor(
      () => (element as unknown as { notice: string }).notice === `Task moved to ${flat.name}.`,
    );
    await settle(element);
    expect(moveBody).toMatchObject({
      destinationCollectionId: flat.id,
      destinationPhaseId: null,
      name: moved.name,
    });
    expect(`${location.pathname}${location.search}`).toBe(
      `/collections/${flat.id}?task=${task.id}`,
    );
    expect(element.querySelector('#task-inspector-title')?.textContent).toBe(moved.name);
    expect(element.textContent).toContain(`Task moved to ${flat.name}.`);
  });

  it('keeps the dialog and entered values after a failed move', async () => {
    history.replaceState({}, '', `/collections/${phased.id}/backlog?task=${task.id}`);
    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith(`/tasks/${task.id}/move`))
          return Promise.resolve(
            new Response(
              JSON.stringify({ error: { message: 'Archived collections cannot receive tasks' } }),
              { status: 409 },
            ),
          );
        if (url.endsWith('/collections')) return response([flat, phased]);
        if (url.includes(`/collections/${phased.id}/phases`)) return response([]);
        if (url.includes(`/collections/${phased.id}`)) return response(phased);
        if (url.endsWith(`/tasks/${task.id}`)) return response(task);
        if (url.includes(`/tasks?collectionId=${phased.id}`)) return response([task]);
        return Promise.resolve(new Response('{}', { status: 404 }));
      }),
    );
    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);
    [...element.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.textContent?.includes('Edit task'))!
      .click();
    await settle(element);
    const name = element.querySelector<HTMLInputElement>('input[name="name"]')!;
    name.value = 'Unsaved edit';
    element
      .querySelector<HTMLFormElement>('dialog form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settle(element);
    expect(element.querySelector('dialog')).not.toBeNull();
    expect(element.querySelector<HTMLInputElement>('input[name="name"]')!.value).toBe(
      'Unsaved edit',
    );
    expect(element.querySelector('[role="alert"]')?.textContent).toContain(
      'Archived collections cannot receive tasks',
    );
  });

  it('deletes an empty phase from the Manage Phases dialog', async () => {
    history.replaceState({}, '', `/collections/${phased.id}`);
    const emptyPhase = {
      ...phase,
      id: '99999999-9999-4999-8999-999999999999',
      name: 'Empty Phase',
      position: 1,
      taskCount: 0,
      hasTasks: false,
    };
    let phasesList = [phase, emptyPhase];
    const deletedSpy = vi.fn();

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL, init?: RequestInit) => {
        const url = String(input);
        const method = init?.method ?? 'GET';
        if (method === 'DELETE' && url.includes(`/phases/${emptyPhase.id}`)) {
          deletedSpy();
          phasesList = phasesList.filter((p) => p.id !== emptyPhase.id);
          return response(emptyPhase);
        }
        if (url.endsWith('/collections')) return response([flat, phased]);
        if (url.includes(`/collections/${phased.id}/phases`)) return response(phasesList);
        if (url.includes(`/collections/${phased.id}`)) return response(phased);
        if (url.includes('/tasks?collectionId=')) return response([]);
        return Promise.resolve(new Response('{}', { status: 404 }));
      }),
    );

    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);

    const manageBtn = element.querySelector<HTMLButtonElement>('button.manage-phases')!;
    manageBtn.click();
    await settle(element);

    expect(element.querySelector('dialog.phase-manager')).not.toBeNull();
    expect(element.textContent).toContain('Empty Phase');

    const deleteBtn = element.querySelector<HTMLButtonElement>(
      `button[aria-label="Delete ${emptyPhase.name}"]`,
    )!;
    expect(deleteBtn).not.toBeNull();
    deleteBtn.click();
    await settle(element);

    expect(element.querySelector('dialog.confirmation')).not.toBeNull();
    expect(element.querySelector('#confirm-title')?.textContent).toContain(`Delete ${emptyPhase.name}?`);

    const confirmBtn = element.querySelector<HTMLButtonElement>('dialog.confirmation button.danger')!;
    confirmBtn.click();
    await settle(element);

    expect(deletedSpy).toHaveBeenCalledTimes(1);
    expect(element.querySelector('dialog.phase-manager')).not.toBeNull();
    expect(element.querySelector('.managed-phases')?.textContent).not.toContain('Empty Phase');
  });

  it('prevents deleting a phase that has tasks and shows a notice', async () => {
    history.replaceState({}, '', `/collections/${phased.id}`);
    const phaseWithTasks = {
      ...phase,
      id: '44444444-4444-4444-8444-444444444444',
      name: 'Planning',
      taskCount: 1,
      hasTasks: true,
    };

    vi.stubGlobal(
      'fetch',
      vi.fn((input: string | URL) => {
        const url = String(input);
        if (url.endsWith('/collections')) return response([flat, phased]);
        if (url.includes(`/collections/${phased.id}/phases`)) return response([phaseWithTasks]);
        if (url.includes(`/collections/${phased.id}`)) return response(phased);
        if (url.includes('/tasks?collectionId=')) return response([task]);
        return Promise.resolve(new Response('{}', { status: 404 }));
      }),
    );

    const element = document.createElement('taskbook-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);

    const manageBtn = element.querySelector<HTMLButtonElement>('button.manage-phases')!;
    manageBtn.click();
    await settle(element);

    const deleteBtn = element.querySelector<HTMLButtonElement>(
      `button[aria-label*="Cannot delete ${phaseWithTasks.name}"]`,
    )!;
    expect(deleteBtn).not.toBeNull();
    deleteBtn.click();
    await settle(element);

    expect(element.querySelector('dialog.confirmation')).toBeNull();
    expect(element.querySelector('[aria-live="polite"]')?.textContent).toContain(
      `${phaseWithTasks.name} cannot be deleted. Move or delete its tasks first`,
    );
  });
});
