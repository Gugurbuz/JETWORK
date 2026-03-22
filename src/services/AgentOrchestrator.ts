import { DocumentData, Message, MessageRole, Question } from '../types';
import { agentTools } from '../schemas';

// 1. Ajan Rolleri İçin İzole Sistem Talimatları (System Instructions)
export const AGENT_PROMPTS: Record<string, string> = {
  Orchestrator: `Sen baş yöneticisin (Scrum Master / Router). Kullanıcının isteğine, konuşma geçmişine ve projenin mevcut durumuna bakarak bir sonraki adımda hangi ajanın (BA, IT, QA, PO, UIUX) çalışması gerektiğine karar verirsin. Sadece yönlendirme yaparsın, doküman yazmazsın. Kararını JSON formatında 'nextAgent' ve 'reason' olarak dön.`,
  
  BA: `Sen Kıdemli bir İş Analistisin. Görevin kullanıcının taleplerini analiz etmektir. Dokümanı güncellemek için SADECE 'update_document_section' aracını (tool) kullan (section olarak 'businessAnalysis' seç). Geçmişi ezmemek için 'operation: append' parametresini kullan. Eğer kullanıcıya kritik bir iş kuralı sorman gerekiyorsa 'ask_to_human' aracını çağır.`,
  
  IT: `Sen Kıdemli bir Yazılım Mimarı ve Geliştiricisin. Sistem mimarisini ve kodları tasarlarsın. Dokümanı güncellemek için SADECE 'update_document_section' aracını kullan (section: 'code' veya 'bpmn'). Geçmişi ezmemek için 'operation: append' kullan. Kullanıcıya altyapı sorusu sorman gerekirse 'ask_to_human' aracını çağır.`,
  
  QA: `Sen Kıdemli bir Kalite Güvence Uzmanısın (Test Engineer). Test senaryolarını yazarsın. Dokümanı güncellemek için SADECE 'update_document_section' aracını kullan (section: 'test'). Eksik bilgileri netleştirmek için 'ask_to_human' aracını kullan.`,
  
  PO: `Sen Product Owner'sın. Projenin vizyonunu korursun. Ekibin aldığı kararları özetlemek için 'update_document_section' aracını (section: 'review') kullan.`,

  UIUX: `Sen Kıdemli bir UI/UX Tasarımcısısın. Kullanıcı deneyimini tasarlarsın. Arayüz kararlarını 'update_document_section' ile (section: 'businessAnalysis' veya 'code' içine append yaparak) ekle.`
};

// Orkestratörün döneceği JSON karar şeması
export const OrchestratorDecisionSchema = {
  type: "object",
  properties: {
    nextAgent: {
      type: "string",
      enum: ["BA", "IT", "QA", "PO", "UIUX", "USER", "DONE"],
      description: "Bir sonraki adımda çalışması gereken ajan. Eğer insana (kullanıcıya) soru sorulması gerekiyorsa USER, süreç bittiyse DONE seç."
    },
    reason: {
      type: "string",
      description: "Bu ajanı neden seçtiğinin açıklaması."
    }
  },
  required: ["nextAgent", "reason"]
};

export type CallGeminiFunction = (params: {
  model: string;
  systemInstruction: string;
  contents: any[];
  responseSchema?: any;
  tools?: any[];
  onChunk: (text: string, thinking?: string, tokenCount?: number, functionCalls?: any[]) => void;
  onGrounding?: (urls: { uri: string; title: string }[]) => void;
}) => Promise<{ text: string, thinking: string, tokenCount: number, functionCalls?: any[] }>;

export class AgentOrchestrator {
  private callGemini: CallGeminiFunction;
  private currentDocument: DocumentData | null;
  private messageHistory: Message[];

  constructor(callGemini: CallGeminiFunction, initialDocument: DocumentData | null, history: Message[]) {
    this.callGemini = callGemini;
    this.currentDocument = initialDocument;
    this.messageHistory = history;
  }

  private buildContents(additionalContext?: string): { role: MessageRole; parts: any[] }[] {
    const contents: { role: MessageRole; parts: any[] }[] = this.messageHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text || (msg.documentActions ? msg.documentActions.join(', ') : 'Araç kullanıldı.') }]
    }));

    const stateContext = `
      MEVCUT DOKÜMAN DURUMU (Shared State):
      ${JSON.stringify(this.currentDocument || {}, null, 2)}
      
      KRİTİK KURAL: Dokümanı güncellemek için metin içinde Markdown yazmak yerine KESİNLİKLE 'update_document_section' aracını (tool) çağır. 
      Eğer sistemde olmayan veya bilmediğin bir şey varsa 'ask_to_human' aracını kullan.
      
      ${additionalContext ? `EK BİLGİ/GÖREV: ${additionalContext}` : ''}
    `;

    contents.push({
      role: 'user',
      parts: [{ text: stateContext }]
    });

    return contents;
  }

  public async step(
    onAgentChange?: (agent: string, reason: string) => void, 
    onChunk?: (text: string, thinking?: string, tokenCount?: number) => void
  ): Promise<{
    nextAgent: string;
    updatedDocument: DocumentData | null;
    actionSummary?: string;
    toolUsed?: boolean;
    questions?: Question[];
    requiresUserInput?: boolean;
    finalText?: string;
    finalThinking?: string;
  }> {
    
    // 1. Orkestratöre sor: Sıra kimde?
    let decisionJson = '';
    await this.callGemini({
      model: "gemini-2.5-flash",
      systemInstruction: AGENT_PROMPTS['Orchestrator'],
      contents: this.buildContents("Sohbet geçmişine ve dokümanın durumuna göre bir sonraki ajanı belirle. Eğer tartışılacak bir şey kalmadıysa DONE seç. Eğer insana (kullanıcıya) soru sorulması gerekiyorsa USER seç."),
      responseSchema: OrchestratorDecisionSchema,
      onChunk: (text) => { decisionJson = text; }
    });

    let decisionResponse: any = { nextAgent: 'USER', reason: 'Orkestratör karar veremedi.' };
    try {
      decisionResponse = JSON.parse(decisionJson.trim());
    } catch(e) {
      console.error("Orchestrator decision parse error", e);
    }

    const nextAgent = decisionResponse.nextAgent || 'USER';
    
    if (onAgentChange) onAgentChange(nextAgent, decisionResponse.reason);

    if (nextAgent === 'DONE' || nextAgent === 'USER') {
      return {
        nextAgent,
        updatedDocument: this.currentDocument
      };
    }

    // 2. Seçilen ajanı çalıştır (Araçlar/Tools ile birlikte)
    let agentText = '';
    let agentThinking = '';
    const systemPrompt = AGENT_PROMPTS[nextAgent] || AGENT_PROMPTS['BA'];

    const response = await this.callGemini({
      model: "gemini-2.5-pro",
      systemInstruction: systemPrompt,
      contents: this.buildContents(`Sen ${nextAgent} ajanısın. Görevini yerine getir. Gerekirse 'update_document_section' veya 'ask_to_human' aracını kullan.`),
      tools: agentTools, // Ajanlara fonksiyon çağırma yetkisi verdik!
      onChunk: (text, thinking, tokenCount, functionCalls) => {
        agentText = text;
        if (thinking) agentThinking = thinking;
        if (onChunk) onChunk(text, thinking, tokenCount);
      }
    });

    // 3. Ajanın Dönüşünü (Araç Çağrısı veya Metin) İşle
    let actionSummary = '';
    let requiresUserInput = false;
    let questions: Question[] = [];
    let toolUsed = false;
    let documentActions: string[] = [];

    if (response.functionCalls && response.functionCalls.length > 0) {
      toolUsed = true;
      for (const call of response.functionCalls) {
        if (call.name === 'update_document_section') {
          const args = call.args || {};
          const section = args.section as keyof DocumentData;
          const operation = args.operation || 'append';
          const content = args.content || '';
          
          actionSummary = args.actionSummary || `${nextAgent} ${section} dokümanını güncelledi.`;
          documentActions.push(actionSummary);

          if (!this.currentDocument) {
            this.currentDocument = { businessAnalysis: '', code: '', test: '', review: '', bpmn: '' };
          }

          if (operation === 'append') {
            const existing = (this.currentDocument as any)[section] ? (this.currentDocument as any)[section] + '\n\n' : '';
            (this.currentDocument as any)[section] = existing + content;
          } else {
            (this.currentDocument as any)[section] = content;
          }
        } 
        else if (call.name === 'ask_to_human') {
          const args = call.args || {};
          requiresUserInput = true;
          actionSummary = `${nextAgent} bir soru sordu.`;
          questions.push({
            id: `q_${Date.now()}_${Math.random().toString(36).substring(2,5)}`,
            text: args.question || '',
            options: args.options || []
          });
        }
      }
    } else {
      actionSummary = `${nextAgent} düşüncelerini paylaştı.`;
    }

    // 4. Ajanın mesajını geçmişe ekle
    this.messageHistory.push({
      id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9),
      role: 'model',
      text: response.text || actionSummary,
      senderName: nextAgent,
      senderRole: nextAgent,
      createdAt: Date.now(),
      documentActions: documentActions.length > 0 ? documentActions : undefined
    });

    return {
      nextAgent,
      updatedDocument: this.currentDocument,
      actionSummary,
      toolUsed,
      requiresUserInput,
      questions,
      finalText: response.text,
      finalThinking: response.thinking
    };
  }
}