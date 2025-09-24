const content = `INT. COFFEE SHOP - DAY

JOHN, 30s, sits at a small table reading a newspaper.

JOHN
I can't believe this is happening.

MARY
John! I've been looking for you.`

const lines = content.split('\n')
const elements = []
let currentElement = null

lines.forEach(line => {
  const trimmedLine = line.trim()

  if (!trimmedLine) {
    if (currentElement) {
      elements.push({type: currentElement.type, text: currentElement.text})
      currentElement = null
    }
    return
  }

  let elementType = 'action'

  if (trimmedLine.match(/^(INT\.|EXT\.)/i)) {
    elementType = 'scene_heading'
  } else if (trimmedLine.match(/^\([^)]+\)$/)) {
    elementType = 'parenthetical'
  } else if (currentElement && currentElement.type === 'character') {
    elementType = 'dialogue'
  } else if (trimmedLine === trimmedLine.toUpperCase() &&
             trimmedLine.match(/^[A-Z][A-Z\s]*$/) &&
             trimmedLine.length > 1 &&
             !trimmedLine.match(/\./)) {
    elementType = 'character'
  }

  if (currentElement && currentElement.type !== elementType) {
    elements.push({type: currentElement.type, text: currentElement.text})
    currentElement = null
  }

  if (!currentElement) {
    currentElement = { type: elementType, text: trimmedLine }
  } else {
    if (currentElement.text) {
      currentElement.text += ' ' + trimmedLine
    } else {
      currentElement.text = trimmedLine
    }
  }
})

if (currentElement) {
  elements.push({type: currentElement.type, text: currentElement.text})
}

console.log('Parsed elements:')
elements.forEach((el, i) => console.log(`${i}: ${el.type} -> "${el.text}"`))