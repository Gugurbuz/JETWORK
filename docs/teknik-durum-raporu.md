# JetWork Teknik Durum Raporu

Tarih: 7 Haziran 2026

Bu rapor, mevcut JetWork kod tabanının GitHub uzerinden incelenmesi ve acilan hazirlik PR'lari temel alinarak hazirlanmistir.

## Ozet

JetWork, Supabase uzerinden kimlik dogrulama, proje/calisma alani yonetimi, realtime mesajlasma ve Gemini destekli BA analiz uretimi yapan bir React/Vite uygulamasidir. Urun yonu netlesmistir: ana cikti artik BA analiz / kavramsal tasarim dokumani ve review bolumudur.

Proje calisir bir prototipin otesine gecmeye baslamistir, ancak uretim guvenilirligi icin kurulum tekrarlanabilirligi, veritabani semasi, yetkilendirme, CI ve Edge Function guvenligi kritik basliklardir.

## Acik PR'lar

- PR #1 - Bootstrap setup docs and CI
  - JetWork'e ozel README.
  - `.env.example`.
  - GitHub Actions CI.
  - Edge Function origin ayari dokumantasyonu.

- PR #2 - Add Supabase baseline schema and RLS policies
  - Supabase tablo semasi.
  - RLS politikalari.
  - Username login icin `lookup_email_for_username` RPC.
  - Supabase kurulum notlari.

- PR #3 - Avoid exposing all environment variables in Vite build
  - Vite build sirasinda tum env degerlerinin tarayici bundle'ina aktarilmasini engeller.

- PR #4 - Require authenticated session for Gemini chat calls
  - Gemini Edge Function cagrilarini aktif Supabase oturumuna baglar.
  - Anon-role token ile model cagrisini engeller.
  - `ALLOWED_ORIGINS` ile CORS'u yapilandirilabilir hale getirir.

## Onerilen Merge Sirasi

1. PR #3: Env sizintisi riskini kapatir, tek dosyalik ve bagimsizdir.
2. PR #1: Kurulum dokumantasyonu ve CI zeminini ekler.
3. PR #2: Veritabani semasi ve RLS temelini ekler.
4. PR #4: Gemini Edge Function guvenligini siki hale getirir.

PR #2 ve PR #4 merge edilmeden once staging Supabase projesinde denenmelidir.

## Teknik Risk Listesi

### Yuksek Oncelik

- Supabase migration'lari staging ortaminda henuz uygulanip test edilmedi.
- `settings` tablosu icin net admin rol modeli yok. Mevcut uygulama AI prompt ayarlarini global olarak ele aliyor.
- `shared_analyses` linkleri icin expiry, sahiplik kontrolu veya signed token modeli henuz yok.
- Workspace collaborator modeli JSON email listesine dayaniyor; audit ve RLS evrimi icin normalize membership tablosu daha saglikli olur.

### Orta Oncelik

- UI icinde `alert`, `confirm`, `prompt` kullanimlari var; urun kalitesi icin modal/toast tabanli akislarla degistirilmeli.
- Sign-up ekrani email/kullanici adi ortak input kullaniyor; kayit icin email validasyonu daha net olmali.
- GitHub Actions yeni eklendi; merge sonrasinda ilk CI sonucuna gore TypeScript/lint borclari takip edilmeli.

### Dusuk Oncelik

- Eski IT/Test/FLOW alanlari tiplerde geriye donuk uyumluluk icin duruyor; veri modeli temizlik plani belirlenmeli.
- README ve teknik rapor Ingilizce/Turkce karisik dokuman yapisina evrilebilir; uzun vadede tek dokuman dili secilmeli.

## 30 Gunluk Yol Haritasi

- PR #1, #2, #3, #4 staging kontrollerinden sonra merge edilmeli.
- Supabase migration'lari staging projesinde `db push` ile denenmeli.
- `gemini-chat` function staging ortaminda oturumlu, misafir oturumlu ve oturumsuz senaryolarla test edilmeli.
- `ALLOWED_ORIGINS` production ve preview domainleri icin Supabase secret olarak ayarlanmali.
- CI ilk calisma sonucuna gore type/lint hatalari kapatilmali.

## 60 Gunluk Yol Haritasi

- `workspace_members` gibi normalize bir uyelik tablosu eklenmeli.
- `settings` icin admin rol modeli belirlenmeli ve RLS buna gore daraltilmali.
- `shared_analyses` icin expiry ve sahiplik kontrolleri uygulanmali.
- AI ayar ekrani ve dokuman paylasiminda native `prompt/confirm/alert` yerine uygulama ici modal/toast akislarina gecilmeli.

## 90 Gunluk Yol Haritasi

- BA analiz uretimi icin regression test seti olusturulmali.
- Edge Function loglama, maliyet takibi ve hata izleme eklenmeli.
- Dokuman versiyonlari icin geri yukleme ve karsilastirma akisina test kapsamı eklenmeli.
- Yetkilendirme modeli urun rolleri ve sistem rolleri olarak ayrilmali.

## Sonraki En Mantikli Is

PR'lar merge edilmeden once staging Supabase ortaminda su sirayla test yapilmali:

1. Migration uygulama.
2. Kayit olma ve username ile giris.
3. Proje/workspace olusturma.
4. Mesaj ve dokuman kaydi.
5. Gemini uretimi.
6. Paylasim linki olusturma ve okuma.
7. Realtime mesaj/dokuman guncelleme.
