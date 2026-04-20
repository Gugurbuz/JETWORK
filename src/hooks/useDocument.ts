import { Type } from "@google/genai";
import { useStore } from '../store/useStore';
import { supabase } from '../supabase';
import { nowIso } from '../lib/mapping';
import { DocumentData } from '../types';
import { callGemini } from '../services/geminiService';
import { buildSystemPrompt, BA_DOCUMENT_TEMPLATE_INSTRUCTION } from '../services/promptEngine';
import { marked } from 'marked';

export const useDocument = () => {
  const { 
    currentWorkspaceId, 
    documentContent, 
    setDocumentContent, 
    setIsGenerating, 
    messages, 
    selectedModel,
    promptSettings
  } = useStore();

  const handleGenerateDocument = async () => {
    if (!currentWorkspaceId) return;
    setIsGenerating(true);

    try {
      const systemInstruction = buildSystemPrompt({
        role: 'BA',
        taskType: 'documentation',
        settings: promptSettings,
        additionalContext: `GÖREVİN: Verilen sohbet geçmişini analiz ederek kapsamlı bir iş analizi ve yazılım mimarisi dokümanı oluşturmak.

ÇIKTI FORMATI:
JSON formatında, aşağıdaki alanları içeren bir obje döndür:
- businessAnalysis: Aşağıda verilen ŞABLONA birebir uyan, kapak sayfası + içindekiler + numaralı bölümler içeren tam yapılandırılmış bir İş Analizi Dokümanı (Markdown + izin verilen HTML div blokları)
- code: Teknik mimari, veritabanı şeması, API uç noktaları (Markdown; ## 1., ## 2. numaralı başlıklarla)
- test: Test senaryoları, kabul kriterleri (Markdown; ## 1., ## 2. numaralı başlıklarla, test senaryoları için tablo)
- review: Proje özeti, riskler, öneriler (Markdown)
- bpmn: Süreç akışını anlatan BPMN 2.0 XML formatında veri (Sadece XML içeriği, markdown code block OLMADAN)

ÖNEMLİ: bpmn alanı kesinlikle geçerli bir XML olmalıdır. İçinde markdown (\`\`\`xml gibi) bulunmamalıdır.

${BA_DOCUMENT_TEMPLATE_INSTRUCTION}`
      });

      const contents = [
        {
          role: 'user',
          parts: [{ text: `Sohbet Geçmişi:\n\n${messages.map(m => `[${m.senderName}]: ${m.text}`).join('\n')}` }]
        }
      ];

      const response = await callGemini({
        model: selectedModel,
        systemInstruction,
        contents,
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            businessAnalysis: { type: Type.STRING },
            code: { type: Type.STRING },
            test: { type: Type.STRING },
            review: { type: Type.STRING },
            bpmn: { type: Type.STRING }
          },
          required: ["businessAnalysis", "code", "test", "review", "bpmn"]
        },
        onChunk: () => {} // We don't stream document generation to UI yet
      });

      const rawDoc = JSON.parse(response.text);

      const toSection = (md: string, parse = true) => ({
        content: parse && md ? (marked.parse(md) as string) : (md || ''),
        status: 'DRAFT' as const,
        flags: [] as string[],
      });

      const newDoc = {
        businessAnalysis: toSection(rawDoc.businessAnalysis),
        code: toSection(rawDoc.code),
        test: toSection(rawDoc.test),
        review: toSection(rawDoc.review),
        bpmn: toSection(rawDoc.bpmn, false),
      };
      setDocumentContent(newDoc);

      await supabase.from('documents').upsert({
        id: 'main',
        workspace_id: currentWorkspaceId,
        content: newDoc,
        last_updated: nowIso(),
        updated_at: nowIso(),
        updated_by: 'System',
      });

    } catch (error) {
      console.error("Error generating document:", error);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleUpdateDocument = async (newContent: DocumentData) => {
    if (!currentWorkspaceId) return;
    setDocumentContent(newContent);
    
    try {
      await supabase.from('documents').upsert({
        id: 'main',
        workspace_id: currentWorkspaceId,
        content: newContent,
        last_updated: nowIso(),
        updated_at: nowIso(),
        updated_by: 'User',
      });
    } catch (error) {
      console.error("Error updating document:", error);
    }
  };

  return { handleGenerateDocument, handleUpdateDocument };
};
