# Skill: spreadsheet/deduplicate

## Metadata

```json
{
  "key": "spreadsheet/deduplicate",
  "title": "Spreadsheet deduplicate",
  "category": "spreadsheet",
  "priority": "P1",
  "description": "Duplicate kayıtları anahtar ve iş kurallarına göre tespit eder, hangi kaydın korunacağını deterministik biçimde belirler.",
  "aliases": ["duplicate sil", "tekilleştir", "deduplicate", "mükerrer kayıt"],
  "tools": ["spreadsheet", "python", "openpyxl"]
}
```

## Purpose
Mükerrer kayıtları veri kaybı yaratmadan tekilleştirmek.

## Use when
- Aynı JIRA No/ID birden fazla satırda bulunuyorsa.
- Rapor veya join öncesi duplicate kayıtlar sonucu şişiriyorsa.

## Do not use when
- Aynı anahtarın birden fazla satırda bulunması iş modelinin doğal parçasıysa; önce grain seviyesini belirle.

## Procedure
1. Tablo grain'ini ve duplicate anahtarını açıkça tanımla.
2. Exact duplicate ile aynı anahtarlı fakat içerikçe farklı kayıtları ayır.
3. Korunacak kayıt için deterministik kural belirle: en güncel tarih, aktif durum, doluluk veya kullanıcı kuralı.
4. Çelişkili kayıtlarda alan bazlı merge yapmadan önce anlamı doğrula.
5. Silinecek/elenen kayıtların sayısını ve anahtarlarını logla.
6. Tekilleştirme sonrası satır ve unique key sayılarını karşılaştır.

## Validation
- Doğal one-to-many ilişki yanlışlıkla tekilleştirilmedi mi?
- Kazanan kayıt kuralı her duplicate grupta aynı biçimde uygulandı mı?
- Çelişkili değerler sessizce kaybolmadı mı?

## Output contract
- Tekilleştirilmiş tablo ve duplicate özeti; gerekiyorsa elenen kayıtlar ayrı liste.

## Failure handling
- Kazanan kayıt için güvenilir kural yoksa silme yapma; duplicate grubunu kullanıcı incelemesine bırak.
