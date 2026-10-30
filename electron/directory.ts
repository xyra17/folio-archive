export interface DirectoryLink {
  title: string;
  sourceNumber?: string;
  url: string;
  navigationLabel?: string;
  navigationKey?: string;
}
export const directoryKey = (link: DirectoryLink) =>
  link.navigationKey || link.navigationLabel || link.url;

// Later scroll windows may introduce items before previously observed siblings.
export function mergeDirectory(
  previous: DirectoryLink[],
  incoming: DirectoryLink[],
) {
  const result = [...previous];
  for (let i = 0; i < incoming.length; i++) {
    const link = incoming[i];
    const key = directoryKey(link);
    if (result.some((item) => directoryKey(item) === key)) continue;
    const next = incoming
      .slice(i + 1)
      .find((item) =>
        result.some((known) => directoryKey(known) === directoryKey(item)),
      );
    const prior = incoming
      .slice(0, i)
      .reverse()
      .find((item) =>
        result.some((known) => directoryKey(known) === directoryKey(item)),
      );
    const index = next
      ? result.findIndex((item) => directoryKey(item) === directoryKey(next))
      : prior
        ? result.findIndex(
            (item) => directoryKey(item) === directoryKey(prior),
          ) + 1
        : result.length;
    result.splice(index, 0, link);
  }
  return result;
}

// Serialized into the source renderer. Only explicit directory controls are operated.
export function directoryDOM(
  action: "read" | "reset" | "advance" | "expand" | "activate",
  target?: { title: string; navigationKey?: string },
) {
  const geek = /(^|\.)geekbang\.com$/.test(location.hostname);
  const feishu = /(^|\.)(feishu\.cn|larksuite\.com)$/.test(location.hostname);
  const visible = (e: Element) => {
    const s = getComputedStyle(e);
    return (
      !!e.getClientRects().length &&
      s.display !== "none" &&
      s.visibility !== "hidden"
    );
  };
  const specific =
    '[data-chapter-list],.chapter-tree,.sidebar-tree,.wiki-tree,.wiki-tree-container,[role="tree"],.toc,[data-chapter],#mdbook-sidebar,mdbook-sidebar-scrollbox,ol.chapter';
  const selector =
    geek || feishu
      ? `${specific},nav,aside,[role="navigation"],.reader-sidebar`
      : specific;
  const roots = Array.from(document.querySelectorAll(selector)).filter(visible);
  const outer = roots.filter(
    (e) => !roots.some((other) => other !== e && other.contains(e)),
  );
  const candidates = outer.flatMap((root) =>
    Array.from(
      root.querySelectorAll(
        'a[href],button,[role="treeitem"],[role="button"],.section-link,[data-chapter-id],[data-node-token]',
      ),
    ),
  );
  const links: DirectoryLink[] = [];
  const elements: { element: HTMLElement; link: DirectoryLink }[] = [];
  const titleOf = (e: Element) => {
    const copy = (
      e.querySelector(".section-title,[data-chapter-title]") || e
    ).cloneNode(true) as HTMLElement;
    copy
      .querySelectorAll('[aria-hidden="true"],.chapter-toggle')
      .forEach((node) => node.remove());
    return (e.getAttribute("data-title") || copy.textContent || "").trim();
  };
  for (const element of candidates) {
    if (!visible(element)) continue;
    const title = titleOf(element);
    if (!title || title.length > 300) continue;
    let link: DirectoryLink | undefined;
    if (element instanceof HTMLAnchorElement) {
      const u = new URL(element.href);
      const current = new URL(location.href);
      // In-document headings are part of one document, not separate chapters.
      if (
        !/^https?:$/.test(u.protocol) ||
        u.origin !== current.origin ||
        u.hash
      )
        continue;
      if (
        geek &&
        current.pathname.startsWith("/space/wiki/") &&
        u.pathname !== current.pathname
      )
        continue;
      if (feishu && !/^\/(?:wiki|docx|docs)\//.test(u.pathname)) continue;
      const prefix = element.matches(
        "#mdbook-sidebar a,mdbook-sidebar-scrollbox a,ol.chapter a",
      )
        ? element
            .querySelector(':scope > strong[aria-hidden="true"]')
            ?.textContent?.trim()
        : undefined;
      const sourceNumber =
        prefix && /^\d+(?:\.\d+)*\.?$/.test(prefix) ? prefix : undefined;
      link = { title, sourceNumber, url: u.href };
    } else {
      const chapterControl =
        element.matches(".section-link,[data-chapter-id],[data-node-token]") ||
        (element.getAttribute("role") === "treeitem" &&
          !element.querySelector("a[href]")) ||
        (element.closest("[data-chapter-list]") &&
          !element.hasAttribute("aria-expanded"));
      if (
        !chapterControl ||
        element.querySelector("a[href],button,.section-link")
      )
        continue;
      const stable =
        element.getAttribute("data-chapter-id") ||
        element.getAttribute("data-node-token") ||
        element.getAttribute("data-id");
      link = {
        title,
        url: location.href,
        navigationLabel: title,
        navigationKey: stable ? `node:${stable}` : `title:${title}`,
      };
    }
    elements.push({ element: element as HTMLElement, link });
    links.push(link);
  }
  const expandable = outer
    .flatMap((root) =>
      Array.from(
        root.querySelectorAll(
          'button[aria-expanded="false"],[role="treeitem"][aria-expanded="false"],[role="button"][aria-expanded="false"],details:not([open])',
        ),
      ),
    )
    .filter(visible)
    // Geek's per-section subheading toggles do not reveal more chapters.
    .filter(
      (e) =>
        !geek || e.matches(".chapter-header") || !e.closest(".section-item"),
    );
  const scrollers = outer
    .flatMap((root) => {
      const all: Element[] = [root, ...Array.from(root.querySelectorAll("*"))];
      for (
        let p = root.parentElement;
        p && p !== document.body && !p.matches("main,article");
        p = p.parentElement
      )
        all.push(p);
      return all.filter(
        (e) =>
          e.clientHeight > 0 &&
          e.scrollHeight > e.clientHeight + 4 &&
          /auto|scroll/.test(getComputedStyle(e).overflowY),
      );
    })
    .filter((e, i, all) => all.indexOf(e) === i);
  const scrolling = scrollers.map((e) => ({
    top: e.scrollTop,
    height: e.scrollHeight,
    bottom: e.scrollTop + e.clientHeight >= e.scrollHeight - 4,
  }));
  let activated = false;
  let ambiguous = false;
  if (action === "activate" && target) {
    const found = elements.filter(({ link }) =>
      target.navigationKey
        ? link.navigationKey === target.navigationKey
        : link.title === target.title,
    );
    ambiguous = found.length > 1;
    if (found.length === 1) {
      found[0].element.click();
      activated = true;
    }
  }
  if (action === "expand")
    for (const e of expandable.slice(0, 20)) {
      if (e instanceof HTMLDetailsElement) e.open = true;
      else (e as HTMLElement).click();
    }
  if (action === "reset") for (const e of scrollers) e.scrollTop = 0;
  if (action === "advance")
    for (const e of scrollers) e.scrollTop += Math.max(1, e.clientHeight * 0.7);
  const countText = geek
    ? document.querySelector(".reader-sidebar")?.textContent || ""
    : "";
  const declared = countText.match(/已更新\s*(\d+)\s*讲/)?.[1];
  const explicitCount = outer
    .map((e) => Number(e.getAttribute("data-chapter-count")))
    .filter((n) => Number.isInteger(n) && n > 0);
  return {
    links,
    roots: outer.length,
    collapsed: expandable.length,
    scrolling,
    activated,
    ambiguous,
    declared: declared ? Number(declared) : explicitCount[0],
    collectionTitle: geek
      ? document.querySelector(".reader-sidebar h2")?.textContent?.trim()
      : document.querySelector("#mdbook-sidebar")
        ? document.querySelector(".menu-title")?.textContent?.trim()
        : undefined,
  };
}
