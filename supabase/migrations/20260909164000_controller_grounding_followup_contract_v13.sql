-- Controller grounding/follow-up contract v13.
-- The Controller remains the sole semantic authority. This prompt contract does
-- not choose tools or routes; it makes the current-turn evidence boundary explicit
-- so provider continuation/memory cannot be mistaken for citation-ready evidence.

do $$
declare
  current_prompt public.assistant_prompt_versions%rowtype;
  next_version integer;
  contract_text text := E'\n\n[JETWORK CURRENT-TURN GROUNDING CONTRACT v1 — ACTIVE]\n- Önceki konuşma, provider continuation ve önceki asistan cevabı referenti anlamak için bağlamdır; ancak bu turdaki kurum-özel teknik iddianın citation-ready kanıtı sayılmaz.\n- Kısa/eksik bir follow-up önceki teknik nesneye açıkça referans veriyorsa referenti konuşma bağlamından çöz. Fakat final cevapta teknik identifier, mesaj, fonksiyon, tablo, alan veya exact davranış söylemeden önce bu turda uygun Jetbase knowledge capability ile ilgili kanıtı yeniden doğrula. Araç seçimini sen yaparsın.\n- Mevcut turda citation-ready tool observation içinde görünmeyen yeni teknik identifier üretme. Hatırladığın ama bu turda doğrulanmamış identifier yerine ilgili knowledge capabilityyi çağır veya doğrulanamayan kısmı açıkça belirt.\n- Kullanıcı yalnız bir metodun ürettiği mesajları soruyorsa, gerekli mesaj listesini doğrulanmış relation/source kanıtından ver. Cevabı zenginleştirmek için doğrulanmamış alan, değişken, tablo veya koşul adı ekleme.\n- Exhaustive/çok kayıtlı cevapta her ek teknik ayrıntının faydasını kanıt maliyetiyle tart. Kullanıcı istemediyse message code listesini gereksiz implementasyon tahminleriyle genişletme.\n- Bu kurallar ikinci planner veya deterministik semantic router değildir. Sıradaki capability, araştırma ve final cevap kararları Controller LLM\u2019e aittir; runtime yalnız mekanik doğrulama yapar.\n';
begin
  select * into current_prompt
  from public.assistant_prompt_versions
  where workspace_id is null and is_active
  order by version desc
  limit 1
  for update;

  if current_prompt.id is null then
    raise exception 'No active global assistant prompt found';
  end if;

  if position('[JETWORK CURRENT-TURN GROUNDING CONTRACT v1 — ACTIVE]' in current_prompt.prompt_text) = 0 then
    select coalesce(max(version), 0) + 1 into next_version
    from public.assistant_prompt_versions
    where workspace_id is null;

    update public.assistant_prompt_versions
    set is_active = false
    where workspace_id is null and is_active;

    insert into public.assistant_prompt_versions (
      workspace_id, version, prompt_text, model, is_active, created_by
    ) values (
      null,
      next_version,
      current_prompt.prompt_text || contract_text,
      current_prompt.model,
      true,
      current_prompt.created_by
    );
  end if;
end $$;

-- Architectural test alignment: this assertion belonged to the retired
-- deterministic-authoritative-terminal path. Keep the substantive content,
-- source-canonical, cost and model-call assertions; remove only the obsolete
-- mechanism assertion so the gate validates the current Controller architecture.
delete from public.ai_quality_assertions a
using public.ai_quality_scenarios s
where a.scenario_id = s.id
  and s.slug = 'abap-short-message-111'
  and a.kind = 'usage_gte'
  and a.field = 'deterministic_authoritative_terminal';
