import { NextRequest, NextResponse } from 'next/server'

interface SceneData {
  slugline: string
  characters: string[]
  summary: string
  tokens: number
  wordCount: number
}

interface FDXParseResult {
  success: boolean
  title?: string
  sceneCount?: number
  sluglines?: string[]
  scenes?: SceneData[]
  projectId?: string
  error?: string
}

// Enhanced FDX parser - extracts full scene content for proper script display
function parseFDX(fdxContent: string): FDXParseResult {
  try {
    // Parse FDX XML to extract structured scene data
    const scenes: SceneData[] = []
    const sceneHeadings: string[] = []

    // Extract title
    const titleMatch = fdxContent.match(/<Title>(.*?)<\/Title>/i)
    const title = titleMatch ? titleMatch[1].trim() : 'Untitled Script'

    // Find all paragraph elements with their types
    const paragraphRegex = /<Paragraph[^>]*Type="([^"]*)"[^>]*>.*?<Text[^>]*>(.*?)<\/Text>.*?<\/Paragraph>/gi
    let paragraphMatch
    const allParagraphs: { type: string; text: string }[] = []

    // Extract all paragraphs
    while ((paragraphMatch = paragraphRegex.exec(fdxContent)) !== null) {
      const type = paragraphMatch[1].trim()
      const text = paragraphMatch[2].replace(/<[^>]*>/g, '').trim()
      if (text) {
        allParagraphs.push({ type, text })
      }
    }

    // Group paragraphs by scenes
    let currentSceneIndex = -1
    const sceneContents: { [key: number]: { type: string; text: string }[] } = {}
    const allCharacters: Set<string> = new Set()

    allParagraphs.forEach(paragraph => {
      if (paragraph.type === 'Scene Heading') {
        currentSceneIndex++
        sceneHeadings.push(paragraph.text)
        sceneContents[currentSceneIndex] = [paragraph]
      } else if (currentSceneIndex >= 0) {
        sceneContents[currentSceneIndex].push(paragraph)

        // Collect character names
        if (paragraph.type === 'Character') {
          allCharacters.add(paragraph.text.toUpperCase())
        }
      }
    })

    // Convert scene contents to proper screenplay format and create scene data
    Object.keys(sceneContents).forEach(indexStr => {
      const index = parseInt(indexStr)
      const sceneParas = sceneContents[index]
      let sceneText = ''
      const sceneCharacters: Set<string> = new Set()

      sceneParas.forEach((para, paraIndex) => {
        switch (para.type) {
          case 'Scene Heading':
            sceneText += para.text + '\n\n'
            break
          case 'Action':
            sceneText += para.text + '\n\n'
            break
          case 'Character':
            sceneText += para.text.toUpperCase() + '\n'
            sceneCharacters.add(para.text.toUpperCase())
            break
          case 'Dialogue':
            sceneText += para.text + '\n\n'
            break
          case 'Parenthetical':
            sceneText += `(${para.text})\n`
            break
          case 'Transition':
            sceneText += para.text.toUpperCase() + '\n\n'
            break
          default:
            // Handle other types as action lines
            sceneText += para.text + '\n\n'
            break
        }
      })

      // Calculate metrics
      const wordCount = sceneText.split(/\s+/).length
      const tokens = Math.ceil(wordCount * 1.3) // Rough estimate

      // Create summary from action lines (first 200 chars)
      const actionLines = sceneParas
        .filter(p => p.type === 'Action')
        .map(p => p.text)
        .join(' ')
      const summary = actionLines.length > 200
        ? actionLines.substring(0, 200) + '...'
        : actionLines || 'No action description available.'

      scenes.push({
        slugline: sceneHeadings[index],
        characters: Array.from(sceneCharacters),
        summary,
        tokens,
        wordCount,
        fullContent: sceneText.trim() // Store full scene content
      })
    })

    return {
      success: true,
      title,
      sceneCount: scenes.length,
      sluglines: sceneHeadings,
      scenes,
      projectId: `imported_${Date.now()}`
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
    
    // Parse FDX
    const parseResult = parseFDX(fileContent)
    
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
              slugline: scene.slugline,
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
    
    return NextResponse.json({
      success: true,
      title: parseResult.title,
      sceneCount: parseResult.sceneCount,
      sluglines: parseResult.sluglines,
      projectId: parseResult.projectId
    })
    
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