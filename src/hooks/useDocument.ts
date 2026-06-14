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
        additionalContext: `GÖREVİN: Verilen sohbet geçmişini analiz ederek kurumsal Kavramsal Tasarım Raporu oluşturmak.

ÇIKTI FORMATI:
JSON formatında, aşağıdaki alanları içeren bir obje döndür:
- businessAnalysis: Aşağıda verilen kurumsal Word şablonuna birebir uyan KAVRAMSAL TASARIM RAPORU. Başlık sırası şudur: PROJE KİMLİK KARTI, Amaç, Doküman Tarihçesi, İÇİNDEKİLER, SÜREÇ TASARIMI, SÜREÇ MODELİ blokları, EK A.
- code: IT / teknik analiz özeti. Mimari, entegrasyon, veri modeli, güvenlik ve loglama notları. Ana detay businessAnalysis içinde de bulunmalı.
- test: test stratejisi ve kabul kriterleri özeti. Ana detay businessAnalysis içinde de bulunmalı.
- review: kararlar, riskler, açık sorular, varsayımlar ve kalite notları.
- bpmn: varsa süreç akışını anlatan BPMN 2.0 XML. Yoksa boş string döndür.

ÖNEMLİ: businessAnalysis alanı "BA Analiz Raporu" ile değil, "KAVRAMSAL TASARIM RAPORU" ile başlamalıdır. Eksik bilgileri [VARSAYIM] veya [AÇIK KONU] olarak işaretle.

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