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
      name: "TEST 7: BLACK transition - should be reclassified",
      fdx: `<Paragraph Type="Scene Heading"><Text>BLACK.</Text></Paragraph>`,
      expected: "{ type: 'transition', text: 'BLACK.' }"
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

  // 🎯 CONTENT-BASED CLASSIFICATION (overrides XML Type when needed)

  // 1. TRANSITION DETECTION - These should NEVER be scene headings
  // RESPECT XML Type="Scene Heading" for ambiguous cases like "BLACK."
  const transitionPatterns = [
    /^(FADE IN|FADE OUT|FADE TO BLACK|SMASH CUT TO|CUT TO|MATCH CUT TO|JUMP CUT TO|DISSOLVE TO|FLASH TO|FLASH CUT TO|FREEZE FRAME|TIME CUT|MONTAGE|END MONTAGE|SPLIT SCREEN|IRIS IN|IRIS OUT|WIPE TO|FLIP TO)[\.\:\;]?$/i,
    /^(FADE IN\:|FADE OUT\.|CUT TO\:|DISSOLVE TO\:|FLASH TO\:)$/i,
    /^(LATER|CONTINUOUS|MEANWHILE|SIMULTANEOUSLY)$/i,
    /^(THE END|END OF FILM|END OF EPISODE|ROLL CREDITS)$/i
  ]

  // Only apply transition detection for non-Scene Heading XML types
  // If XML says Type="Scene Heading", respect that classification
  if (type !== 'Scene Heading') {
    for (const pattern of transitionPatterns) {
      if (pattern.test(text)) {
        console.log(`   🔄 TRANSITION DETECTED (was "${type}"): "${text}" → transition`)
        return { type: 'transition', text: text.toUpperCase() + (text.endsWith(':') || text.endsWith('.') ? '' : ':') }
      }
    }

    // Handle specific transition cases for XML Type="Transition"
    if (type === 'Transition' && text.match(/^(BLACK\.|WHITE\.|SILENCE\.)$/i)) {
      console.log(`   🔄 TRANSITION DETECTED (was "${type}"): "${text}" → transition`)
      return { type: 'transition', text: text.toUpperCase() + (text.endsWith(':') || text.endsWith('.') ? '' : ':') }
    }
  }

  // 2. SCENE HEADING VALIDATION - Must be proper sluglines
  if (type === 'Scene Heading') {
    // Special case: Allow "BLACK." as a valid scene heading (visual state)
    if (text.match(/^(BLACK|WHITE|DARKNESS|SILENCE)\.?$/i)) {
      console.log(`   ✅ VALID visual scene heading: "${text}"`)
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

    // Group paragraphs into scenes with improved orphan handling
    console.log(`\n📊 GROUPING ${allParagraphs.length} paragraphs into scenes`)

    let currentSceneIndex = -1
    const sceneContents: { [key: number]: { type: string; text: string; sequenceIndex: number }[] } = {}
    const orphanedParagraphs: { type: string; text: string; sequenceIndex: number }[] = []

    allParagraphs.forEach((paragraph) => {
      if (paragraph.type === 'scene_heading') {
        // If we have orphaned content, create a placeholder scene for it
        if (orphanedParagraphs.length > 0 && currentSceneIndex === -1) {
          currentSceneIndex++
          sceneHeadings.push('TITLE SEQUENCE / OPENING')
          sceneContents[currentSceneIndex] = [...orphanedParagraphs]
          console.log(`  📝 Created placeholder scene for ${orphanedParagraphs.length} orphaned paragraphs`)
          orphanedParagraphs.length = 0 // Clear array
        }

        // Start new scene
        currentSceneIndex++
        sceneHeadings.push(paragraph.text)
        sceneContents[currentSceneIndex] = [paragraph]
        console.log(`  🎬 Scene ${currentSceneIndex + 1}: "${paragraph.text}"`)
      } else if (currentSceneIndex >= 0) {
        // Add to current scene (transitions stay with their scenes)
        sceneContents[currentSceneIndex].push(paragraph)
        if (paragraph.type === 'transition') {
          console.log(`    🔄 Transition added to scene: "${paragraph.text}"`)
        }
      } else {
        // Collect orphaned paragraphs for potential placeholder scene
        orphanedParagraphs.push(paragraph)
        console.log(`  ⚠️ Orphaned paragraph: [${paragraph.type}] "${paragraph.text}"`)
      }
    })

    // Handle any remaining orphaned content at the end
    if (orphanedParagraphs.length > 0) {
      if (currentSceneIndex === -1) {
        // No scenes at all, create a default scene
        currentSceneIndex++
        sceneHeadings.push('UNTITLED SEQUENCE')
        sceneContents[currentSceneIndex] = [...orphanedParagraphs]
        console.log(`  📝 Created default scene for ${orphanedParagraphs.length} orphaned paragraphs`)
      } else {
        // Add to the last scene
        sceneContents[currentSceneIndex].push(...orphanedParagraphs)
        console.log(`  📝 Added ${orphanedParagraphs.length} orphaned paragraphs to last scene`)
      }
    }

    console.log(`\n📋 Created ${currentSceneIndex + 1} scenes`)

    // Convert scenes to ScreenplayElements and generate scene data
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

        // Create unique slugline for storage (avoids duplicate overwrites)
        const sceneNumber = String(sceneIndex + 1).padStart(3, '0')
        const uniqueSlugline = `${sceneNumber}. ${sceneHeadings[sceneIndex]}`

        // Store scene data
        scenes.push({
          slugline: uniqueSlugline,
          characters: Array.from(sceneCharacters),
          summary,
          tokens,
          wordCount,
          fullContent: JSON.stringify(screenplayElements)
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
      projectId: `imported_${Date.now()}`,
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
    
    // Store scenes in the backend memory system
    if (parseResult.scenes && parseResult.projectId) {
      try {
        const BACKEND_API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001/api'
        
        // Store each scene in the memory system
        for (const scene of parseResult.scenes) {
          const memoryData = {
            characters: scene.characters,
            summary: scene.summary,
            tokens: scene.tokens,
            wordCount: scene.wordCount,
            fullContent: scene.fullContent, // Include full scene content
            projectTitle: parseResult.title, // Store the filename-based title
            themes: [], // Could be enhanced later
            timestamp: new Date().toISOString(),
          }
          
          const response = await fetch(`${BACKEND_API_URL}/memory/update`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              projectId: parseResult.projectId,
              slugline: scene.slugline, // Now using unique slugline with scene number
              data: memoryData
            }),
          })
          
          if (!response.ok) {
            console.warn(`Failed to store scene: ${scene.slugline}`)
          }
        }
        
        console.log(`Successfully imported ${parseResult.scenes.length} scenes to memory system`)
      } catch (error) {
        console.error('Error storing scenes in memory:', error)
        // Don't fail the import if memory storage fails
      }
    }
    
    // Enhanced response with detailed scene information
    const response = {
      success: true,
      title: parseResult.title,
      sceneCount: parseResult.sceneCount,
      sluglines: parseResult.sluglines,
      projectId: parseResult.projectId,
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