import { Type } from "@google/genai";
import { useStore } from '../store/useStore';
import { db, doc, setDoc, serverTimestamp } from '../db';
import { DocumentData } from '../types';
import { callGemini } from '../services/geminiService';

export const useDocument = () => {
  const { 
    currentWorkspaceId, 
    documentContent, 
    setDocumentContent, 
    setIsGenerating, 
    messages, 
    selectedModel 
  } = useStore();

  const handleGenerateDocument = async () => {
    if (!currentWorkspaceId) return;
    setIsGenerating(true);

    try {
      const systemInstruction = `Sen bir Kıdemli İş Analisti ve Sistem Mimarı'sın.
GÖREVİN: Verilen sohbet geçmişini analiz ederek kapsamlı bir iş analizi ve yazılım mimarisi dokümanı oluşturmak.

ÇIKTI FORMATI:
JSON formatında, aşağıdaki alanları içeren bir obje döndür:
- businessAnalysis: İş analizi, gereksinimler, kullanıcı hikayeleri (Markdown)
- code: Teknik mimari, veritabanı şeması, API uç noktaları (Markdown)
- test: Test senaryoları, kabul kriterleri (Markdown)
- review: Proje özeti, riskler, öneriler (Markdown)
- bpmn: Süreç akışını anlatan BPMN 2.0 XML formatında veri (Sadece XML içeriği, markdown code block OLMADAN)

ÖNEMLİ: bpmn alanı kesinlikle geçerli bir XML olmalıdır. İçinde markdown (\`\`\`xml gibi) bulunmamalıdır.`;

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

      const newDoc = JSON.parse(response.text);
      setDocumentContent(newDoc);

      const docRef = doc(db, 'workspaces', currentWorkspaceId, 'documents', 'main');
      await setDoc(docRef, {
        content: newDoc,
        lastUpdated: serverTimestamp(),
        updatedBy: 'System'
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
      const docRef = doc(db, 'workspaces', currentWorkspaceId, 'documents', 'main');
      await setDoc(docRef, {
        content: newContent,
        lastUpdated: serverTimestamp(),
        updatedBy: 'User'
      });
    } catch (error) {
      console.error("Error updating document:", error);
    }
  };

  return { handleGenerateDocument, handleUpdateDocument };
};
