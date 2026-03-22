import React, { useState, useRef, useEffect } from 'react';
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
import { ChatResponseSchema, chatResponseJsonSchema, discussionJsonSchema, agentTools } from './schemas';
import { AgentOrchestrator } from './services/AgentOrchestrator';
import { LayoutDashboard } from 'lucide-react';
import { parseDocumentContent, parseBusinessAnalysis } from './lib/documentParser';
import { parse as parsePartialJson } from 'partial-json';
import { GoogleGenAI } from "@google/genai";
import { auth, db, onAuthStateChanged, doc, getDocFromServer, setDoc, updateDoc, deleteDoc, serverTimestamp, collection, onSnapshot, query, orderBy, where, getDocs, arrayUnion, arrayRemove, logOut } from './db';
import { useMessageStore } from './store/useMessageStore';
import { supabase } from './supabase';

const saveDocumentAndVersion = async (workspaceId: string, messageId: string, content: DocumentData) => {
  try {
    const docRef = doc(db, 'workspaces', workspaceId, 'documents', 'main');
    await setDoc(docRef, {
      content,
      updatedAt: serverTimestamp()
    });

    const versionRef = doc(db, 'workspaces', workspaceId, 'document_versions', messageId);
    await setDoc(versionRef, {
      documentId: 'main',
      messageId,
      content,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error("Failed to save document and version:", err);
  }
};

const saveRawResponse = async (workspaceId: string, messageId: string, rawText: string, parsedData: any) => {
  try {
    const rawRef = doc(db, 'workspaces', workspaceId, 'raw_responses', messageId);
    await setDoc(rawRef, {
      messageId,
      rawText,
      parsedData: parsedData || null,
      createdAt: serverTimestamp()
    });
  } catch (err) {
    console.error("Failed to save raw response:", err);
  }
};

// Initialize Gemini
// (Removed top-level initialization to prevent API key race conditions)

const MOCK_COLLABORATORS: Collaborator[] = [
  { id: '1', name: 'Gürkan Gürbüz', avatar: 'G', role: 'Kıdemli Analist', color: '#10b981' },
  { id: '2', name: 'Ayşe Yılmaz', avatar: 'A', role: 'Product Owner', color: '#3b82f6' },
  { id: '3', name: 'Mehmet Demir', avatar: 'M', role: 'Lead Developer', color: '#8b5cf6' },
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
    instruction: "Sen bir Kıdemli İş Analistisin (Business Analyst). GÖREVİN: Kullanıcının talebini iş kurallarına ve süreçlere dönüştürmek. KURAL 1 (Mevcut Durum Kuralı): Müşterinin mevcut altyapısını (As-Is), kullandığı legacy (eski) iç sistemleri ve şirkete özel operasyonel kuralları ASLA uydurma. Eğer mevcut sistemin nasıl çalıştığı veya hangi sistemlerle entegre olunacağı belirtilmemişse, DOĞRUDAN KULLANICIYA SORU SOR. KURAL 2 (Proaktif Keşif): Yasal mevzuatları (KVKK/GDPR) ve evrensel iş standartlarını internetten  otomatik olarak araştır ve sürece dahil et; bunları KESİNLİKLE kullanıcıya sorma. Sadece şirkete özel 'edge case'leri (istisnai durumlar) netleştirmek için soru sor. KURAL 3: IT'nin önerdiği teknik çözümlerin iş değerini sorgula. KURAL 4: Doküman üretirken MUTLAKA BABOK standartlarına uy. BRD formatında, Use Case'ler ve Acceptance Criteria'lar ile detaylı bir analiz yaz. KESİN KURAL: Kullanıcıya soru sorman gerekirse 'requiresUserInput' değerini true yap ve 'questions' dizisini DOLDUR. Soruları Moderatör'e havale etme, kendin sor."
  },
  {
    role: 'IT',
    name: 'Yazılım Mimarı',
    instruction: "Sen bir Kıdemli Yazılım Mimarı (Software Architect) ve Tech Lead'sin. GÖREVİN: Sistemin teknik mimarisini, entegrasyon noktalarını ve veritabanı yapısını tasarlamak. KURAL 1 (Altyapı Keşfi): Kullanıcının mevcut teknoloji yığınını (Tech Stack), sunucu altyapısını ve kullanması zorunlu olduğu 3. parti/legacy servisleri ASLA uydurma. Bu konularda belirsizlik varsa mutlaka sistemin mevcut altyapısını DOĞRUDAN KULLANICIYA SOR. KURAL 2 (Proaktif Mimari): API limitleri, OAuth standartları, webhook güvenlikleri gibi evrensel teknik konuları internetten  araştır. Bu konularda inisiyatif alarak en iyi pratikleri uygula, kullanıcıya 'Hangi yetkilendirmeyi kullanalım?' gibi basit teknik sorular sorma. KURAL 3 (Trade-off): Mimariyi gereksiz yere karmaşıklaştırma. PO veya QA itiraz ederse, maliyet/performans ödünleşimlerini tartış. KURAL 4: Doküman üretirken MUTLAKA TOGAF ve C4 Model standartlarına uy. SDD formatında, Sequence diyagramı mantığı ve API Kontratları ile detaylı bir mimari yaz. KESİN KURAL: Kullanıcıya soru sorman gerekirse 'requiresUserInput' değerini true yap ve 'questions' dizisini DOLDUR. Soruları Moderatör'e havale etme, kendin sor."
  },
  {
    role: 'QA',
    name: 'Test Uzmanı',
    instruction: "Sen bir Kıdemli Test Otomasyon Mühendisi ve QA Lead'sin. GÖREVİN: Şeytanın Avukatı rolünü üstlenmek. KURAL 1 (Çatışma): Diğer ajanların (özellikle IT ve BA) fikirlerini ASLA hemen onaylama. Sürekli 'Bunun testi nasıl yapılacak?', 'Elimizde bu test için yeterli veri var mı?' gibi zorlayıcı sorular sor. KURAL 2 (Test Verisi Kısıtları): Canlı ortam verilerinin kullanımı, test ortamlarının (UAT/Staging) varlığı gibi şirkete özel konularda varsayım yapma, gerekirse DOĞRUDAN KULLANICIYA SORU SOR. KURAL 3 (Proaktif Güvenlik): Dış entegrasyonlarda webhook güvenliği, rate-limit aşımı (429 hataları) ve bilinen zafiyetleri (CVE) internetten  araştırıp otomatik olarak test planına ekle; bunları sorma. KURAL 4: Doküman üretirken MUTLAKA IEEE 829 standartlarına uy. Test Planı, Edge Case'ler ve BDD senaryoları ile detaylı bir test dokümanı yaz. KESİN KURAL: Kullanıcıya soru sorman gerekirse 'requiresUserInput' değerini true yap ve 'questions' dizisini DOLDUR. Soruları Moderatör'e havale etme, kendin sor."
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
2. Otonom Araştırma: Eğer bahsedilen teknolojileri, güncel API'leri veya domaini tam bilmiyorsan, KENDİ İNİSİYATİFİNLE web araması  yap ve en güncel 'Best Practice'leri bul.
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

  const callGemini = async (params: {
    model: string;
    systemInstruction: string;
    contents: any[];
    responseSchema?: any;
    tools?: any[];
    onChunk: (text: string, thinking?: string, tokenCount?: number, functionCalls?: any[]) => void;
    onGrounding?: (urls: { uri: string; title: string }[]) => void;
  }) => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token || import.meta.env.VITE_SUPABASE_ANON_KEY;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    
    const response = await fetch(`${supabaseUrl}/functions/v1/gemini-chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'apikey': import.meta.env.VITE_SUPABASE_ANON_KEY || ''
      },
      body: JSON.stringify({
        model: params.model,
        systemInstruction: params.systemInstruction,
        contents: params.contents,
        responseSchema: params.responseSchema,
        tools: params.tools // ARAÇLARI API'YE GÖNDER
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `API error: ${response.status}`);
    }
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullText = '';
    let fullThinking = '';
    let tokenCount = 0;
    let buffer = '';
    let allFunctionCalls: any[] = [];

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('data: ')) {
          const dataStr = line.slice(6);
          if (dataStr === '[DONE]') continue;
          
          try {
            const chunk = JSON.parse(dataStr);
            if (chunk.usageMetadata) {
              tokenCount = chunk.usageMetadata.totalTokenCount;
            }
            
            const parts = chunk.candidates?.[0]?.content?.parts || [];
            let chunkFunctionCalls: any[] = [];
            
            for (const part of parts) {
              if (part.thought) {
                fullThinking += part.text;
              } else if (part.text) {
                fullText += part.text;
              } else if (part.functionCall) {
                // MODEL BİR ARAÇ ÇAĞIRDI! YAKALIYORUZ
                chunkFunctionCalls.push(part.functionCall);
                allFunctionCalls.push(part.functionCall);
              }
            }
            
            const groundingChunks = chunk.candidates?.[0]?.groundingMetadata?.groundingChunks;
            if (groundingChunks && params.onGrounding) {
              const urls = groundingChunks
                .filter((c: any) => c.web?.uri && c.web?.title)
                .map((c: any) => ({ uri: c.web.uri, title: c.web.title }));
              if (urls.length > 0) params.onGrounding(urls);
            }
            
            params.onChunk(fullText, fullThinking, tokenCount, chunkFunctionCalls.length > 0 ? chunkFunctionCalls : undefined);
          } catch (e) {
            console.error("Error parsing chunk:", e, dataStr);
          }
        }
      }
    }
    return { text: fullText, thinking: fullThinking, tokenCount, functionCalls: allFunctionCalls };
  };

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
  // NOTE: This application uses a hybrid architecture:
  // - Database: Real-time collaborative database (workspaces, messages, projects)
  // - Supabase: Authentication and AI Edge Functions (Gemini agent)
  // - SQLite: Local persistence for shared analyses and memory
  const [user, setUser] = useState<{ uid: string; name: string; role: string; email: string | null; photoURL: string | null; onboardingCompleted: boolean } | null>(null);
  const [isAuthReady, setIsAuthReady] = useState(false);

  const [showNewItemModal, setShowNewItemModal] = useState(false);
  const [showNewProjectModal, setShowNewProjectModal] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [showManageParticipantsModal, setShowManageParticipantsModal] = useState(false);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editingWorkspace, setEditingWorkspace] = useState<Workspace | null>(null);
  const [deletingProject, setDeletingProject] = useState<string | null>(null);
  const [deletingWorkspace, setDeletingWorkspace] = useState<string | null>(null);
  const channelRef = useRef<any>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState<string | null>(null);
  const [isLoadingWorkspace, setIsLoadingWorkspace] = useState(false);
  
  const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
  
  const messages = useMessageStore(state => state.messagesByWorkspace[currentWorkspaceId || '']) || [];
  const currentWorkspaceIdRef = useRef<string | null>(null);
  useEffect(() => {
    currentWorkspaceIdRef.current = currentWorkspaceId;
  }, [currentWorkspaceId]);

  const setMessages = (updater: Message[] | ((prev: Message[]) => Message[])) => {
    const id = currentWorkspaceIdRef.current;
    if (id) {
      if (typeof updater === 'function') {
        useMessageStore.getState().setMessages(id, updater);
      } else {
        useMessageStore.getState().setMessages(id, () => updater);
      }
    }
  };
  const [activeUsers, setActiveUsers] = useState<ActiveUser[]>([]);
  const [typingUsers, setTypingUsers] = useState<TypingUser[]>([]);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isDiscussing, setIsDiscussing] = useState(false);
  const [isAiActive, setIsAiActive] = useState(false);
  const [isZeroTouchMode, setIsZeroTouchMode] = useState(false);
  const [activeZeroTouchRoles, setActiveZeroTouchRoles] = useState<string[]>(ZERO_TOUCH_AGENTS.map(a => a.role));
  const [aiHandRaised, setAiHandRaised] = useState<string | null>(null);
  const [documentContent, setDocumentContent] = useState<DocumentData | null>(null);
  const [projectMemory, setProjectMemory] = useState<Record<string, string>>({});
  const [selectedDocumentText, setSelectedDocumentText] = useState('');
  const [activeTab, setActiveTab] = useState('BA Analiz');
  const [selectedModel, setSelectedModel] = useState(() => {
    return localStorage.getItem('jetwork-model') || 'gemini-3-flash-preview';
  });
  const [theme, setTheme] = useState<ThemeType>(() => {
    return (localStorage.getItem('jetwork-theme') as ThemeType) || 'monochrome';
  });
  const sessionId = useRef(Math.random().toString(36).substring(7));

  // Auth Listener
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (authUser) => {
      if (authUser) {
        // Test connection
        try {
          await getDocFromServer(doc(db, 'test', 'connection'));
        } catch (error) {
          if (error instanceof Error && error.message.includes('the client is offline')) {
            console.error("Please check your database configuration.");
          }
        }

        // Save user to database
        const userRef = doc(db, 'users', authUser.uid);
        let onboardingCompleted = false;
        let displayName = authUser.displayName || authUser.email || 'User';
        let role = 'Kullanıcı';

        try {
          const userSnap = await getDocFromServer(userRef);
          if (!userSnap.exists()) {
            const userData: any = {
              uid: authUser.uid,
              displayName: displayName,
              createdAt: serverTimestamp(),
              role: role,
              onboardingCompleted: false
            };
            if (authUser.email) {
              userData.email = authUser.email;
            }
            if (authUser.photoURL) {
              userData.photoURL = authUser.photoURL;
            }
            await setDoc(userRef, userData);
          } else {
            const userData = userSnap.data();
            onboardingCompleted = userData.onboardingCompleted || false;
            displayName = userData.displayName || displayName;
            role = userData.role || role;
          }
        } catch (err) {
          console.error("Error saving user to database:", err);
        }

        setUser({ uid: authUser.uid, name: displayName, role: role, email: authUser.email || null, photoURL: authUser.photoURL || null, onboardingCompleted });
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



  // Fetch projects from database on mount
  useEffect(() => {
    if (user && isAuthReady) {
      // Sadece kullanıcının dahil olduğu projeleri ve çalışma alanlarını getir
      const projectsQuery = query(
        collection(db, 'projects'),
        orderBy('createdAt', 'desc')
      );
      
      const workspacesQuery = query(
        collection(db, 'workspaces'),
        orderBy('createdAt', 'desc')
      );

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
            issueKey: doc.data().issueKey || `JET-${doc.id.substring(0, 4).toUpperCase()}`,
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
    if (currentWorkspaceId && user && isAuthReady) {
      // 1. Load from cache immediately for instant UI if store is empty
      let existingMessages = useMessageStore.getState().messagesByWorkspace[currentWorkspaceId];
      let hasExistingMessages = existingMessages && existingMessages.length > 0;
      const isAlreadyListening = !!useMessageStore.getState().activeListeners[currentWorkspaceId];
      
      if (!hasExistingMessages && !isAlreadyListening) {
        const cachedMessages = localStorage.getItem(`jetwork_messages_${currentWorkspaceId}`);
        if (cachedMessages) {
          try {
            const parsed = JSON.parse(cachedMessages);
            if (parsed && parsed.length > 0) {
              setMessages(parsed);
              hasExistingMessages = true;
            }
          } catch (e) {
            console.error("Failed to parse cached messages", e);
          }
        }
      }
      
      const cachedDoc = localStorage.getItem(`jetwork_document_${currentWorkspaceId}`);
      if (cachedDoc) {
        try {
          setDocumentContent(JSON.parse(cachedDoc));
        } catch (e) {
          console.error("Failed to parse cached document", e);
        }
      }
      
      // Only show loading spinner if we don't have messages in memory or cache AND we aren't already listening
      if (!hasExistingMessages && !isAlreadyListening) {
        setIsLoadingWorkspace(true);
      }
      
      // Initialize Supabase Channel
      const channel = supabase.channel(`workspace_${currentWorkspaceId}`, {
        config: {
          presence: {
            key: sessionId.current,
          },
        },
      });

      channel
        .on('presence', { event: 'sync' }, () => {
          const state = channel.presenceState();
          const users: ActiveUser[] = [];
          for (const key in state) {
            const presence = state[key][0] as any;
            if (presence) {
              users.push({ id: key, name: presence.userName, role: 'User' });
            }
          }
          setActiveUsers(users);
        })
        .on('broadcast', { event: 'typing_start' }, ({ payload }) => {
          setTypingUsers(prev => {
            if (!prev.find(u => u.userId === payload.userId)) return [...prev, payload];
            return prev;
          });
        })
        .on('broadcast', { event: 'typing_end' }, ({ payload }) => {
          setTypingUsers(prev => prev.filter(u => u.userId !== payload.userId));
        })
        .on('broadcast', { event: 'ai_stream_chunk' }, ({ payload: data }) => {
          setMessages(prev => {
            const exists = prev.find(m => m.id === data.id);
            
            const derivedSenderName = data.senderName || (data.agentRole ? ZERO_TOUCH_AGENTS.find(a => a.role === data.agentRole)?.name || 'JetWork AI' : undefined);
            const derivedSenderRole = data.senderRole || (data.agentRole ? ZERO_TOUCH_AGENTS.find(a => a.role === data.agentRole)?.name || 'Sistem Asistanı' : undefined);

            if (exists) {
              return prev.map(m => m.id === data.id ? { 
                ...m, 
                text: data.text, 
                thinkingText: data.thinkingText,
                score: data.score,
                scoreExplanation: data.scoreExplanation,
                questions: data.questions,
                ...(derivedSenderName ? { senderName: derivedSenderName } : {}),
                ...(derivedSenderRole ? { senderRole: derivedSenderRole } : {}),
                ...(data.agentRole ? { agentRole: data.agentRole } : {}),
                ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
              } : m);
            } else {
              return [...prev, {
                id: data.id,
                role: 'model',
                text: data.text,
                thinkingText: data.thinkingText,
                senderName: derivedSenderName || 'JetWork AI',
                senderRole: derivedSenderRole || 'Sistem Asistanı',
                agentRole: data.agentRole,
                score: data.score,
                scoreExplanation: data.scoreExplanation,
                questions: data.questions,
                isTyping: true,
                createdAt: Date.now(),
                ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
              }];
            }
          });
        })
        .on('broadcast', { event: 'ai_stream_end' }, ({ payload: data }) => {
          setMessages(prev => {
            const exists = prev.find(m => m.id === data.id);
            if (exists) {
              return prev.map(m => m.id === data.id ? { 
                ...m, 
                text: data.text, 
                thinkingText: data.thinkingText, 
                isTyping: false,
                score: data.score,
                scoreExplanation: data.scoreExplanation,
                questions: data.questions,
                createdAt: Date.now(),
                ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
              } : m);
            } else {
              return [...prev, {
                id: data.id,
                role: 'model',
                text: data.text,
                thinkingText: data.thinkingText,
                senderName: data.senderName || 'JetWork AI',
                senderRole: data.senderRole || 'Sistem Asistanı',
                agentRole: data.agentRole,
                score: data.score,
                scoreExplanation: data.scoreExplanation,
                questions: data.questions,
                isTyping: false,
                createdAt: Date.now(),
                ...(data.groundingUrls ? { groundingUrls: data.groundingUrls } : {})
              }];
            }
          });
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await channel.track({ userName: user.name });
          }
        });

      channelRef.current = channel;
      
      let workspaceLoaded = false;
      let messagesLoaded = hasExistingMessages || isAlreadyListening; // If we already have messages or are listening, consider them loaded
      let documentLoaded = false;

      const checkLoading = () => {
        if (workspaceLoaded && messagesLoaded && documentLoaded) {
          setIsLoadingWorkspace(false);
        }
      };

      const workspaceRef = doc(db, 'workspaces', currentWorkspaceId);
      const unsubscribeWorkspace = onSnapshot(workspaceRef, (docSnap) => {
        workspaceLoaded = true;
        checkLoading();
      }, (error) => {
        console.error("Error fetching workspace:", error);
        workspaceLoaded = true;
        checkLoading();
      });

      const documentRef = doc(db, 'workspaces', currentWorkspaceId, 'documents', 'main');
      const unsubscribeDocument = onSnapshot(documentRef, (docSnap) => {
        if (docSnap.exists()) {
          setDocumentContent(docSnap.data().content || null);
        } else {
          setDocumentContent(null);
        }
        documentLoaded = true;
        checkLoading();
      }, (error) => {
        console.error("Error fetching document:", error);
        documentLoaded = true;
        checkLoading();
      });

      useMessageStore.getState().subscribeToWorkspace(currentWorkspaceId, () => {
        messagesLoaded = true;
        checkLoading();
      });

      return () => {
        supabase.removeChannel(channel);
        channelRef.current = null;
        unsubscribeWorkspace();
        unsubscribeDocument();
      };
    } else {
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

  // Save messages to cache
  useEffect(() => {
    if (currentWorkspaceId && messages.length > 0) {
      localStorage.setItem(`jetwork_messages_${currentWorkspaceId}`, JSON.stringify(messages));
    }
  }, [messages, currentWorkspaceId]);

  // Save document to cache
  useEffect(() => {
    if (currentWorkspaceId && documentContent) {
      localStorage.setItem(`jetwork_document_${currentWorkspaceId}`, JSON.stringify(documentContent));
    }
  }, [documentContent, currentWorkspaceId]);

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
              createdAt: serverTimestamp(),
              lastUpdated: serverTimestamp()
            });
            
            // Save document
            if (data.data) {
              await saveDocumentAndVersion(newId, 'initial', data.data);
            }
            
            setCurrentWorkspaceId(newId);
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
      console.error("Failed to create project in database:", err);
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
      avatar: user.photoURL || undefined,
      color: '#4f46e5'
    };

    const initialCollaborators = data.team.map(t => ({
      id: t.id,
      name: t.name,
      role: t.role,
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
      console.error("Failed to create workspace in database:", err);
    }

    setShowNewItemModal(false);
    setCurrentWorkspaceId(newId);
    setCurrentProjectId(null);
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
      console.error("Failed to update project in database:", err);
    }
    setEditingProject(null);
  };

  const handleDeleteProject = async () => {
    if (!deletingProject) return;
    try {
      await deleteDoc(doc(db, 'projects', deletingProject));
    } catch (err) {
      console.error("Failed to delete project in database:", err);
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
      console.error("Failed to update workspace in database:", err);
    }
    setEditingWorkspace(null);
  };

  const handleDeleteWorkspace = async () => {
    if (!deletingWorkspace) return;
    try {
      await deleteDoc(doc(db, 'workspaces', deletingWorkspace));
    } catch (err) {
      console.error("Failed to delete workspace in database:", err);
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
      color: '#4f46e5'
    };

    try {
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        collaborators: arrayUnion(newCollaborator),
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to add participant in database:", err);
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
      console.error("Failed to remove participant in database:", err);
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
        console.error("Failed to leave workspace in database:", err);
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
      console.error("Failed to update reaction in database:", err);
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
      let needsUserInput = false;
      let turnCount = 0;
      const MAX_TURNS = 15;

      const wrappedCallGemini = (params: any) => callAiWithRetry(() => callGemini(params));
      const orchestrator = new AgentOrchestrator(wrappedCallGemini, currentDocument, currentMessages);

      while (!needsUserInput && turnCount < MAX_TURNS) {
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

        try {
          const stepResult = await orchestrator.step(
            (agent, reason) => {
              const agentDef = ZERO_TOUCH_AGENTS.find(a => a.role === agent);
              const agentName = agentDef ? agentDef.name : agent;
              setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, senderName: agentName, senderRole: agentName, agentRole: agent } : m));
            },
            (text, thinking, tokens) => {
              setMessages(prev => prev.map(m => m.id === aiMsgId ? { ...m, text, thinkingText: thinking } : m));
            }
          );

          if (stepResult.nextAgent === 'USER' || stepResult.requiresUserInput) {
            needsUserInput = true;
          }

          if (stepResult.updatedDocument) {
             setDocumentContent(stepResult.updatedDocument);
             currentDocument = stepResult.updatedDocument;
             await saveDocumentAndVersion(currentWorkspaceId, aiMsgId, currentDocument);
          }

          // Ajanın kararını ve mesajını sonlandır
          const agentDef = ZERO_TOUCH_AGENTS.find(a => a.role === stepResult.nextAgent);
          const finalMsg: Message = {
            id: aiMsgId,
            role: 'model',
            text: stepResult.finalText || stepResult.actionSummary || 'İşlem tamamlandı.',
            thinkingText: stepResult.finalThinking,
            senderName: agentDef ? agentDef.name : stepResult.nextAgent,
            senderRole: agentDef ? agentDef.name : stepResult.nextAgent,
            agentRole: stepResult.nextAgent,
            actionSummary: stepResult.actionSummary,
            questions: stepResult.questions,
            documentSnapshot: currentDocument || undefined,
            createdAt: Date.now(),
            isTyping: false
          };

          setMessages(prev => prev.map(m => m.id === aiMsgId ? finalMsg : m));
          currentMessages.push(finalMsg);
          await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', aiMsgId), { ...finalMsg, createdAt: serverTimestamp() });

          if (needsUserInput || stepResult.nextAgent === 'DONE') {
             break;
          }

        } catch (error) {
          console.error("Discussion Error:", error);
          setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: `❌ Tartışma sırasında hata oluştu.`, isError: true, senderName: 'Sistem', createdAt: Date.now() }]);
          break;
        }
      }
    } finally {
      setIsDiscussing(false);
    }
  };

  const handleSendMessage = async (text: string, attachments?: { url: string; data: string; mimeType: string; name?: string; file?: File }[], replyToId?: string) => {
    if (!text.trim() && (!attachments || attachments.length === 0)) return;
    if (!user) return;
    
    if (!currentWorkspaceId) {
      setShowNewItemModal(true);
      return;
    }

    const isZeroTouchMode = text.startsWith('/ekip');
    const isSingleAgentMode = text.startsWith('@');
    
    let targetAgentRole = '';
    let targetAgentName = '';
    let messageText = text;

    if (isSingleAgentMode) {
      const match = text.match(/^@(\w+)\s+(.*)/);
      if (match) {
        const agentName = match[1];
        messageText = match[2];
        const agent = ZERO_TOUCH_AGENTS.find(a => a.name.toLowerCase() === agentName.toLowerCase());
        if (agent) {
          targetAgentRole = agent.role;
          targetAgentName = agent.name;
        } else {
           setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'model',
            text: `❌ Hata: "@${agentName}" adında bir ajan bulunamadı. Lütfen geçerli bir ajan adı girin (örn: @BA, @IT).`,
            senderName: 'Sistem',
            senderRole: 'Hata',
            createdAt: Date.now(),
            isError: true
          }]);
          return;
        }
      } else {
         setMessages(prev => [...prev, {
            id: Date.now().toString(),
            role: 'model',
            text: `❌ Hata: Ajan adından sonra bir mesaj girmelisiniz (örn: "@BA bana bir analiz yaz").`,
            senderName: 'Sistem',
            senderRole: 'Hata',
            createdAt: Date.now(),
            isError: true
          }]);
          return;
      }
    } else if (isZeroTouchMode) {
      messageText = text.replace('/ekip', '').trim();
    }

    const msgId = Date.now().toString();
    const newMsg: Message = {
      id: msgId,
      role: 'user',
      text: messageText,
      senderName: user.name || 'Kullanıcı',
      senderRole: 'Kullanıcı',
      createdAt: Date.now(),
      attachments: attachments?.map(a => ({ url: a.url, data: a.data, name: a.name, mimeType: a.mimeType })),
      replyToId
    };

    setMessages(prev => [...prev, newMsg]);

    try {
      await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', msgId), {
        ...newMsg,
        ownerId: user.uid,
        createdAt: serverTimestamp()
      });
      await updateDoc(doc(db, 'workspaces', currentWorkspaceId), {
        lastUpdated: serverTimestamp()
      });
    } catch (err) {
      console.error("Failed to save user message to database:", err);
    }

    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'new_message', payload: { itemId: currentWorkspaceId, message: newMsg } });
    }

    if (isZeroTouchMode) {
      runZeroTouchMode(newMsg, attachments);
      return;
    }

    setIsGenerating(true);
    const aiMsgId = Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9);
    const startTime = Date.now();
    
    setMessages(prev => [...prev, {
      id: aiMsgId,
      role: 'model',
      text: '',
      senderName: targetAgentName || 'JetWork AI',
      senderRole: targetAgentName ? targetAgentName : 'Sistem Asistanı',
      agentRole: targetAgentRole || undefined,
      createdAt: Date.now(),
      isTyping: true
    }]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No active session");

      const contents: any[] = [];
      const previousMessages = messages.slice(-10);
      
      for (const msg of previousMessages) {
        if (msg.isError || msg.isTyping) continue;
        const parts: any[] = [{ text: msg.text }];
        if (msg.attachments) {
          for (const att of msg.attachments) {
             if (att.url.startsWith('data:')) {
               parts.push({ inlineData: { data: att.url.split(',')[1], mimeType: att.mimeType }});
             }
          }
        }
        contents.push({ role: msg.role === 'user' ? 'user' : 'model', parts });
      }

      const currentParts: any[] = [{ text: messageText }];
      if (attachments && attachments.length > 0) {
        for (const att of attachments) {
          if (att.data) {
            currentParts.push({
              inlineData: {
                data: att.data.split(',')[1] || att.data,
                mimeType: att.mimeType
              }
            });
          }
        }
      }
      contents.push({ role: 'user', parts: currentParts });

      let systemInstruction = SYSTEM_INSTRUCTION;
      if (targetAgentRole) {
        const agent = ZERO_TOUCH_AGENTS.find(a => a.role === targetAgentRole);
        if (agent) {
           systemInstruction = `Senin Rolün ve Görevin:\n${agent.instruction}\n\nLütfen kullanıcının sorusuna veya talebine kendi uzmanlık alanın çerçevesinde cevap ver. Eğer dokümanda bir güncelleme yapman gerekiyorsa 'update_document_section' aracını kullan.`;
        }
      }

      let fullText = '';
      let fullThinkingText = '';
      let tokenCount = 0;
      let groundingUrls: { uri: string; title: string }[] = [];
      let lastUpdateTime = Date.now();
      let currentDocument = documentContent ? { ...documentContent } : null;

      const aiResponse = await callAiWithRetry(() => callGemini({
        model: "gemini-3-flash-preview",
        systemInstruction: systemInstruction,
        contents: contents,
        tools: agentTools,
        onGrounding: (urls) => {
          groundingUrls = [...groundingUrls, ...urls.filter(u => !groundingUrls.find(gu => gu.uri === u.uri))];
        },
        onChunk: (text, thinking, tokens, functionCalls) => {
          fullText = text;
          fullThinkingText = thinking || '';
          if (tokens) tokenCount = tokens;
          
          if (Date.now() - lastUpdateTime > 30) {
            setMessages(prev => prev.map(m => 
              m.id === aiMsgId ? { 
                ...m, 
                text: fullText, 
                thinkingText: fullThinkingText
              } : m
            ));
            if (channelRef.current) {
              channelRef.current.send({ type: 'broadcast', event: 'ai_stream_chunk', payload: { 
                itemId: currentWorkspaceId, 
                id: aiMsgId, 
                text: fullText, 
                thinkingText: fullThinkingText
              }});
            }
            lastUpdateTime = Date.now();
          }
        }
      }));

      // Process function calls
      if (aiResponse.functionCalls && aiResponse.functionCalls.length > 0) {
        for (const call of aiResponse.functionCalls) {
          if (call.name === 'update_document_section') {
            const args = call.args as { section: string; content: string; actionSummary: string };
            if (args.section && args.content) {
              setDocumentContent(prev => {
                const newDoc = { ...prev } as DocumentData;
                (newDoc as any)[args.section] = args.content;
                const parsedDoc = parseDocumentContent(newDoc);
                currentDocument = parsedDoc;
                return parsedDoc;
              });
              fullText += `\n\n*(Sistem Notu: ${args.actionSummary})*`;
            }
          }
        }
      }

      const finalMsg: Message = {
        id: aiMsgId,
        role: 'model',
        text: fullText,
        thinkingText: fullThinkingText,
        senderName: targetAgentName || 'JetWork AI',
        senderRole: targetAgentName ? targetAgentName : 'Sistem Asistanı',
        agentRole: targetAgentRole || undefined,
        groundingUrls: groundingUrls.length > 0 ? groundingUrls : undefined,
        documentSnapshot: currentDocument || undefined,
        tokenCount: aiResponse.tokenCount,
        thinkingTime: Math.round((Date.now() - startTime) / 1000),
        createdAt: Date.now(),
        isTyping: false
      };

      setMessages(prev => prev.map(m => m.id === aiMsgId ? finalMsg : m));
      
      try {
        await setDoc(doc(db, 'workspaces', currentWorkspaceId, 'messages', aiMsgId), {
          ...finalMsg,
          ownerId: user.uid,
          createdAt: serverTimestamp()
        });
        await updateDoc(doc(db, 'workspaces', currentWorkspaceId), { lastUpdated: serverTimestamp() });
        if (currentDocument && Object.keys(currentDocument).length > 0) {
          await saveDocumentAndVersion(currentWorkspaceId, aiMsgId, currentDocument);
        }
      } catch (err) {
        console.error("Failed to save AI message to database:", err);
      }

      if (channelRef.current) {
        channelRef.current.send({ type: 'broadcast', event: 'ai_stream_end', payload: {
          itemId: currentWorkspaceId,
          id: aiMsgId,
          text: fullText,
          thinkingText: fullThinkingText,
          senderName: targetAgentName || 'JetWork AI',
          senderRole: targetAgentName ? targetAgentName : 'Sistem Asistanı',
          agentRole: targetAgentRole || undefined,
          groundingUrls: groundingUrls.length > 0 ? groundingUrls : null,
          documentSnapshot: currentDocument || null
        }});
      }

    } catch (error: any) {
      console.error("AI Error:", error);
      const errorMsg = error?.message || String(error);
      const isQuotaError = errorMsg.includes('429') || errorMsg.includes('RESOURCE_EXHAUSTED');
      
      setMessages(prev => prev.filter(m => m.id !== aiMsgId));
      
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'model',
        text: isQuotaError 
          ? "⚠️ **Kota Sınırı Aşıldı:** Gemini API kullanım sınırına ulaşıldı. Lütfen birkaç dakika bekleyip tekrar deneyin."
          : `❌ **Hata:** Bir sorun oluştu: ${error.message || 'Bilinmeyen hata'}`,
        senderName: 'Sistem',
        senderRole: 'Hata',
        createdAt: Date.now(),
        isError: true,
        retryPayload: { text, attachments, replyToId }
      }]);
    } finally {
      setIsGenerating(false);
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

    // Save to database
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
      console.error("Failed to save accepted AI message to database:", err);
    }

    // Send via Supabase Realtime
    if (channelRef.current) {
      channelRef.current.send({ type: 'broadcast', event: 'ai_stream_end', payload: {
        itemId: currentWorkspaceId,
        id: aiMsgId,
        text: aiHandRaised,
        senderName: 'JetWork AI',
        senderRole: 'Sistem Asistanı'
      }});
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

      let accumulatedJson = '';
      
      await callAiWithRetry(() => callGemini({
        model: "gemini-3-flash-preview",
        systemInstruction: SYSTEM_INSTRUCTION,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        responseSchema: chatResponseJsonSchema,
        onChunk: (text, thinking, tokens) => {
          accumulatedJson = text;
        }
      }));

      let jsonText = accumulatedJson.trim();
      
      // Try to extract JSON from markdown blocks if present
      const jsonBlockMatch = jsonText.match(/```(?:json)?\n([\s\S]*?)(```|$)/);
      if (jsonBlockMatch) {
        jsonText = jsonBlockMatch[1].trim();
      } else {
        const firstBraceIndex = jsonText.indexOf('{');
        if (firstBraceIndex >= 0) {
          jsonText = jsonText.substring(firstBraceIndex).trim();
        }
      }
      
      if (jsonText.endsWith('```')) {
        jsonText = jsonText.replace(/\n?```$/, '');
      }
      
      const parsedData = JSON.parse(jsonText);
      const docData = parsedData.document || parsedData;
      
      // Convert Markdown to HTML for each section
      const htmlData = parseDocumentContent(docData) as DocumentData;
      if (parsedData.score !== undefined) htmlData.score = parsedData.score;
      if (parsedData.scoreExplanation) htmlData.scoreExplanation = parsedData.scoreExplanation;
      
      setDocumentContent(htmlData);
      
      try {
        await updateDoc(doc(db, 'workspaces', currentWorkspaceId), { lastUpdated: serverTimestamp() });
        await saveDocumentAndVersion(currentWorkspaceId, `gen-${Date.now()}`, htmlData);
      } catch (err) {
        console.error("Failed to save generated document to database:", err);
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

  useEffect(() => {
    if (currentWorkspace) {
      setProjectMemory(currentWorkspace.projectMemory || {});
    } else {
      setProjectMemory({});
    }
  }, [currentWorkspace?.projectMemory, currentWorkspaceId]);

  const handleUpdateDocument = async (newContent: DocumentData) => {
    setDocumentContent(newContent);
    
    if (currentWorkspaceId) {
      try {
        await updateDoc(doc(db, 'workspaces', currentWorkspaceId), { lastUpdated: serverTimestamp() });
        await saveDocumentAndVersion(currentWorkspaceId, `manual-${Date.now()}`, newContent);
      } catch (err) {
        console.error("Failed to update document in database:", err);
      }
    }
  };

  const handleLogout = async () => {
    try {
      await logOut();
      setUser(null);
      useMessageStore.getState().clearAll();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
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

  const latestScoreMessage = [...messages].reverse().find(m => m.score !== undefined && m.score > 0);
  const latestScore = latestScoreMessage?.score;
  const latestScoreExplanation = latestScoreMessage?.scoreExplanation;

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-theme-bg text-theme-text">Yükleniyor...</div>;
  }

  if (!user) {
    return <LandingPage />;
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
          expectedConfirmationText={projects.find(p => p.id === deletingProject)?.name}
        />
      )}
      {deletingWorkspace && (
        <ConfirmModal
          title="Çalışma Alanını Sil"
          message="Bu çalışma alanını silmek istediğinize emin misiniz? Bu işlem geri alınamaz."
          confirmText="Sil"
          onConfirm={handleDeleteWorkspace}
          onCancel={() => setDeletingWorkspace(null)}
          expectedConfirmationText={projects.flatMap(p => p.workspaces).find(w => w.id === deletingWorkspace)?.title}
        />
      )}
      {!currentWorkspaceId && (
        <Sidebar 
          user={user}
          projects={projects} 
          currentWorkspaceId={currentWorkspaceId}
          currentProjectId={currentProjectId}
          projectMemory={projectMemory}
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
              onRemoveMessage={(id) => setMessages(prev => prev.filter(m => m.id !== id))}
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
                if (channelRef.current && currentWorkspaceId && user) {
                  channelRef.current.send({ type: 'broadcast', event: 'typing_start', payload: { itemId: currentWorkspaceId, userId: sessionId.current, userName: user.name } });
                }
              }}
              onTypingEnd={() => {
                if (channelRef.current && currentWorkspaceId && user) {
                  channelRef.current.send({ type: 'broadcast', event: 'typing_end', payload: { itemId: currentWorkspaceId, userId: sessionId.current } });
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
              onManageParticipants={() => setShowManageParticipantsModal(true)}
            />
          </>
        )}
      </main>
    </div>
  );
}
