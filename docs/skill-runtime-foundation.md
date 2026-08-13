# JetWork Skill Runtime Foundation

## Karar

JetWork, sağlayıcıya özel bir skill formatına kilitlenmeyecek. Canonical skill kaynağı repo içindeki `skills/**/SKILL.md` dosyaları olacak ve mevcut OpenAI Responses + Gemini runtime'ına iki küçük model-facing capability ile bağlanacak:

- `search_skills`
- `load_skills`

Bu iki tool yalnız prosedür keşfi/materialization içindir. Kurumsal gerçekleri doğrulamaz ve citation kaynağı değildir.

## Neden doğrudan provider-native skill'e geçmiyoruz?

OpenAI Agents SDK'nin Sandbox Agent katmanında `skills()` capability'si ve lazy skill source desteği vardır; ancak bu Sandbox Agents yüzeyidir ve beta durumundadır. JetWork'un mevcut production çekirdeği doğrudan OpenAI Responses API + Gemini sağlayıcı adaptörü + Supabase Edge yaşam döngüsü kullanır. Tüm runtime'ı sandbox-agent mimarisine taşımak skill foundation için gereksiz bir migration riski yaratır.

Google tarafında agent/coding-agent ekosisteminde skill paketleri vardır, ancak JetWork'un kullandığı Gemini API çağrısında OpenAI Sandbox Agents'taki `skills()` ile aynı provider-native runtime kontratına güvenmiyoruz. Bu nedenle ortak JetWork kontratı provider parity sağlar.

## Hedef akış

```text
User turn
   |
Primary LLM (OpenAI or Gemini)
   |
   +-- trivial/general task ----------------------> answer
   |
   +-- specialized workflow
          |
          +-- search_skills(query)
          +-- load_skills(keys)
          |
          +-- normal JetWork capabilities
                 +-- knowledge/RAG (facts/evidence)
                 +-- web (fresh external evidence)
                 +-- file/artifact tools
          |
          +-- validation from loaded skill
          |
          +-- answer/artifact
```

## Ayrım: skill vs knowledge

| Katman | Soru | Güven modeli |
|---|---|---|
| Skill | “Bu işi nasıl yapmalıyım?” | JetWork tarafından versionlanan trusted procedure |
| Knowledge/RAG | “Kurumda gerçek durum nedir?” | Published, verified evidence |
| Web | “Dış dünyada güncel gerçek nedir?” | Kaynak/citation gerektirir |
| Model reasoning | “Bu bilgilerden ne sonuç çıkar?” | Çıkarım, evidence ile sınırlandırılır |

Skill sonucu `sources: []`, `proceduralOnly: true`, `citationReady: false` döndürür. Böylece mevcut grounding guard skill metnini kurumsal kanıt sanmaz.

## Ölçekleme

140 skill tek prompta konmayacak. Model yalnız iki küçük discovery tool şemasını görür. Arama sonucu metadata döner; tam skill metni yalnız `load_skills` çağrısında context'e girer. Bir turda en fazla 4 skill materialize edilir.

Bu yaklaşım:

- token maliyetini sınırlar,
- global prompt şişmesini önler,
- skill sürümleme/testini bağımsızlaştırır,
- OpenAI/Gemini provider parity sağlar,
- ileride OpenAI Sandbox `skills()` veya başka native capability'ye adapter yazılmasına izin verir.

## Foundation kapsamı

İlk P0 runtime registry:

- `spreadsheet/inspect`
- `spreadsheet/table-join`
- `spreadsheet/format-preserve`
- `spreadsheet/quality-check`
- `jira/export-analysis`
- `jira/latest-sprint`

Bunlar kullanıcının verdiği gerçek Excel + Jira mapping örneğini uçtan uca kapsayan ilk vertical slice'tır.

## Sonraki runtime wiring

1. `ASSISTANT_SKILL_TOOLS` her non-final model round'unda kullanılabilir olacak.
2. Knowledge tools yalnız bilgi gerektiğinde mevcut politikasını koruyacak.
3. Skill tool çağrıları mevcut tool audit ledger'a `proceduralOnly` özetiyle yazılacak.
4. Kullanıcı UI'sında skill çağrısı kaynak sayacına eklenmeyecek.
5. Provider parity ve regression testleri eklenecek.
6. Daha sonra canonical `SKILL.md` dosyalarından edge registry üreten build/check adımı eklenecek.
