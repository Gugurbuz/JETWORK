import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, ThinkingLevel, Type, FunctionDeclaration } from '@google/genai';
import { Sidebar, ThemeType } from './components/Sidebar';
import { ChatPanel } from './components/ChatPanel';
import { DocumentPanel } from './components/DocumentPanel';
import { LandingPage } from './components/LandingPage';
import { NewItemModal } from './components/NewItemModal';
import { NewProjectModal } from './components/NewProjectModal';
import { ProjectDashboard } from './components/ProjectDashboard';
import { SettingsModal } from './components/SettingsModal';
import { Message, Project, Workspace, Collaborator, DocumentData, ActiveUser, TypingUser } from './types';
import { ChatResponseSchema, chatResponseJsonSchema, discussionJsonSchema } from './schemas';
import { LayoutDashboard } from 'lucide-react';
import { marked } from 'marked';
import { io, Socket } from 'socket.io-client';
import { parse as parsePartialJson } from 'partial-json';

// Initialize Gemini
// (Removed top-level initialization to prevent API key race conditions)

const MOCK_COLLABORATORS: Collaborator[] = [
  { id: '1', name: 'Gürkan Gürbüz', avatar: 'G', role: 'Kıdemli Analist', color: 'emerald' },
  { id: '2', name: 'Ayşe Yılmaz', avatar: 'A', role: 'Product Owner', color: 'blue' },
  { id: '3', name: 'Mehmet Demir', avatar: 'M', role: 'Lead Developer', color: 'purple' },
];

const ZERO_TOUCH_AGENTS = [
  {
    role: 'PO',
    name: 'Product Owner',
    instruction: "Sen bir Product Owner'sın. Kullanıcının talebini iş değeri (business value), müşteri deneyimi ve ürün vizyonu açısından değerlendir. KURAL 1: IT'nin karmaşık ve maliyetli (örn. Kafka, mikroservisler) çözümlerine itiraz et. 'Bu mimari Faz 1'in canlıya çıkış süresini ne kadar uzatır? Daha basit bir MVP yapamaz mıyız?' diyerek ekibi basitliğe zorla. KURAL 2: Müşteri deneyimini her şeyin önünde tut. KURAL 3: Kullanıcı belirtmese bile ROI (Yatırım Getirisi) ve Time-to-Market metriklerini her zaman gözet. Ekip teknik detaylarda boğulursa onları iş hedeflerine geri çek. KURAL 4 (KULLANICIYI DARRALMA): Kullanıcıya sürekli soru sorma! Sadece iş modelini tamamen bloke eden, kararsız kalınan çok kritik bir durum varsa kullanıcıya soru sor. Diğer tüm durumlarda inisiyatif al ve ekiple tartışarak en mantıklı kararı kendiniz verin. KURAL 5 (MAKSİMUM DÜŞÜNME SEVİYESİ): Karar vermeden önce adım adım düşün (Step-by-step reasoning). Tüm iş risklerini, pazar dinamiklerini ve alternatif senaryoları derinlemesine analiz et. İlk aklına gelen çözümü değil, en optimize edilmiş stratejiyi sun."
  },
  {
    role: 'BA',
    name: 'İş Analisti',
    instruction: "Sen bir Kıdemli İş Analistisin (Business Analyst). GÖREVİN: Kullanıcının talebini iş kurallarına ve süreçlere dönüştürmek. KURAL 1 (Sıfır Varsayım): Müşterinin mevcut altyapısını (As-Is) ASLA uydurma. KURAL 2 (Proaktif Keşif ve Araştırma): Kullanıcı sana 'şunları dikkate al' DEMESE BİLE, sen bir analist olarak yasal mevzuatları (KVKK/GDPR), SLA gereksinimlerini ve hata durumlarındaki (örn: sistem çökmesi) müşteri deneyimini otomatik olarak düşün. İnisiyatif al! Sektör standartlarını veya rakip analizlerini bilmiyorsan hemen internette arama yap (googleSearch kullan). KURAL 3: IT'nin önerdiği teknik çözümlerin iş değerini sorgula. KURAL 4 (Dokümantasyon): Doküman üretirken MUTLAKA BABOK standartlarına uy. BRD formatında, Use Case'ler ve Acceptance Criteria'lar ile detaylı bir analiz yaz. KURAL 5 (KULLANICIYI DARRALMA): Kullanıcıya sürekli soru sorma! Sadece projeyi tamamen bloke eden, kararsız kalınan çok kritik bir durum varsa kullanıcıya soru sor. Diğer tüm durumlarda best-practice'lere göre inisiyatif al ve ekiple tartışarak en mantıklı kararı kendiniz verin. KURAL 6 (MAKSİMUM DÜŞÜNME SEVİYESİ): Süreçleri tasarlarken adım adım düşün. Tüm istisnai durumları (exception paths), veri akışındaki olası tıkanıklıkları ve paydaş etkileşimlerini derinlemesine analiz et."
  },
  {
    role: 'IT',
    name: 'Yazılım Mimarı',
    instruction: "Sen bir Kıdemli Yazılım Mimarı (Software Architect) ve Tech Lead'sin. GÖREVİN: Sistemin teknik mimarisini, entegrasyon noktalarını ve veritabanı yapısını tasarlamak. KURAL 1 (Proaktif Mimari ve Araştırma): Kullanıcı sana 'API limitlerini veya güvenliği dikkate al' DEMESE BİLE, sen bir mimar olarak bunları DÜŞÜNMEK ZORUNDASIN. Herhangi bir dış entegrasyon (Stripe, SAP vb.) tasarlarken İLK İŞİN internetten (googleSearch) güncel rate-limit'leri, webhook imza (signature) doğrulama yöntemlerini, yetkilendirme (OAuth vb.) standartlarını araştırmak olmalı. Mimariyi bu gerçek verilere göre kur. KURAL 2 (Trade-off): Mimariyi gereksiz yere karmaşıklaştırma. PO veya QA itiraz ederse, maliyet/performans ödünleşimlerini tartış. KURAL 3: Diğer ajanların fikirlerini hemen onaylama, teknik zorluklarını belirt. KURAL 4 (Dokümantasyon): Doküman üretirken MUTLAKA TOGAF ve C4 Model standartlarına uy. SDD formatında, Sequence diyagramı mantığı ve API Kontratları ile detaylı bir mimari yaz. KURAL 5 (KULLANICIYI DARRALMA): Kullanıcıya sürekli soru sorma! Sadece mimariyi tamamen bloke eden, kararsız kalınan çok kritik bir durum varsa kullanıcıya soru sor. Diğer tüm durumlarda sektör standartlarına (best-practices) göre inisiyatif al ve ekiple tartışarak en mantıklı kararı kendiniz verin. KURAL 6 (MAKSİMUM DÜŞÜNME SEVİYESİ): Mimariyi kurarken adım adım düşün (Step-by-step reasoning). Single point of failure (tek nokta hataları), darboğazlar (bottlenecks), veri tutarlılığı (ACID/BASE) ve ölçeklenebilirlik senaryolarını derinlemesine analiz et. İlk aklına gelen çözümü değil, en sağlam (robust) çözümü sun."
  },
  {
    role: 'QA',
    name: 'Test Uzmanı',
    instruction: "Sen bir Kıdemli Test Otomasyon Mühendisi ve QA Lead'sin. GÖREVİN: Şeytanın Avukatı rolünü üstlenmek. KURAL 1 (Çatışma): Diğer ajanların (özellikle IT ve BA) fikirlerini ASLA hemen onaylama. Sürekli 'Bunun testi nasıl yapılacak?', 'Elimizde bu test için yeterli veri var mı?' gibi zorlayıcı sorular sor. KURAL 2 (Proaktif Güvenlik ve Araştırma): Kullanıcı belirtmese bile, dış entegrasyonlarda webhook güvenliği, rate-limit aşımı (429 hataları) ve veri sızıntısı gibi senaryoları otomatik olarak test planına dahil et. Seçilen teknoloji yığınıyla ilgili bilinen son güvenlik açıklarını (CVE) veya kronik sorunları internette ara (googleSearch kullan). KURAL 3: Varsayımları bul ve çürüt. KURAL 4 (Dokümantasyon): Doküman üretirken MUTLAKA IEEE 829 standartlarına uy. Test Planı, Edge Case'ler ve BDD senaryoları ile detaylı bir test dokümanı yaz. KURAL 5 (KULLANICIYI DARRALMA): Kullanıcıya sürekli soru sorma! Sadece test sürecini tamamen bloke eden, kararsız kalınan çok kritik bir durum varsa kullanıcıya soru sor. Diğer tüm durumlarda inisiyatif al ve ekiple tartışarak en mantıklı kararı kendiniz verin. KURAL 6 (MAKSİMUM DÜŞÜNME SEVİYESİ): Test senaryolarını oluştururken adım adım düşün. Sadece 'happy path' değil, en uç edge-case'leri, race condition'ları ve güvenlik açıklarını derinlemesine analiz et."
  },
  {
    role: 'SM',
    name: 'Scrum Master',
    instruction: "Sen bir Scrum Master ve Agile Koçusun. GÖREVİN: Toplantıyı modere etmek ve ekibin doğru yolda kalmasını sağlamak. KURAL 1 (Echo Chamber Önleme): Eğer ekip sürekli birbirini onaylıyorsa araya gir ve zıt görüş iste. KURAL 2 (Kullanıcıya Danışma): SADECE VE SADECE ekibin kendi arasında çözemediği, projeyi tamamen bloke eden kritik bir karar (blocker) varsa tartışmayı durdur ve JSON çıktısında 'requiresUserInput: true' göndererek kullanıcıya net sorular sor. Ufak tefek detaylar için kullanıcıyı rahatsız etme, ekibin kendi arasında karar almasını sağla. KURAL 3: Kullanıcıya soru sorarken mesajına MUTLAKA '@KullanıcıAdı' diyerek başla ve soruları 1., 2., 3. şeklinde alt alta maddeler halinde yaz. KURAL 4: Tüm sorular cevaplandıysa ve MVP üzerinde uzlaşıldıysa 'isDocumentationPhase: true' yaparak dokümantasyona geçilmesini sağla. KURAL 5 (MAKSİMUM DÜŞÜNME SEVİYESİ): Ekibin tartışma dinamiklerini adım adım analiz et. Gözden kaçan bir bağımlılık (dependency) veya gizli bir risk olup olmadığını derinlemesine sorgula."
  },
  {
    role: 'Orchestrator',
    name: 'Orkestratör',
    instruction: "Sen bir Proje Yöneticisi ve Orkestratörsün. GÖREVİN: Tüm ajanların çıktılarını denetlemek, çelişkileri bulmak ve nihai dokümanı onaylamak. KURAL 1 (Proaktif Denetim): Ekibin dış entegrasyonlarda güvenlik (webhook, auth), performans (rate-limit) ve yasal uyumluluk (KVKK/GDPR) gibi kritik metrikleri kullanıcı söylemeden akıl edip etmediğini denetle. Eğer atlamışlarsa onlara araştırma görevi ver. KURAL 2: Eğer ajanlar uydurma veri kullandıysa veya birbirlerini körü körüne onayladılarsa puanı (score) acımasızca kır. KURAL 3: Eğer ajanlar trade-off tartışması yaptıysa, internetten gerçek kanıtlar (grounding) buldularsa yüksek puan ver. KURAL 4: 'scoreExplanation' alanında ekibin problem çözme metodolojisini detaylıca açıkla. KURAL 5 (SÜREKLİ İYİLEŞTİRME): Eğer verdiğin puan 90'ın altındaysa, eksikleri tespit et ve JSON çıktısında 'needsRevision: true' göndererek ekibin dokümanları baştan yazmasını sağla. KURAL 6 (REVIEW): 'document.review' alanına toplantı notlarını detaylıca yaz. KURAL 7 (KULLANICIYI DARRALMA): Ekibin kullanıcıya gereksiz sorular sormasını engelle. Sadece kritik blocker'lar için kullanıcıya gidilmesini sağla. KURAL 8 (MAKSİMUM DÜŞÜNME SEVİYESİ): Tüm ekibin çıktılarını adım adım (step-by-step) ve eleştirel bir gözle analiz et. En ince detaya kadar in, mantık hatalarını ve entegrasyon boşluklarını bul."
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
- BPMN: Süreç akışları için mutlaka 'bpmn' alanına geçerli bir BPMN 2.0 XML kodu üret.
- İNKREMENTAL GÜNCELLEME: Mevcut bir doküman varsa, onu tamamen silip baştan yazma. Mevcut bilgileri koru, yeni kararları ve detayları üzerine ekle. Dokümanı her adımda daha da zenginleştir.
- EN KRİTİK KURAL (DOKÜMAN EZİLMESİNİ ÖNLEMEK İÇİN): JSON çıktısı üretirken 'document' objesi içine SADECE güncellediğin veya yeni eklediğin alanları koy. Değiştirmediğin alanları KESİNLİKLE JSON'a dahil etme (null bile gönderme, o key'i hiç yazma). Örneğin sadece BA Analizini güncellediysen sadece 'businessAnalysis' alanını gönder, 'code' veya 'test' alanlarını JSON'a koyma! Böylece mevcut dokümandaki diğer bilgiler silinmez.

ÇOK ÖNEMLİ: Eğer kullanıcı senden bir "doküman oluşturmanı", "mimari çizmeni", "kod yazmanı" veya "test senaryosu oluşturmanı" isterse, SOHBET MESAJINDA (message alanı) UZUN UZUN DOKÜMAN İÇERİĞİNİ KESİNLİKLE YAZMA. Bunun yerine SADECE sana sağlanan JSON şemasındaki 'document' objesinin altındaki ilgili alanları (businessAnalysis, code, test, bpmn) doldurarak dokümanı sağ taraftaki panele aktar. 
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
  const [user, setUser] = useState<{ name: string; role: string } | null>(() => {
    const saved = localStorage.getItem('ai-business-analyst-user');
    return saved ? JSON.parse(saved) : null;
  });

  const [showNewItemModal, setShowNewItemModal] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const socketRef = useRef<Socket | null>(null);

  const [projects, setProjects] = useState<Project[]>(() => {
    const saved = localStorage.getItem('jetwork-projects-data');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse local storage data', e);
      }
    }
    
    // Migration from old data
    const oldSaved = localStorage.getItem('ai-business-analyst-data');
    if (oldSaved) {
      try {
        const oldAnalyses = JSON.parse(oldSaved);
        if (oldAnalyses && oldAnalyses.length > 0) {
          const defaultProject: Project = {
            id: 'default-project',
            name: 'Varsayılan Proje',
            description: 'Eski analizlerden aktarılan proje',
            workspaces: oldAnalyses.map((a: any) => ({
              ...a,
              issueKey: a.jiraCode || `JET-${Math.floor(Math.random() * 900) + 100}`,
              type: a.requestType === 'Support' ? 'Support' : 'Development'
            })),
            createdAt: Date.now(),
            lastUpdated: Date.now()
          };
          return [defaultProject];
        }
      } catch (e) {
        console.error('Failed to migrate old data', e);
      }
    }
    return [];
  });
  
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(() => {
    return localStorage.getItem('jetwork-current-workspace-id') || localStorage.getItem('ai-business-analyst-current-id');
  });
  
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(() => {
    return localStorage.getItem('jetwork-current-project-id');
  });
  
  const [messages, setMessages] = useState<Message[]>([]);
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isAiActive, setIsAiActive] = useState(false);
  const [isZeroTouchMode, setIsZeroTouchMode] = useState(false);
  const [aiHandRaised, setAiHandRaised] = useState<string | null>(null);
  const [documentContent, setDocumentContent] = useState<DocumentData | null>(null);
  const [selectedDocumentText, setSelectedDocumentText] = useState('');
  const [activeTab, setActiveTab] = useState('BA Analiz');
  const [theme, setTheme] = useState<ThemeType>(() => {
    return (localStorage.getItem('jetwork-theme') as ThemeType) || 'monochrome';
  });
  const sessionId = useRef(Math.random().toString(36).substring(7));

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

      socketRef.current.on('new_message', (data: any) => {
        setMessages(prev => {
          // Prevent duplicates
          if (prev.some(m => m.id === data.id)) return prev;
          
          const newMsg: Message = {
            id: data.id,
            role: data.isAi ? 'model' : 'user',
            text: data.text,
            senderName: data.senderName,
            senderRole: data.senderRole,
            attachments: data.attachments
          };
          return [...prev, newMsg];
        });
      });

      socketRef.current.on('document_updated', (doc: DocumentData) => {
        setDocumentContent(doc);
      });

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

      socketRef.current.on('ai_stream_chunk', (data: { itemId: string, id: string, text: string, thinkingText?: string, groundingUrls?: { uri: string; title: string }[], agentRole?: string, score?: number, scoreExplanation?: string }) => {
        setMessages(prev => {
          const exists = prev.find(m => m.id === data.id);
          if (exists) {
            return prev.map(m => m.id === data.id ? { 
              ...m, 
              text: data.text, 
              thinkingText: data.thinkingText,
              score: data.score,
              scoreExplanation: data.scoreExplanation,
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
              isTyping: true,
              ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
            }];
          }
        });
      });

      socketRef.current.on('ai_stream_end', (data: { itemId: string, id: string, text: string, thinkingText?: string, groundingUrls?: { uri: string; title: string }[], agentRole?: string, score?: number, scoreExplanation?: string }) => {
        setMessages(prev => prev.map(m =>
          m.id === data.id ? { 
            ...m, 
            text: data.text, 
            thinkingText: data.thinkingText, 
            isTyping: false,
            score: data.score,
            scoreExplanation: data.scoreExplanation,
            ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
          } : m
        ));
        
        setProjects(prev => prev.map(p => ({
          ...p,
          workspaces: p.workspaces.map(w => {
            if (w.id === data.itemId) {
              const updatedMessages = w.messages ? [...w.messages] : [];
              const finalMsg: Message = {
                id: data.id,
                role: 'model',
                text: data.text,
                thinkingText: data.thinkingText,
                senderName: data.agentRole ? ZERO_TOUCH_AGENTS.find(a => a.role === data.agentRole)?.name || 'JetWork AI' : 'JetWork AI',
                senderRole: data.agentRole ? ZERO_TOUCH_AGENTS.find(a => a.role === data.agentRole)?.name || 'Sistem Asistanı' : 'Sistem Asistanı',
                agentRole: data.agentRole,
                score: data.score,
                scoreExplanation: data.scoreExplanation,
                ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
              };
              const existingIdx = updatedMessages.findIndex(m => m.id === data.id);
              if (existingIdx >= 0) {
                updatedMessages[existingIdx] = finalMsg;
              } else {
                updatedMessages.push(finalMsg);
              }
              return { ...w, messages: updatedMessages, lastUpdated: Date.now() };
            }
            return w;
          })
        })));
      });

      socketRef.current.on('reaction_updated', (data: { messageId: string, reactions: any[] }) => {
        setMessages(prev => prev.map(m => 
          m.id === data.messageId ? { ...m, reactions: data.reactions } : m
        ));
        
        setProjects(prev => prev.map(p => ({
          ...p,
          workspaces: p.workspaces.map(w => {
            if (w.id === currentWorkspaceId) {
              const updatedMessages = w.messages ? w.messages.map(m => 
                m.id === data.messageId ? { ...m, reactions: data.reactions } : m
              ) : [];
              return { ...w, messages: updatedMessages };
            }
            return w;
          })
        })));
      });

      return () => {
        socketRef.current?.disconnect();
      };
    }
  }, [user]);

  // Fetch projects from server on mount
  useEffect(() => {
    if (user) {
      fetch('/api/projects')
        .then(res => res.json())
        .then(data => {
          if (data.success && data.data && data.data.length > 0) {
            setProjects(data.data);
            localStorage.setItem('jetwork-projects-data', JSON.stringify(data.data));
          }
        })
        .catch(err => console.warn("Backend not available, using local state", err));
    }
  }, [user]);

  // Join room when workspace changes
  useEffect(() => {
    if (currentWorkspaceId && socketRef.current && user) {
      socketRef.current.emit('join_room', { 
        itemId: currentWorkspaceId, 
        user: { id: sessionId.current, name: user.name, role: user.role } 
      });
      
      // Fetch full item data from server
      fetch(`/api/items/${currentWorkspaceId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success) {
            setMessages(data.data.messages || []);
            setDocumentContent(data.data.document || null);
          }
        })
        .catch(err => console.error("Failed to fetch item data:", err));
    }
  }, [currentWorkspaceId]);

  // Save user to localStorage
  useEffect(() => {
    if (user) {
      localStorage.setItem('ai-business-analyst-user', JSON.stringify(user));
    } else {
      localStorage.removeItem('ai-business-analyst-user');
    }
  }, [user]);

  // Save to localStorage whenever projects change
  useEffect(() => {
    localStorage.setItem('jetwork-projects-data', JSON.stringify(projects));
  }, [projects]);

  // Save current workspace ID
  useEffect(() => {
    if (currentWorkspaceId) {
      localStorage.setItem('jetwork-current-workspace-id', currentWorkspaceId);
    } else {
      localStorage.removeItem('jetwork-current-workspace-id');
    }
  }, [currentWorkspaceId]);

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

    if (shareId) {
      // Fetch shared workspace
      fetch(`/api/share/${shareId}`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.data) {
            const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
            const newWorkspace: Workspace = { 
              id: newId, 
              issueKey: generateJiraCode(),
              title: 'Paylaşılan Çalışma Alanı', 
              type: 'Development',
              status: 'Draft',
              messages: [],
              document: data.data, 
              createdAt: Date.now(),
              lastUpdated: Date.now(),
              collaborators: MOCK_COLLABORATORS
            };
            
            setProjects(prev => {
              const defaultProject = prev.find(p => p.id === 'default-project');
              if (defaultProject) {
                return prev.map(p => p.id === 'default-project' ? { ...p, workspaces: [newWorkspace, ...p.workspaces] } : p);
              } else {
                return [{
                  id: 'default-project',
                  name: 'Varsayılan Proje',
                  description: '',
                  workspaces: [newWorkspace],
                  createdAt: Date.now(),
                  lastUpdated: Date.now()
                }, ...prev];
              }
            });
            
            setCurrentWorkspaceId(newId);
            setMessages([]);
            setDocumentContent(data.data);
            
            // Remove shareId from URL
            window.history.replaceState({}, document.title, window.location.pathname);
          }
        })
        .catch(err => console.error("Failed to load shared workspace:", err));
        
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

  const generateJiraCode = () => `JET-${Math.floor(Math.random() * 900) + 100}`;

  const handleSelectWorkspace = (id: string) => {
    setCurrentWorkspaceId(id);
    setCurrentProjectId(null);
    setTypingUsers([]);
    const workspace = projects.flatMap(p => p.workspaces).find(w => w.id === id);
    if (workspace) {
      setDocumentContent(workspace.document || null);
      setMessages(workspace.messages || []); 
    }
  };

  const handleSelectProject = (id: string) => {
    setCurrentProjectId(id);
    setCurrentWorkspaceId(null);
  };

  const handleNewProject = async (data: { name: string; description: string }) => {
    const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    
    try {
      await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          name: data.name,
          description: data.description
        })
      });
    } catch (err) {
      console.warn("Backend not available, using local state", err);
    }
    
    setProjects(prev => {
      const newProjects = [{
        id: newId,
        name: data.name,
        description: data.description,
        workspaces: [],
        createdAt: Date.now(),
        lastUpdated: Date.now()
      }, ...prev];
      localStorage.setItem('jetwork-projects-data', JSON.stringify(newProjects));
      return newProjects;
    });
    
    setShowNewProjectModal(false);
    setCurrentProjectId(newId);
    setCurrentWorkspaceId(null);
  };

  // Initialize a new workspace
  const handleNewWorkspace = async (data: { projectId: string; itemNumber: string; title: string; team: { name: string; role: string }[] }) => {
    const newId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    
    // Create on server
    try {
      await fetch('/api/items', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: newId,
          projectId: data.projectId,
          itemNumber: data.itemNumber,
          title: data.title,
          team: data.team
        })
      });
    } catch (err) {
      console.warn("Backend not available, using local state", err);
    }

    const newWorkspace: Workspace = { 
      id: newId, 
      issueKey: data.itemNumber,
      title: data.title, 
      type: 'Development',
      status: 'Draft',
      messages: [],
      document: null, 
      createdAt: Date.now(),
      lastUpdated: Date.now(),
      collaborators: data.team.map((member, i) => ({
        id: i.toString(),
        name: member.name,
        avatar: member.name.charAt(0),
        role: member.role,
        color: ['emerald', 'blue', 'purple'][i % 3]
      }))
    };
    
    setProjects(prev => {
      const targetProject = prev.find(p => p.id === data.projectId);
      let newProjects;
      if (targetProject) {
        newProjects = prev.map(p => p.id === data.projectId ? { ...p, workspaces: [newWorkspace, ...p.workspaces] } : p);
      } else {
        newProjects = prev;
      }
      localStorage.setItem('jetwork-projects-data', JSON.stringify(newProjects));
      return newProjects;
    });
    
    setCurrentWorkspaceId(newId);
    setMessages([]);
    setDocumentContent(null);
    setShowNewItemModal(false);
  };



  const handleToggleReaction = (messageId: string, emoji: string) => {
    if (!user || !currentWorkspaceId || !socketRef.current) return;
    
    socketRef.current.emit('toggle_reaction', {
      itemId: currentWorkspaceId,
      messageId,
      emoji,
      userName: user.name
    });
  };

  // Send a message
  const runZeroTouchMode = async (newUserMessage: Message, attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[]) => {
    if (!currentWorkspaceId) return;

    setIsGenerating(true);
    try {
      let currentMessages = [...messages, newUserMessage];
      let currentDocument = documentContent ? { ...documentContent } : null;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });
      const uploadedFiles: { fileUri: string; mimeType: string }[] = [];

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.mimeType === 'application/pdf' && att.file) {
            try {
              const fileUpload = await ai.files.upload({
                file: att.file,
                config: { displayName: att.name || 'document.pdf' }
              });
              let getFile = await ai.files.get({ name: fileUpload.name });
              while (getFile.state === 'PROCESSING') {
                await new Promise(resolve => setTimeout(resolve, 3000));
                getFile = await ai.files.get({ name: fileUpload.name });
              }
              if (getFile.state !== 'FAILED') {
                uploadedFiles.push({ fileUri: getFile.uri, mimeType: getFile.mimeType });
              }
            } catch (err) {
              console.error("Error uploading PDF:", err);
            }
          }
        }
      }

      // PHASE 1: Discussion
      let isDocumentationPhase = false;
      let needsUserInput = false;
      let turnCount = 0;
      const MAX_TURNS = 15;

      while (!isDocumentationPhase && !needsUserInput && turnCount < MAX_TURNS) {
        turnCount++;
        
        const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
        
        const tempAiMessage: Message = {
          id: aiMsgId,
          role: 'model',
          text: '',
          senderName: 'Ekip',
          senderRole: 'Tartışma',
          isTyping: true
        };
        
        setMessages(prev => [...prev, tempAiMessage]);

        const contents: any[] = [];
        let prompt = "Sen bir toplantı odasındaki yapay zeka ajanlarını yöneten bir simülatörsün.\n";
        prompt += "Odada şu ajanlar var:\n";
        ZERO_TOUCH_AGENTS.forEach(a => {
          prompt += `- ${a.role} (${a.name}): ${a.instruction}\n`;
        });
        
        prompt += "\nSohbet Geçmişi:\n";
        currentMessages.slice(-20).forEach(m => {
          prompt += `${m.senderName || 'Kullanıcı'} (${m.senderRole || 'Bilinmiyor'}): ${m.text}\n`;
        });

        const userName = user?.name || 'Kullanıcı';
        prompt += `\n\nÖNEMLİ NOT: Kullanıcının adı "${userName}". Eğer kullanıcıya hitap edecekseniz veya soru soracaksanız MUTLAKA @${userName} şeklinde etiketleyin. Eğer birden fazla soru soracaksanız, soruları metin içine gömmeyin, kesinlikle 1., 2., 3. şeklinde alt alta maddeler halinde (bullet points) yazın.`;

        prompt += "\n\nGörev: Sohbet geçmişine bakarak, sıradaki en mantıklı konuşmacı kim olmalıysa onun rolünü seç (agentRole) ve onun ağzından bir yanıt üret (message). Eğer konu yeterince tartışıldıysa ve herkes hemfikirse, SM rolüyle 'isDocumentationPhase' değerini true yap. Konuşmalar sırayla olmak zorunda değil, bağlama göre en uygun ajanı seç.";
        
        prompt += "\n\nKRİTİK KURAL: Ajanlar kendi aralarında tartışarak en doğru kararı vermelidir. Kullanıcıya (müşteriye) soru sormaktan KESİNLİKLE KAÇININ. Sadece ve sadece projeyi tamamen durduran, hiçbir varsayım yapılamayacak kadar kritik bir 'blocker' varsa `requiresUserInput` değerini true yapın. Aksi takdirde kendi aranızda uzlaşın, en mantıklı varsayımı yapın ve karara varın.";
        
        prompt += "\n\nUYARI: Çıktı token sınırına (8192) takılmamak ve mesajın yarım kalmasını önlemek için düşünme (thinking) sürecini çok fazla uzatmayın. Doğrudan konuya ve tartışmaya odaklanın.";

        const parts: any[] = [{ text: prompt }];

        if (attachments && attachments.length > 0) {
          for (const att of attachments) {
            if (att.mimeType !== 'application/pdf') {
              parts.push({ inlineData: { data: att.data, mimeType: att.mimeType } });
            }
          }
        }
        for (const uf of uploadedFiles) {
          parts.push({ fileData: { fileUri: uf.fileUri, mimeType: uf.mimeType } });
        }

        contents.push({ role: 'user', parts });

        try {
          const responseStream = await callAiWithRetry(() => ai.models.generateContentStream({
            model: "gemini-3-flash-preview",
            contents: contents,
            config: {
              systemInstruction: "Sen bir toplantı simülatörüsün. Sadece JSON formatında yanıt ver.",
              thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH, includeThoughts: true },
              responseMimeType: "application/json",
              responseSchema: discussionJsonSchema,
              maxOutputTokens: 8192,
              tools: [{ googleSearch: {} }]
            }
          }));

          let fullText = '';
          let fullThinkingText = '';
          let accumulatedJson = '';
          let currentAgentRole = '';
          let currentAgentName = 'Ekip';
          let currentAgentTitle = 'Tartışma';
          let groundingUrls: { uri: string; title: string }[] = [];

          for await (const chunk of responseStream) {
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
                  if (parsed.isDocumentationPhase !== undefined) isDocumentationPhase = parsed.isDocumentationPhase;
                  if (parsed.requiresUserInput !== undefined) needsUserInput = parsed.requiresUserInput;
                } else {
                  fullText = jsonToParse;
                }
              } catch (e) {
                fullText = jsonToParse;
              }
            }
            
            setMessages(prev => prev.map(m => 
              m.id === aiMsgId ? { 
                ...m, 
                text: fullText, 
                thinkingText: fullThinkingText,
                senderName: currentAgentName,
                senderRole: currentAgentTitle,
                agentRole: currentAgentRole,
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
                groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined
              });
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
            ...(groundingUrls.length > 0 ? { groundingUrls } : {})
          };

          setMessages(prev => prev.map(m => m.id === aiMsgId ? finalMsg : m));
          currentMessages.push(finalMsg);

          setProjects(prev => prev.map(p => ({
            ...p,
            workspaces: p.workspaces.map(w => {
              if (w.id === currentWorkspaceId) {
                return { ...w, messages: [...(w.messages || []), finalMsg], lastUpdated: Date.now() };
              }
              return w;
            })
          })));

          if (socketRef.current) {
            socketRef.current.emit('ai_stream_end', {
              itemId: currentWorkspaceId,
              id: aiMsgId,
              text: fullText,
              thinkingText: fullThinkingText,
              agentRole: currentAgentRole,
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
            senderRole: 'Hata'
          }]);
          break;
        }
      }

      // PHASE 2: Documentation
      if (!needsUserInput && (isDocumentationPhase || turnCount >= MAX_TURNS)) {
        if (turnCount >= MAX_TURNS && !isDocumentationPhase) {
          const timeoutMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
          const timeoutMsg: Message = {
            id: timeoutMsgId,
            role: 'model',
            text: "⏱️ **Tartışma Süresi Doldu:** Ekip maksimum tartışma süresine ulaştı. Mevcut kararlar üzerinden dokümantasyon aşamasına geçiliyor.",
            senderName: 'Sistem',
            senderRole: 'Bilgi'
          };
          setMessages(prev => [...prev, timeoutMsg]);
          currentMessages.push(timeoutMsg);
        }

        let docNeedsRevision = true;
        let docLoopCount = 0;
        const MAX_DOC_LOOPS = 5; // Increased to allow more revisions until score >= 90
        let lastScore = 0;

        while (docNeedsRevision && docLoopCount < MAX_DOC_LOOPS) {
          docLoopCount++;
          docNeedsRevision = false; // Assume it's fine unless Orchestrator says otherwise

          const docAgents = ZERO_TOUCH_AGENTS.filter(a => ['BA', 'IT', 'QA', 'Orchestrator'].includes(a.role));
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
          isTyping: true
        };
        
        setMessages(prev => [...prev, tempAiMessage]);

        const contents: any[] = [];
        let prompt = "Sohbet Geçmişi ve Tartışma Sonucu:\n";
        currentMessages.slice(-20).forEach(m => {
          prompt += `${m.senderName || 'Kullanıcı'} (${m.senderRole || 'Bilinmiyor'}): ${m.text}\n`;
        });

        const userName = user?.name || 'Kullanıcı';
        prompt += `\n\nSenin Rolün ve Görevin:\n${agent.instruction}\n\nÖNEMLİ NOT: Kullanıcının adı "${userName}". Eğer kullanıcıya hitap edeceksen veya soru soracaksan MUTLAKA @${userName} şeklinde etiketle. Eğer birden fazla soru soracaksan, soruları metin içine gömme, kesinlikle 1., 2., 3. şeklinde alt alta maddeler halinde (bullet points) yaz.\n\nLütfen yukarıdaki uzlaşılan çözüme göre kendi dokümantasyon alanını GÜNCELLE ve GENİŞLET. Mevcut dokümandaki bilgileri koru, eksikleri tamamla ve yeni kararları ekle. Dokümanı tamamen silip baştan yazma, üzerine ekleyerek ilerle. Kullanıcıya kısa bir bilgi mesajı ver (örn: "İş analizi dokümanı güncellendi.").`;
        prompt += `\n\nDİKKAT: Ürettiğin uzun metinleri, HTML/XML kodlarını ASLA 'message' alanına yazma. 'message' alanı sadece kullanıcıya vereceğin 1-2 cümlelik kısa bir bilgi mesajıdır. Tüm teknik veriyi, testleri ve kodları SADECE 'document' objesinin içindeki ilgili alanlara koy.`;
        prompt += `\n\nEN KRİTİK KURAL (DOKÜMAN EZİLMESİNİ ÖNLEMEK İÇİN): JSON çıktısı üretirken 'document' objesi içine SADECE kendi rolünle ilgili alanı ekle. Diğer ajanların alanlarını KESİNLİKLE JSON'a dahil etme (null bile gönderme, o key'i hiç yazma). Örneğin BA isen sadece 'businessAnalysis' alanını gönder, 'code' veya 'test' alanlarını JSON'a koyma! Böylece diğer ajanların yazdıkları silinmez.`;
        prompt += `\n\nKRİTİK UYARI: Çıktı token sınırına (8192) takılmamak ve dokümanın yarım kalmasını önlemek için düşünme (thinking) sürecini gereksiz yere uzatma. Doğrudan dokümanı oluşturmaya ve güncellemeye odaklan.`;
        
        if (agent.role !== 'IT' && agent.role !== 'Orchestrator') {
          prompt += `\nDİKKAT: BPMN diyagramını SADECE IT veya Orkestratör üretebilir. Sen 'bpmn' alanını boş bırak.`;
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
            if (att.mimeType !== 'application/pdf') {
              parts.push({ inlineData: { data: att.data, mimeType: att.mimeType } });
            }
          }
        }
        for (const uf of uploadedFiles) {
          parts.push({ fileData: { fileUri: uf.fileUri, mimeType: uf.mimeType } });
        }

        contents.push({ role: 'user', parts });

        try {
          const responseStream = await callAiWithRetry(() => ai.models.generateContentStream({
            model: "gemini-3-flash-preview",
            contents: contents,
            config: {
              systemInstruction: SYSTEM_INSTRUCTION,
              thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH, includeThoughts: true },
              responseMimeType: "application/json",
              responseSchema: chatResponseJsonSchema,
              maxOutputTokens: 8192,
              tools: [{ googleSearch: {} }]
            }
          }));

          let fullText = '';
          let fullThinkingText = '';
          let accumulatedJson = '';
          let finalScore: number | undefined = undefined;
          let finalScoreExplanation: string | undefined = undefined;
          let tokenCount = 0;
          let groundingUrls: { uri: string; title: string }[] = [];

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
                  if (parsed.score !== undefined) {
                    finalScore = parsed.score;
                    lastScore = parsed.score;
                  }
                  if (parsed.scoreExplanation) finalScoreExplanation = parsed.scoreExplanation;
                  if (parsed.needsRevision !== undefined) docNeedsRevision = parsed.needsRevision;
                  
                  // Force revision if score < 90 and it's the Orchestrator
                  if (agent.role === 'Orchestrator' && finalScore !== undefined && finalScore < 90) {
                    docNeedsRevision = true;
                  }

                  if (parsed.document) {
                    setDocumentContent(prev => {
                      const newDoc = { ...prev } as DocumentData;
                      if (parsed.document.businessAnalysis) newDoc.businessAnalysis = marked.parse(parsed.document.businessAnalysis) as string;
                      if (parsed.document.code) newDoc.code = marked.parse(parsed.document.code) as string;
                      if (parsed.document.test) newDoc.test = marked.parse(parsed.document.test) as string;
                      if (parsed.document.review) newDoc.review = marked.parse(parsed.document.review) as string;
                      if (parsed.document.bpmn) newDoc.bpmn = parsed.document.bpmn;
                      if (finalScore !== undefined) newDoc.score = finalScore;
                      if (finalScoreExplanation) newDoc.scoreExplanation = finalScoreExplanation;
                      currentDocument = newDoc;
                      
                      if (socketRef.current && currentWorkspaceId) {
                        socketRef.current.emit('update_document', { itemId: currentWorkspaceId, document: newDoc });
                      }
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
            
            setMessages(prev => prev.map(m => 
              m.id === aiMsgId ? { 
                ...m, 
                text: fullText, 
                thinkingText: fullThinkingText,
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
          }

          const finalMsg: Message = {
            id: aiMsgId,
            role: 'model',
            text: fullText,
            thinkingText: fullThinkingText,
            senderName: agent.name,
            senderRole: agent.name,
            agentRole: agent.role,
            score: finalScore,
            scoreExplanation: finalScoreExplanation,
            tokenCount: tokenCount,
            thinkingTime: Math.round((Date.now() - startTime) / 1000),
            ...(groundingUrls.length > 0 ? { groundingUrls } : {})
          };

          setMessages(prev => prev.map(m => m.id === aiMsgId ? finalMsg : m));
          currentMessages.push(finalMsg);

          setProjects(prev => prev.map(p => ({
            ...p,
            workspaces: p.workspaces.map(w => {
              if (w.id === currentWorkspaceId) {
                return { ...w, messages: [...(w.messages || []), finalMsg], lastUpdated: Date.now() };
              }
              return w;
            })
          })));

          if (socketRef.current) {
            socketRef.current.emit('ai_stream_end', {
              itemId: currentWorkspaceId,
              id: aiMsgId,
              text: fullText,
              thinkingText: fullThinkingText,
              agentRole: agent.role,
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
          break;
        }
      }
        }
      }
    } finally {
      setIsGenerating(false);
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
      attachments: attachments?.map(a => ({ url: a.url, data: a.data, mimeType: a.mimeType, name: a.name })) 
    };
    
    // Optimistic update
    setMessages(prev => [...prev, newUserMessage]);

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
    
    // Update local workspace state
    setProjects(prev => prev.map(p => ({
      ...p,
      workspaces: p.workspaces.map(w => {
        if (w.id === currentWorkspaceId) {
          return { ...w, messages: [...(w.messages || []), newUserMessage], lastUpdated: Date.now() };
        }
        return w;
      })
    })));

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
      allMessages.slice(-20).forEach(m => {
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
      const uploadedFiles: { fileUri: string; mimeType: string }[] = [];

      // Add temporary AI message with typing indicator only if it should respond directly
      if (shouldAiRespond) {
        const hasPdf = attachments?.some(a => a.mimeType === 'application/pdf');
        const tempAiMessage: Message = {
          id: aiMsgId,
          role: 'model',
          text: hasPdf ? '📄 PDF dokümanı yükleniyor ve analiz ediliyor. Bu işlem dosya boyutuna göre biraz zaman alabilir...' : '',
          senderName: 'JetWork AI',
          senderRole: 'Sistem Asistanı',
          isTyping: true
        };
        
        setMessages(prev => [...prev, tempAiMessage]);
      }

      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.mimeType === 'application/pdf' && att.file) {
            try {
              const fileUpload = await ai.files.upload({
                file: att.file,
                config: { displayName: att.name || 'document.pdf' }
              });

              let getFile = await ai.files.get({ name: fileUpload.name });
              while (getFile.state === 'PROCESSING') {
                await new Promise(resolve => setTimeout(resolve, 3000));
                getFile = await ai.files.get({ name: fileUpload.name });
              }

              if (getFile.state === 'FAILED') {
                console.error(`PDF işlenemedi: ${att.name}`);
              } else {
                uploadedFiles.push({
                  fileUri: getFile.uri,
                  mimeType: getFile.mimeType
                });
              }
            } catch (err) {
              console.error("Error uploading PDF:", err);
            }
          } else {
            parts.push({
              inlineData: {
                data: att.data,
                mimeType: att.mimeType
              }
            });
          }
        }
      }

      for (const uf of uploadedFiles) {
        parts.push({
          fileData: {
            fileUri: uf.fileUri,
            mimeType: uf.mimeType
          }
        });
      }

      contents.push({ role: 'user', parts });

      const tools: any[] = [{ googleSearch: {} }];
      if (isRead && urlToRead) tools.push({ urlContext: {} });

      const responseStream = await callAiWithRetry(() => ai.models.generateContentStream({
        model: "gemini-3-flash-preview",
        contents: contents,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH, includeThoughts: true },
          responseMimeType: "application/json",
          responseSchema: chatResponseJsonSchema,
          maxOutputTokens: 8192,
          tools: tools.length > 0 ? tools : undefined
        }
      }));

      let fullText = '';
      let fullThinkingText = '';
      let isNoResponse = false;
      let groundingUrls: { uri: string; title: string }[] = [];
      let newDocumentContent: DocumentData | null = null;
      let accumulatedJson = '';

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
                  if (parsed.document.businessAnalysis) newDoc.businessAnalysis = marked.parse(parsed.document.businessAnalysis) as string;
                  if (parsed.document.code) newDoc.code = marked.parse(parsed.document.code) as string;
                  if (parsed.document.test) newDoc.test = marked.parse(parsed.document.test) as string;
                  if (parsed.document.bpmn) newDoc.bpmn = parsed.document.bpmn;
                  newDocumentContent = newDoc;
                  
                  if (socketRef.current && currentWorkspaceId) {
                    socketRef.current.emit('update_document', {
                      itemId: currentWorkspaceId,
                      document: newDoc
                    });
                  }
                  
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
          
          // Update local workspace state with final message and document
          setProjects(prev => prev.map(p => ({
            ...p,
            workspaces: p.workspaces.map(w => {
              if (w.id === currentWorkspaceId) {
                const updatedMessages = w.messages ? [...w.messages] : [];
                const finalMsg: Message = {
                  id: aiMsgId,
                  role: 'model',
                  text: fullText,
                  thinkingText: fullThinkingText,
                  senderName: 'JetWork AI',
                  senderRole: 'Sistem Asistanı',
                  ...(groundingUrls.length > 0 ? { groundingUrls } : {}),
                  documentSnapshot: newDocumentContent || undefined,
                  previousDocumentSnapshot,
                  documentActions
                };
                const existingIdx = updatedMessages.findIndex(m => m.id === aiMsgId);
                if (existingIdx >= 0) {
                  updatedMessages[existingIdx] = finalMsg;
                } else {
                  updatedMessages.push(finalMsg);
                }
                return { 
                  ...w, 
                  messages: updatedMessages, 
                  lastUpdated: Date.now(),
                  ...(newDocumentContent ? { document: newDocumentContent } : {})
                };
              }
              return w;
            })
          })));

          // Send AI response via socket for other users
          if (socketRef.current) {
            socketRef.current.emit('ai_stream_end', {
              itemId: currentWorkspaceId,
              id: aiMsgId,
              text: fullText,
              thinkingText: fullThinkingText,
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
        senderRole: 'Hata'
      }]);
    }
  };

  const handleAcceptAiHandRaise = () => {
    if (!aiHandRaised || !currentWorkspaceId) return;

    const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    const finalMsg: Message = {
      id: aiMsgId,
      role: 'model',
      text: aiHandRaised,
      senderName: 'JetWork AI',
      senderRole: 'Sistem Asistanı'
    };

    setMessages(prev => [...prev, finalMsg]);
    setAiHandRaised(null);

    // Update local workspace state
    setProjects(prev => prev.map(p => ({
      ...p,
      workspaces: p.workspaces.map(w => {
        if (w.id === currentWorkspaceId) {
          return { ...w, messages: [...(w.messages || []), finalMsg], lastUpdated: Date.now() };
        }
        return w;
      })
    })));

    // Send via socket
    if (socketRef.current) {
      socketRef.current.emit('ai_stream_end', {
        itemId: currentWorkspaceId,
        id: aiMsgId,
        text: aiHandRaised
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
        "businessAnalysis": "İş analizi dokümanı (Talep özeti, mevcut durum, hedeflenen durum, kullanıcı hikayeleri, kabul kriterleri, vb.) Markdown formatında.",
        "code": "Geliştirme için teknik notlar, mimari kararlar, veritabanı şemaları, API tasarımları ve örnek kod blokları. Markdown formatında.",
        "test": "Test senaryoları, birim testleri, entegrasyon testleri ve QA notları. Markdown formatında.",
        "bpmn": "Geçerli bir BPMN 2.0 XML kodu. Eğer süreç bir akış veya entegrasyon içeriyorsa mutlaka doldur."
      }
      Tüm bölümler birbiriyle ilişkili ve tutarlı olmalıdır.`;

      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
        config: {
          systemInstruction: SYSTEM_INSTRUCTION,
          thinkingConfig: { thinkingLevel: ThinkingLevel.HIGH }
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
        businessAnalysis: marked.parse(data.businessAnalysis) as string,
        code: marked.parse(data.code) as string,
        test: marked.parse(data.test) as string,
        bpmn: data.bpmn || ""
      };
      
      setDocumentContent(htmlData);
      
      if (socketRef.current && currentWorkspaceId) {
        socketRef.current.emit('update_document', {
          itemId: currentWorkspaceId,
          document: htmlData
        });
      }
      
      setProjects(prev => prev.map(p => ({
        ...p,
        workspaces: p.workspaces.map(w => 
          w.id === currentWorkspaceId ? { ...w, document: htmlData, lastUpdated: Date.now() } : w
        )
      })));
      
    } catch (error) {
      console.error('Error generating document:', error);
      // Fallback if JSON parsing fails
      const fallbackData: DocumentData = {
        businessAnalysis: "Doküman oluşturulurken veya JSON ayrıştırılırken bir hata oluştu. Lütfen tekrar deneyin.",
        code: "",
        test: ""
      };
      setDocumentContent(fallbackData);
    } finally {
      setIsGenerating(false);
    }
  };

  const currentWorkspace = projects.flatMap(p => p.workspaces).find(w => w.id === currentWorkspaceId);

  const handleUpdateDocument = (newContent: DocumentData) => {
    setDocumentContent(newContent);
    
    // Send via socket
    if (socketRef.current && currentWorkspaceId) {
      socketRef.current.emit('update_document', {
        itemId: currentWorkspaceId,
        document: newContent
      });
    }

    setProjects(prev => prev.map(p => ({
      ...p,
      workspaces: p.workspaces.map(w => {
        if (w.id === currentWorkspaceId) {
          return { ...w, document: newContent, lastUpdated: Date.now() };
        }
        return w;
      })
    })));
  };

  const handleLogout = () => {
    setUser(null);
    localStorage.removeItem('ai-business-analyst-user');
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
  };

  const handleUpdateUser = (updatedUser: { name: string; role: string }) => {
    setUser(updatedUser);
    localStorage.setItem('ai-business-analyst-user', JSON.stringify(updatedUser));
  };

  const latestScoreMessage = [...messages].reverse().find(m => m.score !== undefined);
  const latestScore = latestScoreMessage?.score;
  const latestScoreExplanation = latestScoreMessage?.scoreExplanation;

  if (!user) {
    return <LandingPage onLogin={setUser} />;
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
              messages={messages} 
              onSendMessage={handleSendMessage} 
              isGenerating={isGenerating}
              issueKey={currentWorkspace?.issueKey}
              status={currentWorkspace?.status}
              title={currentWorkspace?.title}
              projectName={projects.find(p => p.workspaces.some(w => w.id === currentWorkspaceId))?.name}
              hasDocument={!!documentContent}
              onBack={() => setCurrentWorkspaceId(null)}
              activeUsers={activeUsers}
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
              onToggleAiActive={() => setIsAiActive(!isAiActive)}
              isZeroTouchMode={isZeroTouchMode}
              onToggleZeroTouchMode={() => setIsZeroTouchMode(!isZeroTouchMode)}
              aiHandRaised={aiHandRaised}
              onAcceptAiHandRaise={handleAcceptAiHandRaise}
              onDismissAiHandRaise={() => setAiHandRaised(null)}
              selectedDocumentText={selectedDocumentText}
              onRestoreDocument={handleUpdateDocument}
            />
            <DocumentPanel 
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              documentContent={documentContent}
              onGenerate={handleGenerateDocument}
              isGenerating={isGenerating}
              hasMessages={messages.length > 0}
              collaborators={currentWorkspace?.collaborators}
              onUpdateDocument={handleUpdateDocument}
              onSelectionChange={setSelectedDocumentText}
              score={latestScore}
              scoreExplanation={latestScoreExplanation}
              messages={messages}
            />
          </>
        )}
      </main>
    </div>
  );
}
