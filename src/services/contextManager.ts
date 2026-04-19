import { Message, KnowledgeItem, PromptSettings } from '../types';
import { callGemini } from './geminiService';

const STOP_WORDS = new Set(['ve', 'veya', 'ile', 'için', 'bir', 'bu', 'şu', 'o', 'da', 'de', 'mi', 'mu', 'mı', 'mü', 'gibi', 'kadar', 'ise', 'ki', 'ama', 'fakat', 'ancak', 'lakin', 'çünkü', 'eğer', 'şayet', 'madem', 'nasıl', 'neden', 'niçin', 'kim', 'ne', 'nerede', 'ne zaman', 'hangi', 'kaç', 'çok', 'az', 'daha', 'en', 'hiç', 'hep', 'her', 'tüm', 'bütün', 'bazı', 'kimi', 'çoğu', 'biraz', 'birkaç', 'göre', 'rağmen', 'karşı', 'doğru', 'beri', 'önce', 'sonra', 'başka', 'diğer', 'aynı', 'farklı', 'gibi', 'kadar', 'için', 'üzere', 'diye', 'dolayı', 'yüzünden', 'sayesinde', 'halde', 'durumda', 'şekilde', 'biçimde', 'olarak', 'olan', 'olduğu', 'oldukları', 'olması', 'olmak', 'olur', 'olursa', 'olmaz', 'olmazsa', 'olabilir', 'olamaz', 'yapmak', 'etmek', 'kılmak', 'eylemek', 'ol', 'yap', 'et', 'kıl', 'eyle', 'var', 'yok', 'evet', 'hayır', 'belki', 'sanki', 'güya', 'meğer', 'zaten', 'henüz', 'hala', 'artık', 'şimdi', 'hemen', 'derhal', 'sonra', 'önce', 'bugün', 'yarın', 'dün', 'sabah', 'akşam', 'gece', 'gündüz', 'yıl', 'ay', 'hafta', 'gün', 'saat', 'dakika', 'saniye', 'an', 'zaman', 'vakit', 'kez', 'defa', 'kere', 'sefer', 'kez', 'boyunca', 'süresince', 'zarfında', 'içinde', 'dışında', 'üzerinde', 'altında', 'yanında', 'yakınında', 'uzağında', 'karşısında', 'arkasında', 'önünde', 'sağında', 'solunda', 'arasında', 'ortasında', 'başında', 'sonunda', 'ilk', 'son', 'tek', 'çift', 'yarım', 'çeyrek', 'tam', 'bütün', 'eksik', 'fazla', 'yeterli', 'yetersiz', 'iyi', 'kötü', 'güzel', 'çirkin', 'doğru', 'yanlış', 'gerçek', 'yalan', 'büyük', 'küçük', 'uzun', 'kısa', 'geniş', 'dar', 'kalın', 'ince', 'ağır', 'hafif', 'zor', 'kolay', 'pahalı', 'ucuz', 'yeni', 'eski', 'genç', 'yaşlı', 'sıcak', 'soğuk', 'hızlı', 'yavaş', 'yüksek', 'düşük', 'derin', 'sığ', 'temiz', 'kirli', 'açık', 'kapalı', 'dolu', 'boş', 'zengin', 'fakir', 'güçlü', 'zayıf', 'sert', 'yumuşak', 'tatlı', 'acı', 'ekşi', 'tuzlu', 'renkli', 'renksiz', 'karanlık', 'aydınlık', 'sessiz', 'gürültülü', 'sakin', 'hareketli', 'canlı', 'cansız', 'insan', 'hayvan', 'bitki', 'eşya', 'yer', 'zaman', 'durum', 'olay', 'sebep', 'sonuç', 'amaç', 'araç', 'yöntem', 'şekil', 'biçim', 'özellik', 'nitelik', 'nicelik', 'miktar', 'derece', 'oran', 'sayı', 'rakam', 'harf', 'kelime', 'cümle', 'paragraf', 'metin', 'kitap', 'defter', 'kalem', 'kağıt', 'masa', 'sandalye', 'kapı', 'pencere', 'duvar', 'tavan', 'zemin', 'ev', 'oda', 'salon', 'mutfak', 'banyo', 'tuvalet', 'bahçe', 'sokak', 'cadde', 'mahalle', 'semt', 'ilçe', 'şehir', 'ülke', 'dünya', 'evren', 'güneş', 'ay', 'yıldız', 'gezegen', 'uzay', 'gökyüzü', 'yeryüzü', 'deniz', 'okyanus', 'göl', 'nehir', 'dağ', 'tepe', 'orman', 'çöl', 'ada', 'kıta', 'hava', 'su', 'toprak', 'ateş', 'rüzgar', 'yağmur', 'kar', 'buz', 'bulut', 'sis', 'fırtına', 'deprem', 'sel', 'yangın', 'kaza', 'hastalık', 'sağlık', 'yaşam', 'ölüm', 'doğum', 'çocuk', 'genç', 'yetişkin', 'yaşlı', 'kadın', 'erkek', 'kız', 'oğlan', 'anne', 'baba', 'kardeş', 'abi', 'abla', 'dede', 'nine', 'amca', 'dayı', 'hala', 'teyze', 'kuzen', 'yeğen', 'arkadaş', 'dost', 'düşman', 'komşu', 'akraba', 'yabancı', 'tanıdık', 'öğrenci', 'öğretmen', 'doktor', 'mühendis', 'avukat', 'polis', 'asker', 'işçi', 'patron', 'müdür', 'memur', 'esnaf', 'tüccar', 'çiftçi', 'işsiz', 'emekli', 'zengin', 'fakir', 'orta', 'sınıf', 'toplum', 'devlet', 'hükümet', 'millet', 'halk', 'insanlık', 'tarih', 'coğrafya', 'matematik', 'fizik', 'kimya', 'biyoloji', 'edebiyat', 'sanat', 'müzik', 'resim', 'tiyatro', 'sinema', 'spor', 'futbol', 'basketbol', 'voleybol', 'yüzme', 'koşu', 'oyun', 'eğlence', 'tatil', 'gezi', 'seyahat', 'iş', 'meslek', 'kariyer', 'eğitim', 'okul', 'üniversite', 'ders', 'sınav', 'not', 'başarı', 'başarısızlık', 'ödül', 'ceza', 'para', 'maaş', 'ücret', 'fiyat', 'maliyet', 'kar', 'zarar', 'gelir', 'gider', 'bütçe', 'ekonomi', 'ticaret', 'sanayi', 'tarım', 'turizm', 'ulaşım', 'iletişim', 'teknoloji', 'bilgisayar', 'internet', 'telefon', 'televizyon', 'radyo', 'gazete', 'dergi', 'kitap', 'haber', 'bilgi', 'veri', 'belge', 'dosya', 'resim', 'video', 'ses', 'müzik', 'film', 'dizi', 'program', 'uygulama', 'oyun', 'yazılım', 'donanım', 'sistem', 'ağ', 'bağlantı', 'hız', 'kapasite', 'güç', 'enerji', 'elektrik', 'su', 'doğalgaz', 'petrol', 'kömür', 'maden', 'altın', 'gümüş', 'demir', 'bakır', 'çelik', 'plastik', 'cam', 'ahşap', 'kağıt', 'kumaş', 'deri', 'pamuk', 'yün', 'ipek', 'renk', 'kırmızı', 'mavi', 'sarı', 'yeşil', 'turuncu', 'mor', 'pembe', 'kahverengi', 'siyah', 'beyaz', 'gri', 'şekil', 'kare', 'dikdörtgen', 'üçgen', 'daire', 'çember', 'küre', 'silindir', 'koni', 'piramit', 'çizgi', 'nokta', 'açı', 'yön', 'kuzey', 'güney', 'doğu', 'batı', 'sağ', 'sol', 'yukarı', 'aşağı', 'ileri', 'geri', 'iç', 'dış', 'ön', 'arka', 'üst', 'alt', 'yan', 'orta', 'köşe', 'kenar', 'yüzey', 'hacim', 'alan', 'uzunluk', 'genişlik', 'yükseklik', 'derinlik', 'ağırlık', 'kütle', 'zaman', 'süre', 'hız', 'ivme', 'kuvvet', 'basınç', 'sıcaklık', 'ısı', 'ışık', 'ses', 'renk', 'koku', 'tat', 'duyu', 'görme', 'işitme', 'dokunma', 'koklama', 'tatma', 'duygu', 'düşünce', 'fikir', 'inanç', 'değer', 'kural', 'yasa', 'hak', 'görev', 'sorumluluk', 'özgürlük', 'eşitlik', 'adalet', 'barış', 'savaş', 'şiddet', 'suç', 'ceza', 'iyilik', 'kötülük', 'doğruluk', 'yanlışlık', 'güzellik', 'çirkinlik', 'sevgi', 'nefret', 'korku', 'cesaret', 'umut', 'umutsuzluk', 'sevinç', 'üzüntü', 'mutluluk', 'mutsuzluk', 'heyecan', 'sıkıntı', 'öfke', 'sakinlik', 'şaşkınlık', 'beklenti', 'hayal', 'gerçek', 'rüya', 'kabus', 'uyku', 'uyanıklık', 'yorgunluk', 'dinlenme', 'çalışma', 'oyun', 'eğlence', 'tatil', 'gezi', 'seyahat', 'iş', 'meslek', 'kariyer', 'eğitim', 'okul', 'üniversite', 'ders', 'sınav', 'not', 'başarı', 'başarısızlık', 'ödül', 'ceza', 'para', 'maaş', 'ücret', 'fiyat', 'maliyet', 'kar', 'zarar', 'gelir', 'gider', 'bütçe', 'ekonomi', 'ticaret', 'sanayi', 'tarım', 'turizm', 'ulaşım', 'iletişim', 'teknoloji', 'bilgisayar', 'internet', 'telefon', 'televizyon', 'radyo', 'gazete', 'dergi', 'kitap', 'haber', 'bilgi', 'veri', 'belge', 'dosya', 'resim', 'video', 'ses', 'müzik', 'film', 'dizi', 'program', 'uygulama', 'oyun', 'yazılım', 'donanım', 'sistem', 'ağ', 'bağlantı', 'hız', 'kapasite', 'güç', 'enerji', 'elektrik', 'su', 'doğalgaz', 'petrol', 'kömür', 'maden', 'altın', 'gümüş', 'demir', 'bakır', 'çelik', 'plastik', 'cam', 'ahşap', 'kağıt', 'kumaş', 'deri', 'pamuk', 'yün', 'ipek', 'renk', 'kırmızı', 'mavi', 'sarı', 'yeşil', 'turuncu', 'mor', 'pembe', 'kahverengi', 'siyah', 'beyaz', 'gri', 'şekil', 'kare', 'dikdörtgen', 'üçgen', 'daire', 'çember', 'küre', 'silindir', 'koni', 'piramit', 'çizgi', 'nokta', 'açı', 'yön', 'kuzey', 'güney', 'doğu', 'batı', 'sağ', 'sol', 'yukarı', 'aşağı', 'ileri', 'geri', 'iç', 'dış', 'ön', 'arka', 'üst', 'alt', 'yan', 'orta', 'köşe', 'kenar', 'yüzey', 'hacim', 'alan', 'uzunluk', 'genişlik', 'yükseklik', 'derinlik', 'ağırlık', 'kütle', 'zaman', 'süre', 'hız', 'ivme', 'kuvvet', 'basınç', 'sıcaklık', 'ısı', 'ışık', 'ses', 'renk', 'koku', 'tat', 'duyu', 'görme', 'işitme', 'dokunma', 'koklama', 'tatma', 'duygu', 'düşünce', 'fikir', 'inanç', 'değer', 'kural', 'yasa', 'hak', 'görev', 'sorumluluk', 'özgürlük', 'eşitlik', 'adalet', 'barış', 'savaş', 'şiddet', 'suç', 'ceza', 'iyilik', 'kötülük', 'doğruluk', 'yanlışlık', 'güzellik', 'çirkinlik', 'sevgi', 'nefret', 'korku', 'cesaret', 'umut', 'umutsuzluk', 'sevinç', 'üzüntü', 'mutluluk', 'mutsuzluk', 'heyecan', 'sıkıntı', 'öfke', 'sakinlik', 'şaşkınlık', 'beklenti', 'hayal', 'gerçek', 'rüya', 'kabus', 'uyku', 'uyanıklık', 'yorgunluk', 'dinlenme', 'çalışma']);

export const extractKeywords = (text: string): string[] => {
  const words = text.toLowerCase().replace(/[^\w\sğüşıöç]/gi, '').split(/\s+/);
  return [...new Set(words.filter(word => word.length > 2 && !STOP_WORDS.has(word)))];
};

export const hybridSearch = (query: string, knowledgeBase: KnowledgeItem[], limit: number = 3): KnowledgeItem[] => {
  const queryKeywords = extractKeywords(query);
  
  if (queryKeywords.length === 0) return [];

  const scoredItems = knowledgeBase.map(item => {
    let matchScore = 0;
    item.keywords.forEach(kw => {
      if (queryKeywords.includes(kw)) matchScore += 1;
    });

    // Calculate BM25-lite score
    const keywordOverlap = matchScore / Math.max(queryKeywords.length, 1);
    
    // Combine with importance score (0-10)
    const finalScore = (keywordOverlap * 0.7) + ((item.importance / 10) * 0.3);

    return { item, score: finalScore };
  });

  return scoredItems
    .filter(x => x.score > 0.1) // Minimum threshold
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(x => x.item);
};

export const summarizeConversation = async (messages: Message[]): Promise<string> => {
  if (messages.length === 0) return "";

  const conversationText = messages.map(m => `${m.role === 'user' ? 'Kullanıcı' : 'Yapay Zeka'}: ${m.text}`).join('\n');
  
  const result = await callGemini({
    model: 'gemini-3.1-flash-lite-preview', // Use a faster/cheaper model for summarization
    systemInstruction: "Sen bir özetleme asistanısın. Verilen konuşma geçmişini analiz et ve en önemli kararları, bağlamı ve teknik detayları içeren kısa ve öz bir özet çıkar. Asla gereksiz detaylara girme.",
    contents: [{ parts: [{ text: conversationText }] }],
    onChunk: () => {} // We just need the final result
  });

  return result.text;
};

export const extractKeyFacts = async (text: string): Promise<{ fact: string, importance: number }[]> => {
  const result = await callGemini({
    model: 'gemini-3.1-flash-lite-preview',
    systemInstruction: "Verilen metinden kalıcı olarak hatırlanması gereken önemli teknik kararları, proje gereksinimlerini veya kurumsal bilgileri çıkar. Eğer önemli bir bilgi yoksa boş bir JSON dizisi dön. Yanıtın SADECE şu formatta bir JSON dizisi olmalı: [{ \"fact\": \"Önemli bilgi\", \"importance\": 8 }]. Importance 1-10 arası bir değer olmalı.",
    contents: [{ parts: [{ text }] }],
    onChunk: () => {}
  });

  try {
    const jsonStr = result.text.replace(/```json/g, '').replace(/```/g, '').trim();
    return JSON.parse(jsonStr);
  } catch (e) {
    console.error("Failed to parse key facts JSON", e);
    return [];
  }
};
