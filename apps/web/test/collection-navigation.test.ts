// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import '../src/app/waymark-app';

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

describe('collection navigation', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    history.replaceState({}, '', '/');
    mockApi();
  });

  afterEach(() => vi.unstubAllGlobals());

  it('renders API collections without legacy Groups or Projects sections', async () => {
    const element = document.createElement('waymark-app') as HTMLElement & {
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
    const element = document.createElement('waymark-app') as HTMLElement & {
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
    const element = document.createElement('waymark-app') as HTMLElement & {
      updateComplete: Promise<unknown>;
    };
    document.body.append(element);
    await settle(element);
    expect(element.querySelector('#collection-title')?.textContent).toBe('Website Redesign');
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
    const element = document.createElement('waymark-app') as HTMLElement & {
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
    expect(select.selectedOptions[0]?.textContent?.trim()).toBe('Website Redesign');
    expect(element.querySelector('dialog')?.textContent).not.toMatch(
      /(?:Description|Due date|Waiting reason)\s*>/,
    );
  });
});
