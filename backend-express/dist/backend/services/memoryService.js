"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryService = void 0;
const snapshotService_1 = __importDefault(require("./snapshotService"));
const projectMemories = new Map();
class MemoryService {
    static getProjectMemory(projectId) {
        if (!projectMemories.has(projectId)) {
            projectMemories.set(projectId, []);
        }
        return projectMemories.get(projectId);
    }
    static updateSceneMemory(projectId, slugline, data, sceneIndex) {
        const memory = this.getProjectMemory(projectId);
        console.log(`\n📝 MEMORY WRITE REQUEST:`);
        console.log(`   Project: ${projectId}`);
        console.log(`   Scene Index: ${sceneIndex}`);
        console.log(`   Slugline: "${slugline}"`);
        console.log(`   Current memory size: ${memory.length} scenes`);
        const sceneId = sceneIndex !== undefined ? `${projectId}_${sceneIndex}` : undefined;
        if (sceneId) {
            console.log(`   Generated Scene ID: ${sceneId}`);
        }
        const existingIndex = sceneId
            ? memory.findIndex(scene => scene.sceneId === sceneId)
            : -1;
        if (existingIndex !== -1) {
            console.log(`   ⚠️ UPDATING existing scene at index ${existingIndex}`);
            console.log(`   Previous slugline: "${memory[existingIndex].slugline}"`);
            console.log(`   Previous sceneId: ${memory[existingIndex].sceneId}`);
            memory[existingIndex] = {
                ...memory[existingIndex],
                ...data,
                projectId,
                slugline,
                sceneId: sceneId || memory[existingIndex].sceneId,
                sceneIndex: sceneIndex !== undefined ? sceneIndex : memory[existingIndex].sceneIndex,
                timestamp: new Date()
            };
            console.log(`   ✅ Scene UPDATED successfully`);
            return memory[existingIndex];
        }
        else {
            const newSceneIndex = sceneIndex !== undefined ? sceneIndex : memory.length;
            const newScene = {
                projectId,
                slugline,
                sceneId: `${projectId}_${newSceneIndex}`,
                sceneIndex: newSceneIndex,
                characters: data.characters || [],
                summary: data.summary || '',
                tone: data.tone,
                themeTags: data.themeTags,
                tokens: data.tokens,
                timestamp: new Date(),
                wordCount: data.wordCount,
                fullContent: data.fullContent,
                projectTitle: data.projectTitle
            };
            const duplicateSlugs = memory.filter(s => s.slugline === slugline);
            if (duplicateSlugs.length > 0) {
                console.log(`   📋 DUPLICATE SLUGLINE DETECTED: "${slugline}"`);
                console.log(`   Existing scenes with same slugline: ${duplicateSlugs.length}`);
                duplicateSlugs.forEach(s => {
                    console.log(`      - SceneId: ${s.sceneId}, Index: ${s.sceneIndex}`);
                });
            }
            memory.push(newScene);
            console.log(`   ✅ NEW scene CREATED with ID: ${newScene.sceneId}`);
            console.log(`   Memory now has ${memory.length} scenes`);
            return newScene;
        }
    }
    static getRecentScenes(projectId, count = 3) {
        const memory = this.getProjectMemory(projectId);
        return memory
            .sort((a, b) => {
            if (a.sceneIndex !== undefined && b.sceneIndex !== undefined) {
                return b.sceneIndex - a.sceneIndex;
            }
            const timeA = a.timestamp?.getTime() || 0;
            const timeB = b.timestamp?.getTime() || 0;
            return timeB - timeA;
        })
            .slice(0, count);
    }
    static getSceneBySlugline(projectId, slugline, sceneIndex) {
        const memory = this.getProjectMemory(projectId);
        if (sceneIndex !== undefined) {
            const sceneId = `${projectId}_${sceneIndex}`;
            return memory.find(scene => scene.sceneId === sceneId);
        }
        return memory.find(scene => scene.slugline === slugline);
    }
    static getSceneById(projectId, sceneId) {
        const memory = this.getProjectMemory(projectId);
        return memory.find(scene => scene.sceneId === sceneId);
    }
    static getScenesByCharacter(projectId, characterName) {
        const memory = this.getProjectMemory(projectId);
        return memory.filter(scene => scene.characters.some(char => char.toLowerCase().includes(characterName.toLowerCase())));
    }
    static getScenesByTheme(projectId, theme) {
        const memory = this.getProjectMemory(projectId);
        return memory.filter(scene => scene.themeTags?.some(tag => tag.toLowerCase().includes(theme.toLowerCase())));
    }
    static getTotalRecentTokens(projectId, sceneCount = 3) {
        return this.getRecentScenes(projectId, sceneCount)
            .reduce((total, scene) => total + (scene.tokens || 0), 0);
    }
    static getAllScenes(projectId) {
        const memory = this.getProjectMemory(projectId);
        console.log(`\n📊 MEMORY RETRIEVAL for project: ${projectId}`);
        console.log(`   Total scenes in memory: ${memory.length}`);
        const sluglineCounts = {};
        memory.forEach(scene => {
            sluglineCounts[scene.slugline] = (sluglineCounts[scene.slugline] || 0) + 1;
        });
        const duplicates = Object.entries(sluglineCounts)
            .filter(([_, count]) => count > 1)
            .map(([slugline, count]) => `"${slugline}" (${count}x)`);
        if (duplicates.length > 0) {
            console.log(`   📋 Duplicate sluglines found: ${duplicates.length}`);
            duplicates.forEach(d => console.log(`      - ${d}`));
        }
        console.log(`   Scene IDs in memory:`);
        memory.slice(0, 5).forEach(scene => {
            console.log(`      - ${scene.sceneId}: "${scene.slugline}"`);
        });
        if (memory.length > 10) {
            console.log(`      ... ${memory.length - 10} more scenes ...`);
        }
        memory.slice(-5).forEach(scene => {
            console.log(`      - ${scene.sceneId}: "${scene.slugline}"`);
        });
        const sorted = [...memory].sort((a, b) => {
            if (a.sceneIndex !== undefined && b.sceneIndex !== undefined) {
                return a.sceneIndex - b.sceneIndex;
            }
            return 0;
        });
        console.log(`   ✅ Returning ${sorted.length} scenes (sorted by index)`);
        if (sorted.length > 0 && !snapshotService_1.default.hasSnapshot(projectId)) {
            console.log(`\n🔄 AUTO-MIGRATION: Creating snapshot from memory for project ${projectId}`);
            const title = sorted[0].projectTitle || 'Migrated Project';
            try {
                snapshotService_1.default.storeSnapshot(projectId, {
                    version: Date.now(),
                    title,
                    scenes: sorted,
                    metadata: {
                        createdAt: new Date().toISOString(),
                        migratedFromMemory: true
                    }
                });
                console.log(`   ✅ Migration successful: Created snapshot with ${sorted.length} scenes`);
            }
            catch (error) {
                console.error(`   ❌ Migration failed:`, error);
            }
        }
        return sorted;
    }
    static clearSceneMemory(projectId) {
        projectMemories.set(projectId, []);
    }
    static clearAllMemory() {
        projectMemories.clear();
    }
    static getMemoryStats(projectId) {
        const memory = this.getProjectMemory(projectId);
        const totalTokens = memory.reduce((sum, scene) => sum + (scene.tokens || 0), 0);
        const totalWords = memory.reduce((sum, scene) => sum + (scene.wordCount || 0), 0);
        const uniqueCharacters = Array.from(new Set(memory.flatMap(scene => scene.characters)));
        const allThemes = Array.from(new Set(memory.flatMap(scene => scene.themeTags || [])));
        return {
            totalScenes: memory.length,
            totalTokens,
            averageWordsPerScene: memory.length > 0 ? Math.round(totalWords / memory.length) : 0,
            uniqueCharacters,
            allThemes
        };
    }
    static getGlobalStats() {
        const projectIds = Array.from(projectMemories.keys());
        const totalScenesAllProjects = projectIds.reduce((total, projectId) => {
            return total + this.getProjectMemory(projectId).length;
        }, 0);
        return {
            totalProjects: projectIds.length,
            totalScenesAllProjects,
            projectIds
        };
    }
    static deleteScene(projectId, slugline, sceneIndex) {
        const memory = this.getProjectMemory(projectId);
        let index = -1;
        if (sceneIndex !== undefined) {
            const sceneId = `${projectId}_${sceneIndex}`;
            index = memory.findIndex(scene => scene.sceneId === sceneId);
        }
        else {
            index = memory.findIndex(scene => scene.slugline === slugline);
        }
        if (index !== -1) {
            memory.splice(index, 1);
            return true;
        }
        return false;
    }
    static deleteProject(projectId) {
        return projectMemories.delete(projectId);
    }
    static hasScenes(projectId) {
        const memory = this.getProjectMemory(projectId);
        return memory.length > 0;
    }
    static getSceneCount(projectId) {
        return this.getProjectMemory(projectId).length;
    }
    static migrateProjectScenes(projectId) {
        const memory = this.getProjectMemory(projectId);
        const needsMigration = memory.some(scene => !scene.sceneId);
        if (!needsMigration) {
            return;
        }
        console.log(`Migrating ${memory.length} scenes for project ${projectId}`);
        memory.sort((a, b) => {
            const timeA = a.timestamp?.getTime() || 0;
            const timeB = b.timestamp?.getTime() || 0;
            return timeA - timeB;
        });
        memory.forEach((scene, index) => {
            if (!scene.sceneId) {
                scene.sceneIndex = index;
                scene.sceneId = `${projectId}_${index}`;
            }
        });
        console.log(`Migration complete for project ${projectId}`);
    }
}
exports.MemoryService = MemoryService;
exports.default = MemoryService;
//# sourceMappingURL=memoryService.js.map