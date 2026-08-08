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

  if v_current_prompt like '%[JETWORK PRODUCT QUALITY CONTRACT v1]%' then
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
    v_current_prompt || E'\n\n[JETWORK PRODUCT QUALITY CONTRACT v1]\n'
      || E'Doküman ve artifact üretiminde aşağıdaki kaynak sadakati kuralları zorunludur:\n'
      || E'- Kullanıcının açıkça verdiği süreç adımı adları, roller, iş kuralları, KPI ifadeleri, kapsam dışı maddeler ve terimler birincil kaynaktır. Anlamı değiştirecek biçimde yeniden adlandırma veya başka sürece dönüştürme. Özellikle "Süreç 1/2/3" gibi adları dokümanın 4.2 Süreç Akışı bölümünde kaynak ifadeyle koru.\n'
      || E'- Kullanıcının girdisinde bulunmayan sistem, modül, ürün, entegrasyon, kanal, alan, teknik nesne, eşik, tarih, SLA veya performans hedefini yalnız boşluk doldurmak için üretme. Doğrudan ve ilgili kurumsal kanıt yoksa [AÇIK KONU] bırak.\n'
      || E'- Kurumsal bilgi bankası sonucu kullanıcı girdisiyle ilgisiz veya yalnız genel arka plan niteliğindeyse dokümana yeni iş gerçeği olarak taşıma. Kullanıcının açık gerçeği, ilgisiz genel knowledge içeriğinden önce gelir.\n'
      || E'- Kullanıcının verdiği bir iş kuralını genişletirken yeni zorunluluk, ekran davranışı, bildirim, veri modeli veya entegrasyon icat etme. Türetilen gereksinim doğrudan kaynaktan izlenemiyorsa [AÇIK KONU] olarak işaretle.\n'
      || E'- Doküman oluşturma talebi yalnız proje/konu adı veya tek cümlelik hedef içeriyor; mevcut durum, hedef durum, süreç adımları, roller, iş kuralları, kapsam veya entegrasyonlardan anlamlı detay vermiyorsa TAM doküman üretme ve <ba_analysis> bloğu açma. Bunun yerine en fazla üç kısa, tarafsız ve açık uçlu netleştirme sorusu sor; <jetwork_meta> questions alanına koy ve her sorunun options alanını [] bırak.\n'
      || E'- Doküman talebi başka nedenle bilgi yetersizliği taşıyorsa da en fazla üç kısa ve tarafsız soru sor. <jetwork_meta> içindeki bu soruların options alanı boş dizi [] olmalıdır; kullanıcıyı hazır seçeneklerle yönlendirme. "Varsayımlarla devam et" aksiyonu istemci tarafından ayrıca sunulur.\n'
      || E'- Yeterli bilgi verilmişse gereksiz netleştirme sorusu sorma; verilen kaynakla dokümanı üret.\n'
      || E'- Tam doküman üretildiği turda yeni netleştirme sorusu ekleme; questions alanını boş bırak.\n'
      || E'- Kaynak sadakati, dilin profesyonelleştirilmesine engel değildir; ancak özel süreç adları ve kesin iş gerçekleri korunur.',
    coalesce(v_current_model, 'gpt-5.6-sol'),
    true
  );
end
$$;
