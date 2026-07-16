import type { DocumentData } from '../types';

export const CANONICAL_CONCEPTUAL_SECTIONS = [
  'KAVRAMSAL TASARIM RAPORU',
  'PROJE KIMLIK KARTI',
  'Amac',
  'Dokuman Tarihcesi',
  'Katilimcilar',
  'Revize tarih',
  'Kontrol EDEN VE ONAYLAYAN',
  'ICINDEKILER',
  'SUREC TASARIMI',
  'SUREC MODELI',
  'Ust Duzey Surec Aciklamasi',
  'Surec degisiklikleri',
  'Is Gerekleri ve KPIs',
  'Detayli Surec Akisi',
  'Akis Diyagrami',
  'Ilgili Surecler',
  'Ust Duzey Musteri Gelistirmesi',
  'Onemli Uyarlamalar ve Amaclari',
  'Degisim Yonetimi',
  'EK A',
  'ILGILI / REFERANS DOKUMANLAR',
  'EKLENTI',
] as const;

export const CONCEPTUAL_TEMPLATE_PROMPT = `
[KURUMSAL KAVRAMSAL TASARIM DOKUMANI - TEK SABLON SOZLESMESI]
Bu sozlesme yalniz conceptual_design profillerinde uygulanir. Baslik adlarini ve sirasini koru.

businessAnalysis.content baslik sirasi:
1. KAVRAMSAL TASARIM RAPORU
2. PROJE KIMLIK KARTI
3. Amac
4. Dokuman Tarihcesi
   - Katilimcilar
   - Revize tarih
   - Kontrol EDEN VE ONAYLAYAN
5. ICINDEKILER
6. SUREC TASARIMI
7. Kaynakta belirlenen her ana surec icin SUREC MODELI blogu
   - Ust Duzey Surec Aciklamasi
   - Surec degisiklikleri
   - Is Gerekleri ve KPIs
   - Detayli Surec Akisi
   - Akis Diyagrami
   - Ilgili Surecler
   - Ust Duzey Musteri Gelistirmesi
   - Onemli Uyarlamalar ve Amaclari
   - Degisim Yonetimi
8. EK A
   - ILGILI / REFERANS DOKUMANLAR
   - EKLENTI

Kaynak ve derinlik kurallari:
- Baslik iskeletini koru; proje gerceklerini sadece kullanici mesaji, ekli kaynak, sohbet gecmisi, proje hafizasi ve dogrulanmis arastirmadan turet.
- Kaynakta olmayan proje, kisi, rol, sistem, ekran, surec, entegrasyon, KPI, esik, tarih veya teknik urun adi uydurma.
- Surec blogu sayisini sabit minimumla belirleme. Kaynakta kac ayri ana surec varsa o kadar blok uret.
- Kaynak surec tanimlamiyorsa genel surec adlari uydurma. SUREC MODELI bolumunde eksigi [ACIK KONU] olarak kaydet.
- Bir kaynak sureci varsa onu aktor, tetikleyici, on kosul, ana akis, alternatif akis, istisna, is kurali, veri, ekran, entegrasyon ve kapanis sonucu seviyesinde analiz et.
- Gereksinim veya KPI satir sayisini sabitleme. Talebin kapsamini karar verilebilir hale getirecek kadar madde yaz.
- Sayisal KPI hedefi kaynakta yoksa metrik adini yaz; hedef degerini ve sahibini [ACIK KONU] birak.
- Katilimci ve onay tablolarinda gercek isim veya rol verilmediyse sahte kisi/rol doldurma; ilgili hucreyi [ACIK KONU] yap.
- Teknik analiz, veri, entegrasyon, ekran, validasyon, hata davranisi, NFR ve UAT ayrintilarini ilgili surec blogunda yalniz talep gerektiriyorsa yaz.
- Her kritik iddiayi DOGRULANDI, CIKARIM, VARSAYIM veya ACIK KONU durumuyla izlenebilir tut.
- Review bolumu kaynak ve kanit durumunu, celiskileri, riskleri, varsayimlari ve acik kararlari raporlar; yeni is gercegi uretmez.
`.trim();

function normalize(value = ''): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/\s+/g, ' ')
    .trim();
}

export function conceptualTemplateCoverage(content = ''): {
  missing: string[];
  passed: number;
  total: number;
} {
  const normalized = normalize(content);
  const missing = CANONICAL_CONCEPTUAL_SECTIONS
    .filter(section => !normalized.includes(normalize(section)));
  return {
    missing: [...missing],
    passed: CANONICAL_CONCEPTUAL_SECTIONS.length - missing.length,
    total: CANONICAL_CONCEPTUAL_SECTIONS.length,
  };
}

export function isConceptualTemplateCompliant(content = ''): boolean {
  return conceptualTemplateCoverage(content).missing.length === 0;
}

/**
 * Backward-compatible read-only boundary. Repair requires an explicit AI turn,
 * a previewed diff and user confirmation before persistence.
 */
export function ensureConceptualTemplateStructure(document: DocumentData): DocumentData {
  return document;
}
