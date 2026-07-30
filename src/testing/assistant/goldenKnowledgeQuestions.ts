export interface AssistantGoldenQuestion {
  id: string;
  question: string;
  expectedPrimaryTool: string;
  expectedCanonicalKey?: string;
  expectedRelationType?: string;
}

export const assistantGoldenQuestions: AssistantGoldenQuestion[] = [
  {
    id: 'message-zcrm2-338',
    question: 'ZCRM2-338 nedir?',
    expectedPrimaryTool: 'get_message_detail',
    expectedCanonicalKey: 'message:zcrm2-338',
  },
  {
    id: 'method-check-kacak-pod',
    question: 'CHECK_KACAK_POD ne yapıyor?',
    expectedPrimaryTool: 'search_knowledge_catalog',
  },
  {
    id: 'function-zbil-cs-pod-operand',
    question: 'ZBIL_CS_POD_OPERAND nerede çağrılıyor?',
    expectedPrimaryTool: 'get_related_objects',
    expectedCanonicalKey: 'function:zbil_cs_pod_operand',
    expectedRelationType: 'CALLS',
  },
  {
    id: 'method-check-ztks-messages',
    question: 'CHECK_ZTKS hangi mesajları üretiyor?',
    expectedPrimaryTool: 'get_related_objects',
    expectedRelationType: 'EMITS_MESSAGE',
  },
  {
    id: 'message-zcrm2-545',
    question: 'ZCRM2-545 hangi koşulda alınır?',
    expectedPrimaryTool: 'get_message_detail',
    expectedCanonicalKey: 'message:zcrm2-545',
  },
];
