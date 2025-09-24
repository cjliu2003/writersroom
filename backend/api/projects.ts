/**
 * Projects API endpoints for WritersRoom
 * Provides project registry mirroring to backend
 */

import { Request, Response } from 'express';
import fs from 'fs/promises';
import path from 'path';

interface ProjectSummary {
  projectId: string;
  title: string;
  sceneCount: number;
  status: 'draft' | 'in-progress' | 'completed';
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
}

const DATA_DIR = path.join(__dirname, '../data');
const PROJECTS_FILE = path.join(DATA_DIR, 'projects.json');

// Ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
  } catch (error) {
    console.error('Error creating data directory:', error);
  }
}

// Load projects from file
async function loadProjects(): Promise<ProjectSummary[]> {
  try {
    const data = await fs.readFile(PROJECTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    // File doesn't exist or is invalid, return empty array
    return [];
  }
}

// Save projects to file
async function saveProjects(projects: ProjectSummary[]): Promise<void> {
  await ensureDataDir();
  await fs.writeFile(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

/**
 * Register or update a project
 * POST /api/projects/register
 */
export async function registerProject(req: Request, res: Response) {
  try {
    const project = req.body as ProjectSummary;

    if (!project.projectId) {
      return res.status(400).json({
        success: false,
        error: 'projectId is required'
      });
    }

    const projects = await loadProjects();
    const existingIndex = projects.findIndex(p => p.projectId === project.projectId);

    if (existingIndex >= 0) {
      // Update existing project
      projects[existingIndex] = {
        ...projects[existingIndex],
        ...project,
        updatedAt: new Date().toISOString()
      };
    } else {
      // Add new project
      projects.push(project);
    }

    await saveProjects(projects);

    res.json({
      success: true,
      message: 'Project registered successfully',
      project
    });
  } catch (error) {
    console.error('Error registering project:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to register project'
    });
  }
}

/**
 * List all projects
 * GET /api/projects/list
 */
export async function listProjects(req: Request, res: Response) {
  try {
    const projects = await loadProjects();

    // Sort by most recently updated/opened first
    const sorted = projects.sort((a, b) => {
      const dateA = a.lastOpenedAt || a.updatedAt;
      const dateB = b.lastOpenedAt || b.updatedAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });

    res.json({
      success: true,
      projects: sorted
    });
  } catch (error) {
    console.error('Error listing projects:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list projects'
    });
  }
}

/**
 * Delete a project
 * DELETE /api/projects/:projectId
 */
export async function deleteProject(req: Request, res: Response) {
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
  } catch (error) {
    console.error('Error deleting project:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete project'
    });
  }
}