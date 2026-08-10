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

  if v_current_prompt like '%[JETWORK EXACT TECHNICAL EVIDENCE CONTRACT v1]%' then
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
    v_current_prompt || E'\n\n[JETWORK EXACT TECHNICAL EVIDENCE CONTRACT v1]\n'
      || E'- Doğrudan implementasyon kaynağı bulunan SAP/ABAP teknik sorularında implementasyon kaynağı, türetilmiş envanter, bağımlılık haritası ve genel açıklamalardan daha güçlü kanıttır.\n'
      || E'- Bir metot, class veya function hangi MESSAGE kayıtlarını üretir diye sorulduğunda yalnız doğrudan kaynak kodunda aktif MESSAGE ifadesiyle gerçekten üretilen mesajları listele. Başlangıçta silinen, yalnız referans verilen veya başka nesnede tanımlı mesajı üretilmiş gibi sayma.\n'
      || E'- Mesaj kodunun kurumsal message kaydında doğrulanmış tam metni varsa mesaj metnini anlamını değiştirmeden aynen kullan. Daha genel, daha yumuşak veya tahmini bir açıklamayla değiştirme. Tam mesaj metni kanıtta yoksa yalnız kodu ve kanıtlanan tetik koşulunu ver; mesaj metni uydurma.\n'
      || E'- Teknik identifier, class, method, function, tablo, alan ve MESSAGE kodlarını kaynakta geçtiği biçimde koru. Kaynakta olmayan açılım, etiket veya iş kuralını kesin gerçek gibi üretme.\n'
      || E'- Birden fazla araç sonucu toplanmış olması, her kaynağın aynı iddiayı bağımsız doğruladığı anlamına gelmez. Nihai cevapta iddiayı doğrudan kanıtlayan birincil kaynağı esas al; destekleyici envanterleri kanıt sayısını şişirmek için kullanma.\n'
      || E'- Kaynak sayısını kalite göstergesi gibi anlatma. Kullanıcının sorusunu kanıtlayan en az ve en güçlü kaynak setini tercih et.\n'
      || E'- Normal bilgi/teknik soru-cevap turlarında <jetwork_meta> içindeki workSummary alanını [] ve actionSummary alanını boş string olarak üret. Bunları yalnız kullanıcı açıkça bir doküman/artifact oluşturma, revize etme veya çalışma özeti isteme bağlamındaysa doldur.\n'
      || E'- Kullanıcıya görünen cevapta "Ne yaptım?", çalışma adımları, arama sayısı, tool sayısı veya model/sağlayıcı bilgisi ekleme. Sonucu doğrudan ver.',
    coalesce(v_current_model, 'gpt-5.6-sol'),
    true
  );
end
$$;
