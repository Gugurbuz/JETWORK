import { DocumentData, Message, MessageRole, PromptSettings } from '../types';
import { applyMicroEditTool } from '../schemas';

export type CallGeminiFunction = (params: {
  model: string;
  systemInstruction: string;
  contents: any[];
  responseSchema?: any;
  tools?: any[];
  toolConfig?: any;
  onChunk?: (text: string, thinking?: string, tokenCount?: number, functionCalls?: any[]) => void;
  onGrounding?: (urls: { uri: string; title: string }[]) => void;
}) => Promise<{ text: string, thinking: string, tokenCount: number, functionCalls?: any[] }>;

export class AgentOrchestrator {
  private callGemini: CallGeminiFunction;
  private currentDocument: DocumentData | null;
  private messageHistory: Message[];
  private promptSettings: PromptSettings | null;

  constructor(callGemini: CallGeminiFunction, initialDocument: DocumentData | null, history: Message[], promptSettings?: PromptSettings | null) {
    this.callGemini = callGemini;
    this.currentDocument = initialDocument;
    this.messageHistory = history;
    this.promptSettings = promptSettings || null;
    
    if (!this.currentDocument) {
      this.currentDocument = {
        businessAnalysis: { content: '', status: 'DRAFT', flags: [] },
        code: { content: '', status: 'DRAFT', flags: [] },
        test: { content: '', status: 'DRAFT', flags: [] },
        bpmn: { content: '', status: 'DRAFT', flags: [] },
        review: { content: '', status: 'DRAFT', flags: [] }
      };
    }
  }

  private buildSystemPrompt(): string {
    return `Sen kıdemli bir yazılım mimarı ve ürün yöneticisisin (Router).
Kullanıcının isteklerini analiz edip, sağ taraftaki dokümanda (Canvas) gerekli güncellemeleri yapmalısın.

KATI KURAL (GUARDRAIL):
1. Asla doğrudan uzun metinler uydurma. Kullanıcının isteğini analiz et ve sağdaki dokümanda nereyi değiştirmen gerekiyorsa SADECE \`apply_micro_edit\` aracını kullan.
2. Eğer kullanıcıdan yeni bir bilgi geldiğinde veya bir talep olduğunda, SADECE soru sormakla yetinme! Mutlaka dokümanın ilgili sekmesini (businessAnalysis, code, test, bpmn) \`apply_micro_edit\` aracı ile güncelle.
3. Dokümanı güncellerken, \`targetText\` alanına dokümandaki mevcut metni BİREBİR, HARFİ HARFİNE yazmalısın.
4. Eğer yeni bir metin ekliyorsan, eklenecek yerin hemen öncesindeki metni \`targetText\` olarak yaz ve \`replacementText\` alanına \`targetText\` + yeni metin şeklinde yaz.
5. Eğer doküman tamamen boşsa veya ilgili sekme boşsa, \`targetText\` alanını boş bırakabilirsin.

ÖNEMLİ: Kullanıcı sana bir cevap verdiğinde (Örn: "Aynı"), bu bilgiyi kullanarak hemen dokümanı güncellemelisin. Sürekli soru sorma döngüsüne girme.

Mevcut Doküman Durumu (Snapshot):
${JSON.stringify(this.currentDocument, null, 2)}
`;
  }

  private buildContents(): { role: MessageRole; parts: any[] }[] {
    return this.messageHistory.map(msg => {
      let textContent = msg.text || '';
      const isSelf = msg.role === 'model';
      
      return {
        role: isSelf ? 'model' : 'user',
        parts: [{ text: isSelf ? textContent : `[${msg.senderName || 'Kullanıcı'}]: ${textContent}` }]
      };
    });
  }

  private applyPatch(sectionContent: string, targetText: string, replacementText: string): string {
    if (!targetText) {
      // If targetText is empty, just append
      return sectionContent ? sectionContent + '\n\n' + replacementText : replacementText;
    }

    // Try exact match
    if (sectionContent.includes(targetText)) {
      return sectionContent.replace(targetText, replacementText);
    }

    // Fallback: If exact match fails, try to find a partial match or just append
    console.warn(`[Orchestrator] Exact match failed for targetText: "${targetText}". Appending to the end.`);
    return sectionContent ? sectionContent + '\n\n' + replacementText : replacementText;
  }

  public async processMessage(
    onChunk?: (text: string, thinking?: string, tokenCount?: number, functionCalls?: any[]) => void
  ): Promise<{
    updatedDocument: DocumentData | null;
    explanation: string;
    finalText?: string;
    finalThinking?: string;
  }> {
    
    let agentText = '';
    let agentThinking = '';

    const response = await this.callGemini({
      model: "gemini-3.1-pro-preview",
      systemInstruction: this.buildSystemPrompt(),
      contents: this.buildContents(),
      tools: [applyMicroEditTool],
      toolConfig: { includeServerSideToolInvocations: true },
      onChunk: (text, thinking, tokenCount, functionCalls) => {
        agentText = text;
        if (thinking) agentThinking = thinking;
        if (onChunk) onChunk(text, thinking, tokenCount, functionCalls);
      }
    });

    let explanation = 'İşlem tamamlandı.';
    let documentUpdated = false;

    if (response.functionCalls && response.functionCalls.length > 0) {
      for (const call of response.functionCalls) {
        if (call.name === 'apply_micro_edit') {
          const args = call.args || {};
          const section = args.section as keyof DocumentData;
          const targetText = args.targetText || '';
          const replacementText = args.replacementText || '';
          
          if (args.explanation) {
            explanation = args.explanation;
          }

          const targetSection = this.currentDocument![section];
          if (targetSection && typeof targetSection === 'object' && 'content' in targetSection) {
            targetSection.content = this.applyPatch(targetSection.content, targetText, replacementText);
            documentUpdated = true;
          }
        }
      }
    } else {
      explanation = response.text || 'Analiz tamamlandı, ancak dokümanda bir değişiklik yapılmadı.';
    }

    return {
      updatedDocument: documentUpdated ? this.currentDocument : null,
      explanation,
      finalText: response.text,
      finalThinking: response.thinking
    };
  }
}