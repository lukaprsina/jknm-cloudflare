"use client";
import EditorJS from "@editorjs/editorjs";
import Header from "@editorjs/header";
import List from "@editorjs/list";
import Quote from "@editorjs/quote";
import Paragraph from "@editorjs/paragraph";
import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    __editor?: EditorJS;
  }
}

export default function Editor() {
  const holder = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("mounting");
  useEffect(() => {
    const editor = new EditorJS({
      holder: holder.current!,
      tools: { header: Header, list: List, quote: Quote, paragraph: Paragraph },
      data: { blocks: [{ type: "paragraph", data: { text: "Pozdravljeni" } }] },
      onReady: () => setStatus("ready"),
    });
    window.__editor = editor;
    return () => {
      void editor.isReady.then(() => editor.destroy()).catch(() => {});
    };
  }, []);
  return (
    <div>
      <p id="editor-status">{status}</p>
      <div id="editor-holder" ref={holder} />
    </div>
  );
}
