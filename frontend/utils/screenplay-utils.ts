import { Editor, Element, Transforms, Range, Point, Text } from 'slate'
import { ReactEditor } from 'slate-react'
import { 
  ScreenplayBlockType, 
  ScreenplayElement, 
  CustomEditor,
  CustomText,
  ENTER_TRANSITIONS,
  TAB_TRANSITIONS,
  COMMAND_SHORTCUTS
} from '@/types/screenplay'
import { convertToFDX, exportToFDXXML } from '@/utils/fdx-format'

// Re-export types for convenience
export type { ScreenplayBlockType, ScreenplayElement, CustomEditor, CustomText }

export const isScreenplayElement = (element: any): element is ScreenplayElement => {
  return element && typeof element.type === 'string' && 
    ['scene_heading', 'action', 'character', 'parenthetical', 'dialogue', 'transition', 
     'shot', 'general', 'cast_list', 'new_act', 'end_of_act', 'summary'].includes(element.type)
}

export const getBlockText = (editor: CustomEditor): string => {
  try {
    const { selection } = editor
    if (!selection) return ''
    
    const [match] = Editor.nodes(editor, {
      match: n => isScreenplayElement(n)
    })
    
    if (!match) return ''
    const [node, path] = match
    return Editor.string(editor, path)
  } catch (error) {
    console.warn('Error getting block text:', error)
    return ''
  }
}

export const getCurrentBlockType = (editor: CustomEditor): ScreenplayBlockType | null => {
  try {
    const { selection } = editor
    if (!selection) return null
    
    // Ensure editor has valid content
    if (!editor.children || editor.children.length === 0) {
      return null
    }
    
    // Ensure selection points to valid paths
    try {
      const [match] = Editor.nodes(editor, {
        match: n => isScreenplayElement(n),
        mode: 'lowest'
      })
      
      if (!match) {
        // If no screenplay element found, try getting the node at current selection
        const [node] = Editor.node(editor, selection.anchor.path.slice(0, 1))
        if (isScreenplayElement(node)) {
          return (node as ScreenplayElement).type
        }
        return null
      }
      
      const [node] = match
      return (node as ScreenplayElement).type
    } catch (pathError) {
      console.warn('Invalid selection path, falling back to first node:', pathError)
      // Fallback: try to get the first node if selection is invalid
      const firstNode = editor.children[0]
      if (isScreenplayElement(firstNode)) {
        return (firstNode as ScreenplayElement).type
      }
      return null
    }
  } catch (error) {
    console.warn('Error getting current block type:', error)
    return null
  }
}

export const setBlockType = (editor: CustomEditor, type: ScreenplayBlockType) => {
  try {
    const { selection } = editor
    if (!selection) return
    
    // Check if editor has any content first
    if (!editor.children || editor.children.length === 0) {
      console.warn('Editor has no children, cannot set block type')
      return
    }
    
    // Ensure we're transforming the current block
    Transforms.setNodes(
      editor,
      { type },
      {
        match: n => Element.isElement(n) && isScreenplayElement(n),
        at: selection,
        mode: 'lowest'
      }
    )
    
    // Force re-render to update block type display
    ReactEditor.focus(editor)
  } catch (error) {
    console.warn('Error setting block type:', error)
  }
}

export const insertBlock = (editor: CustomEditor, type: ScreenplayBlockType, text = '') => {
  const newBlock: ScreenplayElement = {
    type,
    children: [{ text }],
    id: `block_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    metadata: {
      timestamp: new Date().toISOString(),
      uuid: crypto.randomUUID()
    }
  }
  
  Transforms.insertNodes(editor, newBlock)
}

export const isBlockEmpty = (editor: CustomEditor): boolean => {
  try {
    const { selection } = editor
    if (!selection) return false
    
    // Check if editor has any content first
    if (!editor.children || editor.children.length === 0) {
      return true
    }
    
    const [match] = Editor.nodes(editor, {
      match: n => isScreenplayElement(n)
    })
    
    if (!match) return false
    const [, path] = match
    
    const text = Editor.string(editor, path)
    return text.trim() === ''
  } catch (error) {
    console.warn('Could not get block text:', error)
    return false
  }
}

export const handleEnterKey = (editor: CustomEditor): boolean => {
  const currentType = getCurrentBlockType(editor)
  if (!currentType) return false
  
  const isEmpty = isBlockEmpty(editor)
  const trigger = isEmpty ? 'empty_enter' : 'enter'
  
  const transition = ENTER_TRANSITIONS.find(
    t => t.from === currentType && t.trigger === trigger
  )
  
  if (transition) {
    if (isEmpty && (currentType === 'character' || currentType === 'dialogue')) {
      // Handle special empty block cases - change current block type
      setBlockType(editor, transition.to)
      return true
    } else {
      // Create new block with target type - this is the normal case
      Transforms.splitNodes(editor, { always: true })
      // The splitNodes creates a new block, now set its type
      setBlockType(editor, transition.to)
      return true
    }
  }
  
  return false
}

export const handleTabKey = (editor: CustomEditor): boolean => {
  const currentType = getCurrentBlockType(editor)
  if (!currentType) return false
  
  // Special case: empty character block should go to transition
  const isEmpty = isBlockEmpty(editor)
  if (currentType === 'character' && isEmpty) {
    setBlockType(editor, 'transition')
    return true
  }
  
  const transition = TAB_TRANSITIONS.find(t => t.from === currentType && t.trigger === 'tab')
  if (transition) {
    setBlockType(editor, transition.to)
    return true
  }
  
  return false
}

export const formatCharacterName = (text: string): string => {
  return text.toUpperCase().trim()
}

export const formatSceneHeading = (text: string): string => {
  return text.toUpperCase().trim()
}

export const detectBlockType = (text: string): ScreenplayBlockType => {
  const trimmedText = text.trim().toLowerCase()
  
  // Auto-convert int./ext. to scene headings
  if (trimmedText.match(/^(int\.|ext\.)/)) {
    return 'scene_heading'
  }
  
  // Transitions
  if (trimmedText.match(/^(fade in:|fade out|cut to:|dissolve to:)/)) {
    return 'transition'
  }
  
  // Default to action - let user choose other types manually
  return 'action'
}

// Check if text should auto-convert the current block type
export const shouldAutoConvert = (editor: CustomEditor, text: string): ScreenplayBlockType | null => {
  const currentType = getCurrentBlockType(editor)
  if (currentType !== 'action') return null
  
  const trimmedText = text.trim().toLowerCase()
  
  // Convert action to scene_heading if typing int. or ext. followed by period
  if (trimmedText.match(/^(int\.|ext\.)/)) {
    return 'scene_heading'
  }
  
  return null
}

// Check if we should auto-convert as user types (for real-time conversion)
export const checkAutoConvertOnInput = (editor: CustomEditor, inputData: string): boolean => {
  try {
    const currentType = getCurrentBlockType(editor)
    if (currentType !== 'action') return false
    
    // Get current block text
    const { selection } = editor
    if (!selection) return false
    
    // Check if editor has any content first
    if (!editor.children || editor.children.length === 0) {
      return false
    }
    
    const [match] = Editor.nodes(editor, {
      match: n => isScreenplayElement(n)
    })
    
    if (!match) return false
    const [, path] = match
    const currentText = Editor.string(editor, path)
    
    // Check if adding the input data would create int. or ext.
    const newText = (currentText + inputData).trim().toLowerCase()
    
    if (inputData === '.' && (newText === 'int.' || newText === 'ext.')) {
      // Auto-convert to scene heading
      setBlockType(editor, 'scene_heading')
      return true
    }
  } catch (error) {
    console.warn('Error checking auto-convert:', error)
  }
  
  return false
}

// Handle Command+Digit shortcuts
export const handleCommandShortcut = (editor: CustomEditor, key: string): boolean => {
  const targetType = COMMAND_SHORTCUTS[key]
  if (targetType) {
    setBlockType(editor, targetType)
    return true
  }
  return false
}

// Toggle text formatting
export const toggleFormat = (editor: CustomEditor, format: 'bold' | 'italic' | 'underline'): void => {
  const isActive = isFormatActive(editor, format)
  
  if (isActive) {
    Editor.removeMark(editor, format)
  } else {
    Editor.addMark(editor, format, true)
  }
}

export const isFormatActive = (editor: CustomEditor, format: 'bold' | 'italic' | 'underline'): boolean => {
  const marks = Editor.marks(editor)
  return marks ? marks[format] === true : false
}

// Toggle dual dialogue flag
export const toggleDualDialogue = (editor: CustomEditor): void => {
  const [match] = Editor.nodes(editor, {
    match: n => isScreenplayElement(n) && n.type === 'dialogue'
  })
  
  if (match) {
    const [node, path] = match
    const element = node as ScreenplayElement
    Transforms.setNodes(
      editor,
      { isDualDialogue: !element.isDualDialogue },
      { at: path }
    )
  }
}

export const createInitialValue = (): ScreenplayElement[] => {
  try {
    return [
      {
        type: 'scene_heading',
        children: [{ text: 'INT. COFFEE SHOP - DAY' }],
        id: `initial_block_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        metadata: {
          timestamp: new Date().toISOString(),
          uuid: crypto.randomUUID()
        }
      },
      {
        type: 'action',
        children: [{ text: 'Write your story here...' }],
        id: `initial_action_block_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        metadata: {
          timestamp: new Date().toISOString(),
          uuid: crypto.randomUUID()
        }
      }
    ]
  } catch (error) {
    console.warn('Error creating initial value, using fallback:', error)
    // Ultra-safe fallback
    return [
      {
        type: 'action',
        children: [{ text: 'Start writing...' }],
        id: 'safe_fallback_block',
        metadata: {
          timestamp: new Date().toISOString(),
          uuid: 'fallback-uuid'
        }
      }
    ]
  }
}

export const exportToJSON = (value: ScreenplayElement[]) => {
  const scenes: string[] = []
  let currentScene = ''
  
  value.forEach(block => {
    if (block.type === 'scene_heading') {
      currentScene = Editor.string({ children: block.children } as any, [])
      scenes.push(currentScene)
    }
  })
  
  return {
    document: {
      id: crypto.randomUUID(),
      title: 'Untitled Screenplay',
      author: 'Writer',
      content: value,
      scenes,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      version: '1.0.0'
    }
  }
}

// Export to FDX format for industry compatibility
export const exportToFDX = (value: ScreenplayElement[], title = 'Untitled Screenplay') => {
  return exportToFDXXML(value, title)
}

// Get FDX statistics
export const getFDXStats = (value: ScreenplayElement[]) => {
  return convertToFDX(value)
}