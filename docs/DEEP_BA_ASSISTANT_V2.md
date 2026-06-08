# Deep BA Assistant v2

Bu sprintin hedefi JetWork sohbetini basit soru-cevap taslagindan, kaynakli ve karar verilebilir BA/kavramsal tasarim ureten asistana tasimaktir.

## Davranis Hedefi

- Kisa ama alan bilgisi tasiyan talepleri tanir: `sap crm iys entegrasyonu`, mevzuat, API, entegrasyon, KVKK/GDPR, e-belge, SSO gibi basliklar.
- Kullanici "varsayimlarla ilerle", "devam et", "daha fazla soru sorma" dediginde yeni soru sormaz; eksikleri `[VARSAYIM]` ve `Açık Sorular` olarak dokumana tasir.
- Teknik analiz, test ve akis detaylarini eski gizli `code/test/bpmn` bolumlerine zorlamaz; gorunur `BA Analiz` dokumani icinde alt baslik olarak yazar.
- Review sekmesinde kaynak/dogrulama ozeti, riskler, acik kararlar ve kalite kapisi notu uretir.

## SAP CRM - IYS Referans Senaryosu

`sap crm iys entegrasyonu ba analiz kavramsal tasarim dokumani` talebinde derin mod su konu basliklarini zorunlu kontrol listesine alir:

- IYS onay/ret bildirimi ve 3 is gunu aktarim kuralinin kaynakla dogrulanmasi
- Kanal bazli izin modeli: `MESAJ/SMS`, `EPOSTA`, `ARAMA`
- API/kavramsal alanlar: `recipient`, `recipientType`, `source`, `consentDate`, `status`
- Marka kodu, alici tipi, initial load, gunluk delta/mutabakat
- SAP CRM -> Middleware -> IYS entegrasyon mimarisi
- Hata, retry, audit, loglama, veri temizligi ve operasyonel raporlama

## Aktif Kod Noktalari

- `src/modules/deep-ba-assistant/index.ts`: derin BA tetikleyicileri, arastirma plani, dokuman talimati ve soru parser'i.
- `src/services/baAgentLoop.ts`: derin modun plan, arastirma ve dokuman yazma adimlarina baglanmasi.
- `src/services/singleChatOrchestrator.ts`: zorunlu taslak uretiminde eski `code/test/bpmn` baskisinin kaldirilmasi.
- `src/services/ai/intentClassifier.ts`: SAP CRM - IYS gibi kisa entegrasyon taleplerinde konuya ozel soru kartlari ve research sinyali.
- `scripts/verify-deep-ba-assistant.ts`: model cagirmadan deterministik davranis dogrulama.

## Dogrulama

```bash
npm run verify:ai-ba-engine
npm run verify:deep-ba-assistant
npm run lint
npm run build
```

`verify:deep-ba-assistant` su davranislari kontrol eder:

- SAP CRM + IYS talebi derin BA modunu aciyor.
- Arastirma sorgulari 3 is gunu ve IYS API alanlarini kapsiyor.
- Zorunlu taslak akisi yeni soru sormadan BA agent loop'a gidiyor.
- Kisa SAP CRM + IYS talebinde genel sorular yerine konuya ozel IYS kanal/marka/middleware sorulari geliyor.
- Soru secenekleri arayuz kartlarina kaybolmadan tasinabiliyor.
