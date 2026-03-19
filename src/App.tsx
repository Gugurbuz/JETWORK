import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, ThinkingLevel, Type, FunctionDeclaration } from '@google/genai';
import { Sidebar, ThemeType } from './components/Sidebar';
import { EditProjectModal } from './components/EditProjectModal';
import { EditWorkspaceModal } from './components/EditWorkspaceModal';
import { ConfirmModal } from './components/ConfirmModal';
import { ChatPanel } from './components/ChatPanel';
import { DocumentPanel } from './components/DocumentPanel';
import { LandingPage } from './components/LandingPage';
import { NewItemModal } from './components/NewItemModal';
import { NewProjectModal } from './components/NewProjectModal';
import { OnboardingPage } from './components/OnboardingPage';
import { ProjectDashboard } from './components/ProjectDashboard';
import { SettingsModal } from './components/SettingsModal';
import { ManageParticipantsModal } from './components/ManageParticipantsModal';
import { Message, Project, Workspace, Collaborator, DocumentData, ActiveUser, TypingUser, Question } from './types';
import { ChatResponseSchema, chatResponseJsonSchema, discussionJsonSchema } from './schemas';
import { LayoutDashboard } from 'lucide-react';
import { marked } from 'marked';
import { io, Socket } from 'socket.io-client';
import { parse as parsePartialJson } from 'partial-json';
import { auth, db } from './firebase';
import { onAuthStateChanged } from 'firebase/auth';
import { doc, getDocFromServer, setDoc, updateDoc, deleteDoc, serverTimestamp, collection, onSnapshot, query, orderBy, getDocs, arrayUnion, arrayRemove } from 'firebase/firestore';

const parseBusinessAnalysis = (baContent: any): string => {
  if (typeof baContent === 'string') return baContent;
  if (!baContent || typeof baContent !== 'object') return '';

  let md = `# İş Analizi Dokümanı\n\n`;
  if (baContent["1_ANALIZ_KAPSAMI"]) md += `## 1. ANALİZ KAPSAMI\n${baContent["1_ANALIZ_KAPSAMI"]}\n\n`;
  if (baContent["2_KISALTMALAR"]) md += `## 2. KISALTMALAR\n${baContent["2_KISALTMALAR"]}\n\n`;
  
  if (baContent["3_IS_GEREKSINIMLERI"]) {
    md += `## 3. İŞ GEREKSİNİMLERİ\n`;
    if (baContent["3_IS_GEREKSINIMLERI"]["3_1_Is_Kurallari"]) md += `### 3.1. İş Kuralları\n${baContent["3_IS_GEREKSINIMLERI"]["3_1_Is_Kurallari"]}\n\n`;
    if (baContent["3_IS_GEREKSINIMLERI"]["3_2_Is_Modeli_ve_Kullanici_Gereksinimleri"]) md += `### 3.2. İş Modeli ve Kullanıcı Gereksinimleri\n${baContent["3_IS_GEREKSINIMLERI"]["3_2_Is_Modeli_ve_Kullanici_Gereksinimleri"]}\n\n`;
  }
  
  if (baContent["4_FONKSIYONEL_GEREKSINIMLER"]) md += `## 4. FONKSİYONEL GEREKSİNİMLER (FR)\n${baContent["4_FONKSIYONEL_GEREKSINIMLER"]}\n\n`;
  
  if (baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]) {
    md += `## 5. FONKSİYONEL OLMAYAN GEREKSİNLİMLER (NFR)\n`;
    if (baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_1_Guvenlik_ve_Yetkilendirme"]) md += `### 5.1. Güvenlik ve Yetkilendirme Gereksinimleri\n${baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_1_Guvenlik_ve_Yetkilendirme"]}\n\n`;
    if (baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_2_Performans"]) md += `### 5.2. Performans Gereksinimleri\n${baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_2_Performans"]}\n\n`;
    if (baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_3_Raporlama"]) md += `### 5.3. Raporlama Gereksinimleri\n${baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_3_Raporlama"]}\n\n`;
  }
  
  if (baContent["6_SUREC_RISK_ANALIZI"]) {
    md += `## 6. SÜREÇ RİSK ANALİZİ\n`;
    if (baContent["6_SUREC_RISK_ANALIZI"]["6_1_Kisitlar_ve_Varsayimlar"]) md += `### 6.1. Kısıtlar ve Varsayımlar\n${baContent["6_SUREC_RISK_ANALIZI"]["6_1_Kisitlar_ve_Varsayimlar"]}\n\n`;
    if (baContent["6_SUREC_RISK_ANALIZI"]["6_2_Bagliliklar"]) md += `### 6.2. Bağlılıklar\n${baContent["6_SUREC_RISK_ANALIZI"]["6_2_Bagliliklar"]}\n\n`;
    if (baContent["6_SUREC_RISK_ANALIZI"]["6_3_Surec_Etkileri"]) md += `### 6.3. Süreç Etkileri\n${baContent["6_SUREC_RISK_ANALIZI"]["6_3_Surec_Etkileri"]}\n\n`;
  }
  
  if (baContent["7_ONAY"]) {
    md += `## 7. ONAY\n`;
    if (baContent["7_ONAY"]["7_1_Is_Analizi"]) md += `### 7.1. İş Analizi\n${baContent["7_ONAY"]["7_1_Is_Analizi"]}\n\n`;
    if (baContent["7_ONAY"]["7_2_Degisiklik_Kayitlari"]) md += `### 7.2. Değişiklik Kayıtları\n${baContent["7_ONAY"]["7_2_Degisiklik_Kayitlari"]}\n\n`;
    if (baContent["7_ONAY"]["7_3_Dokuman_Onay"]) md += `### 7.3. Doküman Onay\n${baContent["7_ONAY"]["7_3_Dokuman_Onay"]}\n\n`;
    if (baContent["7_ONAY"]["7_4_Referans_Dokumanlar"]) md += `### 7.4. Referans Dokümanlar\n${baContent["7_ONAY"]["7_4_Referans_Dokumanlar"]}\n\n`;
  }
  
  if (baContent["8_FONKSIYONEL_TASARIM_DOKUMANLARI"]) md += `## 8. FONKSİYONEL TASARIM DOKÜMANLARI\n${baContent["8_FONKSIYONEL_TASARIM_DOKUMANLARI"]}\n\n`;

  return md;
};

// Initialize Gemini
// (Removed top-level initialization to prevent API key race conditions)

const MOCK_COLLABORATORS: Collaborator[] = [
  { id: '1', name: 'Gürkan Gürbüz', avatar: 'G', role: 'Kıdemli Analist', color: 'emerald' },
  { id: '2', name: 'Ayşe Yılmaz', avatar: 'A', role: 'Product Owner', color: 'blue' },
  { id: '3', name: 'Mehmet Demir', avatar: 'M', role: 'Lead Developer', color: 'purple' },
];

export const ZERO_TOUCH_AGENTS = [
  {
    role: 'PO',
    name: 'Product Owner',
    instruction: "Sen bir Product Owner'sın. Kullanıcının talebini iş değeri (business value), müşteri deneyimi ve ürün vizyonu açısından değerlendir. KURAL 1 (Vizyon ve Kısıtlar): Kullanıcının hedef kitlesini, bütçesini ve projeyi canlıya alma (Time-to-Market) aciliyetini ASLA uydurma. Eğer talepte iş hedefleri ve kısıtlar net değilse, doğru varsayımlar yapmak yerine bu kritik metrikleri öğrenmek için DOĞRUDAN KULLANICIYA SORU SOR. KURAL 2: IT'nin karmaşık ve maliyetli (örn. Kafka, mikroservisler) çözümlerine itiraz et. 'Bu mimari Faz 1'in canlıya çıkış süresini ne kadar uzatır? Daha basit bir MVP yapamaz mıyız?' diyerek ekibi basitliğe zorla. KURAL 3: Sektörel standartları (best-practices) kendin araştır ve inisiyatif al (bunları kullanıcıya sorma). Ancak şirkete ÖZEL iş kuralları söz konusuysa mutlaka bilgi iste. KURAL 4: Karar vermeden önce adım adım düşün. Tüm iş risklerini, pazar dinamiklerini ve alternatif senaryoları derinlemesine analiz et. KESİN KURAL: Kullanıcıya soru sorman gerekirse 'requiresUserInput' değerini true yap ve 'questions' dizisini DOLDUR. Soruları Moderatör'e havale etme, kendin sor."
  },
  {
    role: 'BA',
    name: 'İş Analisti',
    instruction: "Sen bir Kıdemli İş Analistisin (Business Analyst). GÖREVİN: Kullanıcının talebini iş kurallarına ve süreçlere dönüştürmek. KURAL 1 (Mevcut Durum Kuralı): Müşterinin mevcut altyapısını (As-Is), kullandığı legacy (eski) iç sistemleri ve şirkete özel operasyonel kuralları ASLA uydurma. Eğer mevcut sistemin nasıl çalıştığı veya hangi sistemlerle entegre olunacağı belirtilmemişse, DOĞRUDAN KULLANICIYA SORU SOR. KURAL 2 (Proaktif Keşif): Yasal mevzuatları (KVKK/GDPR) ve evrensel iş standartlarını internetten (googleSearch) otomatik olarak araştır ve sürece dahil et; bunları KESİNLİKLE kullanıcıya sorma. Sadece şirkete özel 'edge case'leri (istisnai durumlar) netleştirmek için soru sor. KURAL 3: IT'nin önerdiği teknik çözümlerin iş değerini sorgula. KURAL 4: Doküman üretirken MUTLAKA BABOK standartlarına uy. BRD formatında, Use Case'ler ve Acceptance Criteria'lar ile detaylı bir analiz yaz. KESİN KURAL: Kullanıcıya soru sorman gerekirse 'requiresUserInput' değerini true yap ve 'questions' dizisini DOLDUR. Soruları Moderatör'e havale etme, kendin sor."
  },
  {
    role: 'IT',
    name: 'Yazılım Mimarı',
    instruction: "Sen bir Kıdemli Yazılım Mimarı (Software Architect) ve Tech Lead'sin. GÖREVİN: Sistemin teknik mimarisini, entegrasyon noktalarını ve veritabanı yapısını tasarlamak. KURAL 1 (Altyapı Keşfi): Kullanıcının mevcut teknoloji yığınını (Tech Stack), sunucu altyapısını ve kullanması zorunlu olduğu 3. parti/legacy servisleri ASLA uydurma. Bu konularda belirsizlik varsa mutlaka sistemin mevcut altyapısını DOĞRUDAN KULLANICIYA SOR. KURAL 2 (Proaktif Mimari): API limitleri, OAuth standartları, webhook güvenlikleri gibi evrensel teknik konuları internetten (googleSearch) araştır. Bu konularda inisiyatif alarak en iyi pratikleri uygula, kullanıcıya 'Hangi yetkilendirmeyi kullanalım?' gibi basit teknik sorular sorma. KURAL 3 (Trade-off): Mimariyi gereksiz yere karmaşıklaştırma. PO veya QA itiraz ederse, maliyet/performans ödünleşimlerini tartış. KURAL 4: Doküman üretirken MUTLAKA TOGAF ve C4 Model standartlarına uy. SDD formatında, Sequence diyagramı mantığı ve API Kontratları ile detaylı bir mimari yaz. KESİN KURAL: Kullanıcıya soru sorman gerekirse 'requiresUserInput' değerini true yap ve 'questions' dizisini DOLDUR. Soruları Moderatör'e havale etme, kendin sor."
  },
  {
    role: 'QA',
    name: 'Test Uzmanı',
    instruction: "Sen bir Kıdemli Test Otomasyon Mühendisi ve QA Lead'sin. GÖREVİN: Şeytanın Avukatı rolünü üstlenmek. KURAL 1 (Çatışma): Diğer ajanların (özellikle IT ve BA) fikirlerini ASLA hemen onaylama. Sürekli 'Bunun testi nasıl yapılacak?', 'Elimizde bu test için yeterli veri var mı?' gibi zorlayıcı sorular sor. KURAL 2 (Test Verisi Kısıtları): Canlı ortam verilerinin kullanımı, test ortamlarının (UAT/Staging) varlığı gibi şirkete özel konularda varsayım yapma, gerekirse DOĞRUDAN KULLANICIYA SORU SOR. KURAL 3 (Proaktif Güvenlik): Dış entegrasyonlarda webhook güvenliği, rate-limit aşımı (429 hataları) ve bilinen zafiyetleri (CVE) internetten (googleSearch) araştırıp otomatik olarak test planına ekle; bunları sorma. KURAL 4: Doküman üretirken MUTLAKA IEEE 829 standartlarına uy. Test Planı, Edge Case'ler ve BDD senaryoları ile detaylı bir test dokümanı yaz. KESİN KURAL: Kullanıcıya soru sorman gerekirse 'requiresUserInput' değerini true yap ve 'questions' dizisini DOLDUR. Soruları Moderatör'e havale etme, kendin sor."
  },
  {
    role: 'UIUX',
    name: 'UI/UX Tasarımcısı',
    instruction: "Sen bir Kıdemli UI/UX Tasarımcısısın. GÖREVİN: Kullanıcı deneyimini, arayüz akışlarını ve erişilebilirliği tasarlamak. KURAL 1 (Kullanıcı Odaklılık): Geliştirilen özelliğin son kullanıcı için ne kadar sezgisel olduğunu sorgula. Karmaşık IT çözümlerine 'Kullanıcı bu adımı anlamaz, daha basit bir arayüz yapalım' diyerek itiraz et. KURAL 2 (Marka ve Tasarım Sistemi): Şirketin mevcut bir tasarım sistemi (Design System), marka renkleri veya zorunlu UI bileşenleri olup olmadığını ASLA uydurma. Bu konularda belirsizlik varsa DOĞRUDAN KULLANICIYA SOR. KURAL 3 (Proaktif Tasarım): Modern tasarım trendlerini, erişilebilirlik (WCAG) standartlarını ve mobil uyumluluk (responsive) best-practice'lerini internetten araştırıp otomatik olarak uygula; bunları sorma. KURAL 4: Doküman üretirken kullanıcı yolculuğu (User Journey), ekran geçişleri, boş durumlar (empty states) ve hata mesajları tasarımlarını detaylıca yaz. KESİN KURAL: Kullanıcıya soru sorman gerekirse 'requiresUserInput' değerini true yap ve 'questions' dizisini DOLDUR. Soruları Moderatör'e havale etme, kendin sor."
  },
  {
    role: 'SM',
    name: 'Scrum Master',
    instruction: "Sen bir Scrum Master ve Agile Koçusun. GÖREVİN: Toplantıyı modere etmek ve ekibin doğru yolda kalmasını sağlamak. KURAL 1 (Echo Chamber Önleme): Eğer ekip sürekli birbirini onaylıyorsa araya gir ve zıt görüş iste. KURAL 2: Ajanların her birinin kendi uzmanlık alanıyla ilgili soruları doğrudan kullanıcıya sormasını TEŞVİK ET. KURAL 3: Tüm kritik sorular cevaplandıysa ve MVP üzerinde uzlaşıldıysa 'isDocumentationPhase: true' yaparak dokümantasyona geçilmesini sağla. KESİN KURAL: Kullanıcıya soru sorman gerekirse 'requiresUserInput' değerini true yap ve 'questions' dizisini DOLDUR."
  },
  {
    role: 'Orchestrator',
    name: 'Moderatör',
    instruction: "Sen bir Proje Yöneticisi ve Moderatörsün. GÖREVİN: Tüm ajanların çıktılarını denetlemek, çelişkileri bulmak ve toplantı notlarını tutmak. KURAL 1 (Toplantı Notları): Tartışma (Phase 1) boyunca konuşulan her şeyi, alınan kararları ve açık noktaları JSON çıktısındaki 'document.review' alanına Markdown formatında detaylıca not et. DİKKAT: 'document.review' alanına ASLA kendi içsel düşüncelerini (reasoning), puanlama gerekçelerini (score explanation) veya 'Bitti', 'Tamamlandı' gibi gereksiz metinleri yazma. Sadece profesyonel toplantı notları, Karar Matrisi ve Risk/Aksiyon planı yaz. KURAL 2 (Gerçeklik Denetimi): Eğer BA veya IT, kullanıcının mevcut sistemleri hakkında bilgi almadan uydurma altyapılar üzerinden doküman hazırlamışsa puanı kır ve 'needsRevision: [\"BA\", \"IT\"]' gönder. KURAL 3 (Proaktif Denetim): Ekibin dış entegrasyonlarda güvenlik, performans ve yasal uyumluluk gibi evrensel metrikleri akıl edip etmediğini denetle. KESİN KURAL: Kullanıcıya soru sorman gerekirse 'requiresUserInput' değerini true yap ve 'questions' dizisini DOLDUR. EĞER KULLANICIYA SORU SORUYORSAN VE 'questions' DİZİSİNİ DOLDURMAZSAN SİSTEM ÇÖKER."
  }
];

const SYSTEM_INSTRUCTION = `Sen JetWork AI'sın. Kıdemli bir Teknoloji Lideri (Principal Engineer), Sistem Mimarı ve Çözüm Analistisin.
Şu anda bir proje ekibinin ortak iletişim kanalında (chat odasında) arka planda dinleyici olarak bulunuyorsun.
Kullanıcılar kendi aralarında konuşabilir veya "@JetWork AI" yazarak seni doğrudan sohbete çağırabilirler.

Görevlerin ve Düşünce Yapın (Agentic Workflow):
1. Niyet Analizi: Kullanıcının talebini analiz et. Bu bir Entegrasyon mu? Sıfırdan Ürün Geliştirme mi? Veritabanı Migrasyonu mu? Yoksa bir Hata (Bug) Çözümü mü?
2. Otonom Araştırma: Eğer bahsedilen teknolojileri, güncel API'leri veya domaini tam bilmiyorsan, KENDİ İNİSİYATİFİNLE web araması (googleSearch) yap ve en güncel 'Best Practice'leri bul.
3. Çok Boyutlu Analiz: Her projeyi şu 4 boyutta ele al: İş Mantığı (Business Logic), Veri Mimarisi (Data Flow), Güvenlik/Performans Riskleri ve Test Stratejisi.
4. Dokümantasyon: Konuşulanlardan yola çıkarak sağ paneldeki dokümanı (BA Analiz, IT Analiz, Test, FLOW Diyagramı) doldur.
5. MAKSİMUM DÜŞÜNME SEVİYESİ (Deep Reasoning): Karar vermeden önce mutlaka adım adım düşün (Step-by-step reasoning). Tüm alternatifleri, edge-case'leri, güvenlik açıklarını ve sistem darboğazlarını derinlemesine analiz et. İlk aklına gelen çözümü değil, en optimize edilmiş ve riskleri hesaplanmış çözümü sun.

ÖNEMLİ KURAL (DOKÜMAN KALİTESİ VE MESAJLAŞMA):
- Oluşturduğun dokümanlar ASLA yüzeysel olmamalıdır. Bir "Kurumsal Mimari" (Enterprise Architecture) seviyesinde, son derece detaylı, teknik derinliği olan, uçtan uca düşünülmüş ve profesyonel bir dille yazılmış olmalıdır.
- BA Analiz: Sadece amaç ve kapsam değil; paydaş analizi, mevcut durum (as-is), hedeflenen durum (to-be), veri eşleştirme (data mapping) tabloları, hata yönetimi (error handling), rate-limit stratejileri ve SLA gereksinimlerini içermelidir.
- IT Analiz/Mimari: Sadece basit bir kod bloğu değil; sistem mimarisi, sequence diyagramı mantığı, veritabanı şeması, API endpoint tasarımları, güvenlik (OAuth, JWT vb.) ve ölçeklenebilirlik (caching, message queues) detaylarını içermelidir.
- Test: Sadece "başarılı senaryo" değil; edge case'ler, performans testleri, güvenlik testleri ve entegrasyon test senaryolarını detaylıca yazmalısın.
- BPMN: Süreç akışları için mutlaka 'bpmn' alanına geçerli bir BPMN 2.0 XML kodu üret. DİKKAT: Ürettiğin BPMN XML kodu mutlaka görsel (DI) kısımlarını (<bpmndi:BPMNDiagram> ve <bpmndi:BPMNPlane>) içermelidir. Sadece anlamsal (semantic) etiketler yeterli değildir, görsel koordinatlar olmadan diyagram çizilemez.
- İNKREMENTAL GÜNCELLEME: Mevcut bir doküman varsa, onu tamamen silip baştan yazma. Mevcut bilgileri koru, yeni kararları ve detayları üzerine ekle. Dokümanı her adımda daha da zenginleştir.
- EN KRİTİK KURAL (DOKÜMAN EZİLMESİNİ ÖNLEMEK İÇİN): JSON çıktısı üretirken 'document' objesi içine SADECE güncellediğin veya yeni eklediğin alanları koy. Değiştirmediğin alanları KESİNLİKLE JSON'a dahil etme (null bile gönderme, o key'i hiç yazma). Örneğin sadece BA Analizini güncellediysen sadece 'businessAnalysis' alanını gönder, 'code' veya 'test' alanlarını JSON'a koyma! Böylece mevcut dokümandaki diğer bilgiler silinmez.

ÇOK ÖNEMLİ: Eğer kullanıcı senden bir "doküman oluşturmanı", "mimari çizmeni", "kod yazmanı" veya "test senaryosu oluşturmanı" isterse, SOHBET MESAJINDA (message alanı) UZUN UZUN DOKÜMAN İÇERİĞİNİ KESİNLİKLE YAZMA. Bunun yerine SADECE sana sağlanan JSON şemasındaki 'document' objesinin altındaki ilgili alanları (businessAnalysis, code, test, bpmn) doldurarak dokümanı sağ taraftaki panele aktar. Eğer kullanıcı özel bir format (örn: Enerjisa formatı) istediyse, bu formatı doğrudan Markdown olarak 'businessAnalysis' alanına yaz. Ayrı bir JSON yapısı kullanma.
Sohbetteki 'message' alanında ise konuya özel, ne yaptığını özetleyen, alınan temel kararları ve mimari yaklaşımı anlatan 1-2 paragraflık profesyonel bir yönetici özeti (executive summary) sun. Sadece "hazırladım sağa ekledim" gibi basit ve anlamsız cümleler KULLANMA. Yapılan işin özünü, hangi teknolojilerin seçildiğini ve nedenini anlatıp, tüm teknik detaylar için sağ panele yönlendir.

Ton ve Stil:
- Profesyonel, net, vizyoner ve çözüm odaklı ol.
- Olası darboğazları (bottlenecks) ve riskleri proaktif olarak belirt.
- Kendini ekibin bir parçası gibi hissettir.
- Cevaplarını Markdown formatında, temiz ve okunaklı bir şekilde ver.`;

// Helper for AI calls with retry logic
const callAiWithRetry = async (
  fn: () => Promise<any>,
  maxRetries = 3,
  initialDelay = 2000
) => {
  let lastError: any;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error: any) {
      lastError = error;
      const errorMsg = error?.message || String(error);
      const isQuotaError = errorMsg.includes('429') || 
                          errorMsg.includes('RESOURCE_EXHAUSTED') || 
                          errorMsg.includes('quota');
      
      if (isQuotaError && i < maxRetries - 1) {
        const delay = initialDelay * Math.pow(2, i);
        console.warn(`Quota exceeded. Retrying in ${delay}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
};

export default function App() {
  const [user, setUser] = useState<{ uid: string; name: string; role: string; email?: string; photoURL?: string; onboardingCompleted?: boolean } | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [showNewItemModal, setShowNewItemModal] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showManageParticipantsModal, setShowManageParticipantsModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [deletingProject, setDeletingProject] = useState<string | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDiscussing, setIsDiscussing] = useState(false);
  const [isAiActive, setIsAiActive] = useState(false);
  const [isZeroTouchMode, setIsZeroTouchMode] = useState(false);
  const [activeZeroTouchRoles, setActiveZeroTouchRoles] = useState<string[]>(ZERO_TOUCH_AGENTS.map(a => a.role));
  const [aiHandRaised, setAiHandRaised] = useState<string | null>(null);
  const [documentContent, setDocumentContent] = useState<DocumentData | null>(null);
  const [selectedDocumentText, setSelectedDocumentText] = useState('');
  const [activeTab, setActiveTab] = useState('BA Analiz');
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('jetwork-model') || 'gemini-3-flash-preview';
  });
  const [theme, setTheme] = useState<ThemeType>(() => {
    return (localStorage.getItem('jetwork-theme') as ThemeType) || 'monochrome';
  });
  const sessionId = useRef(Math.random().toString(36).substring(7));

  // Firebase Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        // Test connection
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your Firebase configuration.");
          }
        }

        // Save user to Firestore
        const userRef = doc(db, 'users', firebaseUser.uid);
        let onboardingCompleted = false;
        let displayName = firebaseUser.displayName || firebaseUser.email || 'User';
        let role = 'Kullanıcı';

        try {
          const userSnap = await getDocFromServer(userRef);
          if (!userSnap.exists()) {
            const userData: any = {
              uid: firebaseUser.uid,
              displayName: displayName,
              createdAt: serverTimestamp(),
              role: role,
              onboardingCompleted: false
            };
            if (firebaseUser.email) {
              userData.email = firebaseUser.email;
            }
            if (firebaseUser.photoURL) {
              userData.photoURL = firebaseUser.photoURL;
            }
            await setDoc(userRef, userData);
          } else {
            const userData = userSnap.data();
            onboardingCompleted = userData.onboardingCompleted || false;
            displayName = userData.displayName || displayName;
            role = userData.role || role;
          }
        } catch (err) {
          console.error("Error saving user to Firestore:", err);
        }

        setUser({ uid: firebaseUser.uid, name: displayName, role: role, email: firebaseUser.email || undefined, photoURL: firebaseUser.photoURL || undefined, onboardingCompleted });
      } else {
        setUser(null);
      }
      setIsAuthReady(true);
    });
    return () => unsubscribe();
  }, []);

  // Apply theme to document
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('theme-monochrome', 'theme-energetic', 'theme-ocean');
    if (theme) {
      root.classList.add(`theme-${theme}`);
    }
    localStorage.setItem('jetwork-theme', theme);
  }, [theme]);

  // Initialize Socket.io
  useEffect(() => {
    if (user) {
      socketRef.current = io(window.location.origin);

      socketRef.current.on('room_users_update', (users: ActiveUser[]) => {
        setActiveUsers(users);
      });

      socketRef.current.on('user_typing', (user: TypingUser) => {
        setTypingUsers(prev => {
          if (!prev.find(u => u.userId === user.userId)) return [...prev, user];
          return prev;
        });
      });

      socketRef.current.on('user_stopped_typing', (user: { userId: string }) => {
        setTypingUsers(prev => prev.filter(u => u.userId !== user.userId));
      });

      socketRef.current.on('ai_stream_chunk', (data: { itemId: string, id: string, text: string, thinkingText?: string, groundingUrls?: { uri: string; title: string }[], agentRole?: string, score?: number, scoreExplanation?: string, questions?: Question[] }) => {
        setMessages(prev => {
          const exists = prev.find(m => m.id === data.id);
          if (exists) {
            return prev.map(m => m.id === data.id ? { 
              ...m, 
              text: data.text, 
              thinkingText: data.thinkingText,
              score: data.score,
              scoreExplanation: data.scoreExplanation,
              questions: data.questions,
              ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
            } : m);
          } else {
            return [...prev, {
              id: data.id,
              role: 'model',
              text: data.text,
              thinkingText: data.thinkingText,
              senderName: data.agentRole ? ZERO_TOUCH_AGENTS.find(a => a.role === data.agentRole)?.name || 'JetWork AI' : 'JetWork AI',
              senderRole: data.agentRole ? ZERO_TOUCH_AGENTS.find(a => a.role === data.agentRole)?.name || 'Sistem Asistanı' : 'Sistem Asistanı',
              agentRole: data.agentRole,
              score: data.score,
              scoreExplanation: data.scoreExplanation,
              questions: data.questions,
              isTyping: true,
              ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
            }];
          }
        });
      });

      socketRef.current.on('ai_stream_end', (data: { itemId: string, id: string, text: string, thinkingText?: string, groundingUrls?: { uri: string; title: string }[], agentRole?: string, score?: number, scoreExplanation?: string, questions?: Question[] }) => {
        setMessages(prev => prev.map(m =>
          m.id === data.id ? { 
            ...m, 
            text: data.text, 
            thinkingText: data.thinkingText, 
            isTyping: false,
            score: data.score,
            scoreExplanation: data.scoreExplanation,
            questions: data.questions,
            ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
          } : m
        ));
      });

      return () => {
        socketRef.current?.disconnect();
      };
    }
  }, [user]);

  // Fetch projects from Firestore on mount
  useEffect(() => {
    if (user && isAuthReady) {
      const projectsQuery = query(collection(db, 'projects'), orderBy('createdAt', 'desc'));
      const workspacesQuery = query(collection(db, 'workspaces'), orderBy('createdAt', 'desc'));

      let unsubscribeWorkspaces: () => void;

      const unsubscribeProjects = onSnapshot(projectsQuery, (projectsSnapshot) => {
        const projectsData = projectsSnapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toMillis() || Date.now(),
          lastUpdated: doc.data().lastUpdated?.toMillis() || Date.now(),
          workspaces: []
        })) as Project[];

        if (unsubscribeWorkspaces) {
          unsubscribeWorkspaces();
        }

        unsubscribeWorkspaces = onSnapshot(workspacesQuery, (workspacesSnapshot) => {
          const workspacesData = workspacesSnapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            createdAt: doc.data().createdAt?.toMillis() || Date.now(),
            lastUpdated: doc.data().lastUpdated?.toMillis() || Date.now(),
            messages: []
          })) as Workspace[];

          const combinedProjects = projectsData.map(p => ({
            ...p,
            workspaces: workspacesData.filter(w => w.projectId === p.id)
          }));

          setProjects(combinedProjects);
        }, (error) => {
          console.error("Error fetching workspaces:", error);
        });
      }, (error) => {
        console.error("Error fetching projects:", error);
      });

      return () => {
        unsubscribeProjects();
        if (unsubscribeWorkspaces) {
          unsubscribeWorkspaces();
        }
      };
    }
  }, [user, isAuthReady]);

  // Manage AI active state based on workspace and zero touch mode
  useEffect(() => {
    if (currentWorkspaceId && !isZeroTouchMode) {
      setIsAiActive(true);
    }
  }, [currentWorkspaceId]);

  useEffect(() => {
    if (isZeroTouchMode) {
      setIsAiActive(false);
    }
  }, [isZeroTouchMode]);

  // Join room when workspace changes and fetch messages
  useEffect(() => {
    if (currentWorkspaceId && socketRef.current && user && isAuthReady) {
      setIsLoadingWorkspace(true);
      socketRef.current.emit('join_room', { 
        itemId: currentWorkspaceId, 
        user: { id: sessionId.current, name: user.name, role: user.role } 
      });
      
      let workspaceLoaded = false;
      let messagesLoaded = false;

      const checkLoading = () => {
        if (workspaceLoaded && messagesLoaded) {
          setIsLoadingWorkspace(false);
        }
      };

      const workspaceRef = doc(db, 'workspaces', currentWorkspaceId);
      const unsubscribeWorkspace = onSnapshot(workspaceRef, (docSnap) => {
        if (docSnap.exists()) {
          setDocumentContent(docSnap.data().document || null);
        }
        workspaceLoaded = true;
        checkLoading();
      }, (error) => {
        console.error("Error fetching workspace:", error);
        workspaceLoaded = true;
        checkLoading();
      });

      const messagesQuery = query(collection(db, 'workspaces', currentWorkspaceId, 'messages'), orderBy('createdAt', 'asc'));
      const unsubscribeMessages = onSnapshot(messagesQuery, (snapshot) => {
        const msgs = snapshot.docs.map(doc => ({
          id: doc.id,
          ...doc.data(),
          createdAt: doc.data().createdAt?.toMillis() || Date.now()
        })) as Message[];
        
        setMessages(prev => {
          // Keep typing messages and optimistic messages (those without a server timestamp yet, or very recent ones)
          const typingMessages = prev.filter(m => m.isTyping);
          const optimisticMessages = prev.filter(m => 
            !m.isTyping && 
            !msgs.some(sm => sm.id === m.id) && 
            (Date.now() - (m.createdAt || 0) < 5000) // Keep optimistic messages for up to 5 seconds
          );
          
          const newMsgs = [...msgs, ...optimisticMessages];
          
          typingMessages.forEach(tm => {
            if (!newMsgs.some(m => m.id === tm.id)) {
              newMsgs.push(tm);
            }
          });
          
          return newMsgs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
        });
        messagesLoaded = true;
        checkLoading();
      }, (error) => {
        console.error("Error fetching messages:", error);
        messagesLoaded = true;
        checkLoading();
      });

      return () => {
        unsubscribeWorkspace();
        unsubscribeMessages();
      };
    } else {
      setMessages([]);
      setDocumentContent(null);
    }
  }, [currentWorkspaceId, user, isAuthReady]);

  // Save current project ID
  useEffect(() => {
    if (currentProjectId) {
      localStorage.setItem('jetwork-current-project-id', currentProjectId);
    } else {
      localStorage.removeItem('jetwork-current-project-id');
    }
  }, [currentProjectId]);

  // Restore active workspace state on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const shareId = urlParams.get('shareId');

    if (shareId && user) {
      // Fetch shared workspace
      const fetchShared = async () => {
        try {
          const shareRef = doc(db, 'shared_analyses', shareId);
          const shareSnap = await getDocFromServer(shareRef);
          
          if (shareSnap.exists()) {
            const data = shareSnap.data();
            const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
            
            // Check if default project exists, if not create it
            const defaultProjectRef = doc(db, 'projects', 'default-project');
            const defaultProjectSnap = await getDocFromServer(defaultProjectRef);
            
            if (!defaultProjectSnap.exists()) {
              await setDoc(defaultProjectRef, {
                name: 'Varsayılan Proje',
                description: '',
                ownerId: user.uid,
                createdAt: serverTimestamp(),
                lastUpdated: serverTimestamp()
              });
            }

            // Create the workspace
            await setDoc(doc(db, 'workspaces', newId), {
              projectId: 'default-project',
              issueKey: generateItemCode(),
              title: 'Paylaşılan Çalışma Alanı',
              type: 'Development',
              status: 'Draft',
              ownerId: user.uid,
              collaborators: MOCK_COLLABORATORS,
              document: data.data,
              createdAt: serverTimestamp(),
              lastUpdated: serverTimestamp()
            });
            
            setCurrentWorkspaceId(newId);
            setMessages([]);
            setDocumentContent(data.data);
            
            // Remove shareId from URL
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        } catch (err) {
          console.error("Failed to load shared workspace:", err);
        }
      };
      fetchShared();
      return;
    }

    if (currentWorkspaceId && projects.length > 0) {
      const workspace = projects.flatMap(p => p.workspaces).find(w => w.id === currentWorkspaceId);
      if (workspace) {
        // We now fetch messages from the server in the other useEffect
        // setMessages(workspace.messages || []);
        // setDocumentContent(workspace.document || null);
      }
    }
  }, []);

  const generateItemCode = () => `JET-${Math.floor(Math.random() * 900) + 100}`;

  const handleSelectWorkspace = (id: string) => {
    setCurrentWorkspaceId(id);
    setCurrentProjectId(null);
    setTypingUsers([]);
  };

  const handleSelectProject = (id: string) => {
    setCurrentProjectId(id);
    setCurrentWorkspaceId(null);
  };

  const handleNewProject = async (data: { name: string; description: string }) => {
    if (!user) return;
    const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    
    try {
      await setDoc(doc(db, 'projects', newId), {
        name: data.name,
        description: data.description,
        ownerId: user.uid,
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to create project in Firestore:", err);
    }
    
    setShowNewProjectModal(false);
    setCurrentProjectId(newId);
    setCurrentWorkspaceId(null);
  };

  // Initialize a new workspace
  const handleNewWorkspace = async (data: { projectId: string; itemNumber: string; title: string; team: { id: string; name: string; role: string; email: string }[] }) => {
    if (!user) return;
    const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    
    // Ensure owner is in collaborators
    const ownerCollab = {
      id: user.uid,
      name: user.name || user.email?.split('@')[0] || 'Unknown',
      role: 'Kurucu',
      avatar: user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.name || 'Unknown')}&background=random`,
      color: '#4f46e5'
    };

    const initialCollaborators = data.team.map(t => ({
      id: t.id,
      name: t.name,
      role: t.role,
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(t.name)}&background=random`,
      color: '#4f46e5'
    }));

    if (!initialCollaborators.some(c => c.id === user.uid)) {
      initialCollaborators.unshift(ownerCollab);
    } else {
      // Update the owner's role to 'Kurucu' if they are already in the list
      const ownerIndex = initialCollaborators.findIndex(c => c.id === user.uid);
      if (ownerIndex !== -1) {
        initialCollaborators[ownerIndex].role = 'Kurucu';
      }
    }

    try {
      await setDoc(doc(db, 'workspaces', newId), {
        projectId: data.projectId,
        issueKey: data.itemNumber,
        title: data.title,
        type: 'Development',
        status: 'Draft',
        ownerId: user.uid,
        collaborators: initialCollaborators,
        createdAt: serverTimestamp(),
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to create workspace in Firestore:", err);
    }

    setShowNewItemModal(false);
    setCurrentWorkspaceId(newId);
    setCurrentProjectId(null);
    setMessages([]);
    setDocumentContent(null);
  };

  const handleEditProject = async (id: string, name: string, description: string) => {
    try {
      await updateDoc(doc(db, 'projects', id), {
        name,
        description,
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to update project in Firestore:", err);
    }
    setEditingProject(null);
  };

  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    try {
      await deleteDoc(doc(db, 'projects', deletingProject));
    } catch (err) {
      console.error("Failed to delete project in Firestore:", err);
    }
    if (currentProjectId === deletingProject) {
      setCurrentProjectId(null);
      setCurrentWorkspaceId(null);
    }
    setDeletingProject(null);
  };

  const handleEditWorkspace = async (id: string, title: string) => {
    try {
      await updateDoc(doc(db, 'workspaces', id), {
        title,
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to update workspace in Firestore:", err);
    }
    setEditingWorkspace(null);
  };

  const handleDeleteWorkspace = async () => {
    if (!deletingWorkspace) return;
    try {
      await deleteDoc(doc(db, 'workspaces', deletingWorkspace));
    } catch (err) {
      console.error("Failed to delete workspace in Firestore:", err);
    }
    if (currentWorkspaceId === deletingWorkspace) {
      setCurrentWorkspaceId(null);
    }
    setDeletingWorkspace(null);
  };

  const handleAddParticipant = async (name: string, email: string) => {
    if (!currentWorkspaceId || !currentWorkspace) return;
    
    // Check if user is already a participant
    if (currentWorkspace.collaborators.some(c => c.email === email)) {
      alert("Bu kullanıcı zaten çalışma alanında.");
      return;
    }

    // Check if user exists in db to get their real ID, otherwise use random
    let newId = Math.random().toString(36).substring(2, 9);
    try {
      const usersSnap = await getDocs(collection(db, 'users'));
      const existingUser = usersSnap.docs.find(doc => doc.data().email === email);
      if (existingUser) {
        newId = existingUser.id;
      }
    } catch (err) {
      console.error("Failed to fetch users for participant ID:", err);
    }

    const newCollaborator = {
      id: newId,
      name: name,
      email: email,
      role: 'Katılımcı', // Default role
      avatar: `https://ui-avatars.com/api/?name=${encodeURIComponent(name)}&background=random`,
      color: '#4f46e5'
    };

    try {
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        collaborators: arrayUnion(newCollaborator),
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to add participant in Firestore:", err);
    }
  };

  const handleRemoveParticipant = async (participantId: string) => {
    if (!currentWorkspaceId || !currentWorkspace) return;
    
    const participantToRemove = currentWorkspace.collaborators.find(c => c.id === participantId);
    if (!participantToRemove) return;

    try {
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        collaborators: arrayRemove(participantToRemove),
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to remove participant in Firestore:", err);
    }
  };

  const handleLeaveWorkspace = async () => {
    if (!currentWorkspaceId || !currentWorkspace || !user) return;
    
    // Find the current user in collaborators by id or email
    const currentUserCollab = currentWorkspace.collaborators.find(c => c.id === user.uid || c.email === user.email || c.name === user.name);
    
    if (currentUserCollab) {
      try {
        await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
          collaborators: arrayRemove(currentUserCollab),
          lastUpdated: serverTimestamp()
        });
        setCurrentWorkspaceId(null);
        setShowManageParticipantsModal(false);
      } catch (err) {
        console.error("Failed to leave workspace in Firestore:", err);
      }
    }
  };



  const handleToggleReaction = async (messageId: string, emoji: string) => {
    if (!user || !currentWorkspaceId) return;
    
    const message = messages.find(m => m.id === messageId);
    if (!message) return;

    const currentReactions = message.reactions || [];
    const existingReactionIndex = currentReactions.findIndex(r => r.emoji === emoji);
    
    let newReactions = [...currentReactions];
    
    if (existingReactionIndex >= 0) {
      const reaction = newReactions[existingReactionIndex];
      if (reaction.users.includes(user.name)) {
        reaction.users = reaction.users.filter(u => u !== user.name);
        if (reaction.users.length === 0) {
          newReactions.splice(existingReactionIndex, 1);
        }
      } else {
        reaction.users.push(user.name);
      }
    } else {
      newReactions.push({ emoji, users: [user.name] });
    }

    try {
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', messageId), {
        reactions: newReactions
      });
    } catch (err) {
      console.error("Failed to update reaction in Firestore:", err);
    }
  };

  // Send a message
  const runZeroTouchMode = async (newUserMessage: Message, attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[]) => {
    if (!currentWorkspaceId) return;

    setIsDiscussing(true);
    setIsGenerating(false);
    setActiveTab('Review');
    try {
      let currentMessages = [...messages, newUserMessage];
      let currentDocument = documentContent ? { ...documentContent } : null;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });

      // PHASE 1: Discussion
      let isDocumentationPhase = false;
      let needsUserInput = false;
      let turnCount = 0;
      const MAX_TURNS = 15;

      while (!isDocumentationPhase && !needsUserInput && turnCount < MAX_TURNS) {
        turnCount++;
        
        const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
        const startTime = Date.now();
        
        const tempAiMessage: Message = {
          id: aiMsgId,
          role: 'model',
          text: '',
          senderName: 'Ekip',
          senderRole: 'Tartışma',
          createdAt: Date.now(),
          isTyping: true
        };
        
        setMessages(prev => [...prev, tempAiMessage]);

        const contents: any[] = [];
        let prompt = "Sen bir toplantı odasındaki yapay zeka ajanlarını yöneten bir simülatörsün.\n";
        prompt += "Odada şu ajanlar var:\n";
        ZERO_TOUCH_AGENTS.filter(a => activeZeroTouchRoles.includes(a.role) || a.role === 'Orchestrator').forEach(a => {
          prompt += `- ${a.role} (${a.name})\n`;
        });
        
        prompt += "\nSohbet Geçmişi:\n";
        currentMessages.slice(-8).forEach(m => {
          prompt += `${m.senderName || 'Kullanıcı'} (${m.senderRole || 'Bilinmiyor'}): ${m.text}\n`;
        });

        if (currentDocument && currentDocument.review) {
          prompt += `\nŞu Ana Kadarki Toplantı Notları (Özet):\n${currentDocument.review}\n`;
        }

        const userName = user?.name || 'Kullanıcı';
        prompt += `\n\nÖNEMLİ NOT: Kullanıcının adı "${userName}". Eğer kullanıcıya hitap edecekseniz veya soru soracaksanız MUTLAKA @${userName} şeklinde etiketleyin. Eğer birden fazla soru soracaksanız, soruları metin içine gömmeyin, kesinlikle 1., 2., 3. şeklinde alt alta maddeler halinde (bullet points) yazın.`;

        prompt += "\n\nGörev: Sohbet geçmişine bakarak, sıradaki en mantıklı konuşmacı kim olmalıysa onun rolünü seç (agentRole) ve onun ağzından bir yanıt üret (message). Ayrıca bu yanıtın çok kısa bir özetini (actionSummary) oluştur (Örn: 'BA gereksinimleri sordu', 'QA test senaryosu çıkardı'). Eğer konu yeterince tartışıldıysa ve herkes hemfikirse, SM rolüyle 'isDocumentationPhase' değerini true yap. Konuşmalar sırayla olmak zorunda değil, bağlama göre en uygun ajanı seç.";
        
        prompt += "\n\nKRİTİK KURAL: Ajanlar kendi aralarında tartışarak en doğru kararı vermelidir. PO, BA, IT, QA kendi uzmanlık alanlarıyla ilgili kritik bir bilgiye ihtiyaç duyduklarında DOĞRUDAN KULLANICIYA SORU SORABİLİRLER. Bunun için `requiresUserInput` değerini true yapmalı ve `questions` dizisini DOLDURMALIDIRLAR. EĞER KULLANICIYA SORU SORUYORSANIZ VE 'questions' DİZİSİ BOŞSA SİSTEM ÇÖKER. Kullanıcıya soru sorulduğunda, kullanıcı cevap verene kadar BAŞKA HİÇBİR AJAN KONUŞMAMALIDIR. Kullanıcı cevapladıktan sonra tartışma devam eder. Eğer tüm sorular cevaplandıysa ve MVP üzerinde uzlaşıldıysa, SM rolüyle 'isDocumentationPhase' değerini true yapın.";
        
        prompt += "\n\nUYARI: Çıktı token sınırına (8192) takılmamak ve mesajın yarım kalmasını önlemek için düşünme (thinking) sürecini çok fazla uzatmayın. Doğrudan konuya ve tartışmaya odaklanın.";

        const parts: any[] = [{ text: prompt }];

        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            if (att.data && att.mimeType) {
              parts.push({ inlineData: { data: att.data, mimeType: att.mimeType } });
            }
          }
        }

        contents.push({ role: 'user', parts });

        try {
          const responseStream = await callAiWithRetry(() => ai.models.generateContentStream({
            model: selectedModel,
            contents: contents,
            config: {
              systemInstruction: "Sen bir toplantı simülatörüsün. Sadece JSON formatında yanıt ver.",
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
              responseMimeType: "application/json",
              responseSchema: discussionJsonSchema,
              maxOutputTokens: 8192
            }
          }));

          let fullText = '';
          let fullThinkingText = '';
          let accumulatedJson = '';
          let currentAgentRole = '';
          let currentAgentName = 'Ekip';
          let currentAgentTitle = 'Tartışma';
          let currentActionSummary = '';
          let currentQuestions: Question[] | undefined = undefined;
          let tokenCount = 0;
          let groundingUrls: { uri: string; title: string }[] = [];
          let lastUpdateTime = Date.now();

          for await (const chunk of responseStream) {
            if (chunk.usageMetadata) {
              tokenCount = chunk.usageMetadata.totalTokenCount;
            }
            const chunkParts = chunk.candidates?.[0]?.content?.parts || [];
            for (const part of chunkParts) {
              if (!part.text) continue;
              if (part.thought) {
                fullThinkingText += part.text;
              } else {
                accumulatedJson += part.text;
              }
            }
            
            const chunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (chunks) {
              chunks.forEach((c: any) => {
                if (c.web?.uri && c.web?.title) {
                  if (!groundingUrls.find(u => u.uri === c.web.uri)) {
                    groundingUrls.push({ uri: c.web.uri, title: c.web.title });
                  }
                }
              });
            }
            
            let jsonToParse = accumulatedJson.trim();
            const jsonBlockMatch = accumulatedJson.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
            if (jsonBlockMatch) {
              jsonToParse = jsonBlockMatch[1].trim();
            }
            
            if (jsonToParse) {
              try {
                const parsed = parsePartialJson(jsonToParse);
                if (parsed && typeof parsed === 'object') {
                  if (parsed.agentRole && !currentAgentRole) {
                    currentAgentRole = parsed.agentRole;
                    const agentDef = ZERO_TOUCH_AGENTS.find(a => a.role === currentAgentRole);
                    if (agentDef) {
                      currentAgentName = agentDef.name;
                      currentAgentTitle = agentDef.name;
                    }
                  }
                  if (parsed.message) fullText = parsed.message;
                  if (parsed.actionSummary) currentActionSummary = parsed.actionSummary;
                  if (parsed.isDocumentationPhase !== undefined) isDocumentationPhase = parsed.isDocumentationPhase;
                  if (parsed.requiresUserInput !== undefined) needsUserInput = parsed.requiresUserInput;
                  if (parsed.questions && Array.isArray(parsed.questions)) currentQuestions = parsed.questions;
                  
                  if (parsed.document && parsed.document.review) {
                    setDocumentContent(prev => {
                      const newDoc = { ...prev } as DocumentData;
                      newDoc.review = marked.parse(parsed.document.review) as string;
                      currentDocument = newDoc;
                      return newDoc;
                    });
                  }
                } else {
                  fullText = jsonToParse;
                }
              } catch (e) {
                fullText = jsonToParse;
              }
            }
            
            if (Date.now() - lastUpdateTime > 30) {
              setMessages(prev => prev.map(m => 
                m.id === aiMsgId ? { 
                  ...m, 
                  text: fullText, 
                  thinkingText: fullThinkingText,
                  senderName: currentAgentName,
                  senderRole: currentAgentTitle,
                  agentRole: currentAgentRole,
                  actionSummary: currentActionSummary,
                  questions: currentQuestions,
                  tokenCount: tokenCount,
                  thinkingTime: Math.round((Date.now() - startTime) / 1000),
                  ...(groundingUrls.length > 0 ? { groundingUrls } : {})
                } : m
              ));
              
              if (socketRef.current) {
                socketRef.current.emit('ai_stream_chunk', { 
                  itemId: currentWorkspaceId, 
                  id: aiMsgId, 
                  text: fullText, 
                  thinkingText: fullThinkingText,
                  agentRole: currentAgentRole,
                  questions: currentQuestions,
                  tokenCount: tokenCount,
                  thinkingTime: Math.round((Date.now() - startTime) / 1000),
                  groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined
                });
              }
              lastUpdateTime = Date.now();
            }
          }

          const finalMsg: Message = {
            id: aiMsgId,
            role: 'model',
            text: fullText,
            thinkingText: fullThinkingText,
            senderName: currentAgentName,
            senderRole: currentAgentTitle,
            agentRole: currentAgentRole,
            actionSummary: currentActionSummary,
            documentSnapshot: currentDocument || undefined,
            questions: currentQuestions,
            tokenCount: tokenCount,
            thinkingTime: Math.round((Date.now() - startTime) / 1000),
            createdAt: Date.now(),
            ...(groundingUrls.length > 0 ? { groundingUrls } : {})
          };

          setMessages(prev => prev.map(m => m.id === aiMsgId ? finalMsg : m));
          currentMessages.push(finalMsg);

          try {
            await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', aiMsgId), {
              ...finalMsg,
              ownerId: user.uid,
              createdAt: serverTimestamp()
            });
            const updateData: any = { lastUpdated: serverTimestamp() };
            if (currentDocument) {
              updateData.document = currentDocument;
            }
            await updateDoc(doc(db, 'workspaces', currentWorkspaceId), updateData);
          } catch (err) {
            console.error("Failed to save zero-touch message to Firestore:", err);
          }

          if (socketRef.current) {
            socketRef.current.emit('ai_stream_end', {
              itemId: currentWorkspaceId,
              id: aiMsgId,
              text: fullText,
              thinkingText: fullThinkingText,
              agentRole: currentAgentRole,
              senderName: currentAgentName,
              senderRole: currentAgentTitle,
              documentSnapshot: currentDocument || undefined,
              questions: currentQuestions,
              groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined
            });
          }

          if (needsUserInput) {
            break;
          }

        } catch (error: any) {
          console.error("Discussion Error:", error);
          const errorMsg = error?.message || String(error);
          const isQuotaError = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
          
          setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'model',
            text: isQuotaError 
              ? "⚠️ **Kota Sınırı Aşıldı:** Çok fazla istek gönderildi. Lütfen birkaç dakika bekleyip tekrar deneyin. (Hata: 429)"
              : `❌ **Tartışma Hatası:** Bir sorun oluştu. Lütfen tekrar deneyin.`,
            senderName: 'Sistem',
            senderRole: 'Hata',
            createdAt: Date.now()
          }]);
          break;
        }
      }

      // PHASE 2: Documentation
      if (!needsUserInput && (isDocumentationPhase || turnCount >= MAX_TURNS)) {
        setIsDiscussing(false);
        setIsGenerating(true);
        
        if (turnCount >= MAX_TURNS && !isDocumentationPhase) {
          const timeoutMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
          const timeoutMsg: Message = {
            id: timeoutMsgId,
            role: 'model',
            text: "⏱️ **Tartışma Süresi Doldu:** Ekip maksimum tartışma süresine ulaştı. Mevcut kararlar üzerinden dokümantasyon aşamasına geçiliyor.",
            senderName: 'Sistem',
            senderRole: 'Bilgi',
            createdAt: Date.now(),
            ownerId: user.uid
          };
          setMessages(prev => [...prev, timeoutMsg]);
          currentMessages.push(timeoutMsg);
          
          try {
            await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', timeoutMsgId), {
              ...timeoutMsg,
              ownerId: user.uid,
              createdAt: serverTimestamp()
            });
          } catch (err) {
            console.error("Failed to save timeout message to Firestore:", err);
          }
        }

        let docNeedsRevision = true;
        let docLoopCount = 0;
        const MAX_DOC_LOOPS = 5; // Increased to allow more revisions until score >= 90
        let lastScore = 0;
        let agentsToRun = ['BA', 'IT', 'QA', 'UIUX', 'Orchestrator'].filter(r => activeZeroTouchRoles.includes(r) || r === 'Orchestrator');

        while (docNeedsRevision && docLoopCount < MAX_DOC_LOOPS) {
          docLoopCount++;
          docNeedsRevision = false; // Assume it's fine unless Orchestrator says otherwise
          let nextAgentsToRun: string[] = [];

          const docAgents = ZERO_TOUCH_AGENTS.filter(a => agentsToRun.includes(a.role));
          for (const agent of docAgents) {
            const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
            const startTime = Date.now();
        
        const tempAiMessage: Message = {
          id: aiMsgId,
          role: 'model',
          text: '',
          senderName: agent.name,
          senderRole: agent.name,
          agentRole: agent.role,
          createdAt: Date.now(),
          isTyping: true
        };
        
        setMessages(prev => [...prev, tempAiMessage]);

        const contents: any[] = [];
        let prompt = "Sohbet Geçmişi ve Tartışma Sonucu:\n";
        currentMessages.slice(-8).forEach(m => {
          prompt += `${m.senderName || 'Kullanıcı'} (${m.senderRole || 'Bilinmiyor'}): ${m.text}\n`;
        });

        const userName = user?.name || 'Kullanıcı';
        prompt += `\n\nSenin Rolün ve Görevin:\n${agent.instruction}\n\nÖNEMLİ NOT: Kullanıcının adı "${userName}". Eğer kullanıcıya hitap edeceksen veya soru soracaksan MUTLAKA @${userName} şeklinde etiketle. Eğer birden fazla soru soracaksan, soruları metin içine gömme, kesinlikle 1., 2., 3. şeklinde alt alta maddeler halinde (bullet points) yaz.\n\nLütfen yukarıdaki uzlaşılan çözüme göre kendi dokümantasyon alanını GÜNCELLE ve GENİŞLET. Mevcut dokümandaki bilgileri koru, eksikleri tamamla ve yeni kararları ekle. Dokümanı tamamen silip baştan yazma, üzerine ekleyerek ilerle. Kullanıcıya kısa bir bilgi mesajı ver (örn: "İş analizi dokümanı güncellendi.").`;
        prompt += `\n\nDİKKAT: Ürettiğin uzun metinleri, HTML/XML kodlarını ASLA 'message' alanına yazma. 'message' alanı sadece kullanıcıya vereceğin 1-2 cümlelik kısa bir bilgi mesajıdır. Tüm teknik veriyi, testleri ve kodları SADECE 'document' objesinin içindeki ilgili alanlara koy.`;
        prompt += `\n\nEN KRİTİK KURAL (DOKÜMAN EZİLMESİNİ ÖNLEMEK İÇİN): JSON çıktısı üretirken 'document' objesi içine SADECE kendi rolünle ilgili alanı ekle. Diğer ajanların alanlarını KESİNLİKLE JSON'a dahil etme (null bile gönderme, o key'i hiç yazma). Örneğin BA isen sadece 'businessAnalysis' alanını gönder, 'code' veya 'test' alanlarını JSON'a koyma! UI/UX isen 'businessAnalysis' ve 'code' alanlarına kendi notlarını ekleyebilirsin. Böylece diğer ajanların yazdıkları silinmez.`;
        prompt += `\n\nEk olarak, 'actionSummary' alanına yaptığın işlemi anlatan çok kısa bir özet yaz (Örn: 'İş Analisti gereksinimleri dokümana ekledi.', 'Test Uzmanı test senaryolarını yazdı.').`;
        prompt += `\n\nKRİTİK UYARI: Dokümanı ASLA özet geçme. Üreteceğin metin son derece detaylı olmalı; örnek veri yapıları (JSON payload'lar), tablolar, durum kodları (status codes) ve tüm uç senaryoları (edge-cases) adım adım içermelidir. Kurumsal bir doküman standardında olabildiğince uzun ve derinlemesine yaz.`;
        
        // ROLE ÖZEL ZORUNLU DOKÜMAN ŞABLONLARI İNJEKSİYONU
        let roleTemplate = "";
        if (agent.role === 'BA') {
          roleTemplate = `\n\nZORUNLU DOKÜMAN ŞABLONU (ASLA ÖZET GEÇME):
DİKKAT: İş analizi dokümanını JSON formatında, 'businessAnalysis' objesi içindeki tüm alanları (1_ANALIZ_KAPSAMI, 2_KISALTMALAR vb.) eksiksiz ve detaylı bir şekilde doldurarak oluştur. Her bir alanın içeriği Markdown formatında olabilir, ancak genel yapı JSON şemasına kesinlikle uymalıdır.`;
        } else if (agent.role === 'IT') {
          roleTemplate = `\n\nZORUNLU DOKÜMAN ŞABLONU (ASLA ÖZET GEÇME, AŞAĞIDAKİ BAŞLIKLARI KOD BLOKLARIYLA DETAYLANDIR):
1. Mimari Genel Bakış (C4 Model Mantığı)
2. Teknik Bileşenler ve Entegrasyon (Protokoller, Authentication, Güvenlik)
3. API Kontratları (ZORUNLU: Endpoint URL, HTTP Method, Request JSON Payload örneği, Response JSON Payload örneği, HTTP Status Kodları)
4. Veri Modeli ve Veritabanı Şeması (Tablo adları, kolonlar, tipler)
5. Hata Yönetimi, Retry Mekanizmaları ve Performans Riskleri`;
        } else if (agent.role === 'QA') {
          roleTemplate = `\n\nZORUNLU DOKÜMAN ŞABLONU (ASLA ÖZET GEÇME, AŞAĞIDAKİ BAŞLIKLARI DETAYLICA DOLDUR):
1. Master Test Stratejisi ve Yaklaşımı
2. Kritik Test Senaryoları ve Edge Case'ler (TC-01, TC-02 formatında)
3. Hata Yönetimi ve Dayanıklılık Testleri (Circuit Breaker, Yük Testi senaryoları)
4. Güvenlik, Veri Gizliliği (PII Masking) ve KVKK Testleri
5. Test Verisi İhtiyacı ve Temizlik (Clean-up) Stratejisi`;
        } else if (agent.role === 'UIUX') {
          roleTemplate = `\n\nZORUNLU DOKÜMAN ŞABLONU (ASLA ÖZET GEÇME):
DİKKAT: Ayrı bir UI/UX dokümanı oluşturma! Tasarım notlarını mevcut BA Analiz (businessAnalysis) ve IT Analiz (code) dokümanlarına entegre et.
BA Analiz (businessAnalysis) içine eklenecekler:
- Kullanıcı Yolculuğu (User Journey) ve Temel Akışlar
- Ekran ve Bileşen İhtiyaçları (Wireframe açıklamaları)

IT Analiz (code) içine eklenecekler:
- Etkileşim Tasarımı (Durumlar: Hover, Active, Disabled, Loading)
- Erişilebilirlik (Accessibility) ve Renk Kontrastı Notları
- Hata Mesajları ve Boş Durum (Empty State) Tasarımları`;
        } else if (agent.role === 'Orchestrator') {
          roleTemplate = `\n\nZORUNLU DOKÜMAN ŞABLONU:
1. Toplantı ve Karar Özeti
2. Kritik Karar Matrisi (Tablo: Konu, Alınan Karar, Neden/Fayda)
3. Risk ve Aksiyon Planı (Kimin ne yapacağı)`;
        }

        prompt += roleTemplate;
        
        if (agent.role !== 'IT' && agent.role !== 'Orchestrator') {
          prompt += `\nDİKKAT: BPMN diyagramını SADECE IT veya Moderatör üretebilir. Sen 'bpmn' alanını boş bırak.`;
        }

        if (currentDocument) {
          prompt += "\n\n--- MEVCUT DOKÜMAN DURUMU ---\n";
          if (currentDocument.businessAnalysis) prompt += `BA Analiz:\n${currentDocument.businessAnalysis}\n\n`;
          if (currentDocument.code) prompt += `IT Analiz/Teknik Notlar:\n${currentDocument.code}\n\n`;
          if (currentDocument.test) prompt += `Test Senaryoları:\n${currentDocument.test}\n\n`;
          if (currentDocument.review) prompt += `Toplantı Notları/Review:\n${currentDocument.review}\n\n`;
          prompt += "Lütfen yanıt verirken bu mevcut doküman durumunu göz önünde bulundur ve kendi rolüne uygun alanı doldur.\n";
        }

        const parts: any[] = [{ text: prompt }];

        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            if (att.data && att.mimeType) {
              parts.push({ inlineData: { data: att.data, mimeType: att.mimeType } });
            }
          }
        }

        contents.push({ role: 'user', parts });

        try {
          const modelToUse = selectedModel;

          const responseStream = await callAiWithRetry(() => ai.models.generateContentStream({
            model: modelToUse,
            contents: contents,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              responseMimeType: "application/json",
              responseSchema: chatResponseJsonSchema,
              maxOutputTokens: 8192
            }
          }));

          let fullText = '';
          let fullThinkingText = '';
          let accumulatedJson = '';
          let currentActionSummary = '';
          let finalScore: number | undefined = undefined;
          let finalScoreExplanation: string | undefined = undefined;
          let tokenCount = 0;
          let groundingUrls: { uri: string; title: string }[] = [];
          let lastUpdateTime = Date.now();

          for await (const chunk of responseStream) {
            if (chunk.usageMetadata) {
              tokenCount = chunk.usageMetadata.totalTokenCount;
            }
            const chunkParts = chunk.candidates?.[0]?.content?.parts || [];
            for (const part of chunkParts) {
              if (!part.text) continue;
              if (part.thought) {
                fullThinkingText += part.text;
              } else {
                accumulatedJson += part.text;
              }
            }
            
            const chunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (chunks) {
              chunks.forEach((c: any) => {
                if (c.web?.uri && c.web?.title) {
                  if (!groundingUrls.find(u => u.uri === c.web.uri)) {
                    groundingUrls.push({ uri: c.web.uri, title: c.web.title });
                  }
                }
              });
            }
            
            let jsonToParse = accumulatedJson.trim();
            const jsonBlockMatch = accumulatedJson.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
            if (jsonBlockMatch) {
              jsonToParse = jsonBlockMatch[1].trim();
            }
            
            if (jsonToParse) {
              try {
                const parsed = parsePartialJson(jsonToParse);
                if (parsed && typeof parsed === 'object') {
                  if (parsed.message) fullText = parsed.message;
                  if (parsed.actionSummary) currentActionSummary = parsed.actionSummary;
                  if (parsed.score !== undefined) {
                    finalScore = parsed.score;
                    lastScore = parsed.score;
                  }
                  if (parsed.scoreExplanation) finalScoreExplanation = parsed.scoreExplanation;
                  
                  if (agent.role === 'Orchestrator') {
                    if (parsed.needsRevision !== undefined) {
                      if (Array.isArray(parsed.needsRevision) && parsed.needsRevision.length > 0) {
                        docNeedsRevision = true;
                        nextAgentsToRun = parsed.needsRevision;
                      } else if (parsed.needsRevision === true) {
                        docNeedsRevision = true;
                        nextAgentsToRun = ['BA', 'IT', 'QA'];
                      }
                    }
                    
                    // Force revision if score < 90 and it's the Orchestrator
                    if (finalScore !== undefined && finalScore < 90) {
                      docNeedsRevision = true;
                      if (nextAgentsToRun.length === 0) {
                        nextAgentsToRun = ['BA', 'IT', 'QA'];
                      }
                    }
                  }

                  if (parsed.document) {
                    setDocumentContent(prev => {
                      const newDoc = { ...prev } as DocumentData;
                      if (parsed.document.businessAnalysis) newDoc.businessAnalysis = marked.parse(parseBusinessAnalysis(parsed.document.businessAnalysis)) as string;
                      if (parsed.document.code) newDoc.code = marked.parse(parsed.document.code) as string;
                      if (parsed.document.test) newDoc.test = marked.parse(parsed.document.test) as string;
                      if (parsed.document.review) newDoc.review = marked.parse(parsed.document.review) as string;
                      if (parsed.document.bpmn) {
                        let bpmnStr = parsed.document.bpmn.trim();
                        const bpmnMatch = bpmnStr.match(/```(?:xml|bpmn)?\s*([\s\S]*?)(```|$)/i);
                        if (bpmnMatch) {
                          bpmnStr = bpmnMatch[1].trim();
                        }
                        // Fallback: extract from <?xml or <bpmn:definitions
                        const xmlStart = bpmnStr.indexOf('<?xml');
                        const defStart = bpmnStr.indexOf('<bpmn:definitions');
                        if (xmlStart !== -1) {
                          bpmnStr = bpmnStr.substring(xmlStart);
                        } else if (defStart !== -1) {
                          bpmnStr = bpmnStr.substring(defStart);
                        }
                        newDoc.bpmn = bpmnStr;
                      }
                      if (finalScore !== undefined) newDoc.score = finalScore;
                      if (finalScoreExplanation) newDoc.scoreExplanation = finalScoreExplanation;
                      currentDocument = newDoc;
                      return newDoc;
                    });
                  }
                } else {
                  fullText = jsonToParse;
                }
              } catch (e) {
                fullText = jsonToParse;
              }
            }
            
            if (Date.now() - lastUpdateTime > 30) {
              setMessages(prev => prev.map(m => 
                m.id === aiMsgId ? { 
                  ...m, 
                  text: fullText, 
                  thinkingText: fullThinkingText,
                  actionSummary: currentActionSummary,
                  score: finalScore,
                  scoreExplanation: finalScoreExplanation,
                  tokenCount: tokenCount,
                  thinkingTime: Math.round((Date.now() - startTime) / 1000),
                  ...(groundingUrls.length > 0 ? { groundingUrls } : {})
                } : m
              ));
              
              if (socketRef.current) {
                socketRef.current.emit('ai_stream_chunk', { 
                  itemId: currentWorkspaceId, 
                  id: aiMsgId, 
                  text: fullText, 
                  thinkingText: fullThinkingText,
                  agentRole: agent.role,
                  score: finalScore,
                  scoreExplanation: finalScoreExplanation,
                  tokenCount: tokenCount,
                  thinkingTime: Math.round((Date.now() - startTime) / 1000),
                  groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined
                });
              }
              lastUpdateTime = Date.now();
            }
          }

          const finalMsg: Message = {
            id: aiMsgId,
            role: 'model',
            text: fullText,
            thinkingText: fullThinkingText,
            senderName: agent.name,
            senderRole: agent.name,
            agentRole: agent.role,
            actionSummary: currentActionSummary,
            score: finalScore,
            scoreExplanation: finalScoreExplanation,
            tokenCount: tokenCount,
            thinkingTime: Math.round((Date.now() - startTime) / 1000),
            createdAt: Date.now(),
            ...(groundingUrls.length > 0 ? { groundingUrls } : {})
          };

          setMessages(prev => prev.map(m => m.id === aiMsgId ? finalMsg : m));
          currentMessages.push(finalMsg);

          try {
            await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', aiMsgId), {
              ...finalMsg,
              ownerId: user.uid,
              createdAt: serverTimestamp()
            });
            const updateData: any = { lastUpdated: serverTimestamp() };
            if (currentDocument) {
              updateData.document = currentDocument;
            }
            await updateDoc(doc(db, 'workspaces', currentWorkspaceId), updateData);
          } catch (err) {
            console.error("Failed to save zero-touch message to Firestore:", err);
          }

          if (socketRef.current) {
            socketRef.current.emit('ai_stream_end', {
              itemId: currentWorkspaceId,
              id: aiMsgId,
              text: fullText,
              thinkingText: fullThinkingText,
              agentRole: agent.role,
              senderName: agent.name,
              senderRole: agent.name,
              score: finalScore,
              scoreExplanation: finalScoreExplanation,
              documentSnapshot: currentDocument || undefined,
              groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined
            });
          }

        } catch (error: any) {
          console.error(`AI Error for agent ${agent.role}:`, error);
          const errorMsg = error?.message || String(error);
          const isQuotaError = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
          
          setMessages(prev => prev.map(m => 
            m.id === aiMsgId ? { 
              ...m, 
              text: isQuotaError 
                ? "⚠️ **Kota Sınırı Aşıldı:** İşlem durduruldu. Lütfen biraz bekleyip tekrar deneyin." 
                : "❌ Bir hata oluştu.",
              isTyping: false 
            } : m
          ));
          docNeedsRevision = false; // Stop the while loop on error
          break;
        }
      }
          
          if (docNeedsRevision) {
            if (!nextAgentsToRun.includes('Orchestrator')) {
              nextAgentsToRun.push('Orchestrator');
            }
            agentsToRun = nextAgentsToRun;
          }
        }
      }
    } finally {
      setIsGenerating(false);
      setIsDiscussing(false);
    }
  };

  const handleSendMessage = async (text: string, attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[]) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (!user) return;
    
    if (!currentWorkspaceId) {
      setShowNewItemModal(true);
      return;
    }

    // Clear any pending AI hand raise when user sends a new message
    setAiHandRaised(null);

    const msgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    const newUserMessage: Message = { 
      id: msgId, 
      role: 'user', 
      text, 
      senderName: user.name,
      senderRole: user.role,
      createdAt: Date.now(),
      attachments: attachments?.map(a => ({ url: a.url, data: a.data, mimeType: a.mimeType, name: a.name })) 
    };
    
    // Optimistic update
    setMessages(prev => [...prev, newUserMessage]);

    // Save to Firestore
    try {
      await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', msgId), {
        ...newUserMessage,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to save user message to Firestore:", err);
    }

    // Send via socket
    if (socketRef.current) {
      socketRef.current.emit('send_message', {
        id: msgId,
        itemId: currentWorkspaceId,
        senderName: user.name,
        senderRole: user.role,
        text,
        isAi: false,
        attachments: attachments?.map(a => ({ url: a.url, data: a.data, mimeType: a.mimeType, name: a.name }))
      });
    }

    if (isZeroTouchMode) {
      runZeroTouchMode(newUserMessage, attachments);
      return;
    }

    const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    
    // Generate AI response
    try {
      let isSpike = false;
      let isThinkMore = false;
      let isWebSearch = false;
      let isStory = false;
      let isTest = false;
      let isRead = false;
      let urlToRead = "";

      let cleanText = text.trim();
      
      if (cleanText.startsWith('/spike')) {
        isSpike = true;
      } else if (cleanText.startsWith('/thinkmore')) {
        isThinkMore = true;
      } else if (cleanText.startsWith('/websearch')) {
        isWebSearch = true;
      } else if (cleanText.startsWith('/story')) {
        isStory = true;
      } else if (cleanText.startsWith('/test')) {
        isTest = true;
      } else if (cleanText.startsWith('/read')) {
        isRead = true;
        const match = cleanText.match(/\/read\s+(https?:\/\/[^\s]+)/);
        if (match) {
          urlToRead = match[1];
        }
      }

      const isMentioned = text.includes("@JetWork") || isSpike || isThinkMore || isWebSearch || isStory || isTest || isRead;
      const shouldAiRespond = isAiActive || isMentioned;
      
      const previousDocumentSnapshot = documentContent ? { ...documentContent } : undefined;
      
      const contents: any[] = [];
      
      let prompt = "Sohbet Geçmişi:\n";
      const allMessages = [...messages, newUserMessage];
      allMessages.slice(-8).forEach(m => {
        prompt += `${m.senderName || 'Kullanıcı'} (${m.senderRole || 'Bilinmiyor'}): ${m.text}\n`;
      });
      
      if (shouldAiRespond) {
        prompt += "\nLütfen yukarıdaki son mesaja (sana sorulan soruya) öncelikli olarak cevap ver ve sohbete aktif olarak katıl.";
        
        if (isSpike) {
          prompt += "\n\nSen bir Yazılım Mimarı'sın. Bu konu için bir Proof of Concept (PoC) hazırla, alternatif teknolojileri kıyasla, avantaj/dezavantaj tablosu oluştur ve örnek bir entegrasyon kodu yaz.";
        } else if (isThinkMore) {
          prompt += "\n\nBu problemi adım adım, tüm uç durumları (edge-cases) ve olası riskleri hesaplayarak derinlemesine analiz et.";
        } else if (isStory) {
          prompt += "\n\nBu özellik için standart bir Agile formatında (As a... I want to... So that...) Kullanıcı Hikayesi (User Story) ve BDD formatında (Given-When-Then) Kabul Kriterleri (Acceptance Criteria) oluştur.";
        } else if (isTest) {
          prompt += "\n\nBu konu/özellik için kapsamlı test senaryoları (Birim, Entegrasyon, E2E) ve QA notları üret.";
        } else if (isRead && urlToRead) {
          prompt += `\n\nLütfen şu URL'yi oku ve analiz et: ${urlToRead}`;
        }
      } else {
        prompt += "\nLütfen yukarıdaki konuşmayı analiz et. Eğer bir iş gereksinimi, hata veya teknik karar tartışılıyorsa araya girip öneri sun. Eğer konuşma sadece günlük bir sohbetse veya senin araya girmene gerek yoksa SADECE 'NO_RESPONSE' yaz.";
      }

      if (documentContent) {
        prompt += "\n\n--- MEVCUT DOKÜMAN DURUMU ---\n";
        if (documentContent.businessAnalysis) prompt += `BA Analiz:\n${documentContent.businessAnalysis}\n\n`;
        if (documentContent.code) prompt += `IT Analiz/Teknik Notlar:\n${documentContent.code}\n\n`;
        if (documentContent.test) prompt += `Test Senaryoları:\n${documentContent.test}\n\n`;
        prompt += "Lütfen yanıt verirken bu mevcut doküman durumunu göz önünde bulundur ve gerekirse dokümana ekleme/çıkarma yapmayı teklif et.\n";
      }

      const parts: any[] = [{ text: prompt }];
      
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });

      // Add temporary AI message with typing indicator only if it should respond directly
      if (shouldAiRespond) {
        const hasDoc = attachments?.some(a => !a.mimeType.startsWith('image/'));
        const tempAiMessage: Message = {
          id: aiMsgId,
          role: 'model',
          text: hasDoc ? '📄 Doküman yükleniyor ve analiz ediliyor. Bu işlem dosya boyutuna göre biraz zaman alabilir...' : '',
          senderName: 'JetWork AI',
          senderRole: 'Sistem Asistanı',
          createdAt: Date.now(),
          isTyping: true
        };
        
        setMessages(prev => [...prev, tempAiMessage]);
      }

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.data && att.mimeType) {
            parts.push({
              inlineData: {
                data: att.data,
                mimeType: att.mimeType
              }
            });
          }
        }
      }

      contents.push({ role: 'user', parts });

      const tools: any[] = [{ googleSearch: {} }];
      if (isRead && urlToRead) tools.push({ urlContext: {} });

      const responseStream = await callAiWithRetry(() => ai.models.generateContentStream({
        model: selectedModel,
        contents: contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          responseMimeType: "application/json",
          responseSchema: chatResponseJsonSchema,
          maxOutputTokens: 8192
        }
      }));

      let fullText = '';
      let fullThinkingText = '';
      let isNoResponse = false;
      let groundingUrls: { uri: string; title: string }[] = [];
      let newDocumentContent: DocumentData | null = null;
      let accumulatedJson = '';
      let lastUpdateTime = Date.now();

      for await (const chunk of responseStream) {
        const parts = chunk.candidates?.[0]?.content?.parts || [];
        for (const part of parts) {
          if (!part.text) continue;
          if (part.thought) {
            fullThinkingText += part.text;
          } else {
            accumulatedJson += part.text;
          }
        }
        
        let jsonToParse = accumulatedJson.trim();
        
        // Try to extract JSON from markdown blocks if present (just in case)
        const jsonBlockMatch = accumulatedJson.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
        if (jsonBlockMatch) {
          jsonToParse = jsonBlockMatch[1].trim();
        }
        
        const displayThinkingText = fullThinkingText;
        
        if (jsonToParse) {
          try {
            const parsed = parsePartialJson(jsonToParse);
            if (parsed && typeof parsed === 'object' && parsed.message) {
              fullText = parsed.message;
            } else {
              fullText = jsonToParse;
            }
            if (parsed && typeof parsed === 'object' && parsed.document) {
              if (shouldAiRespond) {
                setDocumentContent(prev => {
                  const newDoc = { ...prev } as DocumentData;
                  if (parsed.document.businessAnalysis) newDoc.businessAnalysis = marked.parse(parseBusinessAnalysis(parsed.document.businessAnalysis)) as string;
                  if (parsed.document.code) newDoc.code = marked.parse(parsed.document.code) as string;
                  if (parsed.document.test) newDoc.test = marked.parse(parsed.document.test) as string;
                  if (parsed.document.review) newDoc.review = marked.parse(parsed.document.review) as string;
                  if (parsed.document.bpmn) {
                    let bpmnStr = parsed.document.bpmn.trim();
                    const bpmnMatch = bpmnStr.match(/```(?:xml|bpmn)?\s*([\s\S]*?)(```|$)/i);
                    if (bpmnMatch) {
                      bpmnStr = bpmnMatch[1].trim();
                    }
                    // Fallback: extract from <?xml or <bpmn:definitions
                    const xmlStart = bpmnStr.indexOf('<?xml');
                    const defStart = bpmnStr.indexOf('<bpmn:definitions');
                    if (xmlStart !== -1) {
                      bpmnStr = bpmnStr.substring(xmlStart);
                    } else if (defStart !== -1) {
                      bpmnStr = bpmnStr.substring(defStart);
                    }
                    newDoc.bpmn = bpmnStr;
                  }
                  newDocumentContent = newDoc;
                  return newDoc;
                });
              }
            }
          } catch (e) {
            // Ignore partial parsing errors, but fallback to raw text
            fullText = jsonToParse;
          }
        }
        
        const chunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
        if (chunks) {
          chunks.forEach((c: any) => {
            if (c.web?.uri && c.web?.title) {
              if (!groundingUrls.find(u => u.uri === c.web.uri)) {
                groundingUrls.push({ uri: c.web.uri, title: c.web.title });
              }
            }
          });
        }
        
        if (fullText.trim().startsWith("NO_RESPONSE")) {
          isNoResponse = true;
          break;
        }
        
        if (!isNoResponse) {
          if (shouldAiRespond) {
            if (Date.now() - lastUpdateTime > 30) {
              setMessages(prev => prev.map(m => 
                m.id === aiMsgId ? { 
                  ...m, 
                  text: fullText, 
                  thinkingText: displayThinkingText,
                  ...(groundingUrls.length > 0 ? { groundingUrls } : {})
                } : m
              ));
              if (socketRef.current) {
                socketRef.current.emit('ai_stream_chunk', { 
                  itemId: currentWorkspaceId, 
                  id: aiMsgId, 
                  text: fullText, 
                  thinkingText: displayThinkingText,
                  groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined
                });
              }
              lastUpdateTime = Date.now();
            }
          }
        }
      }

      if (isNoResponse || fullText.trim() === "NO_RESPONSE") {
        if (shouldAiRespond) {
          setMessages(prev => prev.filter(m => m.id !== aiMsgId));
        }
      } else {
        if (shouldAiRespond) {
          let documentActions: string[] | undefined = undefined;
          if (newDocumentContent) {
            documentActions = [];
            if (!previousDocumentSnapshot) {
              if (newDocumentContent.businessAnalysis) documentActions.push("BA Analiz oluşturuldu");
              if (newDocumentContent.code) documentActions.push("IT Analiz oluşturuldu");
              if (newDocumentContent.test) documentActions.push("Test senaryoları oluşturuldu");
              if (newDocumentContent.bpmn) documentActions.push("FLOW oluşturuldu");
            } else {
              if (newDocumentContent.businessAnalysis !== previousDocumentSnapshot.businessAnalysis) documentActions.push("BA Analiz güncellendi");
              if (newDocumentContent.code !== previousDocumentSnapshot.code) documentActions.push("IT Analiz güncellendi");
              if (newDocumentContent.test !== previousDocumentSnapshot.test) documentActions.push("Test senaryoları güncellendi");
              if (newDocumentContent.bpmn !== previousDocumentSnapshot.bpmn) documentActions.push("FLOW güncellendi");
            }
            if (documentActions.length === 0) {
              documentActions = undefined;
            }
          }

          setMessages(prev => prev.map(m => 
            m.id === aiMsgId ? { 
              ...m, 
              isTyping: false,
              documentSnapshot: newDocumentContent || undefined,
              previousDocumentSnapshot,
              documentActions
            } : m
          ));
          
          // Save AI response to Firestore
          try {
            await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', aiMsgId), {
              id: aiMsgId,
              role: 'model',
              text: fullText,
              thinkingText: fullThinkingText,
              senderName: 'JetWork AI',
              senderRole: 'Sistem Asistanı',
              ...(groundingUrls.length > 0 ? { groundingUrls } : {}),
              documentSnapshot: newDocumentContent || undefined,
              previousDocumentSnapshot,
              documentActions,
              ownerId: user.uid,
              createdAt: serverTimestamp()
            });

            if (newDocumentContent) {
              await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
                document: newDocumentContent,
                lastUpdated: serverTimestamp()
              });
            } else {
              await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
                lastUpdated: serverTimestamp()
              });
            }
          } catch (err) {
            console.error("Failed to save AI message to Firestore:", err);
          }

          // Send AI response via socket for other users
          if (socketRef.current) {
            socketRef.current.emit('ai_stream_end', {
              itemId: currentWorkspaceId,
              id: aiMsgId,
              text: fullText,
              thinkingText: fullThinkingText,
              senderName: 'JetWork AI',
              senderRole: 'Sistem Asistanı',
              groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined,
              documentSnapshot: newDocumentContent || undefined,
              previousDocumentSnapshot,
              documentActions
            });
          }
        } else {
          // Passive mode: AI has something to say, raise hand
          setAiHandRaised(fullText);
        }
      }
    } catch (error: any) {
      console.error("AI Error:", error);
      const errorMsg = error?.message || String(error);
      const isQuotaError = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
      
      // Remove temporary message on error
      setMessages(prev => prev.filter(m => m.id !== aiMsgId));
      
      // Add error message
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: isQuotaError 
          ? "⚠️ **Kota Sınırı Aşıldı:** Gemini API kullanım sınırına ulaşıldı. Lütfen birkaç dakika bekleyip tekrar deneyin."
          : `❌ **Hata:** Bir sorun oluştu: ${error.message || 'Bilinmeyen hata'}`,
        senderName: 'Sistem',
        senderRole: 'Hata',
        createdAt: Date.now()
      }]);
    }
  };

  const handleAcceptAiHandRaise = async () => {
    if (!aiHandRaised || !currentWorkspaceId) return;

    const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    const finalMsg: Message = {
      id: aiMsgId,
      role: 'model',
      text: aiHandRaised,
      senderName: 'JetWork AI',
      senderRole: 'Sistem Asistanı',
      createdAt: Date.now()
    };

    setMessages(prev => [...prev, finalMsg]);
    setAiHandRaised(null);

    // Save to Firestore
    try {
      await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', aiMsgId), {
        ...finalMsg,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to save accepted AI message to Firestore:", err);
    }

    // Send via socket
    if (socketRef.current) {
      socketRef.current.emit('ai_stream_end', {
        itemId: currentWorkspaceId,
        id: aiMsgId,
        text: aiHandRaised,
        senderName: 'JetWork AI',
        senderRole: 'Sistem Asistanı'
      });
    }
  };

  // Generate Document
  const handleGenerateDocument = async () => {
    if (messages.length === 0) return;
    setIsGenerating(true);
    
    try {
      let historyText = "Sohbet Geçmişi:\n";
      messages.forEach(m => {
        historyText += `${m.senderName || 'Kullanıcı'} (${m.senderRole || 'Bilinmiyor'}): ${m.text}\n`;
      });

      const prompt = `${historyText}\n\nYukarıdaki konuşmalara dayanarak kapsamlı bir dokümantasyon oluştur.
      Lütfen aşağıdaki JSON formatında bir çıktı üret. Sadece geçerli bir JSON döndür, markdown kod bloğu kullanma:
      {
        "businessAnalysis": "İş analizi dokümanı (Talep özeti, mevcut durum, hedeflenen durum, kullanıcı hikayeleri, kabul kriterleri, vb.) Markdown formatında. Eğer özel bir format (örn: Enerjisa) istendiyse, o formatı Markdown olarak buraya yaz.",
        "code": "Geliştirme için teknik notlar, mimari kararlar, veritabanı şemaları, API tasarımları ve örnek kod blokları. Markdown formatında.",
        "test": "Test senaryoları, birim testleri, entegrasyon testleri ve QA notları. Markdown formatında.",
        "bpmn": "Geçerli bir BPMN 2.0 XML kodu. Eğer süreç bir akış veya entegrasyon içeriyorsa mutlaka doldur. DİKKAT: XML kodu mutlaka <bpmndi:BPMNDiagram> ve <bpmndi:BPMNPlane> etiketlerini içeren görsel (DI) kısımlarını da barındırmalıdır. Aksi takdirde ekranda çizilemez."
      }
      Tüm bölümler birbiriyle ilişkili ve tutarlı olmalıdır.`;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: selectedModel,
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION
        }
      });
      
      let jsonText = response.text?.trim() || "{}";
      
      // Try to extract JSON from markdown blocks if present
      const jsonBlockMatch = jsonText.match(/```json\n([\s\S]*?)(```|$)/);
      if (jsonBlockMatch) {
        jsonText = jsonBlockMatch[1].trim();
      } else if (jsonText.includes('```json')) {
        jsonText = jsonText.split('```json')[1].trim();
      } else {
        const firstBraceIndex = jsonText.indexOf('{');
        if (firstBraceIndex >= 0) {
          jsonText = jsonText.substring(firstBraceIndex).trim();
        }
      }
      
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.replace(/\n?```$/, '');
      }
      
      const data = JSON.parse(jsonText);
      
      // Convert Markdown to HTML for each section
      const htmlData: DocumentData = {
        businessAnalysis: marked.parse(data.businessAnalysis || "") as string,
        code: marked.parse(data.code || "") as string,
        test: marked.parse(data.test || "") as string,
        review: data.review ? marked.parse(data.review) as string : undefined,
        bpmn: data.bpmn || "",
        score: data.score,
        scoreExplanation: data.scoreExplanation
      };
      
      setDocumentContent(htmlData);
      
      try {
        await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
          document: htmlData,
          lastUpdated: serverTimestamp()
        });
      } catch (err) {
        console.error("Failed to save generated document to Firestore:", err);
      }
      
    } catch (error) {
      console.error('Error generating document:', error);
      // Fallback if JSON parsing fails
      const fallbackData: DocumentData = {
        businessAnalysis: "Doküman oluşturulurken veya JSON ayrıştırılırken bir hata oluştu. Lütfen tekrar deneyin.",
        code: "",
        test: "",
        review: ""
      };
      setDocumentContent(fallbackData);
    } finally {
      setIsGenerating(false);
    }
  };

  const currentWorkspace = projects.flatMap(p => p.workspaces).find(w => w.id === currentWorkspaceId);

  const handleUpdateDocument = async (newContent: DocumentData) => {
    setDocumentContent(newContent);
    
    if (currentWorkspaceId) {
      try {
        await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
          document: newContent,
          lastUpdated: serverTimestamp()
        });
      } catch (err) {
        console.error("Failed to update document in Firestore:", err);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await auth.signOut();
      setUser(null);
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    } catch (error) {
      console.error("Logout error:", error);
    }
  };

  const handleUpdateUser = async (updatedUser: { name: string; role: string }) => {
    if (!user) return;
    
    try {
      const userRef = doc(db, 'users', user.uid);
      await updateDoc(userRef, {
        displayName: updatedUser.name,
        role: updatedUser.role
      });
      setUser(prev => prev ? { ...prev, ...updatedUser } : null);
    } catch (error) {
      console.error("Failed to update user profile:", error);
      alert("Profil güncellenirken bir hata oluştu.");
    }
  };

  const latestScoreMessage = [...messages].reverse().find(m => m.score !== undefined);
  const latestScore = latestScoreMessage?.score;
  const latestScoreExplanation = latestScoreMessage?.scoreExplanation;

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-theme-bg text-theme-text">Yükleniyor...</div>;
  }

  if (!user) {
    return <LandingPage onLogin={setUser} />;
  }

  if (!user.onboardingCompleted) {
    return <OnboardingPage user={user} onComplete={(updatedUser) => setUser({ ...updatedUser, onboardingCompleted: true })} />;
  }

  return (
    <div className="flex h-screen bg-theme-bg text-theme-text font-sans overflow-hidden selection:bg-theme-primary selection:text-theme-primary-fg transition-colors duration-300 relative">
      {/* Background Gradient for Glass Effect */}
      <div className="absolute inset-0 z-0 pointer-events-none overflow-hidden">
        <div className="absolute -top-[20%] -left-[10%] w-[50%] h-[50%] rounded-full bg-theme-primary/20 blur-[120px]" />
        <div className="absolute top-[40%] -right-[10%] w-[40%] h-[60%] rounded-full bg-theme-primary/10 blur-[100px]" />
        <div className="absolute -bottom-[20%] left-[20%] w-[60%] h-[50%] rounded-full bg-theme-primary/20 blur-[150px]" />
      </div>
      
      {showSettingsModal && (
        <SettingsModal 
          user={user}
          onClose={() => setShowSettingsModal(false)}
          onUpdateUser={handleUpdateUser}
          selectedModel={selectedModel}
          onUpdateModel={(model) => {
            setSelectedModel(model);
            localStorage.setItem('jetwork-model', model);
          }}
        />
      )}
      {showNewItemModal && (
        <NewItemModal 
          projects={projects}
          currentProjectId={currentProjectId}
          onClose={() => setShowNewItemModal(false)} 
          onSubmit={handleNewWorkspace} 
        />
      )}
      {showNewProjectModal && (
        <NewProjectModal 
          onClose={() => setShowNewProjectModal(false)} 
          onSubmit={handleNewProject} 
        />
      )}
      {showManageParticipantsModal && currentWorkspace && user && (
        <ManageParticipantsModal
          collaborators={currentWorkspace.collaborators}
          currentUserId={user.uid}
          ownerId={currentWorkspace.ownerId}
          onClose={() => setShowManageParticipantsModal(false)}
          onAddParticipant={handleAddParticipant}
          onRemoveParticipant={handleRemoveParticipant}
          onLeaveWorkspace={handleLeaveWorkspace}
        />
      )}
      {editingProject && (
        <EditProjectModal
          project={editingProject}
          onClose={() => setEditingProject(null)}
          onSubmit={handleEditProject}
        />
      )}
      {editingWorkspace && (
        <EditWorkspaceModal
          workspace={editingWorkspace}
          onClose={() => setEditingWorkspace(null)}
          onSubmit={handleEditWorkspace}
        />
      )}
      {deletingProject && (
        <ConfirmModal
          title="Projeyi Sil"
          message="Bu projeyi ve içindeki tüm çalışma alanlarını silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
          confirmText="Sil"
          onConfirm={handleDeleteProject}
          onCancel={() => setDeletingProject(null)}
        />
      )}
      {deletingWorkspace && (
        <ConfirmModal
          title="Çalışma Alanını Sil"
          message="Bu çalışma alanını silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
          confirmText="Sil"
          onConfirm={handleDeleteWorkspace}
          onCancel={() => setDeletingWorkspace(null)}
        />
      )}
      {!currentWorkspaceId && (
        <Sidebar 
          user={user}
          projects={projects} 
          currentWorkspaceId={currentWorkspaceId}
          currentProjectId={currentProjectId}
          onSelectWorkspace={handleSelectWorkspace}
          onSelectProject={handleSelectProject}
          onNewWorkspace={() => setShowNewItemModal(true)}
          onNewProject={() => setShowNewProjectModal(true)}
          onEditProject={setEditingProject}
          onDeleteProject={setDeletingProject}
          theme={theme}
          onThemeChange={setTheme}
          onLogout={handleLogout}
          onOpenSettings={() => setShowSettingsModal(true)}
        />
      )}
      <main className="flex-1 flex relative z-10">
        {!currentWorkspaceId ? (
          currentProjectId && projects.find(p => p.id === currentProjectId) ? (
            <ProjectDashboard 
              project={projects.find(p => p.id === currentProjectId)!}
              onSelectWorkspace={handleSelectWorkspace}
              onNewWorkspace={() => setShowNewItemModal(true)}
              onEditWorkspace={setEditingWorkspace}
              onDeleteWorkspace={setDeletingWorkspace}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center bg-theme-bg">
              <div className="text-center">
                <div className="w-16 h-16 bg-theme-surface border border-theme-border rounded-2xl flex items-center justify-center mx-auto mb-4 text-theme-text-muted">
                  <LayoutDashboard size={32} />
                </div>
                <h2 className="text-xl font-bold text-theme-text mb-2">JetWork'e Hoş Geldiniz</h2>
                <p className="text-theme-text-muted mb-6">Başlamak için sol menüden bir proje seçin.</p>
                <div className="flex items-center justify-center gap-4">
                  <button
                    onClick={() => setShowNewProjectModal(true)}
                    className="px-4 py-2 bg-theme-surface border border-theme-border hover:bg-theme-surface-hover text-theme-text rounded-md text-sm font-semibold transition-colors"
                  >
                    Yeni Proje
                  </button>
                </div>
              </div>
            </div>
          )
        ) : (
          <>
            <ChatPanel 
              key={currentWorkspaceId}
              messages={messages} 
              onSendMessage={handleSendMessage} 
              isGenerating={isGenerating || isDiscussing}
              issueKey={currentWorkspace?.issueKey}
              status={currentWorkspace?.status}
              title={currentWorkspace?.title}
              projectName={projects.find(p => p.workspaces.some(w => w.id === currentWorkspaceId))?.name}
              hasDocument={!!documentContent}
              onBack={() => setCurrentWorkspaceId(null)}
              activeUsers={activeUsers}
              collaborators={currentWorkspace?.collaborators}
              typingUsers={typingUsers}
              onTypingStart={() => {
                if (socketRef.current && currentWorkspaceId && user) {
                  socketRef.current.emit('typing_start', { itemId: currentWorkspaceId, userId: sessionId.current, userName: user.name });
                }
              }}
              onTypingEnd={() => {
                if (socketRef.current && currentWorkspaceId && user) {
                  socketRef.current.emit('typing_end', { itemId: currentWorkspaceId, userId: sessionId.current });
                }
              }}
              onToggleReaction={handleToggleReaction}
              currentUser={user}
              isAiActive={isAiActive}
              onToggleAiActive={() => {
                const newValue = !isAiActive;
                setIsAiActive(newValue);
                if (newValue && isZeroTouchMode) {
                  setIsZeroTouchMode(false);
                }
              }}
              isZeroTouchMode={isZeroTouchMode}
              onToggleZeroTouchMode={() => {
                const newValue = !isZeroTouchMode;
                setIsZeroTouchMode(newValue);
                if (newValue && isAiActive) {
                  setIsAiActive(false);
                }
              }}
              activeZeroTouchRoles={activeZeroTouchRoles}
              setActiveZeroTouchRoles={setActiveZeroTouchRoles}
              aiHandRaised={aiHandRaised}
              onAcceptAiHandRaise={handleAcceptAiHandRaise}
              onDismissAiHandRaise={() => setAiHandRaised(null)}
              selectedDocumentText={selectedDocumentText}
              onRestoreDocument={handleUpdateDocument}
              isLoadingWorkspace={isLoadingWorkspace}
              onManageParticipants={() => setShowManageParticipantsModal(true)}
            />
            <DocumentPanel 
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              documentContent={documentContent}
              onGenerate={handleGenerateDocument}
              isGenerating={isGenerating}
              isDiscussing={isDiscussing}
              hasMessages={messages.length > 0}
              collaborators={currentWorkspace?.collaborators}
              onUpdateDocument={handleUpdateDocument}
              onSelectionChange={setSelectedDocumentText}
              score={latestScore}
              scoreExplanation={latestScoreExplanation}
              messages={messages}
              onRestoreDocument={handleUpdateDocument}
              isLoadingWorkspace={isLoadingWorkspace}
            />
          </>
        )}
      </main>
    </div>
  );
}
