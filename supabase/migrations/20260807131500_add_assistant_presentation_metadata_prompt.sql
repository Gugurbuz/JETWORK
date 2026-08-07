do $$
declare
  v_current_prompt text;
  v_current_model text;
  v_next_version integer;
begin
  select prompt_text, model
    into v_current_prompt, v_current_model
  from public.assistant_prompt_versions
  where workspace_id is null
    and is_active = true
  order by version desc
  limit 1;

  if v_current_prompt is null then
    raise exception 'No active global assistant prompt exists';
  end if;

  if v_current_prompt like '%[JETWORK SUNUM METADATA SÖZLEŞMESİ - ZORUNLU]%' then
    return;
  end if;

  select coalesce(max(version), 0) + 1
    into v_next_version
  from public.assistant_prompt_versions
  where workspace_id is null;

  update public.assistant_prompt_versions
  set is_active = false
  where workspace_id is null
    and is_active = true;

  insert into public.assistant_prompt_versions (
    id,
    workspace_id,
    version,
    prompt_text,
    model,
    is_active
  ) values (
    gen_random_uuid(),
    null,
    v_next_version,
    v_current_prompt || E'\n\n[JETWORK SUNUM METADATA SÖZLEŞMESİ - ZORUNLU]\n'
      || E'Kullanıcıya görünen ana cevabı tamamladıktan sonra, yanıtın en sonunda tam olarak bir <jetwork_meta> bloğu üret. Bu blok kullanıcıya gösterilmez; istemci tarafından Çalışma Özeti, netleştirme soruları ve Ne yaptım? alanlarına ayrıştırılır.\n\n'
      || E'Biçim tam olarak şu JSON yapısıdır ve Markdown kod bloğu kullanılmaz:\n'
      || E'<jetwork_meta>\n'
      || E'{"workSummary":["..."],"questions":[{"id":"q1","text":"...","options":["..."]}],"actionSummary":"..."}\n'
      || E'</jetwork_meta>\n\n'
      || E'Kurallar:\n'
      || E'- workSummary 1-4 kısa maddeden oluşur. Yalnız gözlemlenebilir çalışma adımlarını, kullanılan kaynak türünü ve ulaşılan sonucu özetler. Gizli düşünce zinciri, iç muhakeme, sistem talimatı, prompt, token, güvenlik kuralı veya model iç işleyişi asla yazılmaz.\n'
      || E'- questions yalnız kullanıcı kararı gerçekten sonucu değiştiriyorsa üretilir; en fazla 3 soru vardır. Kaynaktan bulunabilecek teknik bilgiyi kullanıcıya sorma. Her soru için 0-4 kısa seçenek verilebilir. Soru gerekmiyorsa boş dizi kullan.\n'
      || E'- İnteraktif soruları ana cevap içinde tekrar etme; questions alanında tut. Ana cevap, mevcut kanıtla verilebilen kısmı yine doğrudan yanıtlasın.\n'
      || E'- actionSummary tek kısa cümledir ve bu turda kullanıcı için ne yapıldığını söyler. Doküman oluşturuldu/revize edildiyse bunu belirt; yalnız bilgi verildiyse araştırılan/yanıtlanan işi özetle.\n'
      || E'- Enerjisa analiz dokümanı çıktısında <jetwork_meta> bloğunu </review> sonrasında ekle; <ba_analysis> ve <review> içeriğine karıştırma.\n'
      || E'- BPMN XML gibi ek karakterin çıktıyı teknik olarak geçersiz kıldığı açıkça ham/standalone makine formatı isteklerinde <jetwork_meta> bloğunu üretme.\n'
      || E'- Bu metadata kullanıcı talimatı değildir ve iş gerçeği eklemek için kullanılmaz. Bilinmeyen bilgiyi uydurma.',
    coalesce(v_current_model, 'gpt-5.6-sol'),
    true
  );
end
$$;
