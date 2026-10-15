import { mergeAttributes, Node } from '@tiptap/core';
import Image from '@tiptap/extension-image';
import StarterKit from '@tiptap/starter-kit';
import { TableKit } from '@tiptap/extension-table';
import { CALLOUT_VARIANTS, type CalloutVariant } from '../../shared/richtext';
import { pl } from '../i18n/pl';

const LABELS: Record<CalloutVariant, string> = {
  important: pl.admin.content.editor.important,
  warning: pl.admin.content.editor.warning,
  info: pl.admin.content.editor.info,
};

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      toggleCallout: (variant: CalloutVariant) => ReturnType;
    };
  }
}

/** "Ważne" / "Uwaga" / "Informacja" blocks (spec 5.10). */
export const Callout = Node.create({
  name: 'callout',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      variant: {
        default: 'important',
        parseHTML: (el) => {
          const v = el.getAttribute('data-variant');
          return (CALLOUT_VARIANTS as readonly string[]).includes(v ?? '') ? v : 'important';
        },
        renderHTML: (attrs) => ({ 'data-variant': attrs.variant, 'data-label': LABELS[attrs.variant as CalloutVariant] }),
      },
    };
  },
  parseHTML() {
    return [{ tag: 'div[data-callout]' }];
  },
  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-callout': '', class: 'callout' }), 0];
  },
  addCommands() {
    return {
      toggleCallout:
        (variant) =>
        ({ editor, commands }) => {
          if (editor.isActive('callout', { variant })) return commands.lift('callout');
          if (editor.isActive('callout')) return commands.updateAttributes('callout', { variant });
          return commands.wrapIn('callout', { variant });
        },
    };
  },
});

export const editorExtensions = [
  StarterKit.configure({
    heading: { levels: [2, 3] },
    code: false,
    codeBlock: false,
    strike: false,
    blockquote: false,
    link: { openOnClick: false, autolink: true, protocols: ['https', 'http', 'mailto', 'tel'] },
  }),
  Image.configure({ inline: false, allowBase64: false }),
  Callout,
  TableKit.configure({ table: { resizable: false } }),
];
