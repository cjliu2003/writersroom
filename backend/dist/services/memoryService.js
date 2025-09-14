"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MemoryService = void 0;
const projectMemories = new Map();
class MemoryService {
    static getProjectMemory(projectId) {
        if (!projectMemories.has(projectId)) {
            projectMemories.set(projectId, []);
        }
        return projectMemories.get(projectId);
    }
    static updateSceneMemory(projectId, slugline, data) {
        const memory = this.getProjectMemory(projectId);
        const existingIndex = memory.findIndex(scene => scene.slugline === slugline);
        if (existingIndex !== -1) {
            memory[existingIndex] = {
                ...memory[existingIndex],
                ...data,
                projectId,
                slugline,
                timestamp: new Date()
            };
            return memory[existingIndex];
        }
        else {
            const newScene = {
                projectId,
                slugline,
                characters: data.characters || [],
                summary: data.summary || '',
                tone: data.tone,
                themeTags: data.themeTags,
                tokens: data.tokens,
                timestamp: new Date(),
                wordCount: data.wordCount,
                fullContent: data.fullContent
            };
            memory.push(newScene);
            return newScene;
        }
    }
    static getRecentScenes(projectId, count = 3) {
        const memory = this.getProjectMemory(projectId);
        return memory
            .sort((a, b) => {
            const timeA = a.timestamp?.getTime() || 0;
            const timeB = b.timestamp?.getTime() || 0;
            return timeB - timeA;
        })
            .slice(0, count);
    }
    static getSceneBySlugline(projectId, slugline) {
        const memory = this.getProjectMemory(projectId);
        return memory.find(scene => scene.slugline === slugline);
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
        return this.getProjectMemory(projectId);
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
    static deleteScene(projectId, slugline) {
        const memory = this.getProjectMemory(projectId);
        const index = memory.findIndex(scene => scene.slugline === slugline);
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
}
exports.MemoryService = MemoryService;
exports.default = MemoryService;
//# sourceMappingURL=memoryService.js.map