// E2E: CLI → API → MCP → Second Brain integration flow
import { test, expect } from '@playwright/test';

test.describe('Second Brain + Global Search integration', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('loads board with kanban columns', async ({ page }) => {
    await expect(page.getByTestId('view-board-tab')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-status="backlog"]')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('[data-status="todo"]')).toBeVisible();
    await expect(page.locator('[data-status="doing"]')).toBeVisible();
    await expect(page.locator('[data-status="review"]')).toBeVisible();
    await expect(page.locator('[data-status="done"]')).toBeVisible();
  });

  test('opens Second Brain tab and sees empty state', async ({ page }) => {
    const brainTab = page.getByRole('tab', { name: /Second Brain/ });
    await expect(brainTab).toBeVisible();
    await brainTab.click();
    await expect(page.getByTestId('second-brain-tab')).toBeVisible();
    await expect(page.getByTestId('brain-doc-tree')).toBeVisible();
  });

  test('creates a new document via Second Brain', async ({ page }) => {
    await page.getByRole('tab', { name: /Second Brain/ }).click();
    await page.getByTestId('new-doc-btn').click();
    await page.getByTestId('brain-doc-title-input').fill('Test Document');
    await page.getByTestId('brain-doc-content-input').fill('# Hello World\n\nThis is a test document.');
    await page.getByTestId('brain-doc-save-btn').click();
    await expect(page.getByTestId('brain-doc-viewer')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('brain-doc-viewer')).toContainText('Test Document');
  });

  test('global search finds documents', async ({ page }) => {
    await page.getByRole('tab', { name: /Second Brain/ }).click();
    await page.getByTestId('new-doc-btn').click();
    await page.getByTestId('brain-doc-title-input').fill('Searchable Doc');
    await page.getByTestId('brain-doc-content-input').fill('# Unique Searchable Content');
    await page.getByTestId('brain-doc-save-btn').click();
    await expect(page.getByTestId('brain-doc-viewer')).toBeVisible({ timeout: 10000 });

    // Click global search button in header
    await page.getByRole('button', { name: /Global search \(FTS5\)/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.getByPlaceholder(/Search everywhere/).fill('Unique Searchable');
    await dialog.getByRole('tab', { name: /Documents/ }).click();
    await expect(dialog.getByText('Searchable Doc')).toBeVisible({ timeout: 5000 });
  });

  test('global search finds tasks created via API', async ({ page, request }) => {
    // Seed a project and task via REST API (simulating CLI/API pipeline)
    await request.post('/api/projects', { data: { name: 'E2E Project', slug: 'e2e-proj' } }).catch(() => {});
    const createRes = await request.post('/api/tasks', {
      data: {
        project: 'e2e-proj',
        title: 'E2E Test Task Alpha',
        description: 'Verify global search across tasks',
        status: 'todo',
      },
    });
    expect(createRes.ok()).toBeTruthy();

    await page.reload();
    await page.getByRole('button', { name: /Global search \(FTS5\)/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await page.getByPlaceholder(/Search everywhere/).fill('E2E Test Task Alpha');
    await expect(dialog.getByText('E2E Test Task Alpha')).toBeVisible({ timeout: 5000 });
  });

  test('clicking document link on Card opens it in Second Brain tab', async ({ page, request }) => {
    await request.post('/api/projects', { data: { name: 'Link Project', slug: 'link-proj' } }).catch(() => {});
    const docRes = await request.post('/api/documents', {
      data: {
        slug: 'specs/link-architecture',
        layer: 'specs',
        title: 'Link Architecture Spec',
        body: '# Link Architecture\n\nVerified card-to-brain navigation.',
        project: 'link-proj',
      },
    });
    expect(docRes.ok()).toBeTruthy();

    const taskRes = await request.post('/api/tasks', {
      data: {
        project: 'link-proj',
        title: 'Task With Spec Link',
        references: ['specs/link-architecture'],
      },
    });
    expect(taskRes.ok()).toBeTruthy();

    await page.goto('/#link-proj');
    const docBtn = page.getByTestId('card-doc-link').filter({ hasText: 'specs/link-architecture' }).first();
    await expect(docBtn).toBeVisible({ timeout: 10000 });
    await docBtn.click();

    await expect(page.getByTestId('second-brain-tab')).toBeVisible();
    await expect(page.getByTestId('brain-doc-viewer')).toBeVisible({ timeout: 10000 });
    await expect(page.getByTestId('brain-doc-viewer')).toContainText('Link Architecture Spec');
    await expect(page.getByTestId('brain-doc-viewer')).toContainText('Verified card-to-brain navigation.');
  });

  test('TaskPanel supports v2 AC checklist, claim, and submit review workflow', async ({ page, request }) => {
    await request.post('/api/projects', { data: { name: 'Workflow Project', slug: 'wf-proj' } }).catch(() => {});
    const taskRes = await request.post('/api/tasks', {
      data: {
        project: 'wf-proj',
        title: 'TaskOS v2 Workflow Check',
        code: 'WF-42',
        priority: 'p1',
        acceptance_criteria: [{ id: 'AC-1', text: 'Verify UI workflow', done: false }],
      },
    });
    expect(taskRes.ok()).toBeTruthy();

    await page.goto('/#wf-proj');
    const cardTitle = page.getByText('TaskOS v2 Workflow Check').first();
    await expect(cardTitle).toBeVisible({ timeout: 10000 });
    await cardTitle.click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText('WF-42')).toBeVisible();

    await dialog.getByRole('button', { name: /Claim/i }).click();
    await expect(dialog.getByText('DOING', { exact: true })).toBeVisible({ timeout: 5000 });

    await dialog.getByRole('checkbox').first().click();
    await dialog.getByRole('button', { name: /Submit review/i }).click();
    await expect(dialog.getByText('REVIEW', { exact: true })).toBeVisible({ timeout: 5000 });
  });
});
