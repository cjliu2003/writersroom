
process.chdir('frontend');
const xml2js = require('xml2js');
const fs = require('fs');

async function testParsing() {
  const fdxContent = fs.readFileSync('../sr_first_look_final.fdx', 'utf8');
  
  // Check ending
  const lines = fdxContent.split('
');
  const lastLines = lines.slice(-20);
  console.log('Last 20 lines of FDX:');
  lastLines.forEach((line, i) => {
    console.log(`${lines.length - 20 + i}: ${line}`);
  });
  
  // Count scene headings near end
  const lastParagraphs = fdxContent.match(/<Paragraph[^>]*Type="Scene Heading"[^>]*>[sS]*?</Paragraph>/gi);
  if (lastParagraphs) {
    console.log('
Last 3 Scene Headings:');
    lastParagraphs.slice(-3).forEach((para, i) => {
      console.log(`${i+1}: ${para}`);
    });
  }
}

testParsing().catch(console.error);
