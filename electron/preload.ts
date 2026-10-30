import { contextBridge, ipcRenderer } from "electron";
import type { ArchiveAPI } from "../shared/types";
const invoke = (name: string, ...args: unknown[]) =>
  ipcRenderer.invoke(`archive:${name}`, ...args);
const api: ArchiveAPI = {
  state: () => invoke("state"),
  windowControl: (action) => invoke("windowControl", action),
  clipboardText: () => invoke("clipboardText"),
  create: (urls, options, startWhenReady) =>
    invoke("create", urls, options, startWhenReady),
  start: (id, options) => invoke("start", id, options),
  action: (id, action) => invoke("action", id, action),
  updateJob: (id, patch) => invoke("updateJob", id, patch),
  settings: (patch) => invoke("settings", patch),
  testModel: (config) => invoke("testModel", config),
  templatePreview: (template) => invoke("templatePreview", template),
  chooseOutput: () => invoke("chooseOutput"),
  login: (id) => invoke("login", id),
  open: (id, name) => invoke("open", id, name),
  reveal: (id) => invoke("reveal", id),
  source: (id, chapterId, blockId) => invoke("source", id, chapterId, blockId),
  demo: () => invoke("demo"),
  diagnostic: (id) => invoke("diagnostic", id),
  preview: (id) => invoke("preview", id),
  checkUpdates: (action) => invoke("checkUpdates", action),
  removalPlan: (id) => invoke("removalPlan", id),
  remove: (id, mode) => invoke("remove", id, mode),
  clearSession: () => invoke("clearSession"),
  onChange: (fn) => {
    ipcRenderer.on("archive:changed", fn);
    return () => ipcRenderer.removeListener("archive:changed", fn);
  },
};
contextBridge.exposeInMainWorld("archive", api);
