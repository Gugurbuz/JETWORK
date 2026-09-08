# Chat actions menu v2

## Intent

The conversation header must not expose a visible `Çalışma alanı` button. Conversation-scoped secondary tools live behind a compact JETWORK-specific overflow menu instead.

## Menu

- **Dosyalar** — generated outputs from the current conversation, including a count badge when available.
- **Kaynaklar** — references used by assistant answers.
- **Agent Work** — agent steps, tools, and execution trace.

Each item opens the existing unified right panel on the corresponding tab. The right-panel architecture and typed generated-file behavior remain unchanged.

## Interaction

- Desktop and mobile both use a `MoreHorizontal` overflow trigger.
- The menu closes after an action, on outside click, on Escape, and when the active conversation changes.
- Existing file-count visibility is preserved as a small badge on the overflow trigger rather than a large workspace button.
