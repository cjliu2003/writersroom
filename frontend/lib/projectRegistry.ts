/**
 * Project Registry for WritersRoom
 * Manages project persistence in localStorage with backend mirroring
 */

export interface ProjectSummary {
  projectId: string;
  title: string;
  sceneCount: number;
  status: 'draft' | 'in-progress' | 'completed';
  createdAt: string;
  updatedAt: string;
  lastOpenedAt?: string;
}

const STORAGE_KEY = 'wr.projects';

/**
 * List all projects from localStorage
 */
export function listProjects(): ProjectSummary[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];

    const projects = JSON.parse(stored);
    if (!Array.isArray(projects)) return [];

    // Sort by most recently updated/opened first
    return projects.sort((a: ProjectSummary, b: ProjectSummary) => {
      const dateA = a.lastOpenedAt || a.updatedAt;
      const dateB = b.lastOpenedAt || b.updatedAt;
      return new Date(dateB).getTime() - new Date(dateA).getTime();
    });
  } catch (error) {
    console.error('Error reading projects from localStorage:', error);
    return [];
  }
}

/**
 * Insert or update a project in the registry
 */
export function upsertProject(project: ProjectSummary): void {
  try {
    const projects = listProjects();
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

    localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  } catch (error) {
    console.error('Error saving project to localStorage:', error);
  }
}

/**
 * Mark a project as opened, updating timestamps
 */
export function markOpened(projectId: string): void {
  try {
    const projects = listProjects();
    const project = projects.find(p => p.projectId === projectId);

    if (project) {
      const now = new Date().toISOString();
      project.lastOpenedAt = now;
      project.updatedAt = now;

      // Save back the entire array
      localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
    }
  } catch (error) {
    console.error('Error marking project as opened:', error);
  }
}

/**
 * Remove a project from the registry (stub for future)
 */
export function removeProject(projectId: string): void {
  try {
    const projects = listProjects();
    const filtered = projects.filter(p => p.projectId !== projectId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch (error) {
    console.error('Error removing project from localStorage:', error);
  }
}

/**
 * Optional: Mirror project to backend (fire-and-forget)
 */
export async function mirrorToBackend(project: ProjectSummary): Promise<void> {
  try {
    // Use centralized API configuration
    const API_BASE_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3003'
    await fetch(`${API_BASE_URL}/api/projects/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project)
    });
  } catch (error) {
    // Silently fail - backend mirroring is optional
    console.debug('Backend mirror failed (non-critical):', error);
  }
}