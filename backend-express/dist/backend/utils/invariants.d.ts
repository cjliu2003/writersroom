export declare class SceneInvariantError extends Error {
    readonly details: {
        stage: string;
        expected?: number;
        actual?: number;
        diff?: number;
        context?: any;
    };
    constructor(message: string, details: {
        stage: string;
        expected?: number;
        actual?: number;
        diff?: number;
        context?: any;
    });
}
//# sourceMappingURL=invariants.d.ts.map