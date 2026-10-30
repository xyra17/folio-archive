export type Format = "pdf" | "docx" | "md" | "html";
export type TemplateId = "reading" | "print" | "technical" | "journal";
export interface SourceAccess {
  kind:
    | "available"
    | "login"
    | "membership"
    | "verification"
    | "permission"
    | "preview"
    | "export-restricted";
  message: string;
  evidence?: string;
  url?: string;
}
export interface ModelConnection {
  modelEndpoint: string;
  model: string;
  apiKey?: string;
  useSavedKey?: boolean;
}
export type JobStatus =
  | "inspecting"
  | "ready"
  | "queued"
  | "running"
  | "paused"
  | "waiting_login"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";
export type Phase =
  "discover" | "capture" | "assets" | "content" | "layout" | "export";
export interface Issue {
  id: string;
  chapterId?: string;
  assetId?: string;
  blockId?: string;
  code: string;
  message: string;
  severity: "warning" | "error";
  resolved?: boolean;
  origin: "rule" | "content-agent" | "layout-agent";
}
export interface Block {
  id: string;
  type:
    | "heading"
    | "paragraph"
    | "quote"
    | "list"
    | "code"
    | "table"
    | "image"
    | "math"
    | "divider";
  text: string;
  html?: string;
  level?: number;
  items?: string[];
  ordered?: boolean;
  rows?: string[][];
  assetId?: string;
  language?: string;
}
export interface Asset {
  id: string;
  url: string;
  chapterId: string;
  path?: string;
  mime?: string;
  width?: number;
  height?: number;
  status: "pending" | "ready" | "failed";
  error?: string;
  hash?: string;
  captureMode?: "original" | "screenshot";
}
export interface Chapter {
  author?: string;
  id: string;
  title: string;
  sourceNumber?: string;
  url: string;
  navigationLabel?: string;
  navigationKey?: string;
  capture?: {
    title: string;
    firstText: string;
    lastText: string;
    reachedEnd: boolean;
    steps: number;
    retries: number;
  };
  selected: boolean;
  status: "discovered" | "capturing" | "checking" | "ready" | "failed";
  blocks: Block[];
  assets: Asset[];
  hash?: string;
  previousHash?: string;
  changes?: string;
  sourceBlockCount?: number;
  capturedAt?: string;
  evidencePath?: string;
  error?: string;
}
export interface JobOptions {
  formats: Format[];
  template: TemplateId;
  fromHeading: string;
  excludeHeadings: string;
  aiReview: boolean;
}
export interface ExportFile {
  name: string;
  path: string;
  format: string;
  bytes: number;
  pages?: number;
}
export interface ReviewCoverage {
  content: "not-requested" | "pending" | "passed" | "issues" | "unavailable";
  layout: "not-requested" | "pending" | "passed" | "issues" | "unavailable";
  layoutScope?: string;
  layoutPages?: number[];
  layoutTotalPages?: number;
  rulePages?: number;
  layoutRepairs?: string[];
  layoutChecks?: { page: number; code: string; message: string }[];
  calls: number;
}
export interface Job {
  access?: SourceAccess;
  startWhenReady?: boolean;
  id: string;
  url: string;
  title: string;
  source: "feishu" | "geekbang" | "pdf" | "web";
  status: JobStatus;
  phase: Phase;
  createdAt: string;
  updatedAt: string;
  chapters: Chapter[];
  discovery?: {
    version: number;
    status: "observed" | "truncated" | "single-page" | "unavailable";
    observed: number;
    declared?: number;
    steps: number;
    message: string;
  };
  reconciliation?: {
    selected: number;
    captured: number;
    verified: number;
    failed: string[];
    truncated: string[];
    duplicateGroups: string[][];
    firstChapter?: string;
    lastChapter?: string;
  };
  issues: Issue[];
  options: JobOptions;
  exports: ExportFile[];
  outputDir: string;
  previewPath?: string;
  originalPath?: string;
  originalUrl?: string;
  error?: string;
  collection: string;
  tags: string[];
  coverage: ReviewCoverage;
  events: { at: string; phase: string; message: string }[];
}
export interface Settings {
  outputRoot: string;
  pageConcurrency: number;
  assetConcurrency: number;
  maxChapters: number;
  maxScrollSteps: number;
  modelEndpoint: string;
  model: string;
  hasApiKey: boolean;
  aiMaxCalls: number;
  updateUrl: string;
}
export interface AppState {
  jobs: Job[];
  settings: Settings;
  version: string;
  dataPath: string;
  platform: string;
  window: { maximized: boolean; fullscreen: boolean };
}
export type RemovalMode = "record" | "files";
export interface RemovalPlan {
  directories: string[];
  outputDirectory: string;
}
export interface ArchiveAPI {
  state(): Promise<AppState>;
  windowControl(
    action: "close" | "minimize" | "zoom" | "fullscreen",
  ): Promise<void>;
  clipboardText(): Promise<string>;
  create(
    urls: string[],
    options?: Partial<JobOptions>,
    startWhenReady?: boolean,
  ): Promise<string[]>;
  start(id: string, options?: Partial<JobOptions>): Promise<void>;
  action(
    id: string,
    action:
      | "pause"
      | "resume"
      | "cancel"
      | "retry"
      | "refresh"
      | "rediscover"
      | "retry-assets"
      | "retry-missing"
      | "reexport",
  ): Promise<void>;
  updateJob(
    id: string,
    patch: {
      selected?: string[];
      collection?: string;
      tags?: string[];
      options?: Partial<JobOptions>;
    },
  ): Promise<void>;
  settings(patch: Partial<Settings> & { apiKey?: string }): Promise<void>;
  testModel(config: ModelConnection): Promise<{ message: string }>;
  templatePreview(template: TemplateId): Promise<string>;
  chooseOutput(): Promise<string | null>;
  login(id: string): Promise<void>;
  open(id: string, name?: string): Promise<void>;
  reveal(id?: string): Promise<void>;
  source(id: string, chapterId?: string, blockId?: string): Promise<void>;
  demo(): Promise<string[]>;
  diagnostic(id: string): Promise<string>;
  preview(id: string): Promise<string | null>;
  checkUpdates(
    action?: "check" | "download" | "install",
  ): Promise<{ status: string; message: string }>;
  removalPlan(id: string): Promise<RemovalPlan>;
  remove(id: string, mode?: RemovalMode): Promise<void>;
  clearSession(): Promise<void>;
  onChange(fn: () => void): () => void;
}
declare global {
  interface Window {
    archive: ArchiveAPI;
  }
}
