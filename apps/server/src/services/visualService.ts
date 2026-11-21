// TASK-085: implementation moved to visuals/ (service.ts, download.ts). This facade keeps the import path stable.
export { VisualService } from "../visuals/service.js";
export { isRetryableDownloadError } from "../visuals/download.js";
