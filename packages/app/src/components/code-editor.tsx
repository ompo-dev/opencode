import { Compartment, EditorState, Prec } from "@codemirror/state"
import { lintGutter, linter } from "@codemirror/lint"
import { EditorView, keymap } from "@codemirror/view"
import {
  HighlightStyle,
  LanguageDescription,
  LanguageSupport,
  StreamLanguage,
  syntaxHighlighting,
  syntaxTree,
} from "@codemirror/language"
import { indentWithTab } from "@codemirror/commands"
import { languages } from "@codemirror/language-data"
import { tags } from "@lezer/highlight"
import { basicSetup } from "codemirror"
import { createEffect, onCleanup, onMount } from "solid-js"

const style = HighlightStyle.define([
  { tag: tags.comment, color: "var(--syntax-comment)" },
  { tag: [tags.string, tags.special(tags.string)], color: "var(--syntax-string)" },
  { tag: [tags.number, tags.integer, tags.float, tags.bool, tags.null], color: "var(--syntax-constant)" },
  { tag: [tags.regexp, tags.escape, tags.special(tags.regexp)], color: "var(--syntax-regexp)" },
  {
    tag: [tags.keyword, tags.definitionKeyword, tags.moduleKeyword, tags.controlKeyword],
    color: "var(--syntax-keyword)",
  },
  { tag: [tags.operatorKeyword, tags.operator], color: "var(--syntax-operator)" },
  { tag: [tags.variableName, tags.labelName], color: "var(--syntax-variable)" },
  { tag: [tags.propertyName, tags.attributeName], color: "var(--syntax-property)" },
  { tag: [tags.typeName, tags.className, tags.namespace, tags.macroName], color: "var(--syntax-type)" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.special(tags.variableName)],
    color: "var(--syntax-primitive)",
  },
  { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], color: "var(--text-strong)" },
  { tag: [tags.punctuation, tags.bracket, tags.separator], color: "var(--syntax-punctuation)" },
  {
    tag: [tags.heading, tags.heading1, tags.heading2, tags.heading3, tags.heading4, tags.heading5, tags.heading6],
    color: "var(--text-strong)",
    fontWeight: "700",
  },
  { tag: [tags.link, tags.url], color: "var(--text-link-base)", textDecoration: "underline" },
  { tag: [tags.emphasis], fontStyle: "italic" },
  { tag: [tags.strong], color: "var(--text-strong)", fontWeight: "700" },
  { tag: [tags.quote, tags.meta, tags.documentMeta, tags.processingInstruction], color: "var(--syntax-comment)" },
  { tag: [tags.list], color: "var(--syntax-punctuation)" },
  { tag: [tags.monospace], color: "var(--syntax-string)" },
  { tag: [tags.content, tags.name], color: "var(--text-base)" },
])

const theme = EditorView.theme({
  "&": {
    height: "100%",
    "background-color": "var(--background-base)",
    color: "var(--text-base)",
  },
  "&.cm-focused": {
    outline: "none",
  },
  ".cm-scroller": {
    overflow: "auto",
    "font-family": "var(--font-family-mono)",
    "font-size": "var(--font-size-small)",
    "font-feature-settings": "var(--font-family-mono--font-feature-settings)",
    "line-height": "24px",
  },
  ".cm-content": {
    "min-height": "100%",
    padding: "16px 24px",
    "caret-color": "var(--text-base)",
  },
  ".cm-line": {
    padding: "0",
  },
  ".cm-gutters": {
    "background-color": "transparent",
    border: "0",
  },
  ".cm-lineNumbers, .cm-foldGutter": {
    display: "none",
  },
  ".cm-lintGutter": {
    width: "12px",
  },
  ".cm-lintGutter .cm-gutterElement": {
    width: "12px",
    padding: "0 0 0 6px",
  },
  ".cm-activeLine, .cm-activeLineGutter": {
    "background-color": "transparent",
  },
  ".cm-cursor, .cm-dropCursor": {
    "border-left-color": "var(--text-base)",
  },
  ".cm-selectionBackground": {
    "background-color": "rgb(from var(--surface-warning-base) r g b / 0.35)",
  },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": {
    "background-color": "rgb(from var(--surface-warning-base) r g b / 0.35)",
  },
  ".cm-panels": {
    "background-color": "var(--background-stronger)",
    color: "var(--text-base)",
    border: "0",
  },
  ".cm-search input, .cm-search button, .cm-textfield, .cm-button": {
    "background-color": "var(--background-base)",
    color: "var(--text-base)",
    border: "1px solid var(--border-base)",
  },
  ".cm-tooltip": {
    "background-color": "var(--background-stronger)",
    color: "var(--text-base)",
    border: "1px solid var(--border-base)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    "background-color": "var(--background-surface)",
    color: "var(--text-strong)",
  },
  ".cm-lintRange-error": {
    background: "none",
    "border-bottom": "2px wavy var(--text-danger-base)",
  },
  ".cm-diagnostic.cm-diagnostic-error": {
    "border-left-color": "var(--border-danger-base)",
  },
  ".cm-lintPoint-error": {
    color: "var(--icon-critical-base)",
  },
})

const syntax = linter(
  (view: EditorView) => {
    const out: {
      from: number
      to: number
      severity: "error"
      source: "syntax"
      message: string
    }[] = []
    const seen = new Set<string>()
    const size = view.state.doc.length

    syntaxTree(view.state).iterate({
      enter(node) {
        if (!node.type.isError) return

        const from = node.from === node.to ? Math.max(0, node.from - 1) : node.from
        const to = node.from === node.to ? Math.min(size, node.to + 1) : node.to
        const key = `${from}:${to}`
        if (seen.has(key)) return

        seen.add(key)
        out.push({
          from,
          to,
          severity: "error" as const,
          source: "syntax",
          message: "Syntax error",
        })
      },
    })

    return out
  },
  { delay: 150 },
)

function name(input: string) {
  const list = input.split(/[/\\]/)
  return list[list.length - 1] ?? input
}

function legacy<T>(load: Promise<T>, pick: (mod: T) => Parameters<typeof StreamLanguage.define>[0]) {
  return load.then((mod) => new LanguageSupport(StreamLanguage.define(pick(mod))))
}

function extra(input: string) {
  const file = input.toLowerCase()
  if (file.endsWith(".mdx")) return import("@codemirror/lang-markdown").then((mod) => mod.markdown())
  if (file.endsWith(".astro")) return import("@codemirror/lang-html").then((mod) => mod.html())
  if (/^dockerfile(\..+)?$/.test(file)) {
    return legacy(import("@codemirror/legacy-modes/mode/dockerfile"), (mod) => mod.dockerFile)
  }
  if (/^\.env(\..+)?$/.test(file) || file === ".editorconfig") {
    return legacy(import("@codemirror/legacy-modes/mode/properties"), (mod) => mod.properties)
  }
}

async function pick(input: string) {
  const file = name(input)
  const ext = extra(file)
  if (ext) return await ext.catch(() => undefined)

  const lang = LanguageDescription.matchFilename(languages, file)
  if (!lang) return
  return await lang.load().catch(() => undefined)
}

export function CodeEditor(props: {
  path: string
  value: string
  disabled?: boolean
  onInput: (value: string) => void
  onSave: VoidFunction
}) {
  let root: HTMLDivElement | undefined
  let view: EditorView | undefined
  let mute = false
  let seq = 0

  const lang = new Compartment()
  const edit = new Compartment()

  onMount(() => {
    if (!root) return

    view = new EditorView({
      state: EditorState.create({
        doc: props.value,
        extensions: [
          basicSetup,
          EditorState.tabSize.of(2),
          theme,
          syntaxHighlighting(style),
          lintGutter(),
          syntax,
          lang.of([]),
          edit.of(EditorView.editable.of(!props.disabled)),
          EditorView.contentAttributes.of({
            spellcheck: "false",
            autocapitalize: "off",
            autocorrect: "off",
            autocomplete: "off",
          }),
          Prec.high(
            keymap.of([
              indentWithTab,
              {
                key: "Mod-s",
                preventDefault: true,
                run() {
                  props.onSave()
                  return true
                },
              },
            ]),
          ),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged || mute) return
            props.onInput(update.state.doc.toString())
          }),
        ],
      }),
      parent: root,
    })
  })

  createEffect(() => {
    const next = props.value
    if (!view) return
    const doc = view.state.doc.toString()
    if (doc === next) return
    const sel = view.state.selection.main
    mute = true
    view.dispatch({
      changes: {
        from: 0,
        to: doc.length,
        insert: next,
      },
      selection: {
        anchor: Math.min(sel.anchor, next.length),
        head: Math.min(sel.head, next.length),
      },
    })
    mute = false
  })

  createEffect(() => {
    if (!view) return
    view.dispatch({
      effects: edit.reconfigure(EditorView.editable.of(!props.disabled)),
    })
  })

  createEffect(() => {
    const path = props.path
    const id = ++seq
    void pick(path).then((next) => {
      if (!view || id !== seq) return
      view.dispatch({
        effects: lang.reconfigure(next ? next.extension : []),
      })
    })
  })

  onCleanup(() => view?.destroy())

  return <div ref={root} class="absolute inset-0" />
}
