from pathlib import Path

policy = Path('supabase/functions/_shared/agent/controllerPolicy.ts')
s = policy.read_text()
needle = "  'Ham kullanıcı kelimelerini bağlamdan koparıp genel sözlük sorusu gibi ele alma. Aktif sistem/kurum/çalışma bağlamı terimlere makul bir alan anlamı veriyorsa önce o anlamı hipotez olarak kur ve gerekiyorsa doğrula. Bu hipotez kesin gerçek değildir; kanıt geldikçe güçlenir, değişir veya reddedilir.',\n"
insert = needle + "  'Tanım veya kısaltma sorularında verified kurumsal evidence terimin kurum içi kullanımını doğruluyor fakat literal açılımı doğrudan yazmıyorsa bunu otomatik olarak \\\"açılım bilinmiyor\\\" sonucuna çevirme. Kullanıcının sorduğu terim için yüksek güvenli standart sektör/genel açılımını biliyorsan açılımı cevabın başında ver; daha uzun resmi varyant varsa ayrıca belirt. Bu model bilgisini kurumsal kaynağın açık ifadesiymiş gibi sunma; standart/genel açılım ile verified kurumsal kullanım kanıtını ayır. Güven düşükse yeni kanıt ara veya belirsizliği söyle.',\n"
if s.count(needle) != 1:
    raise SystemExit(f'expected one insertion anchor, got {s.count(needle)}')
s = s.replace(needle, insert, 1)
policy.write_text(s)

test = Path('src/services/__tests__/controllerAcronymDefinitionPolicyV5.test.ts')
test.write_text("""import { readFileSync } from 'node:fs'\nimport { describe, expect, it } from 'vitest'\n\nconst policySource = readFileSync(\n  new URL('../../../supabase/functions/_shared/agent/controllerPolicy.ts', import.meta.url),\n  'utf8',\n)\n\ndescribe('Controller acronym definition policy V5', () => {\n  it('separates high-confidence standard expansion from verified enterprise usage', () => {\n    expect(policySource).toContain('literal açılımı doğrudan yazmıyorsa bunu otomatik olarak')\n    expect(policySource).toContain('yüksek güvenli standart sektör/genel açılımını biliyorsan açılımı cevabın başında ver')\n    expect(policySource).toContain('standart/genel açılım ile verified kurumsal kullanım kanıtını ayır')\n    expect(policySource).toContain('Güven düşükse yeni kanıt ara veya belirsizliği söyle')\n  })\n\n  it('does not hard-code the LRT acceptance answer or route', () => {\n    expect(policySource).not.toContain('Last Resort Tariff')\n    expect(policySource).not.toContain('CHECK_LRTV3')\n    expect(policySource).not.toContain("if (term === 'LRT')")\n  })\n})\n""")
