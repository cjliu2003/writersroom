"use client"

import React, { useState, useEffect } from 'react';
import { FileText, Clock, Users, Sparkles } from 'lucide-react';
import type { SceneBoundary } from '@/utils/scene-boundary-tracker';
import { generateSceneSummary, type ScriptWithContent } from '@/lib/api';

interface ScriptSceneSidebarProps {
  scenes: SceneBoundary[];
  onSceneClick: (sceneIndex: number) => void;
  currentSceneIndex: number | null;
  className?: string;
  scriptContent?: any[]; // Script content blocks for generating summaries
  scriptId?: string; // Required for AI summary generation
  script?: ScriptWithContent; // Full script data including scene_summaries
}

export function ScriptSceneSidebar({
  scenes,
  onSceneClick,
  currentSceneIndex,
  className = '',
  scriptContent = [],
  scriptId,
  script,
}: ScriptSceneSidebarProps) {
  const [generatingSummaries, setGeneratingSummaries] = useState<Set<number>>(new Set());
  const [aiSummaries, setAiSummaries] = useState<Map<number, string>>(new Map());

  // Load persisted summaries from script.scene_summaries on mount
  useEffect(() => {
    if (!script?.scene_summaries || scenes.length === 0) return;

    const persistedSummaries = new Map<number, string>();
    scenes.forEach((scene, index) => {
      const summary = script.scene_summaries?.[scene.heading];
      if (summary) {
        persistedSummaries.set(index, summary);
      }
    });

    if (persistedSummaries.size > 0) {
      console.log('[ScriptSceneSidebar] Loaded persisted summaries:', persistedSummaries.size);
      setAiSummaries(persistedSummaries);
    }
  }, [script?.scene_summaries, scenes]);

  // Generate local summary from content blocks (fallback)
  const generateLocalSummary = (scene: SceneBoundary): string => {
    if (!scriptContent || scriptContent.length === 0) {
      return "Click to navigate to this scene";
    }

    try {
      // Extract content blocks for this scene
      const sceneBlocks = scriptContent.slice(scene.startIndex, scene.endIndex + 1);

      // Filter for action lines (not dialogue, character names, or scene headings)
      const actionBlocks = sceneBlocks.filter(block => {
        if (block.type === 'scene-heading') return false;
        if (block.type === 'character') return false;
        if (block.type === 'dialogue') return false;
        if (block.type === 'parenthetical') return false;
        if (block.type === 'action' && block.children && block.children[0]) {
          const text = block.children[0].text?.trim() || '';
          return text.length > 0;
        }
        return false;
      });

      if (actionBlocks.length === 0) return "New scene";

      // Take first meaningful action line
      const firstAction = actionBlocks[0].children?.[0]?.text?.trim() || '';
      return firstAction.length > 60 ? `${firstAction.substring(0, 57)}...` : firstAction;
    } catch (error) {
      console.warn('[SceneSidebar] Error generating summary:', error);
      return "Scene content";
    }
  };

  // Extract characters from scene content
  const extractCharacters = (scene: SceneBoundary): string[] => {
    if (!scriptContent || scriptContent.length === 0) return [];

    try {
      const sceneBlocks = scriptContent.slice(scene.startIndex, scene.endIndex + 1);
      const characters = new Set<string>();

      sceneBlocks.forEach(block => {
        if (block.type === 'character' && block.children && block.children[0]) {
          const characterName = block.children[0].text?.trim() || '';
          if (characterName) {
            characters.add(characterName);
          }
        }
      });

      return Array.from(characters).slice(0, 3); // Limit to 3 characters per scene
    } catch (error) {
      console.warn('[SceneSidebar] Error extracting characters:', error);
      return [];
    }
  };

  // Calculate scene word count and time estimate
  const calculateSceneStats = (scene: SceneBoundary): { wordCount: number; minutes: number } => {
    if (!scriptContent || scriptContent.length === 0) {
      return { wordCount: 0, minutes: 1 };
    }

    try {
      const sceneBlocks = scriptContent.slice(scene.startIndex, scene.endIndex + 1);
      let wordCount = 0;

      sceneBlocks.forEach(block => {
        if (block.children && block.children[0]) {
          const text = block.children[0].text || '';
          wordCount += text.split(/\s+/).filter((w: string) => w.length > 0).length;
        }
      });

      // Estimate: ~250 words per minute for screenplay content
      const minutes = Math.max(1, Math.ceil(wordCount / 250));
      return { wordCount, minutes };
    } catch (error) {
      console.warn('[SceneSidebar] Error calculating stats:', error);
      return { wordCount: 0, minutes: 1 };
    }
  };

  // Handle AI summary generation
  const handleGenerateAISummary = async (sceneIndex: number) => {
    if (!scriptId) {
      console.warn('[ScriptSceneSidebar] Cannot generate AI summary: scriptId is required');
      return;
    }

    const scene = scenes[sceneIndex];
    if (!scene) return;

    setGeneratingSummaries(prev => new Set(prev).add(sceneIndex));

    try {
      // Extract scene text from content blocks
      let sceneText = '';
      if (scriptContent && scriptContent.length > 0) {
        const sceneBlocks = scriptContent.slice(scene.startIndex, scene.endIndex + 1);
        sceneText = sceneBlocks
          .map(block => {
            if (block.children && block.children[0]) {
              return block.children[0].text || '';
            }
            return '';
          })
          .filter(text => text.trim().length > 0)
          .join('\n');
      }

      // Call AI service
      const response = await generateSceneSummary({
        script_id: scriptId,
        scene_index: sceneIndex,
        slugline: scene.heading,
        scene_text: sceneText
      });

      if (response.success && response.summary) {
        setAiSummaries(prev => new Map(prev).set(sceneIndex, response.summary!));
      } else {
        throw new Error(response.error || 'Failed to generate summary');
      }
    } catch (error) {
      console.error('[ScriptSceneSidebar] Error generating AI summary:', error);
      // Optionally show error to user
    } finally {
      setGeneratingSummaries(prev => {
        const next = new Set(prev);
        next.delete(sceneIndex);
        return next;
      });
    }
  };

  // Estimate runtime: ~1 minute per page, ~1 page per scene (rough estimate)
  const estimatedMinutes = Math.ceil(scenes.length * 1);
  const estimatedRuntime = estimatedMinutes >= 60
    ? `${Math.floor(estimatedMinutes / 60)}h ${estimatedMinutes % 60}m`
    : `${estimatedMinutes}m`;

  return (
    <div className={`h-full flex flex-col bg-white border-r border-gray-200 shadow-lg overflow-hidden ${className}`}>
      {/* Header */}
      <div className="border-b border-gray-200 bg-white p-4 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 bg-blue-100 rounded flex items-center justify-center">
            <FileText className="w-4 h-4 text-blue-600" />
          </div>
          <h3 className="font-semibold text-slate-700">Scene Navigation</h3>
        </div>
      </div>

      {/* Scene Count Info */}
      <div className="p-4 border-b border-gray-200 bg-gray-50/50">
        <div className="text-xs text-gray-600 space-y-2">
          <div className="flex justify-between items-center">
            <span>Total Scenes</span>
            <span className="font-medium text-slate-700 bg-white border border-gray-200 px-2 py-1 rounded shadow-sm">
              {scenes.length}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span>Estimated Runtime</span>
            <span className="font-medium text-slate-700 bg-white border border-gray-200 px-2 py-1 rounded shadow-sm flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {estimatedRuntime}
            </span>
          </div>
        </div>
      </div>

      {/* Scene List - Enhanced with Independent Scrolling */}
      <div className="flex-1 overflow-hidden relative">
        <div className="h-full overflow-y-auto hover:overflow-y-scroll">
          <div className="p-4 space-y-3">
            {scenes.length === 0 ? (
              <div className="p-6 text-center">
                <div className="w-12 h-12 bg-gray-100 rounded-lg flex items-center justify-center mx-auto mb-3 shadow-sm">
                  <FileText className="w-6 h-6 text-gray-400" />
                </div>
                <p className="text-sm text-gray-500 mb-2 font-medium">No scenes yet</p>
                <p className="text-xs text-gray-400 leading-relaxed">
                  Start writing with scene headings like:<br />
                  <code className="bg-gray-100 border border-gray-200 px-2 py-1 rounded text-xs mt-2 inline-block shadow-sm">
                    INT. COFFEE SHOP - DAY
                  </code>
                </p>
              </div>
            ) : (
              scenes.map((scene, index) => {
                const isActive = currentSceneIndex === index;
                const aiSummary = aiSummaries.get(index);
                const localSummary = generateLocalSummary(scene);
                const summary = aiSummary || localSummary;
                const characters = extractCharacters(scene);
                const stats = calculateSceneStats(scene);
                const isGenerating = generatingSummaries.has(index);

                return (
                  <div
                    key={`scene-${index}-${scene.startIndex}`}
                    className={`p-4 rounded-lg border transition-all duration-200 cursor-pointer group ${
                      isActive
                        ? 'bg-blue-50 border-blue-200 shadow-md ring-2 ring-blue-100'
                        : 'bg-white border-gray-200 shadow-sm hover:bg-gray-50 hover:shadow-lg hover:border-gray-300 hover:-translate-y-0.5'
                    }`}
                    onClick={() => onSceneClick(index)}
                  >
                    {/* Scene Number & Heading */}
                    <div className="flex items-start gap-3 mb-3">
                      <div className={`w-6 h-6 rounded flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors ${
                        isActive
                          ? 'bg-blue-200'
                          : 'bg-blue-100 group-hover:bg-blue-200'
                      }`}>
                        <span className="text-xs font-semibold text-blue-700">{index + 1}</span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="text-sm font-medium text-slate-800 mb-1 leading-tight group-hover:text-slate-900">
                          {scene.heading || 'Untitled Scene'}
                        </h4>
                        <p className="text-xs text-gray-600 leading-relaxed group-hover:text-gray-700">
                          {summary}
                        </p>
                      </div>
                    </div>

                    {/* Scene Metadata */}
                    <div className="space-y-1.5 text-xs text-gray-500 group-hover:text-gray-600">
                      {/* Runtime */}
                      <div className="flex items-center gap-1">
                        <Clock className="w-3 h-3 flex-shrink-0" />
                        <span>{stats.minutes} min</span>
                      </div>

                      {/* Characters - allow wrapping */}
                      {characters.length > 0 && (
                        <div className="flex items-start gap-1">
                          <Users className="w-3 h-3 flex-shrink-0 mt-0.5" />
                          <span className="break-words leading-relaxed">
                            {characters.join(', ')}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* AI Summary Button - TEMPORARILY DISABLED
                        TODO: Re-enable once race condition issues are fully resolved
                        Uncomment the button below to re-enable AI summary generation
                    */}
                    {/* <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleGenerateAISummary(index);
                      }}
                      disabled={isGenerating}
                      className="w-full mt-2 px-2 py-1.5 text-xs bg-gradient-to-r from-purple-50 to-blue-50 hover:from-purple-100 hover:to-blue-100 border border-purple-200 rounded text-purple-700 hover:text-purple-800 transition-all duration-200 flex items-center justify-center gap-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <Sparkles className={`w-3 h-3 ${isGenerating ? 'animate-spin' : ''}`} />
                      {isGenerating ? 'Generating...' : 'Generate AI Summary'}
                    </button> */}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Scroll Fade Indicators */}
        {scenes.length > 3 && (
          <>
            <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-gray-50 to-transparent pointer-events-none"></div>
            <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-gray-50 to-transparent pointer-events-none"></div>
          </>
        )}
      </div>

      {/* Footer with Visual Enhancement */}
      <div className="p-4 border-t border-gray-200 bg-gray-50/50">
        <div className="text-xs text-gray-500 text-center flex items-center justify-center gap-1">
          <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
          <span>Click to navigate</span>
          <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
          <span>Always visible</span>
          <div className="w-1 h-1 bg-gray-400 rounded-full"></div>
        </div>
      </div>
    </div>
  );
}
