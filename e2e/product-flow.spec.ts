import { expect, test, type Page } from '@playwright/test';

const username = process.env.E2E_USERNAME;
const password = process.env.E2E_PASSWORD;

const createWorkspace = async (page: Page, label: string) => {
  const unique = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  const projectName = `E2E Product ${label} ${unique}`;
  const workspaceName = `E2E ${label} ${unique}`;

  await page.goto('/');
  await page.getByTestId('login-identity').fill(username!);
  await page.getByTestId('login-password').fill(password!);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('open-new-project')).toBeVisible({ timeout: 30_000 });

  await page.getByTestId('open-new-project').click();
  await page.getByTestId('new-project-name').fill(projectName);
  await page.getByTestId('new-project-description').fill('AI behavior and document quality smoke test.');
  await page.getByTestId('new-project-submit').click();
  await expect(page.getByRole('heading', { name: projectName })).toBeVisible({ timeout: 20_000 });

  await page.getByTestId('open-new-workspace').click();
  await page.getByTestId('new-workspace-item-number').fill(`E2E-${unique.toUpperCase()}`);
  await page.getByTestId('new-workspace-title').fill(workspaceName);
  await page.getByTestId('new-workspace-submit').click();
  await expect(page.getByTestId('chat-input')).toBeVisible({ timeout: 20_000 });

  return { workspaceName };
};

const sendMessage = async (page: Page, message: string) => {
  await page.getByTestId('chat-input').fill(message);
  await page.getByTestId('chat-send').click();
};

test.describe('authenticated product flow', () => {
  test.skip(!username || !password, 'E2E_USERNAME and E2E_PASSWORD are required.');

  test('generates a source-faithful canonical document without behavior hints', async ({ page }) => {
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
    await expect(panel).toBeVisible({ timeout: 100_000 });
    await expect(panel).toContainText(/KAVRAMSAL TASARIM RAPORU/i);
    await expect(panel).toContainText(/PROJE K.ML.K KARTI/i);
    await expect(panel).toContainText(/DOK.MAN TAR.H.ES./i);
    await expect(panel).toContainText(/NDEK.LER/i);
    await expect(panel).toContainText(/S.RE. MODEL./i);
    await expect(panel).toContainText(/[iIİı]ptal taleb[iIİı]n[iIİı]n al[iIİı]nmas[iIİı]/);
    await expect(panel).toContainText(/Uygunluk kontrol. ve onay/i);
    await expect(panel).toContainText(/ade sonucu ve kapan./i);
    await expect(panel).toContainText(/M.steri temsilcisi/i);
    await expect(panel).toContainText(/Tamamlanma s.resi/i);
    await expect(panel).toContainText(/AKI. D.YAGRAMI/i);
    await expect(panel).toContainText(/ST D.ZEY M.STER. GEL.T.RMES./i);
    await expect(panel).toContainText(/DE.{1,6}M Y.NET.M./i);
    await expect(panel).toContainText(/EKLENT./i);
    await expect(panel).not.toContainText(/SAP|IYS|Findeks|KKB|D2D/i);
    await expect(page.getByTestId('interactive-questions')).toHaveCount(0);
    await expect(page.getByTestId('chat-message').filter({ hasText: /ne yapt/i }).last()).toBeVisible();
    const qualityScoreText = await page.getByTestId('document-quality-score').textContent();
    const qualityScore = Number(qualityScoreText?.match(/\d+/)?.[0] || 0);
    expect(qualityScore).toBeGreaterThanOrEqual(90);
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

  test('asks high-value questions with suggested answers for a sparse request', async ({ page }) => {
    await createWorkspace(page, 'Discovery');
    await sendMessage(
      page,
      'Saha servis is emirlerinin mobil uygulamaya tasinmasi projesi icin kavramsal tasarim dokumani hazirla.',
    );

    const questions = page.getByTestId('interactive-questions');
    await expect(questions).toBeVisible({ timeout: 100_000 });
    expect(await page.getByTestId('question-prompt').count()).toBeGreaterThan(0);
    expect(await page.getByTestId('question-option').count()).toBeGreaterThanOrEqual(2);
  });

  test('keeps test scenarios outside the conceptual Word wrapper', async ({ page }) => {
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
    await expect(panel).toContainText(/n ko.ul|Test verisi/i);
    await expect(panel).toContainText(/Beklenen sonu./i);
    await expect(panel).toContainText(/Negatif senaryo/i);
    await expect(panel).not.toContainText(/KAVRAMSAL TASARIM RAPORU/i);
  });
});
