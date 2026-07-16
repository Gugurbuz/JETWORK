import { expect, test } from '@playwright/test';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;

test.describe('authenticated product flow', () => {
  test.skip(!username || !password, 'E2E_USERNAME and E2E_PASSWORD are required.');

  test('creates a workspace, generates the canonical document and controls sharing', async ({ page }) => {
    const unique = Date.now().toString(36);
    const projectName = `E2E Product ${unique}`;
    const workspaceName = `E2E Conceptual ${unique}`;

    await page.goto('/');
    await page.getByTestId('login-identity').fill(username!);
    await page.getByTestId('login-password').fill(password!);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('open-new-project')).toBeVisible({ timeout: 30_000 });

    await page.getByTestId('open-new-project').click();
    await page.getByTestId('new-project-name').fill(projectName);
    await page.getByTestId('new-project-description').fill('Canonical document and security smoke test.');
    await page.getByTestId('new-project-submit').click();
    await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 20_000 });

    await page.getByTestId('open-new-workspace').click();
    await page.getByTestId('new-workspace-item-number').fill(`E2E-${unique.toUpperCase()}`);
    await page.getByTestId('new-workspace-title').fill(workspaceName);
    await page.getByTestId('new-workspace-submit').click();
    await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 20_000 });

    await page.evaluate(() => { (window as any).__jetworkXss = false; });
    const request = [
      `Proje Adi: ${workspaceName}`,
      'Problem: Abonelik iptal ve iade talepleri farkli kanallarda izlenemiyor.',
      'Hedef: Talepleri tek is listesinde izlemek ve karar gecmisini kaydetmek.',
      'Surec 1 - Iptal talebinin alinmasi',
      'Surec 2 - Uygunluk kontrolu ve onay',
      'Surec 3 - Iade sonucu ve kapanis',
      'Roller: Musteri temsilcisi, operasyon uzmani, onayci.',
      'KPI: Tamamlanma suresi olculecek; hedef deger acik konu.',
      'Guvenlik girdisi: <img src=x onerror="window.__jetworkXss=true">',
      'Kurumsal yapida kavramsal tasarim dokumani hazirla. Bu bilgilerle ilerle, yeni soru sorma.',
    ].join('\n');
    await page.getByTestId('chat-input').fill(request);
    await page.getByTestId('chat-send').click();

    const panel = page.getByTestId('document-panel-content');
    await expect(panel).toBeVisible({ timeout: 100_000 });
    await expect(panel).toContainText(/KAVRAMSAL TASARIM RAPORU/i);
    await expect(panel).toContainText(/PROJE K[İI]ML[İI]K KARTI/i);
    await expect(panel).toContainText(/DOK[ÜU]MAN TAR[İI]H[ÇC]ES[İI]/i);
    await expect(panel).toContainText(/S[ÜU]RE[ÇC] MODEL[İI]/i);
    await expect(page.getByTestId('chat-message').filter({ hasText: /ne yapt/i }).last()).toBeVisible();
    expect(await page.evaluate(() => (window as any).__jetworkXss)).toBe(false);

    const shareDialog = page.waitForEvent('dialog');
    await page.getByTestId('share-document').click();
    const createdShareDialog = await shareDialog;
    expect(createdShareDialog.message()).toContain('?share=');
    await createdShareDialog.accept();
    await expect(page.getByTestId('revoke-document-share')).toBeVisible();

    const revokeDialog = page.waitForEvent('dialog');
    await page.getByTestId('revoke-document-share').click();
    const revokedShareDialog = await revokeDialog;
    expect(revokedShareDialog.message()).toMatch(/iptal/i);
    await revokedShareDialog.accept();
  });
});
