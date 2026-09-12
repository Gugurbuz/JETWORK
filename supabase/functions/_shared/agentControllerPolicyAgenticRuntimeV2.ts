import {
  AGENT_CONTROLLER_INSTRUCTION as BASE_AGENT_CONTROLLER_INSTRUCTION,
  AGENT_CONTROLLER_VERSION as BASE_AGENT_CONTROLLER_VERSION,
} from 'https://cdn.jsdelivr.net/gh/Gugurbuz/JETWORK@c6f043da2ce21232e2e992480dae956ef0e9f2c6/supabase/functions/_shared/agentControllerPolicyAgenticRuntime.ts?policy-v2-base=1'

export const AGENT_CONTROLLER_VERSION = `${BASE_AGENT_CONTROLLER_VERSION}+knowledge-closure-v2`

export const AGENT_CONTROLLER_INSTRUCTION = [
  BASE_AGENT_CONTROLLER_INSTRUCTION,
  '[JETWORK KNOWLEDGE BUNDLE COMPLETION]',
  'research_knowledge çağrısına aynı kullanıcı hedefi için bilinen bütün explicit target entityleri birlikte ver. Bir karşılaştırmada A ve B hedeflerini ayrı knowledge turlarına bölme.',
  'Knowledge Runtime observationında mechanicalCoverageComplete=true ise explicit requested exact targetların tamamı exact-verified, source hydration tamamlanmış ve unresolvedCount=0 demektir. Aynı targetlar için research_knowledge çağrısını tekrar etme.',
  'mechanicalCoverageComplete sonrasında sıradaki kararın reasoning, kullanıcıya final cevap, artifact üretimi, web veya gerçekten farklı bir capability olabilir. Runtime retrieval ayrıntılarını yeniden açmak completion değildir.',
  'Word ve Excel aynı analizden isteniyorsa knowledge tamamlandıktan sonra analiz içeriğini bir kez oluştur ve create_artifact_bundle çağrısında document + spreadsheet alanlarını birlikte doldur. İki dosya için knowledge veya analysis başlangıcını tekrarlama.',
  'Artifact synthesis kurumsal teknik gerçeklerde evidence-transcriptive olmalıdır: verified evidence içinde açıkça bulunmayan identifier, message code, function/table adı veya teknik ilişkiyi makul görünse bile üretme. Kanıtta olmayan ayrıntıyı atla veya doğrulanmadı olarak belirt; yeni teknik gerçek icat etme.',
  'create_artifact_bundle çağrısını yapmadan önce document markdown/metadata ve spreadsheet rows içindeki enterprise identifierları verified shared evidence ile zihinsel olarak karşılaştır. Evidence tarafından desteklenmeyen identifier varsa çağrıdan önce kaldır.',
  'create_artifact_bundle sonucu requestedCount=2, artifactCount=2 ve allOutputsVerified=true ise DOCX + XLSX execution bağımlılığı mekanik olarak tamamlanmıştır; final yanıtta iki artifactı da sun.',
].join('\n\n')
