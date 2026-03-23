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

export const parseBusinessAnalysis = (baContent: any): string => {
  if (typeof baContent === 'string') return baContent;
  if (!baContent || typeof baContent !== 'object') return '';

  const today = new Date().toLocaleDateString('tr-TR');

  let md = `# İş Analizi Dokümanı

**Talep Adı:** P4F Ürünü  
**Tarih:** ${today}  
**Talep No:** UA-437  

---

<img src="https://upload.wikimedia.org/wikipedia/commons/thumb/1/1d/Enerjisa_logo.svg/1200px-Enerjisa_logo.svg.png" alt="Enerjisa Logo" width="200" />

### İçindekiler

`;

  if (baContent["1_ANALIZ_KAPSAMI"]) md += `- 1. ANALİZ KAPSAMI\n`;
  if (baContent["2_KISALTMALAR"]) md += `- 2. KISALTMALAR\n`;
  if (baContent["3_IS_GEREKSINIMLERI"]) {
    md += `- 3. İŞ GEREKSİNİMLERİ\n`;
    if (baContent["3_IS_GEREKSINIMLERI"]["3_1_Is_Kurallari"]) md += `  - 3.1. İş Kuralları\n`;
    if (baContent["3_IS_GEREKSINIMLERI"]["3_2_Is_Modeli_ve_Kullanici_Gereksinimleri"]) md += `  - 3.2. İş Modeli ve Kullanıcı Gereksinimleri\n`;
  }
  if (baContent["4_FONKSIYONEL_GEREKSINIMLER"]) md += `- 4. FONKSİYONEL GEREKSİNİMLER (FR)\n`;
  if (baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]) {
    md += `- 5. FONKSİYONEL OLMAYAN GEREKSİNLİMLER (NFR)\n`;
    if (baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_1_Guvenlik_ve_Yetkilendirme"]) md += `  - 5.1. Güvenlik ve Yetkilendirme Gereksinimleri\n`;
    if (baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_2_Performans"]) md += `  - 5.2. Performans Gereksinimleri\n`;
    if (baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_3_Raporlama"]) md += `  - 5.3. Raporlama Gereksinimleri\n`;
  }
  if (baContent["6_SUREC_RISK_ANALIZI"]) {
    md += `- 6. SÜREÇ RİSK ANALİZİ\n`;
    if (baContent["6_SUREC_RISK_ANALIZI"]["6_1_Kisitlar_ve_Varsayimlar"]) md += `  - 6.1. Kısıtlar ve Varsayımlar\n`;
    if (baContent["6_SUREC_RISK_ANALIZI"]["6_2_Bagliliklar"]) md += `  - 6.2. Bağlılıklar\n`;
    if (baContent["6_SUREC_RISK_ANALIZI"]["6_3_Surec_Etkileri"]) md += `  - 6.3. Süreç Etkileri\n`;
  }
  if (baContent["7_ONAY"]) {
    md += `- 7. ONAY\n`;
    if (baContent["7_ONAY"]["7_1_Is_Analizi"]) md += `  - 7.1. İş Analizi\n`;
    if (baContent["7_ONAY"]["7_2_Degisiklik_Kayitlari"]) md += `  - 7.2. Değişiklik Kayıtları\n`;
    if (baContent["7_ONAY"]["7_3_Dokuman_Onay"]) md += `  - 7.3. Doküman Onay\n`;
    if (baContent["7_ONAY"]["7_4_Referans_Dokumanlar"]) md += `  - 7.4. Referans Dokümanlar\n`;
  }
  if (baContent["8_FONKSIYONEL_TASARIM_DOKUMANLARI"]) md += `- 8. FONKSİYONEL TASARIM DOKÜMANLARI\n`;

  md += `\n---\n\n`;

  if (baContent["1_ANALIZ_KAPSAMI"]) md += `## 1. ANALİZ KAPSAMI\n${baContent["1_ANALIZ_KAPSAMI"]}\n\n`;
  if (baContent["2_KISALTMALAR"]) md += `## 2. KISALTMALAR\n${baContent["2_KISALTMALAR"]}\n\n`;
  
  if (baContent["3_IS_GEREKSINIMLERI"]) {
    md += `## 3. İŞ GEREKSİNİMLERİ\n`;
    if (baContent["3_IS_GEREKSINIMLERI"]["3_1_Is_Kurallari"]) md += `### 3.1. İş Kuralları\n${baContent["3_IS_GEREKSINIMLERI"]["3_1_Is_Kurallari"]}\n\n`;
    if (baContent["3_IS_GEREKSINIMLERI"]["3_2_Is_Modeli_ve_Kullanici_Gereksinimleri"]) md += `### 3.2. İş Modeli ve Kullanıcı Gereksinimleri\n${baContent["3_IS_GEREKSINIMLERI"]["3_2_Is_Modeli_ve_Kullanici_Gereksinimleri"]}\n\n`;
  }
  
  if (baContent["4_FONKSIYONEL_GEREKSINIMLER"]) md += `## 4. FONKSİYONEL GEREKSİNİMLER (FR)\n${baContent["4_FONKSIYONEL_GEREKSINIMLER"]}\n\n`;
  
  if (baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]) {
    md += `## 5. FONKSİYONEL OLMAYAN GEREKSİNLİMLER (NFR)\n`;
    if (baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_1_Guvenlik_ve_Yetkilendirme"]) md += `### 5.1. Güvenlik ve Yetkilendirme Gereksinimleri\n${baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_1_Guvenlik_ve_Yetkilendirme"]}\n\n`;
    if (baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_2_Performans"]) md += `### 5.2. Performans Gereksinimleri\n${baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_2_Performans"]}\n\n`;
    if (baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_3_Raporlama"]) md += `### 5.3. Raporlama Gereksinimleri\n${baContent["5_FONKSIYONEL_OLMAYAN_GEREKSINIMLER"]["5_3_Raporlama"]}\n\n`;
  }
  
  if (baContent["6_SUREC_RISK_ANALIZI"]) {
    md += `## 6. SÜREÇ RİSK ANALİZİ\n`;
    if (baContent["6_SUREC_RISK_ANALIZI"]["6_1_Kisitlar_ve_Varsayimlar"]) md += `### 6.1. Kısıtlar ve Varsayımlar\n${baContent["6_SUREC_RISK_ANALIZI"]["6_1_Kisitlar_ve_Varsayimlar"]}\n\n`;
    if (baContent["6_SUREC_RISK_ANALIZI"]["6_2_Bagliliklar"]) md += `### 6.2. Bağlılıklar\n${baContent["6_SUREC_RISK_ANALIZI"]["6_2_Bagliliklar"]}\n\n`;
    if (baContent["6_SUREC_RISK_ANALIZI"]["6_3_Surec_Etkileri"]) md += `### 6.3. Süreç Etkileri\n${baContent["6_SUREC_RISK_ANALIZI"]["6_3_Surec_Etkileri"]}\n\n`;
  }
  
  if (baContent["7_ONAY"]) {
    md += `## 7. ONAY\n`;
    if (baContent["7_ONAY"]["7_1_Is_Analizi"]) md += `### 7.1. İş Analizi\n${baContent["7_ONAY"]["7_1_Is_Analizi"]}\n\n`;
    if (baContent["7_ONAY"]["7_2_Degisiklik_Kayitlari"]) md += `### 7.2. Değişiklik Kayıtları\n${baContent["7_ONAY"]["7_2_Degisiklik_Kayitlari"]}\n\n`;
    if (baContent["7_ONAY"]["7_3_Dokuman_Onay"]) md += `### 7.3. Doküman Onay\n${baContent["7_ONAY"]["7_3_Dokuman_Onay"]}\n\n`;
    if (baContent["7_ONAY"]["7_4_Referans_Dokumanlar"]) md += `### 7.4. Referans Dokümanlar\n${baContent["7_ONAY"]["7_4_Referans_Dokumanlar"]}\n\n`;
  }
  
  if (baContent["8_FONKSIYONEL_TASARIM_DOKUMANLARI"]) md += `## 8. FONKSİYONEL TASARIM DOKÜMANLARI\n${baContent["8_FONKSIYONEL_TASARIM_DOKUMANLARI"]}\n\n`;

  return md;
};
