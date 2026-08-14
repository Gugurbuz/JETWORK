# JetWork Skill Catalog v1

Hedef katalog **140 skill**. İlk foundation paketinde spreadsheet/Jira odaklı 6 P0 skill aktiftir; kalanlar P0/P1/P2 önceliğiyle iteratif yazılacaktır.

## Aktif P0

- `spreadsheet/inspect`
- `spreadsheet/table-join`
- `spreadsheet/format-preserve`
- `spreadsheet/quality-check`
- `jira/export-analysis`
- `jira/latest-sprint`

## Core / Orchestration — 15

1. `task-intent-detection`
2. `task-complexity-assessment`
3. `skill-selection`
4. `multi-skill-orchestration`
5. `task-planning`
6. `clarification-decision`
7. `tool-selection`
8. `context-resolution`
9. `conversation-context-use`
10. `workspace-context-use`
11. `failure-recovery`
12. `retry-strategy`
13. `response-completeness-check`
14. `response-consistency-check`
15. `final-answer-composer`

## Knowledge / RAG / Grounding — 20

16. `knowledge-source-decision`
17. `enterprise-knowledge-detection`
18. `general-knowledge-decision`
19. `rag-query-generation`
20. `rag-query-expansion`
21. `rag-result-ranking`
22. `rag-evidence-selection`
23. `multi-source-synthesis`
24. `source-conflict-resolution`
25. `source-freshness-check`
26. `source-authority-check`
27. `citation-generation`
28. `citation-coverage-check`
29. `grounded-answer-generation`
30. `hallucination-check`
31. `insufficient-evidence-handling`
32. `knowledge-gap-detection`
33. `document-chunking-strategy`
34. `metadata-generation`
35. `knowledge-ingestion`

## Files / Documents — 10

36. `file-type-detection`
37. `multi-file-analysis`
38. `file-content-extraction`
39. `file-relationship-detection`
40. `file-comparison`
41. `file-diff`
42. `file-summary`
43. `structured-data-extraction`
44. `document-classification`
45. `document-quality-check`

## Spreadsheet — 20

46. `spreadsheet-read` → active implementation: `spreadsheet/inspect`
47. `spreadsheet-write`
48. `spreadsheet-schema-detect`
49. `spreadsheet-data-cleaning`
50. `spreadsheet-column-normalization`
51. `spreadsheet-type-inference`
52. `spreadsheet-table-join` → active implementation: `spreadsheet/table-join`
53. `spreadsheet-fuzzy-match`
54. `spreadsheet-deduplication`
55. `spreadsheet-filtering`
56. `spreadsheet-formula-generation`
57. `spreadsheet-pivot`
58. `spreadsheet-aggregation`
59. `spreadsheet-formatting`
60. `spreadsheet-conditional-formatting`
61. `spreadsheet-chart-generation`
62. `spreadsheet-sheet-management`
63. `spreadsheet-quality-check` → active implementation: `spreadsheet/quality-check`
64. `spreadsheet-preserve-format` → active implementation: `spreadsheet/format-preserve`
65. `spreadsheet-change-report`

## PDF / Word / Presentation — 14

66. `pdf-read`
67. `pdf-table-extraction`
68. `pdf-visual-analysis`
69. `pdf-generation`
70. `docx-read`
71. `docx-edit`
72. `docx-generation`
73. `document-format-preservation`
74. `presentation-read`
75. `presentation-generation`
76. `presentation-layout`
77. `presentation-storytelling`
78. `presentation-chart-selection`
79. `presentation-quality-check`

## Business Analysis — 25

80. `requirement-understanding`
81. `requirement-decomposition`
82. `requirement-gap-analysis`
83. `requirement-conflict-analysis`
84. `business-rule-extraction`
85. `acceptance-criteria-generation`
86. `as-is-analysis`
87. `to-be-design`
88. `gap-analysis`
89. `impact-analysis`
90. `dependency-analysis`
91. `risk-analysis`
92. `assumption-management`
93. `open-question-generation`
94. `scope-definition`
95. `process-analysis`
96. `process-flow-generation`
97. `use-case-generation`
98. `user-story-generation`
99. `functional-analysis`
100. `technical-analysis`
101. `solution-option-analysis`
102. `solution-recommendation`
103. `traceability-matrix`
104. `conceptual-document-mapping`

## Agile / Jira / Product — 20

105. `jira-export-read` → active implementation: `jira/export-analysis`
106. `jira-key-matching`
107. `jira-status-normalization`
108. `jira-sprint-extraction`
109. `jira-latest-sprint-detection` → active implementation: `jira/latest-sprint`
110. `jira-aging-analysis`
111. `jira-comment-analysis`
112. `jira-backlog-quality`
113. `jira-story-quality`
114. `sprint-analysis`
115. `velocity-analysis`
116. `roadmap-analysis`
117. `epic-analysis`
118. `work-type-classification`
119. `effort-analysis`
120. `functional-effort-analysis`
121. `ba-effort-analysis`
122. `capacity-analysis`
123. `wip-analysis`
124. `release-readiness`

## SAP / Enterprise Technical — 12

125. `sap-object-recognition`
126. `sap-code-analysis`
127. `sap-method-analysis`
128. `sap-call-chain-analysis`
129. `sap-message-analysis`
130. `sap-table-relationship`
131. `sap-data-flow-analysis`
132. `sap-integration-analysis`
133. `sap-crm-process-analysis`
134. `sap-isu-process-analysis`
135. `sap-c4c-process-analysis`
136. `sap-error-root-cause`

## Engineering / JetWork — 4

137. `repository-analysis`
138. `code-change-planning`
139. `regression-analysis`
140. `implementation-validation`

## Uygulama sırası

1. **Foundation** — canonical `SKILL.md` kontratı ve katalog.
2. **Runtime discovery** — `search_skills` + `load_skills` tool'ları; model yalnız gereken skill'i lazy-load eder.
3. **Spreadsheet/Jira expansion** — fuzzy match, status normalization, sprint extraction, chart/formula/pivot.
4. **BA/SAP expansion** — requirement, impact, acceptance criteria, SAP method/message/call-chain/root-cause.
5. **Artifact expansion** — PDF/DOCX/PPTX üretim ve kalite skill'leri.
6. **Governance** — versioning, eval set, usage telemetry, deprecation ve provider parity testleri.
