import { describe, expect, test } from "vite-plus/test";
import {
  history_entry,
  lightbox_index,
  push_lightbox_entry,
  replace_lightbox_entry,
  type HistoryLike,
} from "./history-state";

/** A history that records what was written to it; `state` is the current entry's. */
function fake_history(state: unknown = null) {
  const calls: { kind: "push" | "replace"; state: unknown }[] = [];
  const history: HistoryLike = {
    state,
    pushState(next) {
      calls.push({ kind: "push", state: next });
    },
    replaceState(next) {
      calls.push({ kind: "replace", state: next });
    },
  };
  return { history, calls };
}

describe("history_entry", () => {
  test("is the number vinext keeps in the entry's state", () => {
    expect(history_entry(fake_history({ __vinext_historyIndex: 4 }).history)).toBe(4);
  });

  test.each([null, {}, { __vinext_historyIndex: "4" }])("is null for state %j", (state) => {
    expect(history_entry(fake_history(state).history)).toBeNull();
  });
});

describe("lightbox entries", () => {
  test("opening pushes an entry marked with the slide, on the current URL", () => {
    const { history, calls } = fake_history();
    push_lightbox_entry(2, history);
    expect(calls).toEqual([{ kind: "push", state: { lightbox: 2 } }]);
  });

  test("swiping replaces the entry instead of adding one", () => {
    const { history, calls } = fake_history();
    replace_lightbox_entry(3, history);
    expect(calls).toEqual([{ kind: "replace", state: { lightbox: 3 } }]);
  });

  test("an entry that carries a slide inside the article's images reads back as that slide", () => {
    expect(lightbox_index(5, fake_history({ lightbox: 4 }).history)).toBe(4);
    expect(lightbox_index(5, fake_history({ lightbox: 0 }).history)).toBe(0);
  });

  test.each([
    ["no state", null],
    ["a page entry", { __vinext_historyIndex: 1 }],
    ["past the last image", { lightbox: 5 }],
    ["negative", { lightbox: -1 }],
    ["not an integer", { lightbox: 1.5 }],
    ["not a number", { lightbox: "1" }],
  ])("reads null for %s", (_, state) => {
    expect(lightbox_index(5, fake_history(state).history)).toBeNull();
  });
});
