// Runs only against our generated reading document; never changes source content.
export function repairLayout() {
  const repairs: string[] = [];
  const style = document.createElement("style");
  style.textContent = `table{max-width:100%;table-layout:fixed}td,th{min-width:0;word-break:normal;overflow-wrap:anywhere}pre{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}h1,h2,h3,h4,h5,h6{break-after:avoid-page}p,li{orphans:3;widows:3}.long-image-slice{position:relative;overflow:hidden;break-inside:avoid}.long-image-slice img{position:absolute;left:0;max-height:none!important;max-width:none!important;margin:0!important}.split-image{break-inside:avoid;page-break-inside:avoid}`;
  document.head.append(style);
  const mm = 96 / 25.4;
  const pageHeight = 240 * mm;
  for (const table of document.querySelectorAll("table")) {
    for (const row of table.querySelectorAll("tr")) {
      if (row.getBoundingClientRect().height > pageHeight) {
        (row as HTMLElement).style.breakInside = "auto";
        repairs.push("允许超高表格行跨页，保留完整单元格内容");
      }
    }
  }
  for (const code of document.querySelectorAll(".code-block.short")) {
    if (code.getBoundingClientRect().height > pageHeight) {
      code.classList.remove("short");
      repairs.push("允许超长代码块跨页，保留全部代码");
    }
  }
  for (const image of document.querySelectorAll<HTMLImageElement>(
    "figure > img",
  )) {
    if (!image.naturalWidth || !image.naturalHeight) continue;
    const width = Math.min(
      image.naturalWidth,
      image.parentElement!.getBoundingClientRect().width,
    );
    const height = (width * image.naturalHeight) / image.naturalWidth;
    const sliceHeight = 210 * mm;
    if (height <= pageHeight) continue;
    const count = Math.ceil(height / sliceHeight);
    if (count > 80) {
      image.parentElement!.setAttribute(
        "data-folio-layout-warning",
        "长图超过 80 段自动排版上限，PDF 中可能缩得过小，请在 HTML 或原图中核对",
      );
      continue;
    }
    const parent = image.parentElement!;
    const caption =
      parent.querySelector("figcaption")?.textContent || image.alt || "";
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const figure = document.createElement("figure");
      figure.className = "split-image";
      const slice = document.createElement("div");
      slice.className = "long-image-slice";
      slice.style.width = `${width}px`;
      slice.style.height = `${Math.min(sliceHeight, height - i * sliceHeight)}px`;
      const copy = image.cloneNode(true) as HTMLImageElement;
      copy.style.width = `${width}px`;
      copy.style.height = `${height}px`;
      copy.style.top = `${-i * sliceHeight}px`;
      slice.append(copy);
      figure.append(slice);
      const label = document.createElement("figcaption");
      label.textContent = `${caption ? caption + " · " : ""}长图 ${i + 1}/${count}`;
      figure.append(label);
      fragment.append(figure);
    }
    parent.replaceWith(fragment);
    repairs.push(`长图分为 ${count} 段按原顺序排版，保留整张图像`);
  }
  return [...new Set(repairs)];
}

export function applyPDFRepair() {
  const style = document.createElement("style");
  style.textContent =
    "@media print{body{min-height:0}h1,h2,h3,h4,h5,h6{break-after:avoid-page;page-break-after:avoid}pre,td,th{overflow-wrap:anywhere;word-break:break-word}table{max-width:100%}tr{break-inside:auto}.code-block.short{break-inside:auto}.chapter>h2:first-child{margin-top:0}}";
  document.head.append(style);
}
