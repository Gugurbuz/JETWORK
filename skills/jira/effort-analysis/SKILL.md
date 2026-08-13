# Skill: jira/effort-analysis

## Metadata

```json
{
  "key": "jira/effort-analysis",
  "title": "Jira effort analysis",
  "category": "jira",
  "priority": "P1",
  "description": "Jira efor alanlarını birim, issue type, kişi/ekip ve dönem kırılımında kontrollü biçimde analiz eder.",
  "aliases": ["jira efor", "original estimate", "efor dağılımı", "effort analysis"],
  "tools": ["jira", "spreadsheet", "python"]
}
```

## Purpose
Original Estimate veya benzeri efor alanlarını sayı olarak toplamanın ötesinde doğru birim ve kapsamla yorumlamak.

## Use when
- Proje, ürün, support veya faaliyet türüne göre efor dağılımı isteniyorsa.
- Jira exportunda estimate alanları analiz edilecekse.

## Do not use when
- Kaynak yalnız story point içeriyor ve kullanıcı insan/gün gibi başka birime dönüşüm istemiyorsa; birimler karıştırılmamalı.

## Procedure
1. Kullanılan efor alanını ve birimini belirle: saniye, saat, gün, story point veya custom field.
2. Boş ile sıfır değeri ayrı değerlendir.
3. Issue duplicate veya parent-child double count riskini kontrol et.
4. İstenen kategoriyi kaynak alanlardan veya doğrulanmış sınıflandırma kuralından üret.
5. Toplam, ortalama ve medyan gibi metrikleri amaca göre seç; tek metrikle sonucu genelleme.
6. Kişi/ekip bazlı kırılımda aynı işin ortak sahipliğini doğru ele al.
7. Sonuç toplamlarını ham efor toplamıyla reconcile et.

## Validation
- Birimler karıştı mı?
- Parent ve sub-task aynı eforu iki kez sayıyor mu?
- Boş estimate sıfır gibi gösterildi mi?
- Kategori toplamları grand total ile eşleşiyor mu?

## Output contract
- Efor toplamları ve istenen kırılımlar; kullanılan birim ve kapsam açıkça belirtilir.

## Failure handling
- Birim veya alan semantiği belirsizse dönüşüm uydurma; ham değeri koruyup belirsizliği belirt.
