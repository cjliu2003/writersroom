/**
 * Shared Types for Writersroom App
 * 
 * Types shared between frontend and backend to maintain type safety
 * across the full-stack application.
 */

// Scene Memory Types
export interface SceneMemory {
  sceneId?: string; // Unique composite key: projectId_sceneIndex (e.g., "imported_1234567890_0")
  sceneIndex?: number; // Sequential index in the script (0-based) to preserve chronological order
  slugline: string; // e.g., "INT. HOSPITAL - NIGHT"
  characters: string[]; // e.g., ["ONDINE", "DR. GALLAGHER"]
  summary: string; // e.g., "Ondine is tested in Gallagher's seizure experiment."
  tone?: string; // optional: e.g., "tense", "mysterious", "romantic"
  themeTags?: string[]; // optional: ["spiritual", "scientific", "identity"]
  tokens?: number; // optional: number of tokens used (estimate for prompt budget)
  timestamp?: Date; // when this scene memory was created/updated
  wordCount?: number; // optional: word count for the scene content
  projectId: string; // namespace scenes by project/script
  fullContent?: string; // optional: full scene content in screenplay format for FDX imports
  projectTitle?: string; // optional: title of the project/script (from filename for FDX imports)
}

// Memory Statistics Response
export interface MemoryStats {
  totalScenes: number;
  totalTokens: number;
  averageWordsPerScene: number;
  uniqueCharacters: string[];
  allThemes: string[];
}

// API Request/Response Types
export interface UpdateSceneMemoryRequest {
  projectId: string;
  slugline: string;
  sceneIndex?: number; // Optional scene index for unique identification
  data: Partial<Omit<SceneMemory, 'projectId' | 'slugline' | 'sceneId' | 'sceneIndex'>>;
}

export interface GetRecentScenesRequest {
  projectId: string;
  count?: number;
}

export interface GetScenesByCharacterRequest {
  projectId: string;
  characterName: string;
}

export interface GetScenesByThemeRequest {
  projectId: string;
  theme: string;
}

export interface GetTokensRequest {
  projectId: string;
  sceneCount?: number;
}

// API Response Types
export interface SceneMemoryResponse {
  success: boolean;
  data?: SceneMemory[];
  message?: string;
}

export interface SingleSceneResponse {
  success: boolean;
  data?: SceneMemory;
  message?: string;
}

export interface TokensResponse {
  success: boolean;
  data?: number;
  message?: string;
}

export interface StatsResponse {
  success: boolean;
  data?: MemoryStats;
  message?: string;
}

// Error Response
export interface ErrorResponse {
  success: false;
  message: string;
  error?: string;
}

// Utility Types
export type APIResponse<T> = {
  success: true;
  data: T;
} | ErrorResponse;

// Common Scene-related Types (for broader app use)
export interface Scene {
  id: string;
  heading: string;
  content: string;
}

export interface Script {
  id: string;
  title: string;
  scenes: Scene[];
  content: string;
  createdAt: string;
}

// Theme and Tone Enums (for consistency)
export enum SceneTone {
  TENSE = 'tense',
  ROMANTIC = 'romantic', 
  MYSTERIOUS = 'mysterious',
  DRAMATIC = 'dramatic',
  COMEDIC = 'comedic',
  SUSPENSEFUL = 'suspenseful',
  MELANCHOLY = 'melancholy',
  UPLIFTING = 'uplifting'
}

export enum ThemeTag {
  SPIRITUAL = 'spiritual',
  SCIENTIFIC = 'scientific',
  IDENTITY = 'identity',
  LOVE = 'love',
  MEDICAL = 'medical',
  MYSTERY = 'mystery',
  DISCOVERY = 'discovery',
  FAMILY = 'family',
  BETRAYAL = 'betrayal',
  REDEMPTION = 'redemption'
}