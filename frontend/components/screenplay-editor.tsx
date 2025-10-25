"use client"

import React, { useCallback, useMemo, useState, useEffect, useRef } from "react"
import { createEditor, Descendant, Editor, Transforms, Range, Element, Text } from "slate"
import { Slate, Editable, withReact, RenderElementProps, RenderLeafProps } from "slate-react"
import { withHistory } from "slate-history"
import { 
  ScreenplayElement, 
  ScreenplayBlockType,
  CustomText,
  createInitialValue,
  handleEnterKey,
  handleTabKey,
  handleCommandShortcut,
  toggleFormat,
  toggleDualDialogue,
  setBlockType,
  getCurrentBlockType,
  isScreenplayElement
} from "@/utils/screenplay-utils"
import * as Y from 'yjs'
import { withYjs, YjsEditor, SyncElement, toSharedType } from 'slate-yjs'
import { WebsocketProvider } from 'y-websocket'

// Custom editor wrapper to handle Slate edge cases
const withScreenplayEditor = (editor: Editor) => {
  const { normalizeNode } = editor

  editor.normalizeNode = ([node, path]) => {
    try {
      // Ensure all screenplay elements have at least one text child
      if (Element.isElement(node) && isScreenplayElement(node)) {
        const element = node as ScreenplayElement
        if (!element.children || element.children.length === 0) {
          Transforms.insertNodes(editor, { text: '' }, { at: [...path, 0] })
          return
        }
        
        // Ensure all children are valid text nodes
        for (let i = 0; i < element.children.length; i++) {
          const child = element.children[i]
          if (!Text.isText(child) || typeof child.text !== 'string') {
            Transforms.removeNodes(editor, { at: [...path, i] })
            Transforms.insertNodes(editor, { text: '' }, { at: [...path, i] })
            return
          }
        }
      }

      // Ensure root level only contains screenplay elements
      if (path.length === 0 && Element.isElement(node)) {
        const rootElement = node as Element
        if (rootElement.children && Array.isArray(rootElement.children)) {
          for (let i = 0; i < rootElement.children.length; i++) {
            const child = rootElement.children[i]
            if (!isScreenplayElement(child)) {
              // Convert invalid nodes to scene_heading blocks (new default)
              Transforms.setNodes(
                editor,
                { 
                  type: 'scene_heading', 
                  id: `converted_${Date.now()}_${i}`,
                  metadata: {
                    timestamp: new Date().toISOString(),
                    uuid: crypto.randomUUID()
                  }
                },
                { at: [i] }
              )
              return
            }
          }
        }
      }

      normalizeNode([node, path])
    } catch (error) {
      console.warn('Error in editor normalization:', error)
      // Fall back to default normalization
      try {
        normalizeNode([node, path])
      } catch (fallbackError) {
        console.warn('Error in fallback normalization:', fallbackError)
      }
    }
  }

  return editor
}
import { ElementSettingsModal } from "./element-settings-modal"
import { BlockTypeDropdown } from "./block-type-dropdown"
import { calculatePageBreaks } from "@/utils/fdx-format"

interface ScreenplayEditorProps {
  content?: string
  onChange?: (content: string) => void
  onSceneChange?: (currentScene: string) => void
  onCurrentBlockTypeChange?: (type: ScreenplayBlockType | null) => void
  // Optional Yjs collaboration props. When provided, the editor syncs via Yjs.
  collaboration?: {
    doc: Y.Doc
    provider?: WebsocketProvider | null
    awareness?: any
    sceneId?: string
  }
  // Flag to indicate offline queue processing is in progress
  isProcessingQueue?: boolean
}


export function ScreenplayEditor({ content, onChange, onSceneChange, onCurrentBlockTypeChange, collaboration, isProcessingQueue = false }: ScreenplayEditorProps) {
  const isCollaborative = !!collaboration?.doc
  const initialValue = useMemo(() => {
    if (content) {
      try {
        // Try to parse existing content
        const parsedContent = JSON.parse(content)
        if (Array.isArray(parsedContent) && parsedContent.length > 0) {
          // Validate that all nodes have proper structure
          const validContent = parsedContent.every(node => 
            node && 
            typeof node === 'object' && 
            node.children && 
            Array.isArray(node.children) &&
            node.children.length > 0 &&
            node.children.every((child: CustomText) => child && typeof child.text === 'string')
          )
          
          if (validContent) {
            return parsedContent as ScreenplayElement[]
          }
        }
      } catch (error) {
        console.warn('Failed to parse content, using empty:', error)
      }
    }
    
    // Start with a single empty scene heading block to show placeholder
    return [
      {
        type: 'scene_heading' as ScreenplayBlockType,
        children: [{ text: '' }],
        id: `empty_initial_${Date.now()}`,
        metadata: {
          timestamp: new Date().toISOString(),
          uuid: crypto.randomUUID()
        }
      }
    ]
  }, [content])
  
  const [value, setValue] = useState<Descendant[]>(initialValue)
  const [isElementSettingsOpen, setIsElementSettingsOpen] = useState(false)
  const [currentBlockType, setCurrentBlockType] = useState<ScreenplayBlockType | null>('scene_heading')
  const seedContentRef = useRef<Descendant[]>(
    Array.isArray(initialValue) && initialValue.length > 0
      ? (initialValue as Descendant[])
      : (value as Descendant[])
  )
  const editor = useMemo(() => {
    // Build the base Slate editor first
    let e = withScreenplayEditor(withHistory(withReact(createEditor())))
    // Wrap with slate-yjs if collaboration is enabled
    if (collaboration?.doc) {
      try {
        const sharedType = collaboration.doc.getArray<SyncElement>('content') as any
        e = withYjs(e as any, sharedType)
      } catch (err) {
        console.warn('[ScreenplayEditor] Failed to init slate-yjs binding, continuing without Yjs', err)
      }
    }
    return e as Editor
  }, [collaboration?.doc])


  useEffect(() => {
    if (!content) return
    try {
      const parsed = JSON.parse(content)
      if (Array.isArray(parsed)) {
        seedContentRef.current = parsed as Descendant[]
      }
    } catch {
      // ignore parse errors; keep previous seed content
    }
  }, [content])

  // Seed once (if empty) by writing directly to the shared Y.Array via toSharedType
  // slate-yjs does not expose connect/disconnect; it syncs automatically
  useEffect(() => {
    if (!collaboration?.doc) return

    const doc = collaboration.doc
    const provider = collaboration.provider ?? null
    const currentSceneId = collaboration.sceneId ?? null

    const sharedType = doc.getArray<SyncElement>('content') as any
    const meta = doc.getMap('wr_meta') as any

    // CRITICAL: Synchronize Slate with Yjs AFTER seeding, not before
    // Calling synchronizeValue before the doc is seeded results in a blank editor
    const syncEditorFromYjs = () => {
      try {
        (YjsEditor as any).synchronizeValue?.(editor as any)
        console.log('[ScreenplayEditor] Synchronized Slate editor from Yjs doc')
      } catch (err) {
        console.warn('[ScreenplayEditor] Failed to sync editor from Yjs', err)
      }
    }

    // CRITICAL: Listen for remote changes and sync them to Slate
    // We must distinguish between LOCAL changes (from this editor) and REMOTE changes (from other users)
    // - LOCAL changes: already applied by slate-yjs automatically, syncing again causes duplication
    // - REMOTE changes: need manual sync to trigger React re-render
    const handleDocUpdate = (update: Uint8Array, origin: any) => {
      // CRITICAL: Skip Yjs syncs while offline queue is processing to prevent race condition
      // The queue might be saving REST content, and Yjs could overwrite it with stale state
      if (isProcessingQueue) {
        console.log('⏸️ [ScreenplayEditor] Skipping Yjs sync - queue processing in progress')
        return
      }

      // Check if this is a local change from slate-yjs
      // slate-yjs uses a Symbol as origin for local changes: Symbol(Denotes that an event originated from slate-yjs)
      // Remote changes come from the WebSocket provider (different origin)
      const isLocalChange = typeof origin === 'symbol' ||
                           origin === editor ||
                           origin?.constructor?.name === 'YjsEditor'

      if (!isLocalChange) {
        // This is a remote change - sync it to Slate to trigger React re-render
        console.log('[ScreenplayEditor] Remote change detected, syncing to Slate')
        syncEditorFromYjs()
      }
    }

    // Subscribe to doc updates for remote changes
    doc.on('update', handleDocUpdate)

    const seedDocIfNeeded = () => {
      const targetSceneId = meta.get('target_scene_id') ?? currentSceneId
      const seededSceneId = meta.get('seeded_scene_id')
      const sharedLength = (sharedType as any).length ?? 0
      const alreadySeeded = !!meta.get('seeded') && (!targetSceneId || seededSceneId === targetSceneId)

      if (sharedLength > 0 && alreadySeeded) {
        // Doc already has content, just sync to editor
        syncEditorFromYjs()
        return
      }

      if (sharedLength > 0 && seededSceneId !== targetSceneId) {
        try {
          meta.set('seeded', true)
          if (targetSceneId) {
            meta.set('seeded_scene_id', targetSceneId)
          }
        } catch (err) {
          console.warn('[ScreenplayEditor] Failed to update seeded scene metadata', err)
        }
        // Doc has content for different scene, sync to editor
        syncEditorFromYjs()
        return
      }

      if ((sharedType as any).length > 0) {
        try {
          meta.set('seeded', true)
          if (targetSceneId) {
            meta.set('seeded_scene_id', targetSceneId)
          }
        } catch (err) {
          console.warn('[ScreenplayEditor] Failed to mark Y.Doc as seeded', err)
        }
        // Doc has content, sync to editor
        syncEditorFromYjs()
        return
      }

      const nodesToSeed = seedContentRef.current
      if (!Array.isArray(nodesToSeed) || nodesToSeed.length === 0) {
        return
      }

      doc.transact(() => {
        toSharedType(sharedType, nodesToSeed as any)
        meta.set('seeded', true)
        if (targetSceneId) {
          meta.set('seeded_scene_id', targetSceneId)
        }
      })
      console.log('[ScreenplayEditor] Seeded Y.Doc with initial content via toSharedType')

      // CRITICAL: Sync editor AFTER seeding the doc
      // This ensures the editor shows the seeded content
      syncEditorFromYjs()
    }

    const cleanupTasks: Array<() => void> = []

    if (provider) {
      const handleSynced = (event: any) => {
        const synced = typeof event === 'boolean' ? event : !!event?.synced
        if (synced) {
          seedDocIfNeeded()
        }
      }

      provider.on('synced', handleSynced)
      cleanupTasks.push(() => provider.off('synced', handleSynced))

      if ((provider as any).synced) {
        seedDocIfNeeded()
      }
    } else {
      // If we have no provider (unlikely), fall back to immediate seeding.
      seedDocIfNeeded()
    }

    return () => {
      // Cleanup seeding event listeners
      doc.off('update', handleDocUpdate)
      cleanupTasks.forEach((fn) => {
        try { fn() } catch {}
      })
      try { (YjsEditor as any).destroy?.(editor as any) } catch {}
    }
  }, [editor, collaboration?.doc, collaboration?.provider, collaboration?.sceneId])
  const [isEditorReady, setIsEditorReady] = useState(false)
  const [editorKey, setEditorKey] = useState(0) // Force re-render when needed
  // Track last emitted scene UUID to avoid redundant onSceneChange emissions
  const lastSceneUuidRef = useRef<string | null>(null)
  // Track current block type in a ref to avoid effect churn
  const currentBlockTypeRef = useRef<ScreenplayBlockType | null>(currentBlockType)

  useEffect(() => {
    currentBlockTypeRef.current = currentBlockType
  }, [currentBlockType])

  // Update editor when content prop changes (for FDX uploads)
  useEffect(() => {
    // When collaborating via Yjs, the editor state is driven by Yjs.
    if (collaboration?.doc) return
    if (content) {
      console.log('🎬 useEffect: content prop changed')
      console.log('Content type:', typeof content)
      console.log('Content length:', content.length)

      // Safely check if content is an array before filtering
      if (Array.isArray(content)) {
        console.log('First block:', content[0])
        console.log('Scene headings count:', content.filter((e: any) => e.type === 'scene_heading').length)
      } else {
        console.log('Content is not an array, likely JSON string:', content.substring ? content.substring(0, 100) + '...' : content)
      }

      console.log('📝 ScreenplayEditor: Content prop changed, updating editor')

      try {
        const parsedContent = JSON.parse(content)
        if (Array.isArray(parsedContent) && parsedContent.length > 0) {
          console.log('📝 ScreenplayEditor: Parsed', parsedContent.length, 'elements')
          console.log('First few elements:', parsedContent.slice(0, 3))

          const validContent = parsedContent.every(node =>
            node &&
            typeof node === 'object' &&
            node.children &&
            Array.isArray(node.children) &&
            node.children.length > 0 &&
            node.children.every((child: CustomText) => child && typeof child.text === 'string')
          )

          if (validContent) {
            console.log('✅ ScreenplayEditor: Content is valid, updating editor value')
            setValue(parsedContent as ScreenplayElement[])
            setEditorKey(prev => prev + 1) // Force editor re-render
          } else {
            console.warn('❌ ScreenplayEditor: Content validation failed')
          }
        }
      } catch (error) {
        console.warn('❌ ScreenplayEditor: Failed to parse content:', error)
      }
    }
  }, [content, collaboration?.doc])
  
  // Check if editor is completely empty (for placeholder)
  const isEditorEmpty = useMemo(() => {
    if (!value || value.length === 0) return true
    
    // Check if all blocks are empty
    return value.every(block => {
      if (!isScreenplayElement(block)) return true
      try {
        // Create a temporary node structure for Editor.string
        const tempNode = { children: block.children }
        return Editor.string(tempNode as Editor, []).trim() === ''
      } catch {
        // If there's an error getting the text, assume it's not empty
        return false
      }
    })
  }, [value])

  // Initialize editor selection when ready
  React.useEffect(() => {
    if (!isEditorReady && value.length > 0) {
      const timeoutId = setTimeout(() => {
        try {
          // Force normalize the editor content first
          Editor.normalize(editor, { force: true })
          
          // Ensure editor has a valid selection
          if (!editor.selection && editor.children.length > 0) {
            // Validate the first node has text content
            const firstNode = editor.children[0] as ScreenplayElement
            if (firstNode && firstNode.children && firstNode.children.length > 0) {
              const point = { path: [0, 0], offset: 0 }
              Transforms.select(editor, { anchor: point, focus: point })
            }
          }
          setIsEditorReady(true)
        } catch (error) {
          console.warn('Error initializing editor selection:', error)
          // Force reset to safe state
          try {
            const safeValue = createInitialValue()
            setValue(safeValue)
            setEditorKey(prev => prev + 1) // Force complete re-render
            // Try to set selection after reset
            setTimeout(() => {
              try {
                const point = { path: [0, 0], offset: 0 }
                Transforms.select(editor, { anchor: point, focus: point })
              } catch (e) {
                console.warn('Could not set selection after reset:', e)
              }
              setIsEditorReady(true)
            }, 50)
          } catch (resetError) {
            console.warn('Could not reset editor:', resetError)
            setIsEditorReady(true) // Still mark as ready to avoid infinite loop
          }
        }
      }, 200) // Increased delay to ensure DOM is ready
      
      return () => clearTimeout(timeoutId)
    }
  }, [editor, value, isEditorReady])

  // Update current block type when editor changes - with safety delay
  React.useEffect(() => {
    const updateBlockType = () => {
      try {
        // Only update if the editor has content and is properly initialized
        if (isEditorReady && value && value.length > 0 && editor.children && editor.children.length > 0) {
          // Ensure editor selection is valid before getting block type
          if (editor.selection) {
            const type = getCurrentBlockType(editor)
            setCurrentBlockType(type || 'scene_heading')
            onCurrentBlockTypeChange?.(type || 'scene_heading')
          } else {
            // No selection, default to scene_heading
            setCurrentBlockType('scene_heading')
            onCurrentBlockTypeChange?.('scene_heading')
          }
        } else {
          // No content, set to default
          setCurrentBlockType('scene_heading')
          onCurrentBlockTypeChange?.('scene_heading')
        }
      } catch (error) {
        console.warn('Error updating block type:', error)
        setCurrentBlockType('scene_heading')
        onCurrentBlockTypeChange?.('scene_heading')
      }
    }
    
    // Only run if editor is ready
    if (isEditorReady) {
      const timeoutId = setTimeout(updateBlockType, 50) // Reduced delay for more responsiveness
      return () => clearTimeout(timeoutId)
    }
  }, [value, editor, onCurrentBlockTypeChange, isEditorReady])

  // Add selection change listener for immediate cursor-based updates
  React.useEffect(() => {
    if (!isEditorReady) return
    
    const updateBlockTypeOnSelection = () => {
      try {
        // Ensure editor has valid state before proceeding
        if (editor.selection && 
            editor.children && 
            editor.children.length > 0 && 
            Range.isRange(editor.selection)) {
          
          // Additional validation that the selection is valid
          const { anchor, focus } = editor.selection
          if (anchor && focus && 
              anchor.path && focus.path &&
              anchor.path.length > 0 && focus.path.length > 0) {
            
            const type = getCurrentBlockType(editor)
            if (type && type !== currentBlockTypeRef.current) {
              currentBlockTypeRef.current = type
              setCurrentBlockType(type)
              onCurrentBlockTypeChange?.(type)
            }

            // Detect the current scene by scanning backward to the nearest scene_heading
            try {
              const [match] = Editor.nodes(editor, { match: n => isScreenplayElement(n) })
              if (match) {
                const [, path] = match as any
                const topIndex = Array.isArray(path) && path.length > 0 ? path[0] : 0
                for (let i = topIndex; i >= 0; i--) {
                  const node = editor.children[i] as any
                  if (node && (node as any).type === 'scene_heading') {
                    const uuid: string | undefined = (node as any)?.metadata?.uuid
                    // Only emit when the scene actually changes
                    if (uuid && uuid !== lastSceneUuidRef.current) {
                      lastSceneUuidRef.current = uuid
                      onSceneChange?.(uuid)
                    }
                    break
                  }
                }
              }
            } catch (e) {
              // ignore scene detection errors
            }
          }
        }
      } catch (error) {
        console.warn('Error updating block type on selection:', error)
      }
    }

    // Listen to selection changes more directly
    const handleSelectionChange = () => {
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        // Double-check editor is still ready
        if (isEditorReady && editor.children && editor.children.length > 0) {
          updateBlockTypeOnSelection()
        }
      })
    }

    // Add event listener for selection changes
    document.addEventListener('selectionchange', handleSelectionChange)
    
    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
    }
  }, [editor, onCurrentBlockTypeChange, onSceneChange, isEditorReady])

  // Handle auto-conversion logic (define before handleKeyDown)
  const handleAutoConversion = useCallback(() => {
    try {
      if (!editor.children || editor.children.length === 0 || !editor.selection) {
        return
      }
      
      const currentType = getCurrentBlockType(editor)
      if (currentType !== 'action') return
      
      // Get current block text
      const [match] = Editor.nodes(editor, {
        match: n => isScreenplayElement(n)
      })
      
      if (!match) return
      const [, path] = match
      const currentText = Editor.string(editor, path).toLowerCase().trim()
      
      // Check if text ends with 'int.' or 'ext.'
      if (currentText === 'int.' || currentText === 'ext.') {
        console.log('Auto-converting to scene heading:', currentText)
        setBlockType(editor, 'scene_heading')
      }
    } catch (error) {
      console.warn('Error in auto-conversion:', error)
    }
  }, [editor])

  // Handle value changes
  const handleChange = useCallback((newValue: Descendant[]) => {
    try {
      console.log('🟡 [editor.handleChange] Called, isCollaborative:', isCollaborative);
      // For collaboration, determine if this change originated locally
      let isLocalChange = true
      if (isCollaborative) {
        try {
          if (typeof (YjsEditor as any).isLocal === 'function') {
            isLocalChange = (YjsEditor as any).isLocal(editor as any)
          }
        } catch {}
      }
      console.log('🟡 [editor.handleChange] isLocalChange:', isLocalChange, 'elements:', newValue.length);
      // Validate that newValue is not empty and has valid structure
      if (newValue && Array.isArray(newValue) && newValue.length > 0) {
        setValue(newValue)
        if (onChange && isLocalChange) {
          const firstText = (newValue[0] as any)?.children?.[0]?.text;
          console.log('🟡 [editor.handleChange] Calling onChange, first text:', firstText?.substring(0, 50));
          // For now, export as JSON string - can be customized later
          onChange(JSON.stringify(newValue))
        }
      } else {
        console.warn('Received invalid editor value, using fallback')
        // Use empty fallback to show placeholder
        const fallbackValue = [
          {
            type: 'scene_heading' as ScreenplayBlockType,
            children: [{ text: '' }],
            id: `fallback_${Date.now()}`,
            metadata: {
              timestamp: new Date().toISOString(),
              uuid: crypto.randomUUID()
            }
          }
        ]
        setValue(fallbackValue)
        if (onChange && isLocalChange) {
          onChange(JSON.stringify(fallbackValue))
        }
      }
    } catch (error) {
      console.warn('Error handling value change:', error)
      // Use empty fallback on error
      const fallbackValue = [
        {
          type: 'scene_heading' as ScreenplayBlockType,
          children: [{ text: '' }],
          id: `error_fallback_${Date.now()}`,
          metadata: {
            timestamp: new Date().toISOString(),
            uuid: crypto.randomUUID()
          }
        }
      ]
      setValue(fallbackValue)
    }
  }, [onChange, editor, isCollaborative])

  // Calculate pages using FDX format
  const pages = React.useMemo(() => {
    // Skip expensive page calculations during collaboration to keep typing responsive
    if (isCollaborative) return { pages: [{ number: 1, elements: [], lines: 0 }] }
    try {
      if (!value || value.length === 0) {
        return { pages: [{ number: 1, elements: [], lines: 0 }] }
      }
      return calculatePageBreaks(value as ScreenplayElement[])
    } catch (error) {
      console.warn('Error calculating page breaks:', error)
      return { pages: [{ number: 1, elements: [], lines: 0 }] }
    }
  }, [value, isCollaborative])

  // Render screenplay elements with exact Final Draft formatting
  const renderElement = useCallback((props: RenderElementProps) => {
    const { attributes, children, element } = props
    const screenplayElement = element as ScreenplayElement
    
    const baseStyles = {
      fontFamily: '"Courier Prime", Courier, monospace',
      fontSize: '12pt',
      lineHeight: '1.5',
      marginTop: 0,
      marginRight: 0,
      marginBottom: 0,
      marginLeft: 0,
      padding: 0
    }
    
    switch (screenplayElement.type) {
      case 'scene_heading':
        return (
          <div 
            {...attributes} 
            className="uppercase text-black"
            style={{ 
              ...baseStyles,
              marginTop: '24px',
              marginBottom: '12px',
              fontWeight: 'normal',
              textDecoration: 'none'
            }}
          >
            {children}
          </div>
        )
      case 'action':
        return (
          <div 
            {...attributes} 
            className="text-black"
            style={{ 
              ...baseStyles,
              marginBottom: '12px',
              width: '100%',
              textTransform: 'none'
            }}
          >
            {children}
          </div>
        )
      case 'character':
        return (
          <div 
            {...attributes} 
            className="uppercase text-black"
            style={{ 
              ...baseStyles,
              textAlign: 'left',
              marginLeft: '220px',
              marginTop: '12px',
              marginBottom: '0px',
              fontWeight: 'normal'
            }}
          >
            {children}
          </div>
        )
      case 'parenthetical':
        return (
          <div 
            {...attributes} 
            className="text-black"
            style={{ 
              ...baseStyles,
              textAlign: 'left',
              marginLeft: '160px',
              marginBottom: '0px',
              fontStyle: 'normal',
              textTransform: 'none'
            }}
          >
            <span>(</span>{children}<span>)</span>
          </div>
        )
      case 'dialogue':
        return (
          <div 
            {...attributes} 
            className="text-black"
            style={{ 
              ...baseStyles,
              marginLeft: screenplayElement.isDualDialogue ? '100px' : '100px',
              marginRight: screenplayElement.isDualDialogue ? '100px' : '150px',
              marginBottom: '12px',
              fontWeight: 'normal',
              textTransform: 'none',
              maxWidth: '350px', // Limit dialogue width to industry standard
              wordWrap: 'break-word'
            }}
          >
            {children}
          </div>
        )
      case 'transition':
        return (
          <div 
            {...attributes} 
            className="uppercase text-black"
            style={{ 
              ...baseStyles,
              textAlign: 'right',
              marginTop: '12px',
              marginBottom: '24px',
              fontWeight: 'normal'
            }}
          >
            {children}
          </div>
        )
      case 'shot':
        return (
          <div 
            {...attributes} 
            className="uppercase text-black"
            style={{ 
              ...baseStyles,
              marginTop: '12px',
              marginBottom: '6px',
              fontWeight: 'normal'
            }}
          >
            {children}
          </div>
        )
      case 'cast_list':
        return (
          <div 
            {...attributes} 
            className="text-center uppercase text-black"
            style={{ 
              ...baseStyles,
              marginBottom: '6px',
              fontWeight: 'normal'
            }}
          >
            {children}
          </div>
        )
      case 'new_act':
        return (
          <div 
            {...attributes} 
            className="text-center uppercase text-black"
            style={{ 
              ...baseStyles,
              fontSize: '14pt',
              marginTop: '48px',
              marginBottom: '48px',
              fontWeight: 'normal'
            }}
          >
            {children}
          </div>
        )
      case 'end_of_act':
        return (
          <div 
            {...attributes} 
            className="text-center uppercase text-black"
            style={{ 
              ...baseStyles,
              marginTop: '48px',
              marginBottom: '48px',
              fontWeight: 'normal'
            }}
          >
            {children}
          </div>
        )
      case 'summary':
        return (
          <div 
            {...attributes} 
            className="text-black"
            style={{ 
              ...baseStyles,
              marginLeft: '50px',
              marginRight: '50px',
              marginBottom: '12px',
              fontStyle: 'normal',
              textTransform: 'none'
            }}
          >
            {children}
          </div>
        )
      case 'general':
      default:
        return (
          <div 
            {...attributes} 
            className="text-black"
            style={{ 
              ...baseStyles,
              marginBottom: '12px',
              textTransform: 'none'
            }}
          >
            {children}
          </div>
        )
    }
  }, [])

  // Render leaf elements
  const renderLeaf = useCallback((props: RenderLeafProps) => {
    const { attributes, children, leaf } = props
    let content = children
    
    if (leaf.bold) {
      content = <strong>{content}</strong>
    }
    if (leaf.italic) {
      content = <em>{content}</em>
    }
    if (leaf.underline) {
      content = <u>{content}</u>
    }
    
    return <span {...attributes}>{content}</span>
  }, [])

  // Handle keyboard shortcuts and behaviors
  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    try {
      // Safety check: ensure editor is in a valid state
      if (!editor.children || editor.children.length === 0) {
        console.warn('Editor has no children, skipping key handling')
        return
      }

      const { key, metaKey, ctrlKey } = event
      const isCommandKey = metaKey || ctrlKey

      // Auto-capitalization for action blocks
      if (!isCommandKey && key.length === 1 && key.match(/[a-z]/)) {
        const currentType = getCurrentBlockType(editor)
        if (currentType === 'action' && editor.selection && Range.isCollapsed(editor.selection)) {
          try {
            // Get current block and cursor position
            const [match] = Editor.nodes(editor, {
              match: n => isScreenplayElement(n)
            })
            
            if (match) {
              const [node, path] = match
              // Ensure the node has valid children
              if (node && node.children && node.children.length > 0) {
                const blockText = Editor.string(editor, path)
                const { anchor } = editor.selection
                
                // Validate the anchor position
                if (anchor && typeof anchor.offset === 'number' && anchor.offset >= 0) {
                  // Get text before cursor
                  const textBeforeCursor = blockText.substring(0, anchor.offset)
                  
                  // Check if we should capitalize (start of block or after sentence-ending punctuation + space)
                  const shouldCapitalize = 
                    textBeforeCursor.trim() === '' || // Start of block
                    /[.!?]\s*$/.test(textBeforeCursor) // After sentence ending punctuation and optional spaces
                  
                  if (shouldCapitalize) {
                    event.preventDefault()
                    editor.insertText(key.toUpperCase())
                    return
                  }
                }
              }
            }
          } catch (error) {
            console.warn('Error in auto-capitalization:', error)
          }
        }
      }
    
    // Command+E - Element Settings
    if (isCommandKey && key === 'e') {
      event.preventDefault()
      setIsElementSettingsOpen(true)
      return
    }
    
    // Command+Digit shortcuts
    if (isCommandKey && /^[0-9]$/.test(key)) {
      event.preventDefault()
      if (handleCommandShortcut(editor, key)) {
        return
      }
    }
    
    // Text formatting shortcuts
    if (isCommandKey && key === 'b') {
      event.preventDefault()
      toggleFormat(editor, 'bold')
      return
    }
    
    if (isCommandKey && key === 'i') {
      event.preventDefault()
      toggleFormat(editor, 'italic')
      return
    }
    
    if (isCommandKey && key === 'u') {
      event.preventDefault()
      toggleFormat(editor, 'underline')
      return
    }
    
    // Command+D - Toggle dual dialogue
    if (isCommandKey && key === 'd') {
      event.preventDefault()
      toggleDualDialogue(editor)
      return
    }
    
    // DELETE/BACKSPACE key behavior - simplified
    if (key === 'Backspace') {
      const { selection } = editor
      if (selection && Range.isCollapsed(selection)) {
        const [match] = Editor.nodes(editor, {
          match: n => isScreenplayElement(n)
        })
        
        if (match) {
          const [, path] = match
          const text = Editor.string(editor, path)
          
          // If current block is empty and not the first block, merge with previous
          if (text.trim() === '' && path[0] > 0) {
            event.preventDefault()
            Transforms.mergeNodes(editor, { at: path })
            return
          }
        }
      }
      // Let default behavior handle other cases
      return
    }
    
    // ENTER key behavior
    if (key === 'Enter') {
      event.preventDefault()
      if (handleEnterKey(editor)) {
        return
      }
      // Default enter behavior
      Transforms.splitNodes(editor)
    } 
    
    // TAB key behavior
    else if (key === 'Tab') {
      event.preventDefault()
      handleTabKey(editor)
    }
    
    // Period key - check for auto-conversion after the character is inserted
    else if (key === '.') {
      // Let the period be inserted first, then check for auto-conversion
      setTimeout(() => {
        handleAutoConversion()
      }, 10)
    }
    
    } catch (error) {
      console.warn('Error handling key down:', error)
      // Don't prevent default on error to maintain basic functionality
    }
  }, [editor, handleAutoConversion])
  

  return (
    <div className="h-screen bg-gray-100">
      <Slate
        editor={editor}
        initialValue={value}
        onChange={handleChange}
        key={`slate-${editorKey}`}
      >
        {/* Final Draft Style Layout */}
        <div className="h-full flex flex-col">
          
          {/* Main Content Area with Paper Pages */}
          <div className="flex-1 overflow-auto py-8 px-4">
            <div className="max-w-none mx-auto flex flex-col items-center">
              
              {/* Element Type Dropdown - Floating */}
              <div className="fixed top-20 left-1/2 transform -translate-x-1/2 z-50">
                <BlockTypeDropdown
                  currentType={currentBlockType}
                  onTypeChange={(type) => {
                    try {
                      setBlockType(editor, type)
                      // Force update the current block type immediately
                      setTimeout(() => {
                        try {
                          const newType = getCurrentBlockType(editor)
                          setCurrentBlockType(newType || type)
                          onCurrentBlockTypeChange?.(newType || type)
                        } catch (error) {
                          console.warn('Error updating block type after change:', error)
                          setCurrentBlockType(type)
                        }
                      }, 50)
                    } catch (error) {
                      console.warn('Error setting block type:', error)
                    }
                  }}
                  className="bg-white/95 backdrop-blur-sm border border-gray-300 shadow-lg"
                />
              </div>

              {/* Render Single Continuous Editor */}
              <div 
                className="bg-white shadow-lg border border-gray-300 relative"
                style={{
                  width: '8.5in',
                  minHeight: `${Math.max(pages.pages.length, 1) * 11}in`,
                  marginBottom: '32px'
                }}
              >
                {/* Page Numbers - render for each page */}
                {pages.pages.map((page, index) => (
                  <div 
                    key={page.number}
                    className="absolute text-xs text-gray-500"
                    style={{ 
                      top: `${index * 11 + 0.5}in`, 
                      right: '1in',
                      fontFamily: '"Courier Prime", Courier, monospace'
                    }}
                  >
                    {page.number}.
                  </div>
                ))}

                {/* Page Break Lines */}
                {pages.pages.slice(0, -1).map((_, index) => (
                  <div
                    key={`break-${index}`}
                    className="absolute left-0 right-0 border-b border-gray-200 border-dashed"
                    style={{ 
                      top: `${(index + 1) * 11}in`
                    }}
                  />
                ))}

                {/* Writing Area - Single continuous editor */}
                <div
                  style={{
                    padding: '1in 1in 1in 1.5in',
                    paddingTop: '1.2in', // Reduced space for floating dropdown
                    minHeight: `${Math.max(pages.pages.length, 1) * 11}in`,
                    fontFamily: '"Courier Prime", Courier, monospace',
                    fontSize: '12pt',
                    lineHeight: '1.5',
                    position: 'relative'
                  }}
                >
                  {/* Empty Editor Placeholder */}
                  {isEditorReady && isEditorEmpty && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '1.2in',
                        left: '1.5in',
                        color: '#999',
                        fontStyle: 'italic',
                        fontFamily: '"Courier Prime", Courier, monospace',
                        fontSize: '12pt',
                        lineHeight: '1.5',
                        pointerEvents: 'none',
                        userSelect: 'none'
                      }}
                    >
                      Where do we start...
                    </div>
                  )}
                  
                  {isEditorReady ? (
                    <Editable
                      renderElement={renderElement}
                      renderLeaf={renderLeaf}
                      onKeyDown={handleKeyDown}
                      placeholder=""
                      spellCheck={false}
                      style={{
                        outline: 'none',
                        minHeight: `calc(${Math.max(pages.pages.length, 1) * 11}in - 2.5in)`,
                        caretColor: '#000'
                      }}
                    />
                  ) : (
                    <div 
                      style={{
                        outline: 'none',
                        minHeight: `calc(${Math.max(pages.pages.length, 1) * 11}in - 2.5in)`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#999',
                        fontFamily: '"Courier Prime", Courier, monospace',
                        fontSize: '12pt'
                      }}
                    >
                      Loading editor...
                    </div>
                  )}
                </div>
              </div>
              
            </div>
          </div>

          {/* Bottom Status */}
          <div className="border-t border-gray-300 bg-white px-4 py-2 text-xs text-gray-500 flex justify-between items-center">
            <span style={{ fontFamily: '"Courier Prime", Courier, monospace' }}>
              Courier 12pt • Industry Standard • FDX Compatible
            </span>
            <span>Page {pages.pages.length} of {pages.pages.length}</span>
          </div>
        </div>
      </Slate>
      
      {/* Element Settings Modal */}
      <ElementSettingsModal
        isOpen={isElementSettingsOpen}
        onClose={() => setIsElementSettingsOpen(false)}
        currentBlockType={currentBlockType}
        onBlockTypeChange={(type) => setBlockType(editor, type)}
      />
    </div>
  )
}
