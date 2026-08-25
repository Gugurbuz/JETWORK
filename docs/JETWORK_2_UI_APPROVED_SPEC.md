# JetWork 2.0 UI — Approved interaction contract

This document locks the user-facing interaction contract approved on 2026-08-25 and the follow-up file-view refinement approved the same day.

## Language boundary
- The word `artifact` is internal-only. User-facing copy uses `Dosya`, `Belge`, `Sunum`, `Çalışma kitabı`, `PDF`, or `Görsel`.
- Provider, fallback and response-score telemetry are not part of the default conversation surface.

## Conversation shell
- Conversation remains the primary surface.
- User messages are compact right-aligned bubbles.
- Assistant answers are borderless and visually calm; no large colored assistant card.
- Header is minimal. Model details live behind a compact control/menu rather than a wide select.
- Composer floats inside the conversation width instead of occupying a full-width dashboard footer.
- The established global sidebar information architecture and visual surface remain unchanged; new file access must not restyle or replace it.

## File experience
- Generated files remain inline with the assistant message that created them.
- Creating a file does not automatically open or split the conversation.
- On desktop, clicking an inline generated file temporarily narrows the conversation and opens the selected file in a large right-side viewer, similar to ChatGPT's document/file workspace interaction.
- The right-side viewer exists only while a file is open. There is no permanent document column, collapsed file rail, stored split percentage, or resize handle.
- Closing the right-side viewer restores the full conversation at the same context.
- Download is secondary to Open/Preview.
- On mobile, the selected file uses a full-screen viewer instead of a Chat/File segmented switch.

## File library
- Files are discoverable from a separate top-level `Dosyalar` entry, independently from the conversation where they were created.
- The library groups and filters common generated file types.
- The library is additive; it must not disturb the existing sidebar layout.

## Motion
- Motion is subtle and functional: 120–220ms fades/translations for messages, menus and file viewer.
- No large bounce, staircase movement, repeated glow, or attention-seeking scale animation.
- Thinking uses a calm logo motion plus restrained shimmer/pulse and collapsible detail.

## DOCX fidelity
- The in-app preview must not imply Mammoth HTML is a pixel-faithful Word rendering.
- Branded DOCX should prefer a renderer-owned PDF/WYSIWYG rendition when available; the original DOCX remains the download source.

## Accessibility / responsive
- Keyboard and reduced-motion behavior are first-class.
- File viewer closes with Escape and preserves usable keyboard navigation.
- Mobile uses the same conversation-first interaction model.
