from pathlib import Path

core = Path('supabase/functions/openai-assistant-core-v2/implementation.ts')
text = core.read_text(encoding='utf-8')
anchor = """            const canLiveStreamProviderText = activeProvider === 'gemini'
              && plan.enterpriseGroundingRequired !== true
"""
replacement = """            const canLiveStreamProviderText = activeProvider === 'gemini'
              && totalToolCalls === 0
              && plan.enterpriseGroundingRequired !== true
"""
if 'const canLiveStreamProviderText' not in text:
    raise SystemExit('streaming anchor family missing')
if '&& totalToolCalls === 0\n              && plan.enterpriseGroundingRequired' not in text:
    if anchor not in text:
        raise SystemExit('streaming anchor missing')
    text = text.replace(anchor, replacement, 1)
core.write_text(text, encoding='utf-8')

test = Path('src/services/__tests__/groundingRepairV1.test.ts')
test_text = test.read_text(encoding='utf-8')
needle = """    expect(coreSource).toContain('roundText = groundingFailureText()')
  })
"""
updated = """    expect(coreSource).toContain('roundText = groundingFailureText()')
    expect(coreSource).toContain("const canLiveStreamProviderText = activeProvider === 'gemini'")
    expect(coreSource).toContain('&& totalToolCalls === 0')
  })
"""
if "expect(coreSource).toContain('&& totalToolCalls === 0')" not in test_text:
    if needle not in test_text:
        raise SystemExit('test anchor missing')
    test_text = test_text.replace(needle, updated, 1)
test.write_text(test_text, encoding='utf-8')

Path('.github/scripts/apply_grounding_buffer_after_tools.py').unlink(missing_ok=True)
Path('.github/workflows/grounding-buffer-after-tools.yml').unlink(missing_ok=True)
