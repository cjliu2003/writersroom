"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerProject = registerProject;
exports.listProjects = listProjects;
exports.deleteProject = deleteProject;
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const DATA_DIR = path_1.default.join(__dirname, '../data');
const PROJECTS_FILE = path_1.default.join(DATA_DIR, 'projects.json');
async function ensureDataDir() {
    try {
        await promises_1.default.mkdir(DATA_DIR, { recursive: true });
    }
    catch (error) {
        console.error('Error creating data directory:', error);
    }
}
async function loadProjects() {
    try {
        const data = await promises_1.default.readFile(PROJECTS_FILE, 'utf-8');
        return JSON.parse(data);
    }
    catch (error) {
        return [];
    }
}
async function saveProjects(projects) {
    await ensureDataDir();
    await promises_1.default.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}
async function registerProject(req, res) {
    try {
        const project = req.body;
        if (!project.projectId) {
            return res.status(400).json({
                success: false,
                error: 'projectId is required'
            });
        }
        const projects = await loadProjects();
        const existingIndex = projects.findIndex(p => p.projectId === project.projectId);
        if (existingIndex >= 0) {
            projects[existingIndex] = {
                ...projects[existingIndex],
                ...project,
                updatedAt: new Date().toISOString()
            };
        }
        else {
            projects.push(project);
        }
        await saveProjects(projects);
        res.json({
            success: true,
            message: 'Project registered successfully',
            project
        });
    }
    catch (error) {
        console.error('Error registering project:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to register project'
        });
    }
}
async function listProjects(req, res) {
    try {
        const projects = await loadProjects();
        const sorted = projects.sort((a, b) => {
            const dateA = a.lastOpenedAt || a.updatedAt;
            const dateB = b.lastOpenedAt || b.updatedAt;
            return new Date(dateB).getTime() - new Date(dateA).getTime();
        });
        res.json({
            success: true,
            projects: sorted
        });
    }
    catch (error) {
        console.error('Error listing projects:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to list projects'
        });
    }
}
async function deleteProject(req, res) {
    try {
        const { projectId } = req.params;
        if (!projectId) {
            return res.status(400).json({
                success: false,
                error: 'projectId is required'
            });
        }
        const projects = await loadProjects();
        const filtered = projects.filter(p => p.projectId !== projectId);
        if (filtered.length === projects.length) {
            return res.status(404).json({
                success: false,
                error: 'Project not found'
            });
        }
        await saveProjects(filtered);
        res.json({
            success: true,
            message: 'Project deleted successfully'
        });
    }
    catch (error) {
        console.error('Error deleting project:', error);
        res.status(500).json({
            success: false,
            error: 'Failed to delete project'
        });
    }
}
//# sourceMappingURL=projects.js.map