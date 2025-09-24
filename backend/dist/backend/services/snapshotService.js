"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SnapshotService = void 0;
const projectSnapshots = new Map();
class SnapshotService {
    static storeSnapshot(projectId, data) {
        console.log(`\n📸 ATOMIC SNAPSHOT WRITE:`);
        console.log(`   Project ID: ${projectId}`);
        console.log(`   Version: ${data.version}`);
        console.log(`   Scene Count: ${data.scenes.length}`);
        console.log(`   Elements Count: ${data.elements?.length || 0}`);
        if (data.scenes.length > 0) {
            console.log(`   First Scene: ${data.scenes[0].slugline || 'No slugline'}`);
            console.log(`   Last Scene: ${data.scenes[data.scenes.length - 1].slugline || 'No slugline'}`);
            const sluglines = data.scenes.map(s => s.slugline);
            const uniqueSlugs = new Set(sluglines);
            if (uniqueSlugs.size < sluglines.length) {
                console.log(`   ⚠️ Duplicate sluglines detected: ${sluglines.length - uniqueSlugs.size} duplicates`);
            }
        }
        const totalWords = data.scenes.reduce((sum, scene) => sum + (scene.wordCount || 0), 0);
        const totalTokens = data.scenes.reduce((sum, scene) => sum + (scene.tokens || 0), 0);
        const indexedScenes = data.scenes.map((scene, index) => ({
            ...scene,
            projectId,
            sceneIndex: scene.sceneIndex !== undefined ? scene.sceneIndex : index,
            sceneId: scene.sceneId || `${projectId}_${scene.sceneIndex !== undefined ? scene.sceneIndex : index}`,
            timestamp: scene.timestamp || new Date()
        }));
        const snapshot = {
            projectId,
            version: data.version,
            title: data.title || 'Untitled Project',
            scenes: indexedScenes,
            elements: data.elements,
            metadata: {
                createdAt: data.metadata?.createdAt || new Date().toISOString(),
                updatedAt: new Date().toISOString(),
                sceneCount: indexedScenes.length,
                totalWords,
                totalTokens,
                ...data.metadata
            }
        };
        projectSnapshots.set(projectId, snapshot);
        console.log(`   ✅ SNAPSHOT STORED SUCCESSFULLY`);
        console.log(`   Total scenes: ${snapshot.scenes.length}`);
        console.log(`   Total words: ${totalWords}`);
        console.log(`   Total tokens: ${totalTokens}`);
        console.log(`   ✅ Snapshot upload complete. Scenes saved: ${snapshot.scenes.length}`);
        const verification = projectSnapshots.get(projectId);
        if (verification && verification.scenes.length === data.scenes.length) {
            console.log(`   🔍 VERIFIED: All ${data.scenes.length} scenes persisted`);
        }
        else {
            console.error(`   ❌ VERIFICATION FAILED: Expected ${data.scenes.length} scenes, got ${verification?.scenes.length || 0}`);
        }
        return snapshot;
    }
    static getSnapshot(projectId) {
        console.log(`\n📸 ATOMIC SNAPSHOT READ:`);
        console.log(`   Project ID: ${projectId}`);
        const snapshot = projectSnapshots.get(projectId);
        if (!snapshot) {
            console.log(`   ⚠️ No snapshot found for project`);
            return null;
        }
        console.log(`   ✅ SNAPSHOT RETRIEVED`);
        console.log(`   Version: ${snapshot.version}`);
        console.log(`   Scene Count: ${snapshot.scenes.length}`);
        console.log(`   Last Updated: ${snapshot.metadata.updatedAt}`);
        console.log(`   ✅ Snapshot loaded. Scenes retrieved: ${snapshot.scenes.length}`);
        return snapshot;
    }
    static updateMetadata(projectId, metadata) {
        const snapshot = projectSnapshots.get(projectId);
        if (!snapshot) {
            return false;
        }
        snapshot.metadata = {
            ...snapshot.metadata,
            ...metadata,
            updatedAt: new Date().toISOString()
        };
        projectSnapshots.set(projectId, snapshot);
        return true;
    }
    static hasSnapshot(projectId) {
        return projectSnapshots.has(projectId);
    }
    static deleteSnapshot(projectId) {
        console.log(`\n🗑️ DELETING SNAPSHOT for project: ${projectId}`);
        return projectSnapshots.delete(projectId);
    }
    static getStats(projectId) {
        const snapshot = projectSnapshots.get(projectId);
        if (!snapshot) {
            return null;
        }
        return {
            projectId,
            version: snapshot.version,
            sceneCount: snapshot.scenes.length,
            totalWords: snapshot.metadata.totalWords,
            totalTokens: snapshot.metadata.totalTokens,
            createdAt: snapshot.metadata.createdAt,
            updatedAt: snapshot.metadata.updatedAt,
            memoryUsage: JSON.stringify(snapshot).length
        };
    }
    static listProjects() {
        return Array.from(projectSnapshots.keys());
    }
    static getGlobalStats() {
        const projects = Array.from(projectSnapshots.values());
        return {
            totalProjects: projects.length,
            totalScenes: projects.reduce((sum, p) => sum + p.scenes.length, 0),
            totalWords: projects.reduce((sum, p) => sum + p.metadata.totalWords, 0),
            totalMemoryUsage: projects.reduce((sum, p) => sum + JSON.stringify(p).length, 0),
            projects: projects.map(p => ({
                projectId: p.projectId,
                title: p.title,
                sceneCount: p.scenes.length,
                version: p.version
            }))
        };
    }
}
exports.SnapshotService = SnapshotService;
exports.default = SnapshotService;
//# sourceMappingURL=snapshotService.js.map