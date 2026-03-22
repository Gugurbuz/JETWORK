import { DocumentData, Message, MessageRole } from '../types';
import { ZodChatResponse, chatResponseJsonSchema } from '../schemas';

// 1. Ajan Rolleri İçin İzole Sistem Talimatları (System Instructions)
export const AGENT_PROMPTS: Record<string, string> = {
  Orchestrator: `Sen baş yöneticisin (Scrum Master / Router). Kullanıcının isteğine ve dokümanın mevcut durumuna bakarak bir sonraki adımda hangi ajanın (BA, IT, QA, PO) çalışması gerektiğine karar verirsin. Sadece yönlendirme yaparsın, doküman yazmazsın.`,
  
  BA: `Sen Kıdemli bir İş Analistisin. Görevin kullanıcının taleplerini analiz edip 'businessAnalysis' ve 'bpmn' dokümanlarını oluşturmaktır. Teknik kararlara veya kodlamaya karışmazsın. Formata kesinlikle uymalısın.`,
  
  IT: `Sen Kıdemli bir Yazılım Mimarı ve Geliştiricisin. İş Analistinin (BA) yazdığı 'businessAnalysis' verisini okuyarak sistem mimarisini, veritabanı şemalarını ve kodu oluşturursun. Sadece 'code' alanını doldurursun.`,
  
  QA: `Sen Kıdemli bir Kalite Güvence Uzmanısın (Test Engineer). BA ve IT'nin ürettiği dokümanlara bakarak test senaryoları, kabul kriterleri ve QA adımlarını belirlersin. Sadece 'test' alanını güncellersin.`,
  
  PO: `Sen Product Owner'sın. Projenin vizyonunu, önceliklerini ve iş değerini korursun. Geliştirilen çözümlerin müşteri ihtiyaçlarına uyup uymadığını kontrol edersin.`
};

// Orkestratörün döneceği karar şeması (Ajan Yönlendirmesi)
export const OrchestratorDecisionSchema = {
  type: "object",
  properties: {
    nextAgent: {
      type: "string",
      enum: ["BA", "IT", "QA", "PO", "USER", "DONE"],
      description: "Bir sonraki adımda çalışması gereken ajan. Eğer kullanıcıdan bilgi bekleniyorsa USER, tüm süreç bittiyse DONE seç."
    },
    reason: {
      type: "string",
      description: "Bu ajanı neden seçtiğinin kısa açıklaması."
    }
  },
  required: ["nextAgent", "reason"]
};

export interface AgentRequestPayload {
  model: string;
  systemInstruction: string;
  contents: { role: MessageRole; parts: { text: string }[] }[];
  responseSchema?: any;
}

export type CallGeminiFunction = (params: {
  model: string;
  systemInstruction: string;
  contents: any[];
  responseSchema?: any;
  onChunk: (text: string, thinking?: string, tokenCount?: number) => void;
  onGrounding?: (urls: { uri: string; title: string }[]) => void;
}) => Promise<void>;

export class AgentOrchestrator {
  private callGemini: CallGeminiFunction;
  private currentDocument: DocumentData | null;
  private messageHistory: Message[];

  constructor(callGemini: CallGeminiFunction, initialDocument: DocumentData | null, history: Message[]) {
    this.callGemini = callGemini;
    this.currentDocument = initialDocument;
    this.messageHistory = history;
  }

  /**
   * Tüm sohbet geçmişini ve mevcut doküman durumunu Gemini'nin anlayacağı formata çevirir.
   */
  private buildContents(additionalContext?: string): { role: MessageRole; parts: { text: string }[] }[] {
    const contents: { role: MessageRole; parts: { text: string }[] }[] = this.messageHistory.map(msg => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }));

    // Ortak hafızayı (State) en son mesaja ekleyerek ajana mevcut durumu bildiriyoruz
    const stateContext = `
      MEVCUT DOKÜMAN DURUMU (Shared State):
      ${JSON.stringify(this.currentDocument, null, 2)}
      
      ${additionalContext ? `EK BİLGİ/GÖREV: ${additionalContext}` : ''}
    `;

    contents.push({
      role: 'user',
      parts: [{ text: stateContext }]
    });

    return contents;
  }

  /**
   * Ana orkestrasyon döngüsünde bir adım atar.
   */
  public async step(
    onAgentChange?: (agent: string, reason: string) => void, 
    onChunk?: (text: string, thinking?: string, tokenCount?: number) => void
  ): Promise<{
    nextAgent: string;
    finalResponse?: ZodChatResponse;
    updatedDocument: DocumentData | null;
  }> {
    // 1. Orkestratöre sor: Sıra kimde?
    let decisionJson = '';
    await this.callGemini({
      model: "gemini-2.5-flash",
      systemInstruction: AGENT_PROMPTS['Orchestrator'],
      contents: this.buildContents("Sohbet geçmişine ve dokümanın durumuna göre bir sonraki ajanı belirle. Eğer tartışılacak bir şey kalmadıysa DONE seç. Eğer kullanıcıdan bilgi bekleniyorsa USER seç."),
      responseSchema: OrchestratorDecisionSchema,
      onChunk: (text) => { decisionJson = text; }
    });

    let decisionResponse: any = { nextAgent: 'USER', reason: 'Failed to parse' };
    try {
      decisionResponse = JSON.parse(decisionJson.trim());
    } catch(e) {
      console.error("Orchestrator decision parse error", e);
    }

    const nextAgent = decisionResponse.nextAgent || 'USER';
    
    console.log(`[Orchestrator Decision] Next Agent: ${nextAgent}. Reason: ${decisionResponse.reason}`);
    if (onAgentChange) onAgentChange(nextAgent, decisionResponse.reason);

    if (nextAgent === 'DONE' || nextAgent === 'USER') {
      return {
        nextAgent,
        updatedDocument: this.currentDocument
      };
    }

    // 2. Seçilen spesifik ajanı çalıştır (İzole bağlam ile)
    let agentJson = '';
    await this.callGemini({
      model: "gemini-2.5-pro", // Uzman ajanlar için pro model daha iyidir
      systemInstruction: AGENT_PROMPTS[nextAgent],
      contents: this.buildContents(`Sen ${nextAgent} ajanısın. Görevini yerine getir ve dokümanın ilgili kısımlarını güncelle.`),
      responseSchema: chatResponseJsonSchema,
      onChunk: (text, thinking, tokenCount) => {
        agentJson = text;
        if (onChunk) onChunk(text, thinking, tokenCount);
      }
    });

    let agentResult: ZodChatResponse = { message: "" };
    try {
      agentResult = JSON.parse(agentJson.trim());
    } catch(e) {
      console.error("Agent response parse error", e);
      agentResult = { message: agentJson };
    }

    // 3. Ajanın mesajını geçmişe ekle
    this.messageHistory.push({
      id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9),
      role: 'model',
      text: agentResult.message || '',
      senderName: nextAgent,
      senderRole: nextAgent,
      createdAt: Date.now()
    });

    // 4. State'i (Dokümanı) güncelle
    if (agentResult.document) {
      this.currentDocument = {
        ...this.currentDocument,
        ...agentResult.document,
        // BA dokümanı güncelliyorsa, eski code ve test verileri kaybolmasın diye birleştirme yapılır
        businessAnalysis: agentResult.document.businessAnalysis || this.currentDocument?.businessAnalysis || '',
        code: agentResult.document.code || this.currentDocument?.code || '',
        test: agentResult.document.test || this.currentDocument?.test || '',
        bpmn: agentResult.document.bpmn || this.currentDocument?.bpmn || '',
        review: agentResult.document.review || this.currentDocument?.review || ''
      };
    }

    return {
      nextAgent,
      finalResponse: agentResult,
      updatedDocument: this.currentDocument
    };
  }

  /**
   * Kullanıcıdan gelen mesajı işler ve bir adım atar.
   */
  public async processUserInteraction(
    userMessageText: string, 
    onAgentChange?: (agent: string, reason: string) => void, 
    onChunk?: (text: string, thinking?: string, tokenCount?: number) => void
  ): Promise<{
    nextAgent: string;
    finalResponse?: ZodChatResponse;
    updatedDocument: DocumentData | null;
  }> {
    // 1. Kullanıcı mesajını geçmişe ekle
    const userMessage: Message = {
      id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9),
      role: 'user',
      text: userMessageText,
      createdAt: Date.now()
    };
    this.messageHistory.push(userMessage);

    return this.step(onAgentChange, onChunk);
  }
}
