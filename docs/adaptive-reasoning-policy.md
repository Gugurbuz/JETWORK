# JETWORK Adaptif Muhakeme Politikası

## Amaç

JETWORK her talebe aynı sabit analiz şablonunu uygulamaz. `AiTurnDecision` final aksiyonun ve artifact profilinin tek karar otoritesi olmaya devam eder. Adaptif muhakeme politikası yalnızca bu kararın hangi inceleme hareketleriyle ve hangi sırayla yürütüleceğini belirler.

## Seçilebilir yetenekler

1. Problemi bağlama göre parçalama
2. Bağımlı adım planı
3. Kanıtlanabilir hipotezler
4. Alternatif ve karar desteği
5. Çelişki ve bilgi boşluğu analizi
6. Koşul ve kısıt takibi
7. Mantıksal ve sayısal doğrulama
8. Kod ve davranış teşhisi
9. Kaynaklar arası sentez
10. Çoklu ortam kanıt sentezi
11. Agentic yürütme disiplini
12. Bağımsız sonuç eleştirisi

Basit sohbet turunda bu yetenekler zorla etkinleştirilmez. Entegrasyon, hata analizi, karar desteği, sayısal kural, kod inceleme veya doküman üretimi gibi sinyaller ilgili yetenekleri seçer.

## Çalışma akışı

1. `buildAdaptiveReasoningPlan` kullanıcı mesajı, yakın konuşma, mevcut doküman, bilgi kaynağı sayısı ve `AiTurnDecision` üzerinden gerekli yetenekleri seçer.
2. Seçilen yetenekler bir DAG olarak sıralanır. Her adım yalnız tamamlanmış ön koşullara bağlanabilir.
3. `runBaAgentLoop` bu planı PLAN → RESEARCH → REFLECT → ACT hattında modele çalışma sözleşmesi olarak verir.
4. Kullanıcı soruları üç seviyeye ayrılır:
   - Bloke eden: çözüm yönünü veya pahalı bir kararı değiştirir.
   - Varsayılabilir: geri dönüşü kolaydır ve açıkça etiketlenebilir.
   - Ertelenebilir: ilk karar için zorunlu değildir, açık konu olarak tutulur.
5. Üretimden sonra `evaluateAdaptiveReasoningCritique` çıktıyı ilk üretimden bağımsız, salt-okunur kurallarla kontrol eder.
6. Kritik critic bulguları kalite kapısının yayın kararını engeller; uyarılar kalite bulgularına eklenir. Critic doküman metnini kendiliğinden onarmaz.

## Kritik sözleşmeler

- Hipotez analizi: Her olası neden için kontrol yöntemi ve beklenen kanıt gerekir.
- Alternatif değerlendirme: Ortak ölçütlerle karşılaştırma ve gerekçeli öneri gerekir.
- Kısıt takibi: Kaynaktaki eski kayıt ve yetki ayrımları çıktıda korunur.
- Sayısal muhakeme: Kaynak eşikleri, sınır değerleri ve sayısal kurallar kaybolamaz.
- Kod teşhisi: Amaç, gerçek davranış, iş ihtiyacı, yan etki ve test yolu birlikte ele alınır.
- Kaynak sentezi: Kritik iddialar yapısal kanıt durumlarıyla izlenir.
- Critic: Kalite kapısı kapsam, çelişki, istisna, test edilebilirlik ve kaynak sadakatini değerlendirir; Review bölümü bu bulguların görünür kaydıdır.

## Güvenlik ve dürüstlük

- Politika, `AiTurnDecision` kararını değiştiremez.
- Gizli zincir düşünce kullanıcıya veya JSON alanlarına yazılmaz.
- Critic yeni iş gerçeği üretmez ve doküman metnini sessizce değiştirmez.
- Otomatik repair yalnız `AiTurnDecision.documentPolicy.allowAutoRepair` izin verdiğinde ayrı akışta yapılabilir.
