# Jetbase Verified Technical Identifier Index v1

This release adds a mechanical evidence index in front of exact published Jetbase object content.

The index is derived only from the exact canonical key and the already-published source content. It exists to keep verified technical identifiers visible to the final grounding guard even when the underlying ABAP/document body is later truncated for model context.

It does not search, route, plan, infer a recovery action, or create new semantic authority. Controller remains the sole semantic authority.

The index includes deterministic canonical parent/leaf aliases, technical identifiers matching the restricted verified-source pattern, and ABAP `MESSAGE` class/number codes. Unknown or model-invented identifiers are not added.
