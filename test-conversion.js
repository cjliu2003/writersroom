// Test the fullContent to ScreenplayElement conversion
const fullContent1 = `INT. COFFEE SHOP - DAY

JOHN, 30s, sits at a small table reading a newspaper. The coffee shop is busy with morning customers.

JOHN
I can't believe this is happening.

MARY, 20s, enters the coffee shop and spots John. She walks over quickly.

MARY
John! I've been looking everywhere for you.

JOHN
(looking up from his paper)
Mary? What are you doing here?`;

const fullContent2 = `EXT. PARK - LATER

John and Mary walk through the park, deep in conversation. The sun filters through the trees.

JOHN
This changes everything we thought we knew.

MARY
(looking around nervously)
We have to tell someone.

FADE OUT.`;

function parseFullContentToElements(fullContent) {
  const lines = fullContent.split('\n');
  const elements = [];
  let currentElement = null;

  lines.forEach(line => {
    const trimmedLine = line.trim();

    if (!trimmedLine) {
      if (currentElement) {
        elements.push(currentElement);
        currentElement = null;
      }
      return;
    }

    let elementType = 'action';

    if (trimmedLine.match(/^(INT\.|EXT\.)/i)) {
      elementType = 'scene_heading';
    } else if (trimmedLine.match(/^\([^)]+\)$/)) {
      elementType = 'parenthetical';
    } else if (trimmedLine.match(/^(FADE IN:|FADE OUT:|CUT TO:|DISSOLVE TO:)/i)) {
      elementType = 'transition';
    } else if (currentElement && currentElement.type === 'character') {
      elementType = 'dialogue';
    } else if (trimmedLine === trimmedLine.toUpperCase() &&
               trimmedLine.match(/^[A-Z][A-Z\s]*$/) &&
               trimmedLine.length > 1 &&
               !trimmedLine.match(/\./)) {
      elementType = 'character';
    }

    if (currentElement && currentElement.type !== elementType) {
      elements.push(currentElement);
      currentElement = null;
    }

    if (!currentElement) {
      currentElement = {
        type: elementType,
        children: [{ text: trimmedLine }],
        id: `element_${Date.now()}_${Math.random()}`,
        metadata: {
          timestamp: new Date().toISOString(),
          uuid: 'test-uuid'
        }
      };
    } else {
      if (currentElement.children[0].text) {
        currentElement.children[0].text += ' ' + trimmedLine;
      } else {
        currentElement.children[0].text = trimmedLine;
      }
    }
  });

  if (currentElement) {
    elements.push(currentElement);
  }

  return elements;
}

console.log('=== SCENE 1 CONVERSION ===');
const scene1Elements = parseFullContentToElements(fullContent1);
scene1Elements.forEach((el, i) => {
  console.log(`${i}: ${el.type} -> "${el.children[0].text}"`);
});

console.log('\n=== SCENE 2 CONVERSION ===');
const scene2Elements = parseFullContentToElements(fullContent2);
scene2Elements.forEach((el, i) => {
  console.log(`${i}: ${el.type} -> "${el.children[0].text}"`);
});

console.log('\n=== COMBINED SCREENPLAY ELEMENTS ===');
const allElements = [...scene1Elements, ...scene2Elements];
const screenplayJson = JSON.stringify(allElements, null, 2);
console.log('Total elements:', allElements.length);
console.log('JSON length:', screenplayJson.length);
console.log('Valid JSON:', (() => {
  try {
    JSON.parse(screenplayJson);
    return 'YES';
  } catch (e) {
    return 'NO: ' + e.message;
  }
})());