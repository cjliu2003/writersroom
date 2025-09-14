import { BaseEditor, Descendant } from 'slate'
import { ReactEditor } from 'slate-react'
import { HistoryEditor } from 'slate-history'

export type ScreenplayBlockType = 
  | 'scene_heading'
  | 'action'
  | 'character'
  | 'parenthetical'
  | 'dialogue'
  | 'transition'
  | 'shot'
  | 'general'
  | 'cast_list'
  | 'new_act'
  | 'end_of_act'
  | 'summary'

export interface ScreenplayElement {
  type: ScreenplayBlockType
  children: CustomText[]
  id?: string
  isDualDialogue?: boolean
  metadata?: {
    timestamp?: string
    uuid?: string
  }
}

export interface CustomText {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
}

export type CustomEditor = BaseEditor & ReactEditor & HistoryEditor

declare module 'slate' {
  interface CustomTypes {
    Editor: CustomEditor
    Element: ScreenplayElement
    Text: CustomText
  }
}

// Common Scene and Script types used across the app
export interface Scene {
  id: string
  heading: string
  content: string
}

export interface Script {
  id: string
  title: string
  scenes: Scene[]
  content: string
  createdAt: string
}

export interface ScreenplayDocument {
  id: string
  title: string
  author: string
  pages: ScreenplayPage[]
  createdAt: string
  updatedAt: string
  version: string
}

export interface ScreenplayPage {
  pageNumber: number
  blocks: ScreenplayElement[]
  scenes: string[]
  wordCount: number
}

export interface BlockTransition {
  from: ScreenplayBlockType
  to: ScreenplayBlockType
  trigger: 'enter' | 'tab' | 'empty_enter'
}

// ENTER key transitions (Final Draft behavior)
export const ENTER_TRANSITIONS: BlockTransition[] = [
  { from: 'scene_heading', to: 'action', trigger: 'enter' },
  { from: 'action', to: 'action', trigger: 'enter' },
  { from: 'character', to: 'dialogue', trigger: 'enter' },
  { from: 'dialogue', to: 'action', trigger: 'enter' },
  { from: 'parenthetical', to: 'dialogue', trigger: 'enter' },
  { from: 'transition', to: 'scene_heading', trigger: 'enter' },
  { from: 'shot', to: 'action', trigger: 'enter' },
  { from: 'cast_list', to: 'action', trigger: 'enter' },
  { from: 'new_act', to: 'scene_heading', trigger: 'enter' },
  { from: 'end_of_act', to: 'new_act', trigger: 'enter' },
  { from: 'summary', to: 'summary', trigger: 'enter' },
  { from: 'general', to: 'general', trigger: 'enter' },
  
  // Special cases for empty blocks
  { from: 'character', to: 'action', trigger: 'empty_enter' },
  { from: 'dialogue', to: 'character', trigger: 'empty_enter' }
]

// TAB key transitions (Final Draft behavior)
export const TAB_TRANSITIONS: BlockTransition[] = [
  { from: 'scene_heading', to: 'action', trigger: 'tab' },
  { from: 'action', to: 'character', trigger: 'tab' },
  { from: 'character', to: 'transition', trigger: 'tab' }, // when empty
  { from: 'transition', to: 'scene_heading', trigger: 'tab' },
  { from: 'dialogue', to: 'parenthetical', trigger: 'tab' },
  { from: 'parenthetical', to: 'dialogue', trigger: 'tab' },
  { from: 'shot', to: 'action', trigger: 'tab' },
  { from: 'general', to: 'action', trigger: 'tab' }
]

// Command+Digit shortcuts mapping
export const COMMAND_SHORTCUTS: Record<string, ScreenplayBlockType> = {
  '1': 'scene_heading',
  '2': 'action', 
  '3': 'character',
  '4': 'parenthetical',
  '5': 'dialogue',
  '6': 'transition',
  '7': 'shot',
  '8': 'cast_list',
  '9': 'new_act',
  '0': 'general'
}