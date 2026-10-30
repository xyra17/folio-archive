import { BrowserWindow, app } from "electron";
import fs from "node:fs/promises";
import path from "node:path";
export class PDFLayout {
  private window: BrowserWindow;
  constructor() {
    this.window = new BrowserWindow({
      show: false,
      width: 1000,
      height: 1450,
      useContentSize: true,
      webPreferences: {
        sandbox: true,
        nodeIntegration: false,
        contextIsolation: true,
        partition: "folio-pdf-layout",
      },
    });
    this.window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    this.window.webContents.on("will-navigate", (e) => e.preventDefault());
  }
  async load(file: string) {
    const base = app.isPackaged ? app.getAppPath() : process.cwd();
    if (process.env.FOLIO_DEV_URL)
      await this.window.loadURL(process.env.FOLIO_DEV_URL + "/pdf-review.html");
    else await this.window.loadFile(path.join(base, "dist/pdf-review.html"));
    return this.window.webContents.executeJavaScript(
      `window.folioPDF.load(${JSON.stringify((await fs.readFile(file)).toString("base64"))})`,
    ) as Promise<number>;
  }
  async inspect() {
    return this.window.webContents.executeJavaScript(
      "window.folioPDF.inspect()",
    ) as Promise<{ page: number; count: number }[]>;
  }
  async audit(headings: string[] = []) {
    return this.window.webContents.executeJavaScript(
      `window.folioPDF.audit(${JSON.stringify(headings)})`,
    ) as Promise<{ page: number; code: string; message: string }[]>;
  }
  async text(): Promise<string> {
    return this.window.webContents.executeJavaScript("window.folioPDF.text()");
  }
  async page(number: number) {
    const size = await this.window.webContents.executeJavaScript(
      `window.folioPDF.render(${number})`,
    );
    this.window.setContentSize(size.width, size.height);
    return (
      await this.window.webContents.capturePage({
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
      })
    )
      .resize({ width: 1000 })
      .toPNG();
  }
  close() {
    if (!this.window.isDestroyed()) this.window.destroy();
  }
}
