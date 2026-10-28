import * as React from "react";

import type { Editor } from "@tiptap/react";

/**
 * The composer in Apple's real glass (Riley, 2026-10-27: "theres not a whole
 * lot of purpose behind even having the glass composer if it isnt able to do
 * the things that make it so awesome"). The Mac draws the glass above the page
 * and holds the words in its own text view (PolyphonicComposer.swift), so the
 * conversation scrolling beneath bends in it.
 *
 * The page keeps the composer for everything it knows: the draft, mentions,
 * suggestions, sending, the + menu, editing a sent message. Its form keeps its
 * place and draws nothing; it tells the Mac where it is, and the Mac hands back
 * every change as it's typed, Return, the + and the keys the page's
 * suggestions need. Only builds made with `VITE_LUCA_NATIVE_COMPOSER=1` (the
 * composer-glass test app) ask for it, and only where the Mac has announced
 * it (`window.__POLYPHONIC_NATIVE_COMPOSER__`, macOS 26 and later).
 */

type NativeComposerWindow = Window & {
  __POLYPHONIC_NATIVE_COMPOSER__?: number;
  __polyphonicComposer?: NativeComposerBridge;
  webkit?: {
    messageHandlers?: {
      polyphonicComposer?: { postMessage: (message: unknown) => void };
    };
  };
};

type NativeComposerBridge = {
  input: (text: string) => void;
  send: () => void;
  plus: () => void;
  key: (name: string) => void;
  height: (points: number) => void;
};

/** The root attribute the page's styles key on while the glass holds the composer. */
const ROOT_ATTRIBUTE = "data-luca-native-composer";

// `?.`: node's unit tests render components without Vite's env.
const buildFlag = (): string | undefined =>
  import.meta.env?.VITE_LUCA_NATIVE_COMPOSER;

const nativeWindow = () => window as NativeComposerWindow;

const post = (message: Record<string, unknown>) => {
  nativeWindow().webkit?.messageHandlers?.polyphonicComposer?.postMessage(
    message,
  );
};

/** Whether this build asks for the glass and this window can draw it. */
export function useNativeComposerAvailable(): boolean {
  const [available, setAvailable] = React.useState(
    () =>
      buildFlag() === "1" &&
      Boolean(nativeWindow().__POLYPHONIC_NATIVE_COMPOSER__),
  );
  React.useEffect(() => {
    if (buildFlag() !== "1") return;
    const announced = () =>
      setAvailable(Boolean(nativeWindow().__POLYPHONIC_NATIVE_COMPOSER__));
    window.addEventListener("polyphonic-native-composer", announced);
    announced();
    return () =>
      window.removeEventListener("polyphonic-native-composer", announced);
  }, []);
  return available;
}

/** The words as the Mac holds them: one line per paragraph. */
const plainText = (editor: Editor) => editor.getText({ blockSeparator: "\n" });

/** A modal over the page: the glass steps aside, since it would sit above it. */
const modalOpen = () =>
  document.querySelector(
    '[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]',
  ) !== null;

export function useNativeComposerGlass({
  enabled,
  editor,
  formRef,
  suggestionsOpen,
}: {
  enabled: boolean;
  editor: Editor | null;
  formRef: React.RefObject<HTMLFormElement | null>;
  suggestionsOpen: boolean;
}): boolean {
  const active = enabled && editor !== null;

  React.useEffect(() => {
    if (!active || !editor) return;
    const root = document.documentElement;
    root.setAttribute(ROOT_ATTRIBUTE, "");
    let fromMac = false;

    const bridge: NativeComposerBridge = {
      input: (text) => {
        fromMac = true;
        try {
          editor.commands.setContent(
            {
              type: "doc",
              content: text.split("\n").map((line) => ({
                type: "paragraph",
                content: line ? [{ type: "text", text: line }] : [],
              })),
            },
            { emitUpdate: true },
          );
          editor.commands.setTextSelection(editor.state.doc.content.size);
        } finally {
          fromMac = false;
        }
      },
      send: () => formRef.current?.requestSubmit(),
      plus: () => {
        // The + menu opens on a press, as Radix's trigger listens for one.
        formRef.current
          ?.querySelector('[data-testid="message-composer-add"]')
          ?.dispatchEvent(
            new PointerEvent("pointerdown", {
              bubbles: true,
              button: 0,
              cancelable: true,
              pointerType: "mouse",
            }),
          );
      },
      key: (name) => {
        editor.view.dom.dispatchEvent(
          new KeyboardEvent("keydown", {
            bubbles: true,
            cancelable: true,
            key: name,
          }),
        );
      },
      height: (points) => {
        formRef.current?.style.setProperty(
          "--luca-native-composer-height",
          `${points}px`,
        );
      },
    };
    nativeWindow().__polyphonicComposer = bridge;

    // The page changed the words (a draft restored, a message sent, a
    // suggestion taken): the Mac shows them.
    const changed = () => {
      if (!fromMac) post({ type: "text", text: plainText(editor) });
    };
    // Anything that focuses the page's composer gives the Mac's words the keyboard.
    const focused = () => post({ type: "focus" });
    editor.on("update", changed);
    editor.on("focus", focused);
    post({ type: "text", text: plainText(editor) });

    let last = "";
    let frame = 0;
    const report = () => {
      frame = window.requestAnimationFrame(report);
      const form = formRef.current;
      const dark = root.classList.contains("dark");
      let message: Record<string, unknown> = {
        type: "frame",
        visible: false,
        dark,
      };
      if (form && !modalOpen()) {
        // The glass takes the input row's place, with the form's own padding
        // round it: what sits above the row (suggestions, a chosen task,
        // attachments waiting to go) stays the page's, above the glass.
        const row =
          form.querySelector<HTMLElement>(".luca-composer-controls") ?? form;
        const box = row.getBoundingClientRect();
        const style = window.getComputedStyle(form);
        const px = (value: string) => Number.parseFloat(value) || 0;
        const left =
          row === form ? 0 : px(style.paddingLeft) + px(style.borderLeftWidth);
        const right =
          row === form
            ? 0
            : px(style.paddingRight) + px(style.borderRightWidth);
        const top =
          row === form ? 0 : px(style.paddingTop) + px(style.borderTopWidth);
        const bottom =
          row === form
            ? 0
            : px(style.paddingBottom) + px(style.borderBottomWidth);
        const shown =
          box.width > 0 &&
          box.height > 0 &&
          box.bottom > 0 &&
          box.top < window.innerHeight;
        message = {
          type: "frame",
          visible: shown,
          x: box.x - left,
          y: box.y - top,
          w: box.width + left + right,
          h: box.height + top + bottom,
          hint:
            form
              .querySelector("[data-placeholder]")
              ?.getAttribute("data-placeholder") ?? "",
          dark,
        };
      }
      const key = JSON.stringify(message);
      if (key !== last) {
        last = key;
        post(message);
      }
    };
    report();

    return () => {
      window.cancelAnimationFrame(frame);
      editor.off("update", changed);
      editor.off("focus", focused);
      if (nativeWindow().__polyphonicComposer === bridge) {
        delete nativeWindow().__polyphonicComposer;
      }
      root.removeAttribute(ROOT_ATTRIBUTE);
      post({ type: "off" });
    };
  }, [active, editor, formRef]);

  React.useEffect(() => {
    if (active) post({ type: "keys", on: suggestionsOpen });
  }, [active, suggestionsOpen]);

  return active;
}
