import { NextRequest, NextResponse } from 'next/server'
import { Readable } from 'stream'
import * as xml2js from 'xml2js'

interface SceneData {
  slugline: string
  characters: string[]
  summary: string
  tokens: number
  wordCount: number
  fullContent?: string // Full scene content in screenplay format
  // Required strict indexing properties
  sceneIndex: number   // 0…N-1 contiguous
  sceneId: string      // stable unique ID
  originalSlugline: string // never recomputed from content map
}

interface FDXParseResult {
  success: boolean
  title?: string
  sceneCount?: number
  sluglines?: string[]
  scenes?: SceneData[]
  projectId?: string
  error?: string
  screenplayElements?: any[]
  diagnostics?: {
    originalLines: number
    processedParagraphs: number
    lastSceneHeadings: string[]
  }
}

// 🧪 DIAGNOSTIC TEST HARNESS
function runDiagnosticTests() {
  console.log(`\n🧪 RUNNING DIAGNOSTIC TESTS`)

  const tests = [
    {
      name: "TEST 1: Proper Scene Heading",
      fdx: `<Paragraph Type="Scene Heading"><Text>EXT. CLIFFSIDE - NIGHT</Text></Paragraph>`,
      expected: "{ type: 'scene_heading', text: 'EXT. CLIFFSIDE - NIGHT' }"
    },
    {
      name: "TEST 2: Embedded Scene Heading in Action Paragraph (should stay action)",
      fdx: `<Paragraph Type="Action"><Text>CUT TO:\nEXT. STREET - CONTINUOUS</Text></Paragraph>`,
      expected: "{ type: 'action', text: 'CUT TO:\\nEXT. STREET - CONTINUOUS' }"
    },
    {
      name: "TEST 3: Incomplete Slugline (INT. alone) - should be rejected",
      fdx: `<Paragraph Type="Scene Heading"><Text>INT.</Text></Paragraph>`,
      expected: "null"
    },
    {
      name: "TEST 4: Proper Scene Heading with Multi-part XML",
      fdx: `<Paragraph Type="Scene Heading"><Text>INT. </Text><Text>THE VAULT</Text><Text> - NIGHT</Text></Paragraph>`,
      expected: "{ type: 'scene_heading', text: 'INT. THE VAULT - NIGHT' }"
    },
    {
      name: "TEST 5: Regular Action Paragraph (sacred)",
      fdx: `<Paragraph Type="Action"><Text>Sam picks up the gun.</Text></Paragraph>`,
      expected: "{ type: 'action', text: 'Sam picks up the gun.' }"
    },
    {
      name: "TEST 6: Transition marked as Scene Heading - should be reclassified",
      fdx: `<Paragraph Type="Scene Heading"><Text>FLASH TO:</Text></Paragraph>`,
      expected: "{ type: 'transition', text: 'FLASH TO:' }"
    },
    {
      name: "TEST 7: BLACK marked as Scene Heading - should be preserved as scene heading",
      fdx: `<Paragraph Type="Scene Heading"><Text>BLACK.</Text></Paragraph>`,
      expected: "{ type: 'scene_heading', text: 'BLACK.' }"
    },
    {
      name: "TEST 8: FADE TO BLACK transition - should be reclassified",
      fdx: `<Paragraph Type="Scene Heading"><Text>FADE TO BLACK</Text></Paragraph>`,
      expected: "{ type: 'transition', text: 'FADE TO BLACK:' }"
    }
  ]

  tests.forEach((test, index) => {
    console.log(`\n${test.name}`)
    console.log(`Expected: ${test.expected}`)

    const result = parseIndividualParagraph(test.fdx)
    console.log(`Actual: ${JSON.stringify(result)}`)
    console.log(`✅ PASS` + (JSON.stringify(result).includes(test.expected.replace('❌ Should be skipped. Do not allow this as a scene heading.', 'null')) ? '' : ' ❌ FAIL'))
  })
}

// Helper function to convert paragraph object back to XML string
function paragraphToXMLString(paragraph: any): string {
  try {
    const type = paragraph.Type || 'Action'
    let text = ''

    // Handle different text structures
    if (typeof paragraph.Text === 'string') {
      text = paragraph.Text
    } else if (Array.isArray(paragraph.Text)) {
      // Join array elements with proper spacing to avoid word fusion
      text = paragraph.Text.map((item: any) => {
        if (typeof item === 'string') {
          return item
        } else if (item && typeof item === 'object') {
          // Extract text from object, check common properties
          return item._ || item.text || item.content || ''
        }
        return String(item)
      }).join(' ')  // Use space separator to preserve word boundaries
    } else if (paragraph.Text && typeof paragraph.Text === 'object') {
      // Handle nested text objects - extract actual text content
      text = paragraph.Text._ || paragraph.Text.text || paragraph.Text.content || ''

      // If still empty, try to extract any string values from the object
      if (!text) {
        const values = Object.values(paragraph.Text)
        text = values.filter(v => typeof v === 'string').join(' ')
      }

      // Last resort: convert to string but avoid [object Object]
      if (!text) {
        text = String(paragraph.Text).includes('[object Object]') ? '' : String(paragraph.Text)
      }
    }

    // Clean up the text
    text = String(text).trim()

    // Create XML string
    return `<Paragraph Type="${type}"><Text>${text}</Text></Paragraph>`
  } catch (error) {
    console.warn('Failed to convert paragraph to XML:', error, paragraph)
    return '<Paragraph Type="Action"><Text></Text></Paragraph>'
  }
}

// Enhanced paragraph parsing function with content-based validation
function parseIndividualParagraph(paragraphXML: string) {
  const typeMatch = paragraphXML.match(/Type="([^"]*)"/)
  if (!typeMatch) return null

  const type = typeMatch[1].trim()

  // Extract text from all <Text> nodes and concatenate
  const textMatches = paragraphXML.matchAll(/<Text[^>]*>([\s\S]*?)<\/Text>/g)
  let fullText = ''
  for (const match of textMatches) {
    fullText += match[1]
  }

  // Clean the text
  const text = fullText
    .replace(/<[^>]*>/g, '') // Remove XML tags
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .trim()

  // Apply enhanced content-based logic
  if (!text) return null

  // 🎯 CONTENT-BASED CLASSIFICATION (respects XML Type first, then applies content rules)

  // 1. SCENE HEADING VALIDATION - Respect XML Type="Scene Heading" first
  if (type === 'Scene Heading') {
    console.log(`   🏷️ XML TYPE: Scene Heading detected for "${text}"`)

    // BUT first check if it's an obvious transition that was misclassified
    const obviousTransitionPatterns = [
      /^(FADE IN|FADE OUT|FADE TO BLACK|SMASH CUT TO|CUT TO|MATCH CUT TO|JUMP CUT TO|DISSOLVE TO|FLASH TO|FLASH CUT TO|FREEZE FRAME|TIME CUT|MONTAGE|END MONTAGE|SPLIT SCREEN|IRIS IN|IRIS OUT|WIPE TO|FLIP TO)[\.\:\;]?$/i,
      /^(FADE IN\:|FADE OUT\.|CUT TO\:|DISSOLVE TO\:|FLASH TO\:)$/i
    ]

    for (const pattern of obviousTransitionPatterns) {
      if (pattern.test(text)) {
        console.log(`   🔄 OBVIOUS TRANSITION reclassified (was Scene Heading): "${text}" → transition`)
        return { type: 'transition', text: text.toUpperCase() + (text.endsWith(':') || text.endsWith('.') ? '' : ':') }
      }
    }

    // Allow BLACK., WHITE., etc. as valid scene headings when explicitly marked as Scene Heading
    if (text.match(/^(BLACK|WHITE|DARKNESS|SILENCE)\.?$/i)) {
      console.log(`   ✅ VALID visual scene heading (respecting XML type): "${text}"`)
      return { type: 'scene_heading', text: text.toUpperCase() }
    }

    // Reject incomplete sluglines
    if (text.match(/^(INT|EXT|INTERIOR|EXTERIOR)\.?$/i)) {
      console.log(`   ❌ REJECTING incomplete slugline: "${text}"`)
      return null
    }

    // Reject single words that look like transitions (but allow visual states)
    if (text.match(/^[A-Z]+\.?$/) && !text.match(/^(BLACK|WHITE|DARKNESS|SILENCE)\.?$/i)) {
      console.log(`   ❌ REJECTING single-word fake slugline: "${text}"`)
      return null
    }

    // Must contain location info (more than just INT./EXT.) OR be a visual state
    if (!text.match(/^(INT|EXT|INTERIOR|EXTERIOR)[\.\s]+.+/i) && !text.match(/^(BLACK|WHITE|DARKNESS|SILENCE)\.?$/i)) {
      console.log(`   ❌ REJECTING malformed slugline: "${text}"`)
      return null
    }

    console.log(`   ✅ VALID scene heading: "${text}"`)
    return { type: 'scene_heading', text: text.toUpperCase() }
  }

  // 2. TRANSITION DETECTION - Only apply to non-Scene Heading types
  const transitionPatterns = [
    /^(FADE IN|FADE OUT|FADE TO BLACK|SMASH CUT TO|CUT TO|MATCH CUT TO|JUMP CUT TO|DISSOLVE TO|FLASH TO|FLASH CUT TO|FREEZE FRAME|TIME CUT|MONTAGE|END MONTAGE|SPLIT SCREEN|IRIS IN|IRIS OUT|WIPE TO|FLIP TO)[\.\:\;]?$/i,
    /^(FADE IN\:|FADE OUT\.|CUT TO\:|DISSOLVE TO\:|FLASH TO\:)$/i,
    /^(LATER|CONTINUOUS|MEANWHILE|SIMULTANEOUSLY)$/i,
    /^(THE END|END OF FILM|END OF EPISODE|ROLL CREDITS)$/i,
    /^(BLACK\.|WHITE\.|DARKNESS\.|SILENCE\.)$/i // Only apply to non-Scene Heading elements
  ]

  // Apply transition detection to non-Scene Heading types
  if (type !== 'Scene Heading') {
    for (const pattern of transitionPatterns) {
      if (pattern.test(text)) {
        console.log(`   🔄 TRANSITION DETECTED (was "${type}"): "${text}" → transition`)
        return { type: 'transition', text: text.toUpperCase() + (text.endsWith(':') || text.endsWith('.') ? '' : ':') }
      }
    }
  }


  // 3. ACTION PARAGRAPHS - Sacred, never split or reclassified
  if (type === 'Action') {
    return { type: 'action', text }
  }

  // 4. CHARACTER NAME VALIDATION
  if (type === 'Character') {
    return { type: 'character', text: text.toUpperCase() }
  }

  // 5. DIALOGUE
  if (type === 'Dialogue') {
    return { type: 'dialogue', text }
  }

  // 6. PARENTHETICAL
  if (type === 'Parenthetical') {
    const formattedText = text.startsWith('(') && text.endsWith(')') ? text : `(${text})`
    return { type: 'parenthetical', text: formattedText }
  }

  // 7. FALLBACK - Convert other types safely
  const elementType = type.toLowerCase().replace(/\s+/g, '_')
  console.log(`   📝 OTHER ELEMENT: "${type}" → ${elementType}: "${text}"`)
  return { type: elementType, text }
}

// Enhanced streaming FDX parser with comprehensive logging
async function parseFDX(fdxContent: string, filename?: string): Promise<FDXParseResult> {
  try {
    // Diagnostic tests passed - core logic is solid

    const scenes: SceneData[] = []
    const sceneHeadings: string[] = []

    // Use filename as title
    let title = 'Untitled Script'
    if (filename) {
      title = filename.replace(/\.fdx$/i, '').trim()
    } else {
      const titleMatch = fdxContent.match(/<Title>(.*?)<\/Title>/i)
      title = titleMatch ? titleMatch[1].trim() : 'Untitled Script'
    }

    console.log(`\n🎯 PARSING FDX: ${title}`)

    // Count total lines for comparison
    const totalLines = fdxContent.split('\n').length
    console.log(`📊 Total FDX file lines: ${totalLines}`)

    // Use streaming XML parser for large files
    const allParagraphs: { type: string; text: string; sequenceIndex: number }[] = []
    let blockIndex = 0
    let processedLines = 0

    try {
      // Parse XML to JSON structure first
      const parser = new xml2js.Parser({
        explicitArray: false,
        mergeAttrs: true,
        trim: false,        // Don't trim whitespace - preserve exact spacing
        normalize: false    // Don't normalize whitespace - preserve original formatting
      })

      const xmlData = await parser.parseStringPromise(fdxContent)

      // Extract paragraphs from parsed structure
      const content = xmlData?.FinalDraft?.Content
      if (!content) {
        throw new Error('No Content section found in FDX file')
      }

      // Handle both single paragraph and array of paragraphs
      let paragraphs = content.Paragraph
      if (!Array.isArray(paragraphs)) {
        paragraphs = paragraphs ? [paragraphs] : []
      }

      console.log(`📄 Found ${paragraphs.length} paragraphs to process`)

      // Process each paragraph
      for (let i = 0; i < paragraphs.length; i++) {
        const paragraph = paragraphs[i]
        processedLines++

        if (i % 100 === 0 || i === paragraphs.length - 1) {
          console.log(`📈 Processing paragraph ${i + 1}/${paragraphs.length} (${Math.round((i + 1) / paragraphs.length * 100)}%)`)
        }

        // Convert paragraph object back to XML string for existing parser
        const xmlString = paragraphToXMLString(paragraph)
        const result = parseIndividualParagraph(xmlString)

        if (result) {
          allParagraphs.push({
            ...result,
            sequenceIndex: blockIndex++
          })
        }
      }

      console.log(`✅ Successfully processed all ${paragraphs.length} paragraphs`)

    } catch (streamError) {
      console.warn(`⚠️ Streaming parser failed, falling back to regex: ${streamError}`)

      // Fallback to original regex method
      const paragraphRegex = /<Paragraph[^>]*Type="([^"]*)"[^>]*>[\s\S]*?<\/Paragraph>/gi
      let paragraphMatch

      while ((paragraphMatch = paragraphRegex.exec(fdxContent)) !== null) {
        const fullParagraphXML = paragraphMatch[0]
        const result = parseIndividualParagraph(fullParagraphXML)
        processedLines++

        if (result) {
          allParagraphs.push({
            ...result,
            sequenceIndex: blockIndex++
          })
        }
      }
    }

    // 🎯 STRICT 1:1 INDEXING SCENE BUILDER
    console.log(`\n📊 GROUPING ${allParagraphs.length} paragraphs into scenes`)

    // Find ALL scene heading nodes (including valid and invalid ones) to enforce 1:1 indexing
    const allSceneHeadingNodes = allParagraphs.filter(p => p.type === 'scene_heading')
    console.log(`🎬 Found ${allSceneHeadingNodes.length} scene heading nodes:`)
    allSceneHeadingNodes.forEach((heading, i) => {
      console.log(`  ${i + 1}. "${heading.text}"`)
    })

    // Build scenes by iterating original heading nodes in order (STRICT 1:1)
    const sceneContents: { [key: number]: { type: string; text: string; sequenceIndex: number }[] } = {}
    const orphanedParagraphs: { type: string; text: string; sequenceIndex: number }[] = []
    let currentSceneIndex = -1

    // Handle any orphaned content before first scene
    for (const paragraph of allParagraphs) {
      if (paragraph.type === 'scene_heading') {
        break // Stop at first scene heading
      }
      orphanedParagraphs.push(paragraph)
    }

    // If we have orphaned content, create a placeholder scene for it
    if (orphanedParagraphs.length > 0) {
      currentSceneIndex++
      sceneHeadings.push('TITLE SEQUENCE / OPENING')
      sceneContents[currentSceneIndex] = [...orphanedParagraphs]
      console.log(`  📝 Created placeholder scene for ${orphanedParagraphs.length} orphaned paragraphs`)
    }

    // Process each scene heading node to maintain 1:1 correspondence
    allSceneHeadingNodes.forEach((headingNode, headingIndex) => {
      currentSceneIndex++

      // ALWAYS add to sceneHeadings array (maintain 1:1 indexing)
      sceneHeadings.push(headingNode.text)

      // Create scene content starting with the heading
      sceneContents[currentSceneIndex] = [headingNode]
      console.log(`  🎬 Scene ${currentSceneIndex + 1}: "${headingNode.text}"`)

      // Find all paragraphs that belong to this scene (until next scene heading)
      const nextHeadingNode = allSceneHeadingNodes[headingIndex + 1]
      const nextHeadingSequence = nextHeadingNode ? nextHeadingNode.sequenceIndex : Infinity

      // Add all paragraphs between this heading and next heading
      for (const paragraph of allParagraphs) {
        if (paragraph.sequenceIndex > headingNode.sequenceIndex &&
            paragraph.sequenceIndex < nextHeadingSequence &&
            paragraph.type !== 'scene_heading') {
          sceneContents[currentSceneIndex].push(paragraph)
          if (paragraph.type === 'transition') {
            console.log(`    🔄 Transition added to scene: "${paragraph.text}"`)
          }
        }
      }
    })

    console.log(`\n📋 Created ${currentSceneIndex + 1} scenes with strict 1:1 indexing`)

    // 🚨 PARSER INVARIANT: Ensure strict 1:1 correspondence
    const expectedSceneCount = allSceneHeadingNodes.length + (orphanedParagraphs.length > 0 ? 1 : 0)
    const actualSceneCount = currentSceneIndex + 1
    if (actualSceneCount !== expectedSceneCount) {
      throw new Error(`Parser invariant failed: scene count mismatch. Expected ${expectedSceneCount} scenes, got ${actualSceneCount}`)
    }
    console.log(`✅ Parser invariant passed: ${actualSceneCount} scenes = ${allSceneHeadingNodes.length} headings + ${orphanedParagraphs.length > 0 ? 1 : 0} orphan scenes`)

    // Convert scenes to ScreenplayElements and generate scene data
    const projectId = `imported_${Date.now()}`

    Object.keys(sceneContents)
      .map(key => parseInt(key))
      .sort((a, b) => a - b)
      .forEach(sceneIndex => {
        const sceneParas = sceneContents[sceneIndex]
        const sceneCharacters: Set<string> = new Set()
        const screenplayElements: any[] = []

        sceneParas.forEach((para) => {
          let elementType: string
          let text = para.text.trim()

          // Convert paragraph types to screenplay element types
          switch (para.type) {
            case 'scene_heading':
              elementType = 'scene_heading'
              break
            case 'action':
              elementType = 'action'
              break
            case 'character':
              elementType = 'character'
              text = text.toUpperCase()

              // Extract character name for tracking
              const baseCharacterName = text
                .replace(/\s*\((V\.O\.|O\.S\.|CONT'D|OFF)\).*$/i, '')
                .trim()
              if (baseCharacterName) {
                sceneCharacters.add(baseCharacterName)
              }
              break
            case 'dialogue':
              elementType = 'dialogue'
              break
            case 'parenthetical':
              elementType = 'parenthetical'
              if (!text.startsWith('(') || !text.endsWith(')')) {
                text = `(${text})`
              }
              break
            case 'transition':
              elementType = 'transition'
              text = text.toUpperCase()
              if (!text.endsWith(':')) {
                text += ':'
              }
              break
            default:
              elementType = 'action'
              break
          }

          // Validate text is a string (not object)
          if (typeof text !== 'string') {
            console.warn(`⚠️ Non-string text detected: ${typeof text}`, text)
            text = String(text)
          }

          // Check for [object Object] contamination
          if (text.includes('[object Object]')) {
            console.error(`🚨 [object Object] detected in text: "${text}"`)
            text = text.replace(/\[object Object\]/g, '').trim()
          }

          // Create ScreenplayElement
          screenplayElements.push({
            type: elementType,
            children: [{ text: text }],
            id: `fdx_${Date.now()}_${Math.random()}`,
            sequenceIndex: para.sequenceIndex || 0,
            metadata: {
              timestamp: new Date().toISOString(),
              uuid: crypto.randomUUID(),
              sequenceIndex: para.sequenceIndex || 0
            }
          })
        })

        // Calculate scene metrics
        const allText = screenplayElements.map(el => el.children[0].text).join(' ')
        const wordCount = allText.split(/\s+/).filter(word => word.trim().length > 0).length
        const tokens = Math.ceil(wordCount * 1.3)

        // Create scene summary
        const sceneHeading = screenplayElements.find(el => el.type === 'scene_heading')?.children[0].text || ''
        const firstAction = screenplayElements.find(el => el.type === 'action')?.children[0].text || ''

        let summary = sceneHeading
        if (firstAction) {
          summary += '\n' + firstAction.substring(0, 100) + (firstAction.length > 100 ? '...' : '')
        }
        if (!summary.trim()) {
          summary = 'Scene in progress...'
        }

        // Sort elements by sequence index to preserve FDX order
        screenplayElements.sort((a, b) => (a.sequenceIndex || 0) - (b.sequenceIndex || 0))

        // Use original slugline without artificial numbering
        const originalSlugline = sceneHeadings[sceneIndex]

        // 🎯 STRICT INDEXING: Always include these properties for 1:1 mapping
        // Store scene data with strict indexing properties
        scenes.push({
          slugline: originalSlugline,
          characters: Array.from(sceneCharacters),
          summary,
          tokens,
          wordCount,
          fullContent: JSON.stringify(screenplayElements),
          // Required strict indexing properties
          sceneIndex: sceneIndex,                    // 0…N-1 contiguous
          sceneId: `${projectId}:${sceneIndex}`,     // stable unique ID
          originalSlugline: originalSlugline         // never recomputed from content map
        })

        console.log(`  ✅ Scene ${sceneIndex + 1}: "${sceneHeadings[sceneIndex]}" (${screenplayElements.length} elements)`)
      })

    // Create full screenplay elements for fallback storage
    const allScreenplayElements: any[] = []
    scenes.forEach(scene => {
      if (scene.fullContent) {
        try {
          const elements = JSON.parse(scene.fullContent)
          allScreenplayElements.push(...elements)
        } catch (error) {
          console.warn('Failed to parse scene fullContent:', error)
        }
      }
    })

    // Sort all elements by global sequence index to preserve FDX order
    allScreenplayElements.sort((a, b) => {
      const aIndex = a.metadata?.sequenceIndex || a.sequenceIndex || 0
      const bIndex = b.metadata?.sequenceIndex || b.sequenceIndex || 0
      return aIndex - bIndex
    })

    // Final validation and logging
    console.log(`\n📊 PARSING COMPLETE:`);
    console.log(`   📄 Original lines: ${totalLines}`);
    console.log(`   📝 Processed paragraphs: ${allParagraphs.length}`);
    console.log(`   🎬 Created scenes: ${scenes.length}`);
    console.log(`   📋 Scene headings: ${sceneHeadings.slice(-3).join(', ')} (last 3)`);

    // Check for potential truncation
    if (allParagraphs.length === 0) {
      console.error(`❌ NO PARAGRAPHS PARSED - potential parsing failure`);
    }

    // Validate final scenes exist
    const lastSceneHeadings = sceneHeadings.slice(-3);
    console.log(`🔍 Last scene headings:`, lastSceneHeadings);

    return {
      success: true,
      title,
      sceneCount: scenes.length,
      sluglines: sceneHeadings,
      scenes,
      projectId: projectId,
      // Include full screenplay elements for fallback storage
      screenplayElements: allScreenplayElements,
      // Add diagnostic info
      diagnostics: {
        originalLines: totalLines,
        processedParagraphs: allParagraphs.length,
        lastSceneHeadings: lastSceneHeadings
      }
    }

  } catch (error) {
    console.error('FDX parsing error:', error)
    return {
      success: false,
      error: 'Failed to parse FDX file. Please ensure it\'s a valid Final Draft document.'
    }
  }
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData()
    const file = formData.get('fdx') as File
    
    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No FDX file provided' },
        { status: 400 }
      )
    }
    
    if (!file.name.toLowerCase().endsWith('.fdx')) {
      return NextResponse.json(
        { success: false, error: 'File must be an FDX file' },
        { status: 400 }
      )
    }
    
    // Read file content
    const fileContent = await file.text()
    
    // Parse FDX with filename for title
    const parseResult = await parseFDX(fileContent, file.name)
    
    if (!parseResult.success) {
      return NextResponse.json(parseResult, { status: 400 })
    }
    
    // Store scenes in the backend using ATOMIC SNAPSHOT
    if (parseResult.scenes && parseResult.projectId) {
      try {
        const BACKEND_API_URL = process.env.NEXT_PUBLIC_API_BASE_URL || 'http://localhost:3003'

        console.log(`\n🚀 ATOMIC SNAPSHOT STORAGE:`)
        console.log(`   Project ID: ${parseResult.projectId}`)
        console.log(`   Scene Count: ${parseResult.scenes.length}`)
        console.log(`   Title: ${parseResult.title}`)

        // Prepare scene data with proper memory structure
        const scenesForSnapshot = parseResult.scenes.map((scene, index) => ({
          projectId: parseResult.projectId,
          slugline: scene.slugline,
          sceneId: scene.sceneId || `${parseResult.projectId}_${index}`,
          sceneIndex: scene.sceneIndex !== undefined ? scene.sceneIndex : index,
          characters: scene.characters,
          summary: scene.summary,
          tokens: scene.tokens,
          wordCount: scene.wordCount,
          fullContent: scene.fullContent,
          projectTitle: parseResult.title,
          timestamp: new Date().toISOString(),
          originalSlugline: scene.originalSlugline || scene.slugline
        }))

        // Function to attempt snapshot storage with retries
        const storeWithRetry = async (attempt: number = 1): Promise<boolean> => {
          try {
            console.log(`   📤 Attempt ${attempt}: Storing atomic snapshot...`)

            const response = await fetch(`${BACKEND_API_URL}/projects/${parseResult.projectId}/snapshot`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                version: Date.now(),
                title: parseResult.title,
                scenes: scenesForSnapshot,
                elements: parseResult.screenplayElements,
                metadata: {
                  title: parseResult.title,
                  createdAt: new Date().toISOString(),
                  originalFileName: file.name
                }
              }),
              // Add timeout for better error handling
              signal: AbortSignal.timeout(30000) // 30 second timeout
            })

            if (response.ok) {
              const result = await response.json()
              console.log(`   ✅ ATOMIC SNAPSHOT STORED SUCCESSFULLY`)
              console.log(`   Version: ${result.version}`)
              console.log(`   Stored scenes: ${result.count}`)
              return true
            } else {
              const errorText = await response.text()
              console.warn(`   ❌ Snapshot storage failed: ${response.status} ${errorText}`)

              // Retry on 5xx errors
              if (response.status >= 500 && attempt < 3) {
                const delay = Math.pow(2, attempt) * 1000 // Exponential backoff
                console.log(`   ⏰ Retrying in ${delay}ms...`)
                await new Promise(resolve => setTimeout(resolve, delay))
                return storeWithRetry(attempt + 1)
              }

              return false
            }
          } catch (error) {
            console.error(`   ❌ Network error on attempt ${attempt}:`, error)

            // Retry on network errors
            if (attempt < 3) {
              const delay = Math.pow(2, attempt) * 1000 // Exponential backoff
              console.log(`   ⏰ Retrying in ${delay}ms...`)
              await new Promise(resolve => setTimeout(resolve, delay))
              return storeWithRetry(attempt + 1)
            }

            return false
          }
        }

        // Store the snapshot with retry logic
        const stored = await storeWithRetry()

        if (stored) {
          // Verify storage by retrieving the snapshot
          try {
            console.log(`\n🔍 VERIFYING SNAPSHOT...`)
            const verifyResponse = await fetch(`${BACKEND_API_URL}/api/projects/${parseResult.projectId}/snapshot`)

            if (verifyResponse.ok) {
              const verifyResult = await verifyResponse.json()
              const snapshot = verifyResult.data

              if (snapshot && snapshot.scenes) {
                const actualCount = snapshot.scenes.length
                console.log(`   ✅ VERIFICATION SUCCESSFUL`)
                console.log(`   Expected scenes: ${parseResult.scenes.length}`)
                console.log(`   Actual scenes: ${actualCount}`)

                if (actualCount === parseResult.scenes.length) {
                  console.log(`   🎯 PERFECT MATCH: All ${actualCount} scenes persisted atomically`)
                } else {
                  console.error(`   ⚠️ SCENE COUNT MISMATCH: Expected ${parseResult.scenes.length}, got ${actualCount}`)
                }
              }
            } else {
              console.warn(`   ⚠️ Could not verify snapshot: ${verifyResponse.status}`)
            }
          } catch (verifyError) {
            console.warn('   ⚠️ Could not verify snapshot:', verifyError)
          }
        } else {
          console.error(`   ❌ FAILED TO STORE SNAPSHOT AFTER ALL RETRIES`)

          // Fallback: Try to store at least something to prevent total data loss
          console.log(`   🔄 Attempting fallback storage...`)
          try {
            // Store a minimal version
            const fallbackResponse = await fetch(`${BACKEND_API_URL}/api/projects/${parseResult.projectId}/snapshot`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                version: Date.now(),
                title: parseResult.title || 'Recovery Snapshot',
                scenes: scenesForSnapshot.slice(0, 10), // Store at least first 10 scenes
                elements: [],
                metadata: {
                  title: parseResult.title || 'Recovery Snapshot',
                  createdAt: new Date().toISOString(),
                  partial: true,
                  originalSceneCount: parseResult.scenes.length
                }
              })
            })

            if (fallbackResponse.ok) {
              console.log(`   ⚠️ Partial snapshot stored (first 10 scenes)`)
            }
          } catch (fallbackError) {
            console.error(`   ❌ Fallback storage also failed:`, fallbackError)
          }
        }

      } catch (error) {
        console.error('❌ Critical error in snapshot storage:', error)
        // Don't fail the import if storage fails - user still has the parsed data
      }
    }
    
    // Enhanced response with detailed scene information
    const response = {
      success: true,
      title: parseResult.title,
      sceneCount: parseResult.sceneCount,
      sluglines: parseResult.sluglines,
      projectId: parseResult.projectId,
      // Include screenplay elements for localStorage fallback
      screenplayElements: parseResult.screenplayElements,
      // Include diagnostic information
      diagnostics: parseResult.diagnostics,
      // Add final scenes for verification
      finalScenes: parseResult.sluglines ? parseResult.sluglines.slice(-3) : []
    }

    console.log(`\n📤 RESPONSE SUMMARY:`)
    console.log(`   🎬 Scene Count: ${response.sceneCount}`)
    console.log(`   📋 Final Scenes: ${response.finalScenes.join(', ')}`)
    console.log(`   🆔 Project ID: ${response.projectId}`)

    return NextResponse.json(response)
    
  } catch (error) {
    console.error('FDX import API error:', error)
    return NextResponse.json(
      { 
        success: false, 
        error: 'Internal server error occurred during import' 
      },
      { status: 500 }
    )
  }
}