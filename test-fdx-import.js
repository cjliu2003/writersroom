const fs = require('fs');
const FormData = require('form-data');

async function testFDXImport() {
  try {
    const fetch = (await import('node-fetch')).default;
    // Create form data
    const form = new FormData();
    const fdxBuffer = fs.readFileSync('./sr_first_look_final.fdx');
    form.append('fdx', fdxBuffer, 'sr_first_look_final.fdx');

    console.log('🚀 Testing FDX import API...');

    // Send to import API
    const response = await fetch('http://localhost:3000/api/fdx/import', {
      method: 'POST',
      body: form
    });

    const result = await response.json();
    console.log('📊 API Response Status:', response.status);
    console.log('📋 Success:', result.success);

    if (result.success) {
      console.log('🎬 Scene Count:', result.sceneCount);
      console.log('📝 Project ID:', result.projectId);
      console.log('🔍 Final Scenes:', result.finalScenes);
      console.log('📊 Diagnostics:', result.diagnostics);

      // Test memory API
      console.log('\n🧠 Testing memory retrieval...');
      const memoryResponse = await fetch(`http://localhost:3001/api/memory/all?projectId=${result.projectId}`);
      const memoryResult = await memoryResponse.json();

      console.log('Memory Response Status:', memoryResponse.status);
      console.log('Memory Success:', memoryResult.success);
      if (memoryResult.success) {
        console.log('Memory Scene Count:', memoryResult.data.length);
        console.log('First scene slugline:', memoryResult.data[0]?.slugline);
        console.log('Last scene slugline:', memoryResult.data[memoryResult.data.length - 1]?.slugline);
      }
    } else {
      console.error('❌ Import failed:', result.error);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

testFDXImport();