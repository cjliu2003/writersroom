import { SceneMemory } from '../../../shared/types';
export declare function generateSRFirstLookScenes(projectId?: string): SceneMemory[];
export declare const TestScenarios: {
    duplicateSluglineScenes(): SceneMemory[];
    invalidScenes(): any[];
    nonContiguousScenes(): any[];
    largeSceneCollection(count?: number): SceneMemory[];
};
export declare const ExpectedSceneCounts: {
    'sr_first_look_final.fdx': number;
    'test.fdx': number;
    'seizure-test.fdx': number;
    'test-silk-road.fdx': number;
};
export declare function verifySceneIntegrity(scenes: SceneMemory[]): {
    valid: boolean;
    errors: string[];
};
//# sourceMappingURL=test-scenes.fixture.d.ts.map