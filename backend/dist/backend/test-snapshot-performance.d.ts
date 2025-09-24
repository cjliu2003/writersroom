interface PerformanceMetrics {
    fileSize: number;
    parseTime: number;
    postPayloadSize: number;
    postTime: number;
    postStatus: number;
    getTime: number;
    getStatus: number;
    getPayloadSize: number;
    memoryUsage: NodeJS.MemoryUsage;
    errors: string[];
}
declare function measurePerformance(): Promise<PerformanceMetrics>;
declare function checkServerLimits(): Promise<void>;
export { measurePerformance, checkServerLimits };
//# sourceMappingURL=test-snapshot-performance.d.ts.map