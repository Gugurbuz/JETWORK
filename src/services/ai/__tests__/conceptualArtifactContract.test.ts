import { describe, expect, it } from 'vitest';
import { ARTIFACT_PROFILES } from '../artifactProfiles';
import {
  parseConceptualArtifact,
  renderConceptualArtifact,
} from '../conceptualArtifactContract';
import { conceptualTemplateCoverage } from '../../conceptualTemplate';
import { evaluateDocumentQualityGate } from '../../documentQualityGate';

const sourceFact = (text: string) => ({ text, status: 'SOURCE' });
const openFact = (text: string) => ({ text, status: 'OPEN' });

function rawArtifact() {
  const process = (name: string, actor: string) => ({
    name,
    highLevelDescription: sourceFact(`${name} surecinin ust duzey aciklamasi.`),
    actors: [sourceFact(actor)],
    trigger: openFact('Tetikleyici netlestirilmelidir.'),
    preconditions: [openFact('On kosullar netlestirilmelidir.')],
    processChanges: [sourceFact('Ayri listeler yerine tek is listesi kullanilir.')],
    requirementsAndKpis: [sourceFact('Tamamlanma suresi olculur; hedef deger acik konudur.')],
    businessRules: [sourceFact('Iade onayi olmadan odeme talimati olusturulamaz.')],
    validations: [openFact('Validasyon mesaji netlestirilmelidir.')],
    alternateFlows: [openFact('Alternatif akis netlestirilmelidir.')],
    exceptions: [openFact('Hata davranisi netlestirilmelidir.')],
    dataRequirements: [openFact('Veri alanlari netlestirilmelidir.')],
    uiRequirements: [openFact('Ekran davranisi netlestirilmelidir.')],
    integrationRequirements: [openFact('Entegrasyon ihtiyaci netlestirilmelidir.')],
    flowSteps: [{
      text: `${name} kaydi olusturulur.`,
      status: 'SOURCE',
      actor,
      systemBehavior: 'Kaydi merkezi is listesine ekler.',
    }],
    outputs: [sourceFact('Karar gecmisi kaydedilir.')],
    relatedProcesses: [openFact('Ilgili surecler netlestirilmelidir.')],
    customerDevelopments: [sourceFact('Kanal bagimsiz takip saglanir.')],
    adaptations: [sourceFact('Merkezi is listesi uyarlamasi yapilir.')],
    changeManagement: [openFact('Egitim ve gecis plani netlestirilmelidir.')],
  });

  return {
    project: {
      name: 'Abonelik Iptal ve Iade',
      businessProblem: sourceFact('Talepler farkli kanallarda izlenemiyor.'),
      currentState: sourceFact('Ekipler ayri listeler kullaniyor.'),
      targetState: sourceFact('Talepler tek is listesinde izlenecek.'),
      purpose: sourceFact('Iptal ve iade sureclerini karar verilebilir ayrintida tanimlamak.'),
      scopeIn: [sourceFact('Iptal ve iade talep yonetimi.')],
      scopeOut: [sourceFact('Muhasebe sisteminin yeniden yazilmasi.')],
      constraints: [openFact('Teknik kisitlar netlestirilmelidir.')],
      successMetrics: [sourceFact('Tamamlanma suresi; hedef deger acik konu.')],
    },
    documentControl: {
      participants: [sourceFact('Musteri temsilcisi'), sourceFact('Operasyon uzmani')],
      revisionDate: openFact('Revize tarihi netlestirilmelidir.'),
      approvers: [sourceFact('Onayci')],
    },
    processes: [
      process('Iptal talebinin alinmasi', 'Musteri temsilcisi'),
      process('Uygunluk kontrolu ve onay', 'Operasyon uzmani'),
      process('Iade sonucu ve kapanis', 'Onayci'),
    ],
    appendix: {
      relatedDocuments: [openFact('Referans dokuman bildirilmedi.')],
      attachments: [openFact('Eklenti bildirilmedi.')],
    },
    review: {
      risks: [openFact('Operasyonel riskler netlestirilmelidir.')],
      assumptions: [openFact('Varsayim bulunmuyor.')],
      openTopics: [openFact('KPI hedef degeri netlestirilmelidir.')],
      conflicts: [openFact('Belirgin bir celiski saptanmadi.')],
      quickActions: [openFact('Acik kararlarin sahipleri belirlenmelidir.')],
    },
    evidenceClaims: [],
  };
}

describe('structured conceptual artifact contract', () => {
  it('renders the complete canonical Word structure without inventing process blocks', () => {
    const payload = parseConceptualArtifact(rawArtifact());
    expect(payload).not.toBeNull();

    const document = renderConceptualArtifact(payload!);
    const coverage = conceptualTemplateCoverage(document.businessAnalysis.content);
    const processHeadings = document.businessAnalysis.content.match(/SÜREÇ MODELİ:/g) || [];

    expect(coverage.missing).toEqual([]);
    expect(processHeadings).toHaveLength(3);
    expect(document.businessAnalysis.content).toContain('Iptal talebinin alinmasi');
    expect(document.businessAnalysis.content).toContain('AKIŞ DİYAGRAMI');
    expect(document.businessAnalysis.content).toContain('DEĞİŞİM YÖNETİMİ');
    expect(document.businessAnalysis.content).not.toMatch(/SAP|IYS|Findeks|KKB|D2D/i);

    const quality = evaluateDocumentQualityGate(document, {
      artifactProfile: ARTIFACT_PROFILES.conceptual_design_process_heavy,
      sourceProcessTitles: [
        'Iptal talebinin alinmasi',
        'Uygunluk kontrolu ve onay',
        'Iade sonucu ve kapanis',
      ],
      sourceSensitive: false,
    });
    expect(quality.canPublishToPanel).toBe(true);
    expect(quality.score).toBe(100);
  });

  it('downgrades an unsupported VERIFIED claim instead of publishing an invalid ledger', () => {
    const raw = rawArtifact();
    raw.evidenceClaims = [{
      claimId: 'CLM-001',
      claim: 'Kaynak olmadan dogrulanmis gibi isaretlenen iddia.',
      status: 'VERIFIED',
      confidence: 0.95,
    }] as any;

    const payload = parseConceptualArtifact(raw);
    expect(payload?.evidenceClaims[0]).toMatchObject({
      claimId: 'CLM-001',
      status: 'OPEN',
      confidence: 0.5,
    });
  });
});
