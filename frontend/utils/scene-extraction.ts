import { ScreenplayElement } from "@/types/screenplay";

export type SceneDescription = {
  id: number;
  slugline: string;
  sceneText: string;
  summary: string;
  tokenCount: number;
  runtime: string; // e.g. "1.2 min"
  isInProgress: boolean;
};

export function parseEditorContent(content: string | null | undefined): ScreenplayElement[] {
  try {
    if (!content) return [];
    const parsed = JSON.parse(content);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn("Failed to parse editor content:", err);
    return [];
  }
}

function wordCount(text: string): number {
  return text.trim() ? text.trim().split(/\s+/).length : 0;
}

function computeTokens(words: number): number {
  return Math.ceil(words * 1.3);
}

function computeRuntime(tokens: number): string {
  const minutes = Math.max(0, tokens / 250);
  return `${minutes.toFixed(1)} min`;
}

export function extractScenesFromEditor(value: ScreenplayElement[] | null | undefined): SceneDescription[] {
  if (!Array.isArray(value) || value.length === 0) return [];

  const scenes: SceneDescription[] = [];

  let currentSlug = "";
  let buffer: string[] = [];

  const flush = (isLast: boolean) => {
    if (!currentSlug) return;
    const text = buffer.join(" ").trim();
    const tokens = computeTokens(wordCount(text));
    const runtime = computeRuntime(tokens);
    const id = scenes.length + 1;
    scenes.push({
      id,
      slugline: currentSlug.trim() || "UNTITLED SCENE",
      sceneText: text,
      summary: text ? text : "Scene in progress...",
      tokenCount: tokens,
      runtime,
      isInProgress: isLast,
    });
  };

  for (const el of value) {
    if (!el || typeof el !== "object") continue;
    if (el.type === "scene_heading") {
      // close previous scene (not last yet)
      if (currentSlug) {
        flush(false);
      }
      const headingText = (el.children?.[0]?.text ?? "").toString();
      currentSlug = headingText.trim() || "UNTITLED SCENE";
      buffer = [];
      continue;
    }

    if (!currentSlug) {
      // ignore preface content until first scene heading
      continue;
    }

    const t = (el.children?.[0]?.text ?? "").toString();
    if (t) buffer.push(t);
  }

  // finalize last scene as in-progress
  if (currentSlug) flush(true);

  return scenes;
}

// Kept for compatibility with tests that may call this
export function sceneMemoryToDescription(memory: any, id: number, isInProgress: boolean): SceneDescription {
  const slugline = (memory?.slugline ?? "").toString() || "UNTITLED SCENE";
  const summary = (memory?.summary ?? "").toString();
  const tokens = typeof memory?.tokens === "number" ? memory.tokens : 0;
  const runtime = computeRuntime(tokens);
  return {
    id,
    slugline,
    sceneText: "", // memory format doesn’t store full text
    summary: summary || "Scene in progress...",
    tokenCount: tokens,
    runtime,
    isInProgress,
  };
}
