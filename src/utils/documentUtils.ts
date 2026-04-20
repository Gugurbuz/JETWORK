import { doc, setDoc, serverTimestamp } from '../db';
import { DocumentData } from '../types';
import { db } from '../db';

export const saveDocumentAndVersion = async (workspaceId: string, messageId: string, content: DocumentData) => {
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

export const saveRawResponse = async (workspaceId: string, messageId: string, rawText: string, parsedData: any) => {
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

export const applyPatch = (sectionContent: string, targetText: string, replacementText: string): string => {
  if (!targetText) {
    // If targetText is empty, just append
    return sectionContent ? sectionContent + '\n\n' + replacementText : replacementText;
  }

  // Try exact match
  if (sectionContent.includes(targetText)) {
    return sectionContent.replace(targetText, replacementText);
  }

  // Fallback: If exact match fails, try to find a partial match or just append
  console.warn(`[DocumentUtils] Exact match failed for targetText: "${targetText}". Appending to the end.`);
  return sectionContent ? sectionContent + '\n\n' + replacementText : replacementText;
};

export const parseBusinessAnalysis = (baContent: any): string => {
  if (typeof baContent === 'string') return baContent;
  if (!baContent || typeof baContent !== 'object') return '';

  // Eğer yeni SectionData formatındaysa (content alanı varsa), doğrudan içeriği dön
  if (baContent.content && typeof baContent.content === 'string') {
    return baContent.content;
  }

  // Eski format desteği (Eğer 1_ANALIZ_KAPSAMI gibi alanlar varsa formatla)
  if (baContent["1_ANALIZ_KAPSAMI"] || baContent["3_IS_GEREKSINIMLERI"]) {
    const today = new Date().toLocaleDateString('tr-TR');
    let md = `# İş Analizi Dokümanı\n\n**Talep Adı:** P4F Ürünü  \n**Tarih:** ${today}  \n**Talep No:** UA-437  \n\n---\n\n<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Enerjisa_logo.svg/1200px-Enerjisa_logo.svg.png" alt="Enerjisa Logo" width="200" />\n\n`;
    
    // ... (Eski formatlama mantığı devam eder, ancak daha sadeleştirilmiş)
    if (baContent["1_ANALIZ_KAPSAMI"]) md += `## 1. ANALİZ KAPSAMI\n${baContent["1_ANALIZ_KAPSAMI"]}\n\n`;
    if (baContent["2_KISALTMALAR"]) md += `## 2. KISALTMALAR\n${baContent["2_KISALTMALAR"]}\n\n`;
    if (baContent["3_IS_GEREKSINIMLERI"]) {
      md += `## 3. İŞ GEREKSİNİMLERİ\n`;
      if (baContent["3_IS_GEREKSINIMLERI"]["3_1_Is_Kurallari"]) md += `### 3.1. İş Kuralları\n${baContent["3_IS_GEREKSINIMLERI"]["3_1_Is_Kurallari"]}\n\n`;
      if (baContent["3_IS_GEREKSINIMLERI"]["3_2_Is_Modeli_ve_Kullanici_Gereksinimleri"]) md += `### 3.2. İş Modeli ve Kullanıcı Gereksinimleri\n${baContent["3_IS_GEREKSINIMLERI"]["3_2_Is_Modeli_ve_Kullanici_Gereksinimleri"]}\n\n`;
    }
    if (baContent["4_FONKSIYONEL_GEREKSINIMLER"]) md += `## 4. FONKSİYONEL GEREKSİNİMLER (FR)\n${baContent["4_FONKSIYONEL_GEREKSINIMLER"]}\n\n`;
    // ... diğer alanlar eklenebilir ama kullanıcı iptal istediği için bu kadarı yeterli veya doğrudan baContent dönebiliriz.
    return md;
  }

  // Hiçbirine uymuyorsa JSON olarak stringify et (debug amaçlı veya fallback)
  return typeof baContent === 'object' ? JSON.stringify(baContent, null, 2) : String(baContent);
};
