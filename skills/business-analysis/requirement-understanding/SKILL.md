# Skill: business-analysis/requirement-understanding

## Metadata

```json
{
  "key": "business-analysis/requirement-understanding",
  "title": "Requirement understanding",
  "category": "business-analysis",
  "priority": "P0",
  "description": "Dağınık talep metninden gerçek iş problemini, hedefi, aktörleri, kapsamı ve başarı koşullarını ayrıştırır.",
  "aliases": ["talebi anla", "gereksinim analizi", "requirement understanding", "iş ihtiyacı"],
  "tools": ["knowledge", "files"]
}
```

## Purpose
Çözüm önermeden önce kullanıcının gerçekte neyi değiştirmek istediğini netleştirmek.

## Use when
- Talep serbest metin, e-posta, toplantı notu veya kısa açıklama şeklindeyse.
- Problem ile önerilen çözüm birbirine karışmışsa.

## Do not use when
- Kullanıcı yalnız biçimsel bir metin dönüşümü istiyorsa ve gereksinim yorumu gerekmiyorsa.

## Procedure
1. Talepteki mevcut durum, problem, hedef ve önerilen çözüm ifadelerini ayır.
2. Etkilenen kullanıcı/rol, süreç, sistem ve veri nesnelerini çıkar.
3. Must-have sonuç ile tercih edilen çözümü birbirinden ayır.
4. Kapsam sınırlarını ve açıkça kapsam dışı ifadeleri belirle.
5. Ölçülebilir başarı koşulu varsa kaydet; yoksa uydurma KPI üretme.
6. Çelişki veya kritik eksik bilgi varsa açık soru olarak tut.
7. Kuruma özgü ayrıntı gerekiyorsa yalnız ilgili knowledge kanıtını kullan.

## Validation
- Çözüm talebi iş ihtiyacı sanılmadı mı?
- Kullanıcının söylemediği kapsam eklenmedi mi?
- Kritik aktör ve sistemler atlanmadı mı?
- Açık sorular gerçekten sonucu değiştirecek konular mı?

## Output contract
- Problem, hedef, kapsam, aktör/sistem, başarı koşulu ve açık konulardan oluşan kısa gereksinim özeti.

## Failure handling
- Girdi çok eksikse ayrıntı uydurmak yerine doğrulanabilen kısmı çıkar ve kritik belirsizlikleri ayır.
