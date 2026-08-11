from __future__ import annotations

from pathlib import Path
import sys


def parse_operations(patch_text: str):
    lines = patch_text.splitlines(keepends=True)
    operations = []
    current = None
    for line in lines:
        marker = line.rstrip('\r\n')
        if marker == '*** Begin Patch' or marker == '*** End Patch':
            continue
        if marker.startswith('*** Add File: '):
            if current:
                operations.append(current)
            current = {'kind': 'add', 'path': marker[len('*** Add File: '):], 'lines': []}
            continue
        if marker.startswith('*** Update File: '):
            if current:
                operations.append(current)
            current = {'kind': 'update', 'path': marker[len('*** Update File: '):], 'lines': []}
            continue
        if current is not None:
            current['lines'].append(line)
    if current:
        operations.append(current)
    return operations


def apply_add(path: Path, lines: list[str]):
    if path.exists():
        raise RuntimeError(f'Add target already exists: {path}')
    output = []
    for line in lines:
        if line.startswith('+'):
            output.append(line[1:])
        elif line.strip() == '':
            continue
        else:
            raise RuntimeError(f'Unexpected add-file line for {path}: {line[:120]!r}')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(''.join(output), encoding='utf-8')


def split_hunks(lines: list[str]):
    hunks = []
    current = None
    for line in lines:
        if line.startswith('@@'):
            if current is not None:
                hunks.append(current)
            current = []
            continue
        if current is not None:
            current.append(line)
        elif line.strip():
            raise RuntimeError(f'Unexpected update preamble line: {line[:120]!r}')
    if current is not None:
        hunks.append(current)
    return hunks


def apply_update(path: Path, lines: list[str]):
    if not path.exists():
        raise RuntimeError(f'Update target missing: {path}')
    text = path.read_text(encoding='utf-8')
    hunks = split_hunks(lines)
    if not hunks:
        raise RuntimeError(f'No hunks for update target: {path}')

    # Hunk line numbers are intentionally omitted by the custom patch format.
    # Preserve standard-patch semantics by matching hunks monotonically in file
    # order. This safely disambiguates repeated short contexts such as version
    # markers without guessing across earlier sections of the file.
    search_from = 0
    for index, hunk in enumerate(hunks, start=1):
        old_parts = []
        new_parts = []
        for line in hunk:
            if line.startswith(' '):
                old_parts.append(line[1:])
                new_parts.append(line[1:])
            elif line.startswith('-'):
                old_parts.append(line[1:])
            elif line.startswith('+'):
                new_parts.append(line[1:])
            elif line.startswith('\\ No newline at end of file'):
                continue
            elif line.strip() == '':
                continue
            else:
                raise RuntimeError(f'Unexpected hunk line for {path} hunk {index}: {line[:120]!r}')
        old = ''.join(old_parts)
        new = ''.join(new_parts)
        if not old:
            raise RuntimeError(f'Empty match pattern for {path} hunk {index}')

        position = text.find(old, search_from)
        if position < 0:
            # Some earlier replacement may alter text length but not ordering;
            # retry globally only when the remaining candidate is unique.
            candidates = []
            cursor = 0
            while True:
                candidate = text.find(old, cursor)
                if candidate < 0:
                    break
                candidates.append(candidate)
                cursor = candidate + 1
            if len(candidates) != 1:
                raise RuntimeError(
                    f'Could not uniquely place {path} hunk {index}; '
                    f'{len(candidates)} global candidates remain after ordered search'
                )
            position = candidates[0]

        text = text[:position] + new + text[position + len(old):]
        search_from = position + len(new)
    path.write_text(text, encoding='utf-8')


def main():
    if len(sys.argv) != 2:
        raise SystemExit('usage: apply_custom_patch.py PATCH_FILE')
    patch_path = Path(sys.argv[1])
    patch_text = patch_path.read_text(encoding='utf-8')
    operations = parse_operations(patch_text)
    if not operations:
        raise RuntimeError('No patch operations found')
    print(f'Applying {len(operations)} operations')
    for op in operations:
        path = Path(op['path'])
        print(f"{op['kind']}: {path}")
        if op['kind'] == 'add':
            apply_add(path, op['lines'])
        elif op['kind'] == 'update':
            apply_update(path, op['lines'])
        else:
            raise RuntimeError(f"Unknown operation: {op['kind']}")


if __name__ == '__main__':
    main()
