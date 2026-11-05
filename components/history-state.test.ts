import { describe, expect, test } from "vite-plus/test";
import {
  history_entry,
  lightbox_index,
  push_lightbox_entry,
  replace_lightbox_entry,
  type HistoryLike,
} from "./history-state";

/** A history that keeps entries the way a browser does: push adds one, replace rewrites the current. */
function fake_history(state: unknown = null) {
  const entries: { state: unknown; url: string | URL | null | undefined }[] = [
    { state, url: undefined },
  ];
  const history: HistoryLike = {
    get state() {
      return entries.at(-1)!.state;
    },
    pushState(next, _title, url) {
      entries.push({ state: next, url });
    },
    replaceState(next, _title, url) {
      entries[entries.length - 1] = { state: next, url };
    },
  };
  return { history, entries };
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
  test("an entry opened at a slide reads back as that slide", () => {
    const { history } = fake_history();
    push_lightbox_entry(2, history);
    expect(lightbox_index(5, history)).toBe(2);
  });

  test("opening adds an entry, so Back has somewhere to go, and stays on the article's URL", () => {
    const { history, entries } = fake_history();
    push_lightbox_entry(0, history);
    expect(entries).toHaveLength(2);
    expect(entries[1]!.url).toBeUndefined();
  });

  test("swiping moves the same entry to the new slide instead of adding one", () => {
    const { history, entries } = fake_history();
    push_lightbox_entry(0, history);
    replace_lightbox_entry(3, history);
    expect(entries).toHaveLength(2);
    expect(lightbox_index(5, history)).toBe(3);
  });

  test("the entry before the lightbox opened is not a lightbox entry", () => {
    const { history, entries } = fake_history({ __vinext_historyIndex: 1 });
    push_lightbox_entry(0, history);
    expect(lightbox_index(5, fake_history(entries[0]!.state).history)).toBeNull();
  });

  test("a slide beyond the article's images is not shown", () => {
    const { history } = fake_history();
    push_lightbox_entry(5, history);
    expect(lightbox_index(5, history)).toBeNull();
    expect(lightbox_index(6, history)).toBe(5);
  });

  test.each([-1, 1.5, Number.NaN])("a slide number of %s is not shown", (slide) => {
    const { history } = fake_history();
    push_lightbox_entry(slide, history);
    expect(lightbox_index(5, history)).toBeNull();
  });
});
