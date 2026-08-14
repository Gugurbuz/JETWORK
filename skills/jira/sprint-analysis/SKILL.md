# Skill: jira/sprint-analysis

## Metadata

```json
{
  "key": "jira/sprint-analysis",
  "title": "Jira sprint analysis",
  "category": "jira",
  "priority": "P1",
  "description": "Sprint kapsamını durum, tamamlanma, carry-over, eklenen iş ve temel efor metrikleriyle analiz eder.",
  "aliases": ["sprint analiz", "sprint özeti", "carry over", "sprint performans"],
  "tools": ["jira", "spreadsheet", "python"]
}
```

## Purpose
Bir sprintin ne kadar iş bitirdiğini değil, kapsam hareketi ve kalan işlerle birlikte ne olduğunu açıklamak.

## Use when
- Sprint kapanışı veya yönetim özeti hazırlanacaksa.
- Carry-over ve tamamlanma dağılımı incelenecekse.

## Do not use when
- Birden fazla sprint boyunca trend isteniyorsa ayrıca velocity/roadmap analizi gerekir.

## Procedure
1. Sprint kapsamındaki benzersiz issue setini belirle.
2. Status değerlerini normalize ederek tamamlanan ve kalan işleri ayır.
3. Sprint başladıktan sonra eklenen/çıkarılan işler için veri varsa scope change olarak ayrı göster.
4. Carry-over kayıtlarını önceki ve sonraki sprint bilgisiyle belirle.
5. Issue sayısı ve varsa efor ölçülerini ayrı raporla; birbirinin yerine kullanma.
6. En büyük kalan iş veya blocker kümelerini konu/epic bazında grupla.
7. Sonucu suçlayıcı dil yerine gözlenebilir kapsam ve akış verisiyle açıkla.

## Validation
- Aynı issue birden fazla kez sayılmadı mı?
- Done tanımı normalize status kuralıyla uyumlu mu?
- Sprint dışına çıkan işler başarısızlık gibi sayılmadan scope change olarak ayrıldı mı?
- Efor toplamları doğru birimde mi?

## Output contract
- Sprint özeti, tamamlanan/kalan kapsam, carry-over ve önemli gözlemler.

## Failure handling
- Sprint başlangıç kapsamı bilinmiyorsa scope-change oranı uydurma; yalnız mevcut snapshot ile doğrulanabilen metrikleri ver.
