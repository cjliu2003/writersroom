import { Editor } from "slate"
import { ScreenplayElement, CustomText } from "@/types/screenplay"
import { SceneMemory } from "../../shared/types"

export type SceneDescription = {
  id: number
  slugline: string
  sceneText: string
  summary: string
  tokenCount: number
  runtime: string
  isInProgress?: boolean
}

// Helper to convert SceneMemory to SceneDescription for UI compatibility
export const sceneMemoryToDescription = (memory: SceneMemory, id: number, isInProgress = false): SceneDescription => ({
  id,
  slugline: memory.slugline,
  sceneText: '', // Scene text not stored in memory, would need to be reconstructed
  summary: memory.summary,
  tokenCount: memory.tokens || 0,
  runtime: `${((memory.tokens || 0) / 250).toFixed(1)} min`,
  isInProgress
})

const summarizeScene = (sceneText: string): string => {
  // If scene is empty or only has heading, return appropriate message
  if (!sceneText.trim() || sceneText.trim().length < 10) {
    return "Scene in progress..."
  }

  const mockSummaries = [
    "A tense confrontation reveals hidden motivations and sets the stage for conflict.",
    "Characters gather to discuss their next move while tension builds in the background.",
    "An unexpected revelation changes everything the characters thought they knew.",
    "A quiet moment of reflection before the storm of events that will follow.",
    "Action-packed sequence that raises the stakes and pushes characters to their limits.",
    "Dialogue-heavy scene exploring relationships and character development.",
    "A pivotal decision is made that will affect the rest of the story.",
    "Mysterious circumstances create uncertainty and drive the plot forward.",
    "Characters confront their past and face difficult truths.",
    "A dramatic turning point that changes the direction of the story.",
    "Emotional dialogue reveals character backstory and motivation.",
    "Suspenseful sequence building toward a major plot point.",
    "Characters must work together to overcome a shared obstacle.",
    "A moment of vulnerability shows a character's true nature.",
    "Rising tension culminates in an important decision."
  ]

  // Create a consistent hash from the scene text
  const hash = sceneText.split('').reduce((a, b) => {
    a = ((a << 5) - a) + b.charCodeAt(0)
    return a & a
  }, 0)

  return mockSummaries[Math.abs(hash) % mockSummaries.length]
}

const calculateTokenCount = (text: string): number => {
  // Estimate tokens using word count × 1.3 (as specified)
  const words = text.trim().split(/\s+/).filter(word => word.length > 0)
  return Math.ceil(words.length * 1.3)
}

const calculateRuntime = (tokenCount: number): string => {
  // Tokens ÷ 250 = minutes, rounded to 1 decimal place
  const minutes = Math.max(0.1, tokenCount / 250)
  return `${minutes.toFixed(1)} min`
}

const getElementText = (element: ScreenplayElement): string => {
  // Extract text from all children of the element
  return element.children.map((child: CustomText) => child.text).join('')
}

export const extractScenesFromEditor = (editorValue: ScreenplayElement[]): SceneDescription[] => {
  if (!editorValue || editorValue.length === 0) {
    return []
  }

  const scenes: SceneDescription[] = []
  let currentScene: {
    slugline: string
    elements: ScreenplayElement[]
  } | null = null
  let sceneId = 1

  // Iterate through all editor elements
  for (let i = 0; i < editorValue.length; i++) {
    const element = editorValue[i]
    
    if (element.type === 'scene_heading') {
      // If we have a previous scene, finalize it (it's no longer in progress)
      if (currentScene) {
        const sceneText = currentScene.elements
          .map(el => getElementText(el))
          .join('\n')
          .trim()

        const tokenCount = calculateTokenCount(sceneText)

        scenes.push({
          id: sceneId++,
          slugline: currentScene.slugline,
          sceneText: sceneText,
          summary: summarizeScene(sceneText),
          tokenCount: tokenCount,
          runtime: calculateRuntime(tokenCount),
          isInProgress: false
        })
      }

      // Start new scene
      const slugline = getElementText(element).trim()
      currentScene = {
        slugline: slugline || 'UNTITLED SCENE',
        elements: []
      }
    } else if (currentScene) {
      // Add element to current scene
      currentScene.elements.push(element)
    }
    // If no current scene and element is not scene_heading, we ignore it
    // (content before first scene heading)
  }

  // Handle the last scene - this one is still in progress
  if (currentScene) {
    const sceneText = currentScene.elements
      .map(el => getElementText(el))
      .join('\n')
      .trim()

    // If there's content after the scene heading, it's a scene in progress
    // If no content, still show as in progress but with different messaging
    const hasContent = sceneText.trim().length > 0

    scenes.push({
      id: sceneId,
      slugline: currentScene.slugline,
      sceneText: sceneText,
      summary: hasContent ? "Scene in progress..." : "Scene in progress...",
      tokenCount: hasContent ? calculateTokenCount(sceneText) : 0,
      runtime: hasContent ? calculateRuntime(calculateTokenCount(sceneText)) : "0.0 min",
      isInProgress: true
    })
  }

  return scenes
}

// Utility function to get Slate editor value from content string
export const parseEditorContent = (content: string): ScreenplayElement[] => {
  if (!content) {
    return []
  }

  try {
    const parsedContent = JSON.parse(content)
    if (Array.isArray(parsedContent)) {
      return parsedContent as ScreenplayElement[]
    }
  } catch (error) {
    console.warn('Failed to parse editor content:', error)
  }

  return []
}