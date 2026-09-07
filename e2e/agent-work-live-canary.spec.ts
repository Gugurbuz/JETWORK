import { expect, test, type Page } from '@playwright/test';

// Live rollout gate: Controller V3 full surface + explicit-source policy.
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
    const response = await route.fetch({ url: url.toString() });
    if (!response.ok()) {
      const failureBody = (await response.text()).slice(0, 4_000);
      console.error(`[agent-work-live-canary] HTTP ${response.status()} ${failureBody}`);
      await route.fulfill({
        status: response.status(),
        headers: response.headers(),
        body: failureBody,
      });
      return;
    }
    await route.fulfill({ response });
  });
};

const persistedModelMessage = (page: Page) => (
  page.locator('[data-testid="chat-message"][data-message-role="model"]').last()
);

const openPersistedTimeline = async (page: Page) => {
  const modelMessage = persistedModelMessage(page);
  await expect(modelMessage.getByTestId('assistant-work-completed-logo')).toBeVisible({ timeout: 30_000 });
  const detailsToggle = modelMessage.getByRole('button', { name: 'Çalışma ayrıntılarını göster' });
  await expect(detailsToggle).toBeVisible({ timeout: 30_000 });
  await detailsToggle.click();
  const timeline = modelMessage.getByTestId('assistant-work-details');
  await expect(timeline).toBeVisible({ timeout: 30_000 });
  return { modelMessage, timeline };
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

    const liveModelMessage = persistedModelMessage(page);
    await expect(liveModelMessage).toBeVisible({ timeout: 30_000 });
    await expect(liveModelMessage).not.toContainText('Yanıt tamamlanamadı', { timeout: 160_000 });
    await expect(liveModelMessage).not.toContainText(/Asistan servisi 5\d\d hatası döndürdü/i, { timeout: 160_000 });
    await expect(liveModelMessage.getByTestId('assistant-work-completed-logo')).toBeVisible({ timeout: 160_000 });

    // The streaming placeholder can be replaced by the durable message after the
    // turn completes. Inspect the persisted message after reload so the gate tests
    // the exact state users will see on revisit rather than a transient DOM node.
    await page.reload();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 30_000 });

    const firstPersisted = await openPersistedTimeline(page);
    await expect(firstPersisted.modelMessage).not.toContainText(
      /(?:bilgi bankası|knowledge catalog).{0,80}(?:aktif|tanımlı).{0,40}(?:değil|yok|bulunmamaktadır)/i,
    );
    await expect(firstPersisted.timeline).not.toContainText(/Talep işleme alındı/i);
    await expect(firstPersisted.timeline).not.toContainText(/Soru ve konuşma bağlam/i);
    await expect(firstPersisted.timeline).not.toContainText(/Uygun kaynak ve araçlar/i);
    await expect(firstPersisted.timeline).not.toContainText(/Çalışma araçları hazır/i);
    await expect(firstPersisted.timeline).not.toContainText(/Controller/i);

    const rows = firstPersisted.timeline.locator('[data-event-id]');
    const rowCount = await rows.count();
    expect(rowCount).toBeGreaterThan(0);
    const eventIds = await rows.evaluateAll(nodes => nodes.map(node => node.getAttribute('data-event-id')).filter(Boolean) as string[]);
    expect(eventIds.some(id => id.startsWith('reported:') || id.startsWith('observed:'))).toBe(false);
    expect(new Set(eventIds).size).toBe(eventIds.length);

    const knowledgeRows = firstPersisted.timeline.locator('[data-event-kind="tool"], [data-event-kind="source"]');
    const knowledgeSignals = await knowledgeRows.count();
    const timelineText = (await firstPersisted.timeline.textContent()) || '';
    expect(knowledgeSignals > 0 || /Bilgi bankası|kurumsal kaynak|Findeks/i.test(timelineText)).toBe(true);

    // A second reload proves canonical event IDs and ordering survive durable
    // materialization instead of being reconstructed from transient fallback rows.
    await page.reload();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 30_000 });
    const secondPersisted = await openPersistedTimeline(page);
    const reloadedIds = await secondPersisted.timeline.locator('[data-event-id]').evaluateAll(nodes => nodes.map(node => node.getAttribute('data-event-id')).filter(Boolean) as string[]);
    expect(reloadedIds).toEqual(eventIds);
  });
});
