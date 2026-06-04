import { useStore } from '../store/useStore';
import { useMessageStore } from '../store/useMessageStore';
import { supabase } from '../supabase';
import { nowIso } from '../lib/mapping';
import { saveDocumentAndVersion } from '../utils/documentUtils';
import { runConceptualDesignOrchestration } from '../modules/conceptual-design/conceptualDesignOrchestrator';
import { conceptualDesignToDocumentData } from '../modules/conceptual-design/conceptualDesignToDocumentData';

function buildConversationNotes(messages: ReturnType<typeof useMessageStore.getState>['messagesByWorkspace'][string] = []): string {
  return messages
    .map(message => `${message.senderName || 'Kullanıcı'} (${message.senderRole || 'Bilinmiyor'}): ${message.text}`)
    .join('\n');
}

export function useConceptualDesignDocument() {
  const currentWorkspaceId = useStore(state => state.currentWorkspaceId);
  const selectedModel = useStore(state => state.selectedModel);
  const setIsGeneratingDocument = useStore(state => state.setIsGeneratingDocument);
  const setDocumentContent = useStore(state => state.setDocumentContent);

  const handleGenerateConceptualDesignDocument = async () => {
    if (!currentWorkspaceId) return;

    const messages = useMessageStore.getState().messagesByWorkspace[currentWorkspaceId] || [];
    if (!messages.length) return;

    setIsGeneratingDocument(true);

    try {
      const notes = buildConversationNotes(messages);
      const result = await runConceptualDesignOrchestration({
        notes,
        model: selectedModel,
        projectName: 'Jetwork AI İş Analizi Studio',
        templateGuidance: 'Enerjisa kavramsal tasarım dokümanı formatına uygun, süreç/gereksinim/KPI/mesaj/entegrasyon odaklı çıktı üret.',
      });

      const documentData = conceptualDesignToDocumentData(result.document);
      setDocumentContent(documentData);

      await supabase.from('workspaces').update({ last_updated: nowIso() }).eq('id', currentWorkspaceId);
      await saveDocumentAndVersion(currentWorkspaceId, `conceptual-${Date.now()}`, documentData);
    } catch (error) {
      console.error('Error generating conceptual design document:', error);
      setDocumentContent({
        businessAnalysis: {
          content: 'Kavramsal tasarım dokümanı oluşturulurken hata oluştu. Lütfen tekrar deneyin.',
          status: 'NEEDS_REVISION',
          flags: ['Kavramsal tasarım üretim motoru hata verdi.'],
        },
        code: { content: '', status: 'DRAFT', flags: [] },
        test: { content: '', status: 'DRAFT', flags: [] },
        review: { content: '', status: 'DRAFT', flags: [] },
        bpmn: { content: '', status: 'DRAFT', flags: [] },
      });
    } finally {
      setIsGeneratingDocument(false);
    }
  };

  return { handleGenerateConceptualDesignDocument };
}
