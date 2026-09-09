-- JetBase Evidence Graph v1 supporting indexes.
create index if not exists knowledge_claims_v1_source_version_idx
  on public.knowledge_claims_v1(source_version_id);

create index if not exists knowledge_claim_evidence_v1_space_idx
  on public.knowledge_claim_evidence_v1(knowledge_space_id);

create index if not exists knowledge_claim_evidence_v1_relation_idx
  on public.knowledge_claim_evidence_v1(relation_id);
