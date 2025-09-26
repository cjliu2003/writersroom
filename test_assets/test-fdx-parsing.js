const fs = require('fs');
const path = require('path');

// No xml2js needed for basic text analysis

async function testFDXParsing() {
  try {
    const fdxContent = fs.readFileSync('./sr_first_look_final.fdx', 'utf8');
    console.log('FDX file size:', fdxContent.length, 'characters');

    // Count total scene headings
    const sceneHeadings = fdxContent.match(/<Paragraph[^>]*Type="Scene Heading"[^>]*>/g);
    console.log('Total Scene Heading tags found:', sceneHeadings ? sceneHeadings.length : 0);

    // Extract the last few paragraphs to check ending
    const allParagraphs = fdxContent.match(/<Paragraph[^>]*Type="[^"]*"[^>]*>[\s\S]*?<\/Paragraph>/gi);
    console.log('Total paragraphs found:', allParagraphs ? allParagraphs.length : 0);

    if (allParagraphs && allParagraphs.length > 3) {
      console.log('\nLast 3 paragraphs:');
      allParagraphs.slice(-3).forEach((para, i) => {
        const typeMatch = para.match(/Type="([^"]*)"/);
        const type = typeMatch ? typeMatch[1] : 'unknown';
        const textMatch = para.match(/<Text[^>]*>(.*?)<\/Text>/);
        const text = textMatch ? textMatch[1] : 'no text';
        console.log(`${i+1}. Type: ${type}, Text: "${text}"`);
      });
    }

    // Check for BLACK transitions specifically
    const blackTransitions = fdxContent.match(/<Paragraph[^>]*Type="[^"]*"[^>]*>[\s\S]*?BLACK\.?[\s\S]*?<\/Paragraph>/gi);
    console.log('\nParagraphs containing "BLACK":', blackTransitions ? blackTransitions.length : 0);

    if (blackTransitions) {
      blackTransitions.slice(0, 3).forEach((para, i) => {
        const typeMatch = para.match(/Type="([^"]*)"/);
        const type = typeMatch ? typeMatch[1] : 'unknown';
        console.log(`BLACK ${i+1}: Type="${type}"`);
        console.log(para.substring(0, 200) + '...');
      });
    }

  } catch (error) {
    console.error('Error testing FDX parsing:', error);
  }
}

testFDXParsing();