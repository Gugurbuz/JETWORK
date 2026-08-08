import { expect, test, type Page } from '@playwright/test';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;

const createWorkspace = async (page: Page, label: string) => {
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const workspaceName = `E2E ${label} ${unique}`;

  await page.goto('/');
  await page.getByTestId('login-identity').fill(username!);
  await page.getByTestId('login-password').fill(password!);
  await page.getByTestId('login-submit').click();

  const newChat = page.getByRole('button', { name: 'Yeni sohbet' }).first();
  await expect(newChat).toBeVisible({ timeout: 30_000 });
  await newChat.click();

  await expect(page).toHaveURL(/\/c\/[^/?#]+(?:[?#].*)?$/, { timeout: 30_000 });
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 30_000 });

  return { workspaceName };
};

const sendMessage = async (page: Page, message: string) => {
  await page.getByTestId('chat-input').fill(message);
  await page.getByTestId('chat-send').click();
};

test.describe('authenticated product flow', () => {
  test.skip(!username || !password, 'E2E_USERNAME and E2E_PASSWORD are required.');

  test('generates a source-faithful Enerjisa needs analysis without behavior hints', async ({ page }) => {
    test.setTimeout(180_000);
    const { workspaceName } = await createWorkspace(page, 'Conceptual');

    await page.evaluate(() => { (window as any).__jetworkXss = false; });
    const request = [
      `Proje Adi: ${workspaceName}`,
      'Problem: Abonelik iptal ve iade talepleri farkli kanallarda izlenemiyor.',
      'Mevcut durum: Cagri merkezi ve operasyon ekipleri ayri listeler kullaniyor.',
      'Hedef durum: Talepleri tek is listesinde izlemek ve karar gecmisini kaydetmek.',
      'Surec 1 - Iptal talebinin alinmasi',
      'Surec 2 - Uygunluk kontrolu ve onay',
      'Surec 3 - Iade sonucu ve kapanis',
      'Roller: Musteri temsilcisi, operasyon uzmani, onayci.',
      'Is kurali: Iade onayi olmadan odeme talimati olusturulamaz.',
      'KPI: Tamamlanma suresi olculecek; hedef deger acik konu.',
      'Kapsam disi: Muhasebe sisteminin yeniden yazilmasi.',
      'Guvenlik girdisi: <img src=x onerror="window.__jetworkXss=true">',
      'Kurumsal yapida kavramsal tasarim dokumani hazirla.',
    ].join('\n');
    await sendMessage(page, request);

    const panel = page.getByTestId('document-panel-content');
    await expect(panel).toBeVisible({ timeout: 160_000 });
    await expect(panel).toContainText(/HT.YA. ANAL.Z./i);
    await expect(panel).toContainText(/ANAL.Z KAPSAMI/i);
    await expect(panel).toContainText(/KISALTMALAR/i);
    await expect(panel).toContainText(/. GEREKS.N.MLER./i);
    await expect(panel).toContainText(/FONKS.YONEL GEREKS.N.MLER/i);
    await expect(panel).toContainText(/FONKS.YONEL OLMAYAN GEREKS.N.MLER/i);
    await expect(panel).toContainText(/S.RE. R.SK ANAL.Z./i);
    await expect(panel).toContainText(/FONKS.YONEL TASARIM DOK.MANLARI/i);
    await expect(panel).toContainText(/NDEK.LER/i);
    await expect(panel).toContainText(/[iIİı]ptal taleb[iIİı]n[iIİı]n al[iIİı]nmas[iIİı]/i);
    await expect(panel).toContainText(/Uygunluk kontrol. ve onay/i);
    await expect(panel).toContainText(/ade sonucu ve kapan./i);
    await expect(panel).toContainText(/M[üu][şs]teri temsilcisi/i);
    await expect(panel).toContainText(/Tamamlanma s[üu]resi/i);
    await expect(panel).not.toContainText(/SAP|IYS|Findeks|KKB|D2D/i);
    await expect(panel).not.toContainText(/CRM_Metot|ana_rol_ve_mantik|AI TURN DECISION/i);
    await expect(page.getByTestId('interactive-questions')).toHaveCount(0);
    await expect(page.getByTestId('chat-message').filter({ hasText: /ne yapt/i }).last()).toBeVisible();
    const qualityScoreText = await page.getByTestId('document-quality-score').textContent();
    const qualityScore = Number(qualityScoreText?.match(/\d+/)?.[0] || 0);
    expect(qualityScore).toBeGreaterThanOrEqual(72);
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

  test('asks at most three plain maturation questions for a sparse request', async ({ page }) => {
    await createWorkspace(page, 'Discovery');
    await sendMessage(
      page,
      'Saha servis is emirlerinin mobil uygulamaya tasinmasi projesi icin kavramsal tasarim dokumani hazirla.',
    );

    const questions = page.getByTestId('interactive-questions');
    await expect(questions).toBeVisible({ timeout: 100_000 });
    const questionCount = await page.getByTestId('question-prompt').count();
    expect(questionCount).toBeGreaterThan(0);
    expect(questionCount).toBeLessThanOrEqual(3);
    expect(await page.getByTestId('question-option').count()).toBe(0);
    await expect(page.getByRole('button', { name: 'Varsayımlarla devam et' })).toBeVisible();
  });

  test('keeps test scenarios inside the single Enerjisa analysis document', async ({ page }) => {
    await createWorkspace(page, 'TestScenario');
    const request = [
      'Siparis iptal ekraninda musteri temsilcisi siparis numarasi ile kayit arar.',
      'Yalniz ACIK durumundaki siparisler iptal edilebilir.',
      'Yonetici rolu 10.000 TL uzerindeki iadeleri onaylar.',
      'Odeme servisi hata verirse islem BASARISIZ durumuna alinip yeniden denenebilir.',
      'Negatif, sinir deger, yetki ve entegrasyon hata test senaryolarini tablo halinde hazirla.',
    ].join('\n');
    await sendMessage(page, request);

    const panel = page.getByTestId('document-panel-content');
    await expect(panel).toBeVisible({ timeout: 100_000 });
    await expect(panel).toContainText(/HT.YA. ANAL.Z./i);
    await expect(panel).toContainText(/Given/i);
    await expect(panel).toContainText(/When/i);
    await expect(panel).toContainText(/Then/i);
    await expect(panel).toContainText(/Negatif/i);
    await expect(panel).not.toContainText(/KAVRAMSAL TASARIM RAPORU/i);
  });

  test('runs a technical diagnosis through observable reasoning stages', async ({ page }) => {
    test.setTimeout(180_000);
    await createWorkspace(page, 'Reasoning');
    await sendMessage(page, 'ZCRM2-545 hangi koşulda alınır? Bilgi bankasından teknik kanıtla incele.');

    const modelMessage = page.locator('[data-testid="chat-message"][data-message-role="model"]').last();
    await expect(modelMessage).toBeVisible({ timeout: 160_000 });
    await expect(modelMessage).not.toContainText('Yanıt tamamlanamadı');
    await expect(modelMessage).toContainText(/Talep sınıflandırıldı|bilgi bankasında|kanıt/i, { timeout: 160_000 });
  });
});
