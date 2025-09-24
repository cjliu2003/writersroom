/**
 * Unit Tests for Memory API Client
 *
 * Tests the frontend Memory API client that interfaces with the backend
 * for scene memory operations, including CRUD operations, error handling,
 * and response validation.
 */

import { MemoryAPI, useMemoryAPI } from '@/utils/memoryAPI';
import { SceneMemory, MemoryStats } from '../../../shared/types';

// Mock fetch globally
global.fetch = jest.fn();

describe('Memory API Client', () => {
  const mockProjectId = 'test-project-123';
  const mockSlugline = 'INT. OFFICE - DAY';

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockClear();
  });

  describe('updateSceneMemory', () => {
    it('should update scene memory successfully', async () => {
      const mockResponse: SceneMemory = {
        projectId: mockProjectId,
        slugline: mockSlugline,
        summary: 'Office scene summary',
        tokens: 150,
        characters: ['JOHN', 'SARAH'],
        themes: ['business', 'conflict'],
        lastAccessed: new Date(),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: mockResponse,
        }),
      });

      const result = await MemoryAPI.updateSceneMemory(
        mockProjectId,
        mockSlugline,
        {
          summary: 'Office scene summary',
          tokens: 150,
          characters: ['JOHN', 'SARAH'],
          themes: ['business', 'conflict'],
        }
      );

      expect(result).toEqual(mockResponse);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/memory/update',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            projectId: mockProjectId,
            slugline: mockSlugline,
            data: {
              summary: 'Office scene summary',
              tokens: 150,
              characters: ['JOHN', 'SARAH'],
              themes: ['business', 'conflict'],
            },
          }),
        })
      );
    });

    it('should handle update failure with no data', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: null,
        }),
      });

      await expect(
        MemoryAPI.updateSceneMemory(mockProjectId, mockSlugline, {})
      ).rejects.toThrow('No scene data returned from update');
    });

    it('should handle HTTP errors', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await expect(
        MemoryAPI.updateSceneMemory(mockProjectId, mockSlugline, {})
      ).rejects.toThrow('HTTP error! status: 500');
    });

    it('should handle API error responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: false,
          message: 'Database connection failed',
        }),
      });

      await expect(
        MemoryAPI.updateSceneMemory(mockProjectId, mockSlugline, {})
      ).rejects.toThrow('Database connection failed');
    });

    it('should handle network failures', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      await expect(
        MemoryAPI.updateSceneMemory(mockProjectId, mockSlugline, {})
      ).rejects.toThrow('Network error');
    });
  });

  describe('getRecentScenes', () => {
    it('should retrieve recent scenes with default count', async () => {
      const mockScenes: SceneMemory[] = [
        {
          projectId: mockProjectId,
          slugline: 'INT. ROOM 1 - DAY',
          summary: 'Scene 1',
          tokens: 100,
          characters: [],
          themes: [],
          lastAccessed: new Date(),
        },
        {
          projectId: mockProjectId,
          slugline: 'INT. ROOM 2 - DAY',
          summary: 'Scene 2',
          tokens: 200,
          characters: [],
          themes: [],
          lastAccessed: new Date(),
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: mockScenes,
        }),
      });

      const result = await MemoryAPI.getRecentScenes(mockProjectId);

      expect(result).toEqual(mockScenes);
      expect(global.fetch).toHaveBeenCalledWith(
        `http://localhost:3001/api/memory/recent?projectId=${encodeURIComponent(
          mockProjectId
        )}&count=3`,
        expect.objectContaining({
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should retrieve recent scenes with custom count', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [],
        }),
      });

      await MemoryAPI.getRecentScenes(mockProjectId, 5);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('&count=5'),
        expect.anything()
      );
    });

    it('should handle empty response data', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: null,
        }),
      });

      const result = await MemoryAPI.getRecentScenes(mockProjectId);
      expect(result).toEqual([]);
    });
  });

  describe('getSceneBySlugline', () => {
    it('should retrieve scene by slugline', async () => {
      const mockScene: SceneMemory = {
        projectId: mockProjectId,
        slugline: mockSlugline,
        summary: 'Scene summary',
        tokens: 150,
        characters: ['JOHN'],
        themes: ['drama'],
        lastAccessed: new Date(),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: mockScene,
        }),
      });

      const result = await MemoryAPI.getSceneBySlugline(mockProjectId, mockSlugline);

      expect(result).toEqual(mockScene);
      expect(global.fetch).toHaveBeenCalledWith(
        `http://localhost:3001/api/memory/by-slugline?projectId=${encodeURIComponent(
          mockProjectId
        )}&slugline=${encodeURIComponent(mockSlugline)}`,
        expect.anything()
      );
    });

    it('should return undefined when scene not found', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: undefined,
        }),
      });

      const result = await MemoryAPI.getSceneBySlugline(mockProjectId, 'NONEXISTENT');
      expect(result).toBeUndefined();
    });

    it('should handle special characters in slugline', async () => {
      const specialSlugline = 'INT./EXT. CAFÉ - DAY/NIGHT';

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: null,
        }),
      });

      await MemoryAPI.getSceneBySlugline(mockProjectId, specialSlugline);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining(encodeURIComponent(specialSlugline)),
        expect.anything()
      );
    });
  });

  describe('getScenesByCharacter', () => {
    it('should retrieve scenes by character name', async () => {
      const mockScenes: SceneMemory[] = [
        {
          projectId: mockProjectId,
          slugline: 'INT. SCENE 1 - DAY',
          summary: 'John appears',
          tokens: 100,
          characters: ['JOHN', 'MARY'],
          themes: [],
          lastAccessed: new Date(),
        },
        {
          projectId: mockProjectId,
          slugline: 'INT. SCENE 2 - NIGHT',
          summary: 'John talks',
          tokens: 200,
          characters: ['JOHN', 'PETER'],
          themes: [],
          lastAccessed: new Date(),
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: mockScenes,
        }),
      });

      const result = await MemoryAPI.getScenesByCharacter(mockProjectId, 'JOHN');

      expect(result).toEqual(mockScenes);
      expect(global.fetch).toHaveBeenCalledWith(
        `http://localhost:3001/api/memory/by-character?projectId=${encodeURIComponent(
          mockProjectId
        )}&name=${encodeURIComponent('JOHN')}`,
        expect.anything()
      );
    });

    it('should handle empty results', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [],
        }),
      });

      const result = await MemoryAPI.getScenesByCharacter(mockProjectId, 'UNKNOWN');
      expect(result).toEqual([]);
    });
  });

  describe('getScenesByTheme', () => {
    it('should retrieve scenes by theme', async () => {
      const mockScenes: SceneMemory[] = [
        {
          projectId: mockProjectId,
          slugline: 'INT. COURTROOM - DAY',
          summary: 'Legal drama unfolds',
          tokens: 300,
          characters: [],
          themes: ['justice', 'conflict'],
          lastAccessed: new Date(),
        },
      ];

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: mockScenes,
        }),
      });

      const result = await MemoryAPI.getScenesByTheme(mockProjectId, 'justice');

      expect(result).toEqual(mockScenes);
      expect(global.fetch).toHaveBeenCalledWith(
        `http://localhost:3001/api/memory/by-theme?projectId=${encodeURIComponent(
          mockProjectId
        )}&theme=${encodeURIComponent('justice')}`,
        expect.anything()
      );
    });
  });

  describe('getTotalRecentTokens', () => {
    it('should retrieve total token count for recent scenes', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: 750,
        }),
      });

      const result = await MemoryAPI.getTotalRecentTokens(mockProjectId);

      expect(result).toBe(750);
      expect(global.fetch).toHaveBeenCalledWith(
        `http://localhost:3001/api/memory/tokens?projectId=${encodeURIComponent(
          mockProjectId
        )}&sceneCount=3`,
        expect.anything()
      );
    });

    it('should handle custom scene count', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: 1000,
        }),
      });

      await MemoryAPI.getTotalRecentTokens(mockProjectId, 5);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('&sceneCount=5'),
        expect.anything()
      );
    });

    it('should return 0 when no data', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: null,
        }),
      });

      const result = await MemoryAPI.getTotalRecentTokens(mockProjectId);
      expect(result).toBe(0);
    });
  });

  describe('getAllScenes', () => {
    it('should retrieve all scenes for a project', async () => {
      const mockScenes: SceneMemory[] = Array.from({ length: 10 }, (_, i) => ({
        projectId: mockProjectId,
        slugline: `INT. SCENE ${i + 1} - DAY`,
        summary: `Scene ${i + 1} summary`,
        tokens: (i + 1) * 100,
        characters: [],
        themes: [],
        lastAccessed: new Date(),
      }));

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: mockScenes,
        }),
      });

      const result = await MemoryAPI.getAllScenes(mockProjectId);

      expect(result).toEqual(mockScenes);
      expect(result).toHaveLength(10);
    });
  });

  describe('getMemoryStats', () => {
    it('should retrieve memory statistics', async () => {
      const mockStats: MemoryStats = {
        totalScenes: 25,
        totalTokens: 5000,
        averageTokensPerScene: 200,
        uniqueCharacters: 15,
        uniqueThemes: 8,
        lastUpdated: new Date(),
      };

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: mockStats,
        }),
      });

      const result = await MemoryAPI.getMemoryStats(mockProjectId);

      expect(result).toEqual(mockStats);
    });

    it('should handle missing stats data', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: null,
        }),
      });

      await expect(MemoryAPI.getMemoryStats(mockProjectId)).rejects.toThrow(
        'No stats data returned'
      );
    });
  });

  describe('clearSceneMemory', () => {
    it('should clear all memory for a project', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
        }),
      });

      await MemoryAPI.clearSceneMemory(mockProjectId);

      expect(global.fetch).toHaveBeenCalledWith(
        `http://localhost:3001/api/memory/clear?projectId=${encodeURIComponent(
          mockProjectId
        )}`,
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });

    it('should handle clear failure', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
        status: 403,
      });

      await expect(MemoryAPI.clearSceneMemory(mockProjectId)).rejects.toThrow(
        'HTTP error! status: 403'
      );
    });
  });

  describe('deleteScene', () => {
    it('should delete a specific scene', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
        }),
      });

      await MemoryAPI.deleteScene(mockProjectId, mockSlugline);

      expect(global.fetch).toHaveBeenCalledWith(
        `http://localhost:3001/api/memory/scene?projectId=${encodeURIComponent(
          mockProjectId
        )}&slugline=${encodeURIComponent(mockSlugline)}`,
        expect.objectContaining({
          method: 'DELETE',
        })
      );
    });
  });

  describe('healthCheck', () => {
    it('should return true when API is available', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
      });

      const result = await MemoryAPI.healthCheck();

      expect(result).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith(
        'http://localhost:3001/api/health',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });

    it('should return false when API is unavailable', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: false,
      });

      const result = await MemoryAPI.healthCheck();
      expect(result).toBe(false);
    });

    it('should return false on network error', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('Network error'));

      const result = await MemoryAPI.healthCheck();
      expect(result).toBe(false);
    });
  });

  describe('useMemoryAPI Hook', () => {
    it('should provide bound API methods', async () => {
      const api = useMemoryAPI(mockProjectId);

      // Mock for updateScene
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: {
            projectId: mockProjectId,
            slugline: mockSlugline,
            summary: 'Updated',
          },
        }),
      });

      const updateResult = await api.updateScene(mockSlugline, { summary: 'Updated' });
      expect(updateResult.summary).toBe('Updated');

      // Mock for getRecent
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [],
        }),
      });

      const recentResult = await api.getRecent(5);
      expect(recentResult).toEqual([]);
    });

    it('should bind all methods with correct projectId', () => {
      const api = useMemoryAPI(mockProjectId);

      expect(api.updateScene).toBeDefined();
      expect(api.getRecent).toBeDefined();
      expect(api.getByCharacter).toBeDefined();
      expect(api.getByTheme).toBeDefined();
      expect(api.getStats).toBeDefined();
      expect(api.clearMemory).toBeDefined();
      expect(api.deleteScene).toBeDefined();
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should handle malformed JSON responses', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => {
          throw new Error('Invalid JSON');
        },
      });

      await expect(MemoryAPI.getAllScenes(mockProjectId)).rejects.toThrow('Invalid JSON');
    });

    it('should handle timeout scenarios', async () => {
      (global.fetch as jest.Mock).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                ok: false,
                status: 408,
              });
            }, 100);
          })
      );

      await expect(MemoryAPI.getAllScenes(mockProjectId)).rejects.toThrow(
        'HTTP error! status: 408'
      );
    });

    it('should use environment variable for API URL when available', async () => {
      const originalEnv = process.env.NEXT_PUBLIC_API_URL;
      process.env.NEXT_PUBLIC_API_URL = 'https://api.example.com';

      // Re-import to get the new API_BASE_URL
      jest.resetModules();
      const { MemoryAPI: FreshMemoryAPI } = await import('@/utils/memoryAPI');

      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          data: [],
        }),
      });

      await FreshMemoryAPI.getAllScenes(mockProjectId);

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('https://api.example.com'),
        expect.anything()
      );

      process.env.NEXT_PUBLIC_API_URL = originalEnv;
    });
  });
});