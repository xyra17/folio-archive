import {
  getDocument,
  GlobalWorkerOptions,
  Util,
  OPS,
  type PDFDocumentProxy,
} from "pdfjs-dist";
// @ts-expect-error Vite asset import
import worker from "pdfjs-dist/build/pdf.worker.min.mjs?url";
GlobalWorkerOptions.workerSrc = worker;
let doc: PDFDocumentProxy | undefined;
const canvas = document.getElementById("page") as HTMLCanvasElement;
const pdfReview = {
  async load(base64: string) {
    if (doc) await doc.loadingTask.destroy();
    const binary = atob(base64);
    const data = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const asset = (dir: string) =>
      new URL(`./pdf-assets/${dir}/`, location.href).href;
    doc = await getDocument({
      data,
      useSystemFonts: true,
      cMapUrl: asset("cmaps"),
      cMapPacked: true,
      standardFontDataUrl: asset("standard_fonts"),
      wasmUrl: asset("wasm"),
    }).promise;
    return doc.numPages;
  },
  async inspect() {
    if (!doc) throw new Error("PDF 未加载");
    const overflows: { page: number; count: number }[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const v = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      let count = 0;
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const t = Util.transform(v.transform, item.transform);
        if (
          t[4] < -4 ||
          t[4] + item.width > v.width + 4 ||
          t[5] < -4 ||
          t[5] > v.height + 4
        )
          count++;
      }
      if (count) overflows.push({ page: n, count });
      page.cleanup();
    }
    return overflows;
  },
  async audit(headings: string[] = []) {
    if (!doc) throw new Error("PDF 未加载");
    const findings: { page: number; code: string; message: string }[] = [];
    const compact = (value: string) =>
      value.normalize("NFKC").replace(/\s+/g, "");
    const knownHeadings = new Set(headings.map(compact));
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n),
        v = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const lines: { text: string; x: number; y: number; height: number }[] =
        [];
      let overflow = 0;
      for (const item of content.items) {
        if (!("str" in item) || !item.str.trim()) continue;
        const t = Util.transform(v.transform, item.transform);
        if (
          t[4] < -4 ||
          t[4] + item.width > v.width + 4 ||
          t[5] < -4 ||
          t[5] > v.height + 4
        )
          overflow++;
        if (t[5] > v.height - 35) continue; // Generated page-number footer.
        const previous = lines.at(-1);
        if (previous && Math.abs(previous.y - t[5]) < 3)
          previous.text += item.str;
        else
          lines.push({
            text: item.str,
            x: t[4],
            y: t[5],
            height: Math.hypot(t[2], t[3]),
          });
      }
      if (overflow)
        findings.push({
          page: n,
          code: "text-overflow",
          message: `有 ${overflow} 处文字可能超出纸张`,
        });
      const ops = await page.getOperatorList();
      const hasGraphics = ops.fnArray.some((op) =>
        [
          OPS.paintImageXObject,
          OPS.paintInlineImageXObject,
          OPS.paintImageMaskXObject,
          OPS.shadingFill,
          OPS.fill,
          OPS.eoFill,
          OPS.stroke,
        ].includes(op),
      );
      let blank = !lines.length && !hasGraphics;
      if (!lines.length && hasGraphics) {
        // A white page background is also a PDF fill operator.
        const thumb = document.createElement("canvas");
        const viewport = page.getViewport({ scale: 160 / v.width });
        thumb.width = Math.ceil(viewport.width);
        thumb.height = Math.ceil(viewport.height);
        const context = thumb.getContext("2d")!;
        await page.render({ canvas: thumb, canvasContext: context, viewport })
          .promise;
        const pixels = context.getImageData(
          0,
          0,
          thumb.width,
          Math.floor(thumb.height * 0.95),
        ).data;
        let ink = 0;
        for (let p = 0; p < pixels.length; p += 4)
          if (Math.min(pixels[p], pixels[p + 1], pixels[p + 2]) < 240) ink++;
        blank = ink < 4;
      }
      if (blank)
        findings.push({
          page: n,
          code: "blank-page",
          message: "仅有页码或完全空白，请核对是否异常分页",
        });
      const last = lines.at(-1);
      if (
        n < doc.numPages &&
        last &&
        last.text.length < 100 &&
        knownHeadings.has(compact(last.text)) &&
        last.y > v.height * 0.8
      )
        findings.push({
          page: n,
          code: "orphan-heading",
          message: "页面底部疑似只留下标题，需与后续正文连排",
        });
      page.cleanup();
    }
    return findings;
  },
  async text() {
    if (!doc) throw new Error("PDF 未加载");
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      pages.push(
        content.items.map((item) => ("str" in item ? item.str : "")).join(" "),
      );
      page.cleanup();
    }
    return pages.join("\n");
  },
  async render(number: number) {
    if (!doc) throw new Error("PDF 未加载");
    const page = await doc.getPage(number);
    const raw = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: 1000 / raw.width });
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    await page.render({
      canvas,
      canvasContext: canvas.getContext("2d")!,
      viewport,
    }).promise;
    return { width: canvas.width, height: canvas.height };
  },
};
Object.assign(window, { folioPDF: pdfReview });
