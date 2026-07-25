import Link from "@tiptap/extension-link"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  LinkIcon,
  ListBulletsIcon,
  ListNumbersIcon,
  TextBIcon,
  TextItalicIcon,
} from "@phosphor-icons/react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type RichTextEditorProps = {
  id?: string
  /** Initial HTML; remount via key when content should reset. */
  value: string
  onChange: (html: string) => void
  invalid?: boolean
  className?: string
}

export function RichTextEditor({
  id,
  value,
  onChange,
  invalid,
  className,
}: RichTextEditorProps) {
  const { t } = useTranslation()

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        blockquote: false,
        horizontalRule: false,
      }),
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
    ],
    content: value || "",
    editorProps: {
      attributes: {
        id: id ?? "compose-editor",
        class:
          "compose-editor min-h-40 px-3 py-2 text-sm leading-relaxed focus:outline-none",
        "aria-invalid": invalid ? "true" : "false",
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML())
    },
  })

  if (!editor) return null

  function setLink() {
    if (!editor) return
    const prev = editor.getAttributes("link").href as string | undefined
    const url = window.prompt(t("compose.linkPrompt"), prev ?? "https://")
    if (url === null) return
    const trimmed = url.trim()
    if (!trimmed) {
      editor.chain().focus().extendMarkRange("link").unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: trimmed }).run()
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-input bg-transparent shadow-xs transition-[color,box-shadow]",
        invalid && "border-destructive ring-destructive/20 ring-[3px]",
        className
      )}
    >
      <div className="flex flex-wrap gap-0.5 border-b border-border px-1 py-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("compose.bold")}
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <TextBIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("compose.italic")}
          aria-pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <TextItalicIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("compose.bulletList")}
          aria-pressed={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <ListBulletsIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("compose.orderedList")}
          aria-pressed={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListNumbersIcon />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("compose.link")}
          aria-pressed={editor.isActive("link")}
          onClick={setLink}
        >
          <LinkIcon />
        </Button>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
