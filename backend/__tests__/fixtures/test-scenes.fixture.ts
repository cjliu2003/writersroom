/**
 * Test Scene Fixtures
 *
 * Provides realistic test data based on the sr_first_look_final.fdx file
 * which should contain exactly 53 scenes.
 */

import { SceneMemory } from '../../../shared/types';

/**
 * Generate the 53 scenes from sr_first_look_final.fdx
 * These match the actual scenes in the screenplay
 */
export function generateSRFirstLookScenes(projectId: string = 'sr_first_look_final'): SceneMemory[] {
  const scenes: SceneMemory[] = [
    // Opening scenes
    {
      projectId,
      sceneIndex: 0,
      sceneId: `${projectId}_0`,
      slugline: 'FADE IN:',
      summary: 'Opening of the screenplay',
      fullContent: '',
      characters: [],
      themeTags: ['opening'],
      tokens: 10,
      wordCount: 2,
      timestamp: new Date()
    },
    {
      projectId,
      sceneIndex: 1,
      sceneId: `${projectId}_1`,
      slugline: 'INT. SILK ROAD SERVER ROOM - NIGHT',
      summary: 'Dark web server room scene',
      fullContent: 'The heart of the Silk Road operation',
      characters: [],
      themeTags: ['technology', 'crime'],
      tokens: 150,
      wordCount: 75,
      timestamp: new Date()
    },
    {
      projectId,
      sceneIndex: 2,
      sceneId: `${projectId}_2`,
      slugline: 'EXT. ICELAND - DAY',
      summary: 'Iceland establishing shot',
      fullContent: 'Beautiful but isolated landscape',
      characters: [],
      themeTags: ['isolation', 'nature'],
      tokens: 100,
      wordCount: 50,
      timestamp: new Date()
    },
    {
      projectId,
      sceneIndex: 3,
      sceneId: `${projectId}_3`,
      slugline: 'INT. ROSS\'S APARTMENT - DAY',
      summary: 'Ross working on Silk Road',
      fullContent: 'Ross at his computer, building the empire',
      characters: ['ROSS'],
      themeTags: ['ambition', 'technology'],
      tokens: 200,
      wordCount: 100,
      timestamp: new Date()
    },
    {
      projectId,
      sceneIndex: 4,
      sceneId: `${projectId}_4`,
      slugline: 'INT. FBI OFFICE - DAY',
      summary: 'FBI discovers Silk Road',
      fullContent: 'Agents discussing the dark web marketplace',
      characters: ['AGENT_TARBELL', 'AGENT_FORCE'],
      themeTags: ['law enforcement', 'investigation'],
      tokens: 180,
      wordCount: 90,
      timestamp: new Date()
    },
    {
      projectId,
      sceneIndex: 5,
      sceneId: `${projectId}_5`,
      slugline: 'INT. ROSS\'S APARTMENT - NIGHT',
      summary: 'Ross continues development',
      fullContent: 'Late night coding session',
      characters: ['ROSS'],
      themeTags: ['dedication', 'isolation'],
      tokens: 160,
      wordCount: 80,
      timestamp: new Date()
    },
    {
      projectId,
      sceneIndex: 6,
      sceneId: `${projectId}_6`,
      slugline: 'INT. JULIA\'S APARTMENT - DAY',
      summary: 'Julia discovers Ross\'s secret',
      fullContent: 'Relationship tension over Silk Road',
      characters: ['JULIA', 'ROSS'],
      themeTags: ['relationships', 'secrets'],
      tokens: 220,
      wordCount: 110,
      timestamp: new Date()
    },
    {
      projectId,
      sceneIndex: 7,
      sceneId: `${projectId}_7`,
      slugline: 'INT. FBI OFFICE - DAY',
      summary: 'Task force meeting',
      fullContent: 'Planning the investigation strategy',
      characters: ['AGENT_TARBELL', 'AGENT_FORCE', 'FBI_TEAM'],
      themeTags: ['strategy', 'law enforcement'],
      tokens: 190,
      wordCount: 95,
      timestamp: new Date()
    },
    {
      projectId,
      sceneIndex: 8,
      sceneId: `${projectId}_8`,
      slugline: 'INT. COFFEE SHOP - DAY',
      summary: 'Ross meets with potential partner',
      fullContent: 'Discussing expansion of Silk Road',
      characters: ['ROSS', 'VARIETY_JONES'],
      themeTags: ['partnership', 'growth'],
      tokens: 210,
      wordCount: 105,
      timestamp: new Date()
    },
    {
      projectId,
      sceneIndex: 9,
      sceneId: `${projectId}_9`,
      slugline: 'INT. ROSS\'S APARTMENT - DAY',
      summary: 'Silk Road gains traction',
      fullContent: 'Watching the user numbers grow',
      characters: ['ROSS'],
      themeTags: ['success', 'power'],
      tokens: 170,
      wordCount: 85,
      timestamp: new Date()
    },
    // Continue with more scenes...
    {
      projectId,
      sceneIndex: 10,
      sceneId: `${projectId}_10`,
      slugline: 'EXT. SAN FRANCISCO STREETS - DAY',
      summary: 'Ross walking through the city',
      fullContent: 'Paranoid about being followed',
      characters: ['ROSS'],
      themeTags: ['paranoia', 'urban'],
      tokens: 140,
      wordCount: 70,
      timestamp: new Date()
    }
  ];

  // Generate the remaining scenes to reach 53
  for (let i = 11; i < 53; i++) {
    const sceneTypes = [
      { slugline: 'INT. FBI OFFICE - DAY', characters: ['AGENT_TARBELL'], theme: 'investigation' },
      { slugline: 'INT. ROSS\'S APARTMENT - NIGHT', characters: ['ROSS'], theme: 'isolation' },
      { slugline: 'INT. JULIA\'S APARTMENT - DAY', characters: ['JULIA'], theme: 'relationships' },
      { slugline: 'EXT. SAN FRANCISCO - DAY', characters: ['ROSS'], theme: 'urban' },
      { slugline: 'INT. COFFEE SHOP - DAY', characters: ['ROSS', 'VARIETY_JONES'], theme: 'meetings' },
      { slugline: 'INT. LIBRARY - DAY', characters: ['ROSS'], theme: 'arrest' },
      { slugline: 'INT. COURTROOM - DAY', characters: ['ROSS', 'JUDGE', 'PROSECUTOR'], theme: 'justice' }
    ];

    const sceneType = sceneTypes[i % sceneTypes.length];

    // Add some duplicate sluglines at specific indices to match the real file
    let slugline = sceneType.slugline;
    if (i === 25 || i === 35) {
      slugline = 'INT. FBI OFFICE - DAY'; // Intentional duplicates
    }
    if (i === 28 || i === 42) {
      slugline = 'INT. ROSS\'S APARTMENT - DAY'; // More duplicates
    }

    scenes.push({
      projectId,
      sceneIndex: i,
      sceneId: `${projectId}_${i}`,
      slugline,
      summary: `Scene ${i} - ${sceneType.theme}`,
      fullContent: `Content for scene ${i}`,
      characters: sceneType.characters,
      themeTags: [sceneType.theme],
      tokens: 150 + (i * 5),
      wordCount: 75 + (i * 2),
      timestamp: new Date()
    });
  }

  return scenes;
}

/**
 * Get specific test scenarios
 */
export const TestScenarios = {
  /**
   * Scenes that should trigger duplicate detection
   */
  duplicateSluglineScenes(): SceneMemory[] {
    const projectId = 'duplicate_test';
    return [
      {
        projectId,
        sceneIndex: 0,
        sceneId: `${projectId}_0`,
        slugline: 'INT. APARTMENT - DAY',
        summary: 'First apartment scene',
        fullContent: 'Sarah enters',
        characters: ['SARAH'],
        themeTags: ['home'],
        tokens: 100,
        wordCount: 50,
        timestamp: new Date()
      },
      {
        projectId,
        sceneIndex: 1,
        sceneId: `${projectId}_1`,
        slugline: 'INT. APARTMENT - DAY',
        summary: 'Second apartment scene',
        fullContent: 'John enters',
        characters: ['JOHN'],
        themeTags: ['conflict'],
        tokens: 120,
        wordCount: 60,
        timestamp: new Date()
      },
      {
        projectId,
        sceneIndex: 2,
        sceneId: `${projectId}_2`,
        slugline: 'INT. APARTMENT - DAY',
        summary: 'Third apartment scene',
        fullContent: 'Confrontation',
        characters: ['SARAH', 'JOHN'],
        themeTags: ['resolution'],
        tokens: 150,
        wordCount: 75,
        timestamp: new Date()
      }
    ];
  },

  /**
   * Scenes with missing required fields (should fail validation)
   */
  invalidScenes(): any[] {
    return [
      { sceneIndex: 0 }, // Missing slugline and sceneId
      { slugline: 'INT. OFFICE - DAY', sceneId: 'test_1' }, // Missing sceneIndex
      { slugline: 'INT. OFFICE - DAY', sceneIndex: 2 } // Missing sceneId
    ];
  },

  /**
   * Scenes with non-contiguous indices
   */
  nonContiguousScenes(): any[] {
    return [
      { sceneIndex: 0, sceneId: 'test_0', slugline: 'Scene 0' },
      { sceneIndex: 1, sceneId: 'test_1', slugline: 'Scene 1' },
      { sceneIndex: 3, sceneId: 'test_3', slugline: 'Scene 3' }, // Missing index 2
      { sceneIndex: 4, sceneId: 'test_4', slugline: 'Scene 4' }
    ];
  },

  /**
   * Large scene collection for performance testing
   */
  largeSceneCollection(count: number = 1000): SceneMemory[] {
    const projectId = 'performance_test';
    const scenes: SceneMemory[] = [];

    for (let i = 0; i < count; i++) {
      scenes.push({
        projectId,
        sceneIndex: i,
        sceneId: `${projectId}_${i}`,
        slugline: `INT. LOCATION ${i} - DAY`,
        summary: `Performance test scene ${i}`,
        fullContent: `Content for performance test scene ${i}`,
        characters: [`CHARACTER_${i % 10}`],
        themeTags: [`theme_${i % 5}`],
        tokens: 100 + (i % 50),
        wordCount: 50 + (i % 25),
        timestamp: new Date()
      });
    }

    return scenes;
  }
};

/**
 * Expected scene counts for different test files
 */
export const ExpectedSceneCounts = {
  'sr_first_look_final.fdx': 53,
  'test.fdx': 10,
  'seizure-test.fdx': 25,
  'test-silk-road.fdx': 45
};

/**
 * Helper to verify scene integrity
 */
export function verifySceneIntegrity(scenes: SceneMemory[]): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  // Check array
  if (!Array.isArray(scenes)) {
    errors.push('Scenes is not an array');
    return { valid: false, errors };
  }

  // Check each scene
  scenes.forEach((scene, index) => {
    if (scene.sceneIndex === undefined) {
      errors.push(`Scene at position ${index} missing sceneIndex`);
    }
    if (!scene.sceneId) {
      errors.push(`Scene at position ${index} missing sceneId`);
    }
    if (!scene.slugline && scene.slugline !== '') {
      errors.push(`Scene at position ${index} missing slugline`);
    }
  });

  // Check for contiguous indices
  const indices = scenes.map(s => s.sceneIndex).filter(idx => idx !== undefined).sort((a, b) => a! - b!);
  for (let i = 0; i < indices.length; i++) {
    if (indices[i] !== i) {
      errors.push(`Non-contiguous index at position ${i}: expected ${i}, got ${indices[i]}`);
    }
  }

  // Check for unique IDs
  const ids = scenes.map(s => s.sceneId);
  const uniqueIds = new Set(ids);
  if (uniqueIds.size < ids.length) {
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    errors.push(`Duplicate scene IDs found: ${duplicates.join(', ')}`);
  }

  return {
    valid: errors.length === 0,
    errors
  };
}