# JetWork 2.0 UI — Approved interaction contract

This document locks the user-facing interaction contract approved on 2026-08-25.

## Language boundary
- The word `artifact` is internal-only. User-facing copy uses `Dosya`, `Belge`, `Sunum`, `Çalışma kitabı`, `PDF`, or `Görsel`.
- Provider, fallback and response-score telemetry are not part of the default conversation surface.

## Conversation shell
- Conversation remains the primary surface.
- User messages are compact right-aligned bubbles.
- Assistant answers are borderless and visually calm; no large colored assistant card.
- Header is minimal. Model details live behind a compact control/menu rather than a wide select.
- Composer floats inside the conversation width instead of occupying a full-width dashboard footer.

## File experience
- Generated files remain inline with the message that created them.
- Creating a file does not automatically split the conversation.
- Opening a file uses a focused overlay/viewer; closing it restores the same conversation.
- Download is secondary to Open/Preview.
- Desktop does not keep a permanent right-side file column, collapsed file rail, split percentage, or resize handle.
- Mobile does not use a Chat/File segmented switch just because a file exists.

## File library
- Files are discoverable from a top-level `Dosyalar` entry in navigation, independently from the conversation where they were created.
- The library groups and filters common generated file types.

## Motion
- Motion is subtle and functional: 120–220ms fades/translations for messages, menus and file viewer.
- No large bounce, staircase movement, repeated glow, or attention-seeking scale animation.
- Thinking uses a calm logo motion plus restrained shimmer/pulse and collapsible detail.

## DOCX fidelity
- The in-app preview must not imply Mammoth HTML is a pixel-faithful Word rendering.
- Branded DOCX should prefer a renderer-owned PDF/WYSIWYG rendition when available; the original DOCX remains the download source.

## Accessibility / responsive
- Keyboard and reduced-motion behavior are first-class.
- File viewer traps/focuses correctly and closes with Escape.
- Mobile uses the same conversation-first interaction model.
