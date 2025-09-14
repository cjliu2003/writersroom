import { SceneMemory, MemoryStats } from '../../shared/types';
export declare class MemoryService {
    private static getProjectMemory;
    static updateSceneMemory(projectId: string, slugline: string, data: Partial<Omit<SceneMemory, 'projectId' | 'slugline'>>): SceneMemory;
    static getRecentScenes(projectId: string, count?: number): SceneMemory[];
    static getSceneBySlugline(projectId: string, slugline: string): SceneMemory | undefined;
    static getScenesByCharacter(projectId: string, characterName: string): SceneMemory[];
    static getScenesByTheme(projectId: string, theme: string): SceneMemory[];
    static getTotalRecentTokens(projectId: string, sceneCount?: number): number;
    static getAllScenes(projectId: string): SceneMemory[];
    static clearSceneMemory(projectId: string): void;
    static clearAllMemory(): void;
    static getMemoryStats(projectId: string): MemoryStats;
    static getGlobalStats(): {
        totalProjects: number;
        totalScenesAllProjects: number;
        projectIds: string[];
    };
    static deleteScene(projectId: string, slugline: string): boolean;
    static deleteProject(projectId: string): boolean;
    static hasScenes(projectId: string): boolean;
    static getSceneCount(projectId: string): number;
}
export default MemoryService;
//# sourceMappingURL=memoryService.d.ts.map