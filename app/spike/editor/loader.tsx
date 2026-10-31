"use client";
import dynamic from "next/dynamic";

// @editorjs/editorjs patches Element.prototype at module-eval time -> must stay client-only.
export const EditorLoader = dynamic(() => import("./editor"), {
  ssr: false,
  loading: () => <p id="editor-loading">loading editor…</p>,
});
