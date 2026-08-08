import React, { useEffect, useRef } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { Table, TableCell, TableHeader, TableRow } from '@tiptap/extension-table';
import {
  Bold,
  Combine,
  Columns3,
  GitMerge,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  Pilcrow,
  Quote,
  Redo2,
  Rows3,
  Table2,
  Trash2,
  Undo2,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { sanitizeDocumentHtml } from '../../lib/sanitizeHtml';

export interface EditorSelectionRange {
  from: number;
  to: number;
  text: string;
}

interface DocumentEditorProps {
  content: string;
  editable: boolean;
  onChange: (html: string) => void;
  onSelectionUpdate?: (selection: EditorSelectionRange | null) => void;
  onSave?: () => void;
  placeholder?: string;
}

interface ToolbarButtonProps {
  active?: boolean;
  label: string;
  className?: string;
  children?: React.ReactNode;
  disabled?: boolean;
  onClick?: React.MouseEventHandler<HTMLButtonElement>;
}

function ToolbarButton({ active = false, label, className, children, disabled, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex h-8 w-8 items-center justify-center rounded-md border border-transparent text-theme-text-muted transition-colors',
        'hover:border-theme-border hover:bg-theme-surface-hover hover:text-theme-text',
        active && 'border-theme-primary/30 bg-theme-primary/10 text-theme-primary',
        disabled && 'cursor-not-allowed opacity-40',
        className,
      )}
    >
      {children}
    </button>
  );
}

function ToolbarSeparator() {
  return <span className="mx-1 h-6 w-px bg-theme-border" aria-hidden="true" />;
}

function setEditorLink(editor: Editor) {
  const previousUrl = String(editor.getAttributes('link').href || '');
  const url = window.prompt('Bağlantı adresi', previousUrl || 'https://');

  if (url === null) return;
  if (!url.trim()) {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }

  editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
}

function EditorToolbar({ editor }: { editor: Editor }) {
  return (
    <div className="sticky top-0 z-20 flex flex-wrap items-center gap-1 border-b border-theme-border bg-theme-surface/95 px-3 py-2 backdrop-blur">
      <ToolbarButton
        label="Geri al"
        disabled={!editor.can().chain().focus().undo().run()}
        onClick={() => editor.chain().focus().undo().run()}
      >
        <Undo2 size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Yinele"
        disabled={!editor.can().chain().focus().redo().run()}
        onClick={() => editor.chain().focus().redo().run()}
      >
        <Redo2 size={15} />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        label="Başlık 1"
        active={editor.isActive('heading', { level: 1 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
      >
        <Heading1 size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Başlık 2"
        active={editor.isActive('heading', { level: 2 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
      >
        <Heading2 size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Başlık 3"
        active={editor.isActive('heading', { level: 3 })}
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
      >
        <Heading3 size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Paragraf"
        active={editor.isActive('paragraph')}
        onClick={() => editor.chain().focus().setParagraph().run()}
      >
        <Pilcrow size={15} />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        label="Kalın"
        active={editor.isActive('bold')}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        <Bold size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="İtalik"
        active={editor.isActive('italic')}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        <Italic size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Bağlantı"
        active={editor.isActive('link')}
        onClick={() => setEditorLink(editor)}
      >
        <Link2 size={15} />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        label="Madde işaretli liste"
        active={editor.isActive('bulletList')}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        <List size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Numaralı liste"
        active={editor.isActive('orderedList')}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        <ListOrdered size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Alıntı"
        active={editor.isActive('blockquote')}
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
      >
        <Quote size={15} />
      </ToolbarButton>
      <ToolbarButton
        label="Yatay çizgi"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        <Minus size={15} />
      </ToolbarButton>

      <ToolbarSeparator />

      <ToolbarButton
        label="Tablo ekle"
        onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}
      >
        <Table2 size={15} />
      </ToolbarButton>
    </div>
  );
}

function TableBubbleToolbar({ editor }: { editor: Editor }) {
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="jetwork-table-bubble-menu"
      options={{ placement: 'top' }}
      shouldShow={({ editor: currentEditor }) => currentEditor.isActive('table')}
    >
      <div className="flex items-center gap-1 rounded-lg border border-theme-border bg-theme-surface p-1.5 shadow-xl">
        <ToolbarButton label="Sola sütun ekle" onClick={() => editor.chain().focus().addColumnBefore().run()}>
          <Columns3 size={14} className="rotate-180" />
        </ToolbarButton>
        <ToolbarButton label="Sağa sütun ekle" onClick={() => editor.chain().focus().addColumnAfter().run()}>
          <Columns3 size={14} />
        </ToolbarButton>
        <ToolbarButton label="Sütunu sil" onClick={() => editor.chain().focus().deleteColumn().run()}>
          <Trash2 size={14} />
        </ToolbarButton>

        <ToolbarSeparator />

        <ToolbarButton label="Üste satır ekle" onClick={() => editor.chain().focus().addRowBefore().run()}>
          <Rows3 size={14} className="rotate-180" />
        </ToolbarButton>
        <ToolbarButton label="Alta satır ekle" onClick={() => editor.chain().focus().addRowAfter().run()}>
          <Rows3 size={14} />
        </ToolbarButton>
        <ToolbarButton label="Satırı sil" onClick={() => editor.chain().focus().deleteRow().run()}>
          <Trash2 size={14} />
        </ToolbarButton>

        <ToolbarSeparator />

        <ToolbarButton label="Hücreleri birleştir" onClick={() => editor.chain().focus().mergeCells().run()}>
          <Combine size={14} />
        </ToolbarButton>
        <ToolbarButton label="Hücreyi ayır" onClick={() => editor.chain().focus().splitCell().run()}>
          <GitMerge size={14} />
        </ToolbarButton>
        <ToolbarButton label="Başlık satırını aç/kapat" onClick={() => editor.chain().focus().toggleHeaderRow().run()}>
          <Pilcrow size={14} />
        </ToolbarButton>
        <ToolbarButton
          label="Tabloyu sil"
          className="text-red-600 hover:text-red-700"
          onClick={() => editor.chain().focus().deleteTable().run()}
        >
          <Trash2 size={14} />
        </ToolbarButton>
      </div>
    </BubbleMenu>
  );
}

export function DocumentEditor({
  content,
  editable,
  onChange,
  onSelectionUpdate,
  onSave,
  placeholder = 'Doküman içeriğini buraya yazın...',
}: DocumentEditorProps) {
  const onChangeRef = useRef(onChange);
  const onSelectionUpdateRef = useRef(onSelectionUpdate);
  const onSaveRef = useRef(onSave);
  const isExternalUpdateRef = useRef(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSelectionUpdateRef.current = onSelectionUpdate;
  }, [onSelectionUpdate]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: false,
      }),
      Placeholder.configure({ placeholder }),
      Link.configure({
        openOnClick: false,
        autolink: true,
        defaultProtocol: 'https',
      }),
      Table.configure({
        resizable: true,
        cellMinWidth: 80,
      }),
      TableRow,
      TableHeader,
      TableCell,
    ],
    content: sanitizeDocumentHtml(content || '') || '<p></p>',
    editable,
    onUpdate: ({ editor: currentEditor }) => {
      if (isExternalUpdateRef.current || !currentEditor.isEditable) return;
      onChangeRef.current(sanitizeDocumentHtml(currentEditor.getHTML()));
    },
    onSelectionUpdate: ({ editor: currentEditor }) => {
      const { from, to } = currentEditor.state.selection;
      if (from === to) {
        onSelectionUpdateRef.current?.(null);
        return;
      }

      const text = currentEditor.state.doc.textBetween(from, to, ' ').trim();
      onSelectionUpdateRef.current?.(text ? { from, to, text } : null);
    },
    editorProps: {
      attributes: {
        class: [
          'ProseMirror',
          'jetwork-doc',
          'prose prose-slate max-w-none',
          'min-h-[65vh] px-6 py-6 focus:outline-none',
          'prose-headings:font-semibold prose-table:text-sm',
          'prose-th:bg-slate-100 prose-th:p-3 prose-td:p-3',
          'prose-td:border prose-th:border prose-table:w-full',
        ].join(' '),
      },
      handleKeyDown: (_view, event) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
          event.preventDefault();
          onSaveRef.current?.();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    editor?.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    if (!editor || editor.isDestroyed) return;

    const sanitized = sanitizeDocumentHtml(content || '') || '<p></p>';
    if (editor.getHTML() === sanitized) return;

    isExternalUpdateRef.current = true;
    editor.commands.setContent(sanitized, { emitUpdate: false });
    isExternalUpdateRef.current = false;
  }, [content, editor]);

  if (!editor) {
    return <div className="min-h-[65vh] animate-pulse rounded-xl bg-theme-surface-hover" />;
  }

  return (
    <div className="jetwork-editor overflow-hidden rounded-xl border border-theme-border bg-theme-bg">
      {editable && <EditorToolbar editor={editor} />}
      {editable && <TableBubbleToolbar editor={editor} />}
      <EditorContent editor={editor} />
    </div>
  );
}
