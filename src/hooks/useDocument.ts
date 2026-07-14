import { Type } from "@google/genai";
import { useStore } from '../store/useStore';
import { supabase } from '../supabase';
import { nowIso } from '../lib/mapping';
import { DocumentData } from '../types';
import { callGemini } from '../services/geminiService';
import { buildSystemPrompt, BA_DOCUMENT_TEMPLATE_INSTRUCTION } from '../services/promptEngine';
import { marked } from 'marked';
import { useMessageStore } from '../store/useMessageStore';

export const useDocument = () => {
  const {
    currentWorkspaceId,
    documentContent,
    setDocumentContent,
    setIsGeneratingDocument,
    selectedModel,
    promptSettings
  } = useStore();

  const messagesByWorkspace = useMessageStore(state => state.messagesByWorkspace);
  const messages = currentWorkspaceId ? (messagesByWorkspace[currentWorkspaceId] || []) : [];

  const handleGenerateDocument = async () => {
    if (!currentWorkspaceId) return;
    setIsGeneratingDocument(true);

    try {
      const systemInstruction = buildSystemPrompt({
        role: 'BA',
        taskType: 'documentation',
        settings: promptSettings,
        additionalContext: `GÖREVİN: Verilen sohbet geçmişini analiz ederek kapsamlı, kaynakla uyumlu ve karar verilebilir bir kavramsal iş analizi dokümanı oluşturmak.

ÇIKTI FORMATI:
JSON formatında, aşağıdaki alanları içeren bir obje döndür:
- businessAnalysis: Aşağıda verilen ŞABLONA birebir uyan, kapak sayfası + içindekiler + numaralı bölümler içeren tam yapılandırılmış bir İş Analizi Dokümanı (Markdown + izin verilen HTML div blokları)
- review: Kaynak/doğrulama özeti, riskler, açık konular, varsayımlar, kalite notları ve hızlı aksiyonlar (Markdown)

ÖNEMLİ: Görünür doküman yüzeyi yalnızca businessAnalysis ve review alanlarıdır. Teknik analiz, test/UAT, veri modeli, entegrasyon, API kontratı ve süreç akışı detayları ayrı code/test/bpmn alanlarına değil businessAnalysis içindeki ilgili bölümlere yazılmalıdır.

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
            review: { type: Type.STRING }
          },
          required: ["businessAnalysis", "review"]
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
        review: toSection(rawDoc.review),
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
      setIsGeneratingDocument(false);
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
