import { parse as parsePartialJson } from 'partial-json';

const json = `{ "message": "Merhaba @deneme. İYS (İleti Yönetim Sistemi) ve SAP CRM entegrasyonu, ETK (Elektronik Ticaretin Düzenlenmesi Hakkında Kanun) ve KVKK uyumluluğu açısından şirketimizin en kritik veri senkronizasyon süreçlerinden biridir.\\n\\nBu entegrasyonun çift yönlü (Bi-directional) çalışması, veri kaybı yaşanmaması (Zero Data Loss) ve İYS API'lerinin Rate-Limit kısıtlamalarına takılmadan Asenkron / Batch yapılarla desteklenmesi gerekmektedir.\\n\\nSürecin tüm iş analizi detaylarını, Kurumsal Mimari (Enterprise Architecture) seviyesindeki teknik tasarımını, test stratejilerini ve uçtan uca BPMN süreç diyagramını sağ paneldeki dokümana aktardım. İnceleyip üzerinde revizyonlarımızı yapabiliriz.", "document": { "businessAnalysis": "# SAP CRM - İYS Entegrasyonu: İş ve Sistem Analizi Dokümanı\\n\\n## 1. Yönetici Özeti (Executive Summary)\\nBu projenin amacı, kurumun merkezi m" }`;

const parsed = parsePartialJson(json);
console.log("parsed.message:", parsed.message);
console.log("parsed.document:", parsed.document);
