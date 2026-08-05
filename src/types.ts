export type AssistantState = "disconnected" | "connecting" | "listening" | "speaking";

export interface TranscriptLine {
  id: string;
  text: string;
  role: "user" | "model";
  timestamp: Date;
}

export interface Memory {
  id: string;
  category: "Identity" | "Preferences" | "Personality" | "Projects" | "Goals" | "Relationships" | "Schedule" | "Habits" | "Emotional" | "Semantic";
  content: string;
  importance: "Critical" | "High" | "Medium" | "Low";
  confidence: number;
  timestamp: string;
  lastAccessed: string;
  timesReinforced: number;
  pinned: boolean;
}

export interface LiveMessage {
  state?: "connected" | "disconnected";
  audio?: string;
  interrupted?: boolean;
  text?: string;
  role?: "user" | "model";
  error?: string;
  type?: string;
  time_left?: string;
  context_restored?: boolean;
}
