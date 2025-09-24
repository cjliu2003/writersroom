export interface SceneMemory {
    sceneId?: string;
    sceneIndex?: number;
    slugline: string;
    characters: string[];
    summary: string;
    tone?: string;
    themeTags?: string[];
    tokens?: number;
    timestamp?: Date;
    wordCount?: number;
    projectId: string;
    fullContent?: string;
    projectTitle?: string;
}
export interface MemoryStats {
    totalScenes: number;
    totalTokens: number;
    averageWordsPerScene: number;
    uniqueCharacters: string[];
    allThemes: string[];
}
export interface UpdateSceneMemoryRequest {
    projectId: string;
    slugline: string;
    sceneIndex?: number;
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
export interface ErrorResponse {
    success: false;
    message: string;
    error?: string;
}
export type APIResponse<T> = {
    success: true;
    data: T;
} | ErrorResponse;
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
export declare enum SceneTone {
    TENSE = "tense",
    ROMANTIC = "romantic",
    MYSTERIOUS = "mysterious",
    DRAMATIC = "dramatic",
    COMEDIC = "comedic",
    SUSPENSEFUL = "suspenseful",
    MELANCHOLY = "melancholy",
    UPLIFTING = "uplifting"
}
export declare enum ThemeTag {
    SPIRITUAL = "spiritual",
    SCIENTIFIC = "scientific",
    IDENTITY = "identity",
    LOVE = "love",
    MEDICAL = "medical",
    MYSTERY = "mystery",
    DISCOVERY = "discovery",
    FAMILY = "family",
    BETRAYAL = "betrayal",
    REDEMPTION = "redemption"
}
//# sourceMappingURL=types.d.ts.map