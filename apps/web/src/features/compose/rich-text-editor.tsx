import Link from "@tiptap/extension-link"
import { EditorContent, useEditor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import {
  LeftToRightListBulletIcon,
  LeftToRightListNumberIcon,
  LinkIcon,
  TextBoldIcon,
  TextItalicIcon,
} from "@hugeicons/core-free-icons"

import { useEffect } from "react"
import { useTranslation } from "react-i18next"

import { Icon } from "@/components/icon"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

type RichTextEditorProps = {
  id?: string
  /** Initial HTML; remount via key when content should reset. */
  value: string
  onChange: (html: string) => void
  invalid?: boolean
  readOnly?: boolean
  className?: string
}

export function RichTextEditor({
  id,
  value,
  onChange,
  invalid,
  readOnly = false,
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
    editable: !readOnly,
    editorProps: {
      attributes: {
        id: id ?? "compose-editor",
        class:
          "compose-editor min-h-52 px-4 py-3 text-sm leading-relaxed focus:outline-none",
        "aria-invalid": invalid ? "true" : "false",
      },
    },
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML())
    },
  })

  useEffect(() => {
    editor?.setEditable(!readOnly, false)
  }, [editor, readOnly])

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
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: trimmed })
      .run()
  }

  return (
    <div
      className={cn(
        "rounded-lg border border-input bg-card transition-[color,box-shadow] focus-within:border-ring",
        invalid && "border-destructive ring-[3px] ring-destructive/20",
        className
      )}
    >
      <div className="flex flex-wrap gap-1 rounded-t-lg bg-muted/65 px-2 py-1.5">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("compose.bold")}
          aria-pressed={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Icon icon={TextBoldIcon} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("compose.italic")}
          aria-pressed={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Icon icon={TextItalicIcon} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("compose.bulletList")}
          aria-pressed={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <Icon icon={LeftToRightListBulletIcon} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("compose.orderedList")}
          aria-pressed={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <Icon icon={LeftToRightListNumberIcon} />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label={t("compose.link")}
          aria-pressed={editor.isActive("link")}
          onClick={setLink}
        >
          <Icon icon={LinkIcon} />
        </Button>
      </div>
      <EditorContent editor={editor} />
    </div>
  )
}
