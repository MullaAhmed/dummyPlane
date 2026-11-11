import { useEffect, useImperativeHandle, useRef, type Ref } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, closeCompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { closeSearchPanel, highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, StateEffect, StateField, Transaction, type Extension } from "@codemirror/state";
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
import { PALETTES, usePalette, type ThemeChoice } from "@/app/theme";
import type { Revision } from "./fileSession";
import { languageFor, otherLanguageFor } from "./languages";
import { studioStore, useStudio } from "./studioStore";
import { syntaxStyleFor } from "./syntaxTheme";
import { smallestChange } from "./text";

/**
 * The line just reached by Ctrl+P `file:line` or Ctrl+G: lit at once (the keyboard asked for it), held
 * for a moment, then faded out ("fade": the system's own "done" may ease), then put out (null).
 */
const flash = StateEffect.define<number | "fade" | null>();
const LIT = Decoration.line({ class: "cm-dp-flash" });
const FADING = Decoration.line({ class: "cm-dp-flash-out" });
const flashLine = StateField.define({
  create: () => Decoration.none,
  update(lit, tr) {
    for (const effect of tr.effects) {
      if (!effect.is(flash)) continue;
      if (effect.value === null) lit = Decoration.none;
      else if (effect.value !== "fade") lit = Decoration.set([LIT.range(effect.value)]);
      else {
        // Where the lit line is now: the text may have moved it since.
        let at = -1;
        lit.between(0, tr.startState.doc.length, (from) => {
          at = from;
        });
        lit = at < 0 ? Decoration.none : Decoration.set([FADING.range(at)]);
      }
    }
    return tr.docChanged ? lit.map(tr.changes) : lit;
  },
  provide: (field) => EditorView.decorations.from(field),
});
const FLASH_MS = 1200;
/** The fade's length: --dp-dur, the time the decoration stays to let it run. */
const FADE_MS = 200;
/** Each editor's pending flash step: a new reveal or the editor's end cancels it. */
const flashTimers = new WeakMap<EditorView, ReturnType<typeof setTimeout>>();

function stopFlash(view: EditorView) {
  clearTimeout(flashTimers.get(view));
  flashTimers.delete(view);
}

/** Puts the cursor at `line` (and `column`, from 1), clamped to the file, centred on screen, the line lit. */
export function revealLine(view: EditorView, line: number, column = 1) {
  const doc = view.state.doc;
  const target = doc.line(Math.min(Math.max(1, line), doc.lines));
  const pos = Math.min(target.from + Math.max(0, column - 1), target.to);
  stopFlash(view);
  view.dispatch({
    selection: EditorSelection.cursor(pos),
    effects: [EditorView.scrollIntoView(pos, { y: "center" }), flash.of(target.from)],
  });
  view.focus();
  flashTimers.set(
    view,
    setTimeout(() => {
      if (!view.dom.isConnected) return;
      view.dispatch({ effects: flash.of("fade") });
      flashTimers.set(
        view,
        setTimeout(() => {
          flashTimers.delete(view);
          if (view.dom.isConnected) view.dispatch({ effects: flash.of(null) });
        }, FADE_MS),
      );
    }, FLASH_MS),
  );
}

/**
 * The app's tokens, so the editor follows the palette; the highlighting is the palette's own
 * (syntaxTheme.ts). CodeMirror's base theme hard-codes the matched brackets and special characters:
 * they are redrawn here in tokens, a ring of text-3 (3:1 and more on every ground) around a match.
 */
function themeFor(palette: ThemeChoice): Extension {
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
        ".cm-activeLineGutter": { color: "var(--dp-text-2)" },
        "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--dp-accent-soft)", outline: "1px solid var(--dp-text-3)" },
        "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "transparent", outline: "1px solid var(--dp-danger)" },
        ".cm-specialChar": { color: "var(--dp-danger)" },
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
        // A one-shot fade from the flash back to what the line is (the active line's hover, or nothing),
        // on a class that lives one --dp-dur: never transitions on .cm-line itself (dp-flash-out, index.css).
        ".cm-dp-flash-out": { animation: "dp-flash-out var(--dp-dur) var(--dp-ease-out) both" },
      },
      { dark: PALETTES[palette].scheme === "dark" },
    ),
    syntaxHighlighting(syntaxStyleFor(palette)),
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
  onChange: (content: string) => void;
  onSave: () => void;
  ref?: Ref<CodeEditorHandle>;
}

/** A CodeMirror 6 editor for one file; its undo history lives as long as it does. It follows the palette. */
export function CodeEditor({ path, text, revision, onChange, onSave, ref }: CodeEditorProps) {
  // The palette, not its light or dark scheme: electric and expressive are both dark, with their own colors.
  const palette = usePalette();
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
          themes.current.of(themeFor(palette)),
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
      stopFlash(created);
      created.destroy();
      view.current = null;
    };
    // The editor is made once per file: `text` and `palette` are read here only.
  }, [path]);

  // The same document, from the disk: the cursor stays, and undo does not bring the old text back as an edit.
  useEffect(() => {
    const editor = view.current;
    if (!editor || revision.kind !== "reload") return;
    const change = smallestChange(editor.state.doc.toString(), text);
    if (change) editor.dispatch({ changes: change, annotations: [Transaction.remote.of(true), Transaction.addToHistory.of(false)] });
  }, [revision.id]);

  useEffect(() => {
    view.current?.dispatch({ effects: themes.current.reconfigure(themeFor(palette)) });
  }, [palette]);

  // After the editor is made: a line asked for this file is reached once, then forgotten.
  const pending = useStudio((s) => (s.pendingLine?.path === path ? s.pendingLine : null));
  useEffect(() => {
    if (!pending || !view.current) return;
    revealLine(view.current, pending.line, pending.column);
    studioStore.setState({ pendingLine: null });
  }, [pending, path]);

  return <div ref={host} data-editor={path} className="h-full min-h-0 overflow-hidden" />;
}
