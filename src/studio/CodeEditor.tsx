import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, closeCompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { closeSearchPanel, highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
import { oneDarkHighlightStyle } from "@codemirror/theme-one-dark";
import {
  Decoration,
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import type { Theme } from "@/app/theme";
import type { Revision } from "./fileSession";
import { languageFor, otherLanguageFor } from "./languages";
import { studioStore, useStudio } from "./studioStore";
import { smallestChange } from "./text";

/** The line just reached by Ctrl+P `file:line` or Ctrl+G, lit for a moment; null puts it out. */
const flash = StateEffect.define<number | null>();
const flashLine = StateField.define({
  create: () => Decoration.none,
  update(lit, tr) {
    for (const effect of tr.effects)
      if (effect.is(flash)) lit = effect.value === null ? Decoration.none : Decoration.set([Decoration.line({ class: "cm-dp-flash" }).range(effect.value)]);
    return tr.docChanged ? lit.map(tr.changes) : lit;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const FLASH_MS = 1200;

/** Puts the cursor at `line` (and `column`, from 1), clamped to the file, centred on screen, the line lit. */
export function revealLine(view: EditorView, line: number, column = 1) {
  const doc = view.state.doc;
  const target = doc.line(Math.min(Math.max(1, line), doc.lines));
  const pos = Math.min(target.from + Math.max(0, column - 1), target.to);
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: [EditorView.scrollIntoView(pos, { y: "center" }), flash.of(target.from)],
  });
  view.focus();
  setTimeout(() => {
    if (view.dom.isConnected) view.dispatch({ effects: flash.of(null) });
  }, FLASH_MS);
}

/** The app's tokens, so the editor follows the theme; the highlighting is chosen per theme. */
function themeFor(theme: Theme): Extension {
  return [
    EditorView.theme(
      {
        "&": { height: "100%", backgroundColor: "transparent", color: "var(--dp-text)", fontSize: "13px" },
        ".cm-scroller": { fontFamily: "var(--font-mono, 'JetBrains Mono Variable', monospace)", lineHeight: "1.55" },
        ".cm-content": { caretColor: "var(--dp-accent)" },
        ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--dp-accent)" },
        "&.cm-focused": { outline: "none" },
        "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground": {
          backgroundColor: "var(--dp-accent-soft)",
        },
        ".cm-gutters": { backgroundColor: "transparent", color: "var(--dp-text-3)", border: "none" },
        ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--dp-hover)" },
        ".cm-foldPlaceholder": { backgroundColor: "var(--dp-field)", border: "none", color: "var(--dp-text-2)" },
        ".cm-selectionMatch": { backgroundColor: "var(--dp-hover)" },
        ".cm-searchMatch": { backgroundColor: "var(--dp-accent-soft)", outline: "1px solid var(--dp-line)" },
        ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--dp-accent-soft)", outline: "1px solid var(--dp-accent)" },
        ".cm-panels": { backgroundColor: "var(--dp-surface)", color: "var(--dp-text)" },
        ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--dp-line)" },
        ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--dp-line)" },
        // The scale's radii, like the Input, the Button and the menus. `--radius-md` is not emitted unless a class uses it as a var: its value is the fallback.
        ".cm-textfield": { backgroundColor: "var(--dp-field)", border: "1px solid var(--dp-line)", borderRadius: "var(--radius-md, 8px)" },
        ".cm-button": { backgroundImage: "none", backgroundColor: "var(--dp-field)", border: "1px solid var(--dp-line)", borderRadius: "var(--radius-md, 8px)" },
        ".cm-tooltip": { backgroundColor: "var(--dp-surface)", border: "1px solid var(--dp-line)", borderRadius: "var(--radius-lg)" },
        ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--dp-accent-soft)", color: "var(--dp-text)" },
        ".cm-dp-flash": { backgroundColor: "var(--dp-accent-soft)" },
      },
      { dark: theme === "dark" },
    ),
    syntaxHighlighting(theme === "dark" ? oneDarkHighlightStyle : defaultHighlightStyle),
  ];
}

export interface CodeEditorHandle {
  /** Closes what Esc closes in the editor, if anything is open. */
  escape: () => boolean;
}

interface CodeEditorProps {
  path: string;
  /** Read when the editor is made for the file, and at each `reload`. */
  text: string;
  /** Says when `text` comes from the disk. */
  revision: Revision;
  theme: Theme;
  onChange: (content: string) => void;
  onSave: () => void;
  ref?: Ref<CodeEditorHandle>;
}

/** A CodeMirror 6 editor for one file; its undo history lives as long as it does. */
export function CodeEditor({ path, text, revision, theme, onChange, onSave, ref }: CodeEditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const themes = useRef(new Compartment());
  const language = useRef(new Compartment());
  // The latest callbacks, without remaking the editor.
  const handlers = useRef({ onChange, onSave });
  handlers.current = { onChange, onSave };

  useImperativeHandle(ref, () => ({
    escape: () => {
      const current = view.current;
      return current ? closeCompletion(current) || closeSearchPanel(current) : false;
    },
  }));

  useEffect(() => {
    if (!host.current) return;
    const created = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: text,
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightSpecialChars(),
          foldGutter(),
          history(),
          drawSelection(),
          dropCursor(),
          EditorState.allowMultipleSelections.of(true),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          autocompletion(),
          rectangularSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          keymap.of([
            {
              key: "Mod-s",
              preventDefault: true,
              run: () => {
                handlers.current.onSave();
                return true;
              },
            },
            ...closeBracketsKeymap,
            ...defaultKeymap,
            ...searchKeymap,
            ...historyKeymap,
            ...foldKeymap,
            ...completionKeymap,
            indentWithTab,
          ]),
          flashLine,
          language.current.of(languageFor(path)),
          themes.current.of(themeFor(theme)),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !update.transactions.some((tr) => tr.annotation(Transaction.remote))) handlers.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = created;
    created.focus();
    let alive = true;
    void otherLanguageFor(path).then((extension) => {
      if (alive && extension) created.dispatch({ effects: language.current.reconfigure(extension) });
    });
    return () => {
      alive = false;
      created.destroy();
      view.current = null;
    };
    // The editor is made once per file: `text` and `theme` are read here only.
  }, [path]);

  // The same document, from the disk: the cursor stays, and undo does not bring the old text back as an edit.
  useEffect(() => {
    const editor = view.current;
    if (!editor || revision.kind !== "reload") return;
    const change = smallestChange(editor.state.doc.toString(), text);
    if (change) editor.dispatch({ changes: change, annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)] });
  }, [revision.id]);

  useEffect(() => {
    view.current?.dispatch({ effects: themes.current.reconfigure(themeFor(theme)) });
  }, [theme]);

  // After the editor is made: a line asked for this file is reached once, then forgotten.
  const pending = useStudio((s) => (s.pendingLine?.path === path ? s.pendingLine : null));
  useEffect(() => {
    if (!pending || !view.current) return;
    revealLine(view.current, pending.line, pending.column);
    studioStore.setState({ pendingLine: null });
  }, [pending, path]);

  return <div ref={host} data-editor={path} className="h-full min-h-0 overflow-hidden" />;
}
