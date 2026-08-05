export type UpdateChannel = "stable" | "beta" | "alpha";

export interface UpdateProgress {
  percent: number;
  transferred: number;
  total: number;
  bytesPerSecond: number;
}

export interface UpdateState {
  status: string;
  currentVersion: string;
  availableVersion: string | null;
  releaseDate: string | null;
  releaseNotes: string;
  downloadSize: number | null;
  channel: UpdateChannel;
  lastCheckedAt: string | null;
  progress: UpdateProgress | null;
  error: string | null;
  prompt: boolean;
  configured: boolean;
  developmentMode: boolean;
  automaticChecks: boolean;
  automaticDownload: boolean;
  automaticInstall: boolean;
  history: Array<{ version: string; completedAt: string; status: string }>;
}
