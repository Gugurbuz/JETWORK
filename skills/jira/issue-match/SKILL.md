# Skill: jira/issue-match

## Metadata

```json
{
  "key": "jira/issue-match",
  "title": "Jira issue matching",
  "category": "jira",
  "priority": "P0",
  "description": "JIRA No değerlerini farklı dosya ve raporlarda standartlaştırarak güvenli exact eşleştirme için hazırlar.",
  "aliases": ["jira no eşleştir", "issue match", "jira map", "jira numarası"],
  "tools": ["spreadsheet", "python"]
}
```

## Purpose
JIRA No değerlerini `ABC-123` gibi standart biçime getirerek dosyalar arası mapping hatalarını azaltmak.

## Use when
- JIRA No başka tabloyla eşleştirilecekse.
- Değerlerde boşluk, ek açıklama veya farklı case varsa.

## Do not use when
- Ortak alan JIRA No değilse; uygun spreadsheet join skill'ini kullan.

## Procedure
1. Ham JIRA No kolonunu belirle ve orijinal değeri koru.
2. Hücredeki ek metinden yalnız geçerli Jira biçimindeki değeri ayır.
3. Baştaki/sondaki boşlukları temizle ve proje bölümünü standart case'e getir.
4. Aynı satırda birden fazla JIRA No varsa çoklu değer olarak ayrıştır.
5. Geçersiz biçimleri `invalid` olarak işaretle; yeni numara uydurma.
6. Standart değerler üzerinde duplicate dağılımını kontrol et.

## Validation
- Proje bölümü veya issue numarası kesilmedi mi?
- Ek metindeki başka sayılar JIRA No sanılmadı mı?
- Çoklu değerler kaybolmadı mı?
- Duplicate değerler görünür mü?

## Output contract
- Standart JIRA No ve gerekiyorsa `invalid/multiple` durum bilgisi.

## Failure handling
- Güvenilir JIRA No belirlenemiyorsa satırı unmatched bırak.
