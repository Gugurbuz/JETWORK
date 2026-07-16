import { describe, expect, it } from 'vitest';
import { postProcessDocumentData } from '../documentPostProcessor';

describe('documentPostProcessor', () => {
  it('reports gaps without injecting business or review prose', () => {
    const result = postProcessDocumentData({
      businessAnalysis: { content: '# Short draft\n\nOnly supplied content.', status: 'DRAFT', flags: [] },
      review: { content: 'Only supplied review.', status: 'DRAFT', flags: [] },
    }, null, {
      sourceText: 'Project Name: Refund Operations\nProcess 1 - Receive request\nKPI: completion time',
    });

    expect(result.document.businessAnalysis.content).toContain('Only supplied content.');
    expect(result.document.businessAnalysis.content).not.toMatch(/Traceability|Coverage Matrix|Receive request/);
    expect(result.document.review?.content).toContain('Only supplied review.');
    expect(result.document.review?.content).not.toMatch(/Guard|Quality Gate/);
    expect(result.document.qualityAssessment?.findings.length).toBeGreaterThan(0);
  });

  it('sanitizes generated document HTML before persistence or rendering', () => {
    const result = postProcessDocumentData({
      businessAnalysis: {
        content: '<h1>Safe</h1><img src="x" onerror="alert(1)"><script>alert(2)</script><a href="javascript:alert(3)">bad</a>',
        status: 'DRAFT',
        flags: [],
      },
    });

    expect(result.document.businessAnalysis.content).toContain('<h1>Safe</h1>');
    expect(result.document.businessAnalysis.content).not.toMatch(/onerror|<script|javascript:/i);
  });
});
