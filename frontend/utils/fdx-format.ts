import { ScreenplayElement, ScreenplayBlockType } from '@/types/screenplay'

// FDX-compatible element type mappings
export const FDX_ELEMENT_TYPES: Record<ScreenplayBlockType, string> = {
  'scene_heading': 'Scene Heading',
  'action': 'Action',
  'character': 'Character',
  'parenthetical': 'Parenthetical',
  'dialogue': 'Dialogue',
  'transition': 'Transition',
  'shot': 'Shot',
  'general': 'General',
  'cast_list': 'Cast List',
  'new_act': 'New Act',
  'end_of_act': 'End of Act',
  'summary': 'Summary'
}

// Industry standard line counts for pagination
export const LINES_PER_PAGE = 55
export const CHARACTERS_PER_LINE = 61

// FDX paragraph structure
export interface FDXParagraph {
  Type: string
  Text: string
  Number?: number
  DualDialogue?: boolean
}

// Convert Slate elements to FDX format
export function convertToFDX(elements: ScreenplayElement[]): {
  paragraphs: FDXParagraph[]
  pages: number
  wordCount: number
} {
  const paragraphs: FDXParagraph[] = []
  let lineCount = 0
  let pageCount = 1
  let totalWords = 0

  elements.forEach((element, index) => {
    const text = element.children.map(child => child.text).join('')
    const fdxType = FDX_ELEMENT_TYPES[element.type]
    
    // Calculate lines this element will take
    const elementLines = calculateElementLines(element.type, text)
    
    // Check if we need a new page
    if (lineCount + elementLines > LINES_PER_PAGE && lineCount > 0) {
      pageCount++
      lineCount = 0
    }
    
    paragraphs.push({
      Type: fdxType,
      Text: text,
      Number: index + 1,
      DualDialogue: element.isDualDialogue
    })
    
    lineCount += elementLines
    totalWords += text.split(/\s+/).filter(word => word.length > 0).length
  })

  return {
    paragraphs,
    pages: pageCount,
    wordCount: totalWords
  }
}

// Calculate how many lines an element will take based on Final Draft standards
function calculateElementLines(type: ScreenplayBlockType, text: string): number {
  if (!text.trim()) return 1

  const baseLines = Math.ceil(text.length / getMaxCharactersForType(type))
  
  // Add spacing based on element type
  switch (type) {
    case 'scene_heading':
      return baseLines + 2 // Extra spacing after scene headings
    case 'character':
      return baseLines + 1 // Space before character
    case 'transition':
      return baseLines + 2 // Extra spacing for transitions
    case 'action':
      return baseLines + 1 // Standard paragraph spacing
    default:
      return baseLines
  }
}

// Get max characters per line for different element types
function getMaxCharactersForType(type: ScreenplayBlockType): number {
  switch (type) {
    case 'scene_heading':
      return 61 // Full width
    case 'action':
      return 61 // Full width
    case 'character':
      return 20 // Centered, shorter
    case 'parenthetical':
      return 25 // Indented
    case 'dialogue':
      return 35 // Standard dialogue width
    case 'transition':
      return 20 // Right-aligned, shorter
    default:
      return 61
  }
}

// Export to FDX XML format
export function exportToFDXXML(elements: ScreenplayElement[], title: string = 'Untitled'): string {
  const { paragraphs } = convertToFDX(elements)
  
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="12">
  <Content>
    <TitlePage>
      <Content>
        <Paragraph Type="Title">
          <Text>${title}</Text>
        </Paragraph>
      </Content>
    </TitlePage>
    <Body>
      ${paragraphs.map(p => `
      <Paragraph Type="${p.Type}"${p.DualDialogue ? ' DualDialogue="true"' : ''}>
        <Text>${escapeXML(p.Text)}</Text>
      </Paragraph>`).join('')}
    </Body>
  </Content>
</FinalDraft>`

  return xml
}

function escapeXML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Calculate page breaks for display
export function calculatePageBreaks(elements: ScreenplayElement[]): {
  pages: Array<{
    number: number
    elements: ScreenplayElement[]
    lines: number
  }>
} {
  const pages: Array<{
    number: number
    elements: ScreenplayElement[]
    lines: number
  }> = []
  
  let currentPage = {
    number: 1,
    elements: [] as ScreenplayElement[],
    lines: 0
  }
  
  elements.forEach(element => {
    const elementLines = calculateElementLines(element.type, 
      element.children.map(child => child.text).join(''))
    
    // Check if adding this element would exceed page limit
    if (currentPage.lines + elementLines > LINES_PER_PAGE && currentPage.elements.length > 0) {
      // Finish current page
      pages.push({ ...currentPage })
      
      // Start new page
      currentPage = {
        number: pages.length + 1,
        elements: [element],
        lines: elementLines
      }
    } else {
      // Add to current page
      currentPage.elements.push(element)
      currentPage.lines += elementLines
    }
  })
  
  // Add final page if it has content
  if (currentPage.elements.length > 0) {
    pages.push(currentPage)
  }
  
  return { pages: pages.length > 0 ? pages : [{ number: 1, elements: [], lines: 0 }] }
}