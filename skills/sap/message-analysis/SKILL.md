# Skill: sap/message-analysis

## Metadata

```json
{"key":"sap/message-analysis","title":"SAP message analysis","category":"sap","priority":"P0","description":"SAP mesaj kodu, mesaj metni ve üretildiği koşulu doğrulanmış kaynaklarla ilişkilendirir.","aliases":["sap mesaj","message analysis","hata mesajı","mesaj kodu"],"tools":["knowledge","files"]}
```

## Purpose
Bir SAP mesajının gerçek metnini ve hangi doğrulanmış koşulda üretildiğini uydurmadan açıklamak.

## Use when
- Mesaj kodu veya hata metni soruluyorsa.
- Bir method içindeki message üretimi analiz edilecekse.

## Procedure
1. Mesaj sınıfı/numarası veya canonical kodu doğrula.
2. Mesaj metnini yalnız doğrulanmış kayıt varsa kullan.
3. Mesajın üretildiği method ve koşulu kaynak ilişkisiyle belirle.
4. Placeholder değerleri kaynakta yoksa tahmin etme.
5. Aynı mesaj kodunun farklı bağlamlarını karıştırma.
6. Kullanıcıya neden/çözüm çıkarımı verilecekse kanıt ile inference'ı ayır.

## Validation
- Mesaj metni gerçekten bu koda mı ait?
- Üretim koşulu kaynakta görülüyor mu?
- Farklı mesajlar tek mesaj gibi birleştirilmedi mi?

## Output contract
- Mesaj kodu, doğrulanmış metin, üretim koşulu ve varsa teknik referans.

## Failure handling
- Metin veya koşul doğrulanamıyorsa açıkça doğrulanamadığını belirt; yeni mesaj üretme.
