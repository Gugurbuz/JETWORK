import { expect, test, type Page } from '@playwright/test';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;
const canarySlug = process.env.E2E_ASSISTANT_CANARY_SLUG || 'agent-work-meaningful-v2-canary';

const loginAndCreateChat = async (page: Page) => {
  await page.goto('/');
  await page.getByTestId('login-identity').fill(username!);
  await page.getByTestId('login-password').fill(password!);
  await page.getByTestId('login-submit').click();

  const newChat = page.getByRole('button', { name: 'Yeni sohbet' }).first();
  await expect(newChat).toBeVisible({ timeout: 30_000 });
  await newChat.click();
  await expect(page).toHaveURL(/\/c\/[^/?#]+(?:[?#].*)?$/, { timeout: 30_000 });
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 30_000 });
};

const routeAssistantToCanary = async (page: Page) => {
  await page.route('**/functions/v1/openai-assistant-v2', async route => {
    const request = route.request();
    const url = new URL(request.url());
    url.pathname = `/functions/v1/${canarySlug}`;
    await route.continue({ url: url.toString() });
  });
};

test.describe('Agent Work live canary', () => {
  test.skip(!username || !password, 'E2E_USERNAME and E2E_PASSWORD are required.');

  test('shows meaningful work instead of runtime plumbing on a real knowledge turn', async ({ page }) => {
    test.setTimeout(180_000);
    await routeAssistantToCanary(page);
    await loginAndCreateChat(page);

    await page.getByTestId('chat-input').fill(
      'Findeks KKB entegrasyonu için bilgi bankasında Findeks kayıtlarını ara. Bulduğun kayıtları kısaca değerlendir.',
    );
    await page.getByTestId('chat-send').click();

    const modelMessage = page.locator('[data-testid="chat-message"][data-message-role="model"]').last();
    await expect(modelMessage).toBeVisible({ timeout: 30_000 });
    await expect(modelMessage).not.toContainText('Yanıt tamamlanamadı', { timeout: 160_000 });
    await expect(modelMessage.getByTestId('assistant-work-completed-logo')).toBeVisible({ timeout: 160_000 });

    const detailsToggle = modelMessage.getByRole('button', { name: 'Çalışma ayrıntılarını göster' });
    await expect(detailsToggle).toBeVisible();
    await detailsToggle.click();

    const timeline = modelMessage.getByTestId('assistant-work-details');
    await expect(timeline).toBeVisible();
    await expect(timeline).not.toContainText(/Talep işleme alındı/i);
    await expect(timeline).not.toContainText(/Soru ve konuşma bağlam/i);
    await expect(timeline).not.toContainText(/Uygun kaynak ve araçlar/i);
    await expect(timeline).not.toContainText(/Çalışma araçları hazır/i);
    await expect(timeline).not.toContainText(/Controller/i);

    const rows = timeline.locator('[data-event-id]');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    const eventIds = await rows.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-event-id')).filter(Boolean) as string[]);
    expect(eventIds.some(id => id.startsWith('reported:') || id.startsWith('observed:'))).toBe(false);
    expect(new Set(eventIds).size).toBe(eventIds.length);

    // The real turn must expose at least one meaningful knowledge-work signal:
    // a tool/source row or LLM-authored public progress mentioning the knowledge bank.
    const knowledgeRows = timeline.locator('[data-event-kind="tool"], [data-event-kind="source"]');
    const knowledgeSignals = await knowledgeRows.count();
    const timelineText = (await timeline.textContent()) || '';
    expect(knowledgeSignals > 0 || /Bilgi bankası|kurumsal kaynak|Findeks/i.test(timelineText)).toBe(true);

    // Persistence must keep canonical event identity after a real page reload.
    await page.reload();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 30_000 });
    const reloadedMessage = page.locator('[data-testid="chat-message"][data-message-role="model"]').last();
    await expect(reloadedMessage.getByTestId('assistant-work-completed-logo')).toBeVisible({ timeout: 30_000 });
    await reloadedMessage.getByRole('button', { name: 'Çalışma ayrıntılarını göster' }).click();
    const reloadedTimeline = reloadedMessage.getByTestId('assistant-work-details');
    const reloadedIds = await reloadedTimeline.locator('[data-event-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-event-id')).filter(Boolean) as string[]);
    expect(reloadedIds).toEqual(eventIds);
  });
});
