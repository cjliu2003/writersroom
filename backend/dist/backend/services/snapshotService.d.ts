import { SceneMemory } from '../../shared/types';
export interface ProjectSnapshot {
    projectId: string;
    version: number;
    title: string;
    scenes: SceneMemory[];
    elements?: any[];
    metadata: {
        createdAt: string;
        updatedAt: string;
        sceneCount: number;
        totalWords: number;
        totalTokens: number;
    };
}
export declare class SnapshotService {
    static storeSnapshot(projectId: string, data: {
        version: number;
        title?: string;
        scenes: SceneMemory[];
        elements?: any[];
        metadata?: any;
    }): ProjectSnapshot;
    static getSnapshot(projectId: string): ProjectSnapshot | null;
    static updateMetadata(projectId: string, metadata: Partial<ProjectSnapshot['metadata']>): boolean;
    static hasSnapshot(projectId: string): boolean;
    static deleteSnapshot(projectId: string): boolean;
    static getStats(projectId: string): any;
    static listProjects(): string[];
    static getGlobalStats(): any;
}
export default SnapshotService;
//# sourceMappingURL=snapshotService.d.ts.map