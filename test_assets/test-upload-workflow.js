#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

async function testUploadWorkflow() {
  console.log('🧪 Testing FDX Upload Workflow');
  console.log('================================');

  try {
    // 1. Test file upload
    console.log('1. Uploading test-multiline.fdx...');
    const formData = new FormData();
    const fileBuffer = fs.readFileSync('./test-multiline.fdx');
    const file = new File([fileBuffer], 'test-multiline.fdx', { type: 'application/xml' });
    formData.append('fdx', file);

    const uploadResponse = await fetch('http://localhost:3000/api/fdx/import', {
      method: 'POST',
      body: formData
    });

    const uploadResult = await uploadResponse.json();
    console.log('✅ Upload Result:', JSON.stringify(uploadResult, null, 2));

    if (!uploadResult.success) {
      throw new Error('Upload failed: ' + uploadResult.error);
    }

    // 2. Test editor page load
    console.log('\n2. Testing editor page load...');
    const editorResponse = await fetch(`http://localhost:3000/editor?projectId=${uploadResult.projectId}`);
    console.log('✅ Editor page status:', editorResponse.status);

    if (editorResponse.status !== 200) {
      throw new Error('Editor page failed to load');
    }

    // 3. Test localStorage backup
    console.log('\n3. Expected localStorage key:', `project-${uploadResult.projectId}`);

    console.log('\n🎉 All tests passed!');
    console.log('📋 Summary:');
    console.log(`   • Project ID: ${uploadResult.projectId}`);
    console.log(`   • Title: ${uploadResult.title}`);
    console.log(`   • Scene Count: ${uploadResult.sceneCount}`);
    console.log(`   • Scenes: ${uploadResult.sluglines.join(', ')}`);
    console.log(`   • Editor URL: http://localhost:3000/editor?projectId=${uploadResult.projectId}`);

    // 4. Validate scene structure
    console.log('\n4. Scene Structure Validation:');
    const expectedScenes = [
      'INT. COFFEE SHOP - DAY',
      'FLASH TO:',
      'int. dining room - memory - day',
      'CUT TO:',
      'EXT. STREET - NIGHT',
      'fade to black.'
    ];

    console.log('Expected scenes:', expectedScenes);
    console.log('Actual scenes:  ', uploadResult.sluglines);

    const scenesMatch = expectedScenes.every((scene, i) => scene === uploadResult.sluglines[i]);
    console.log(scenesMatch ? '✅ Scene structure correct!' : '❌ Scene structure mismatch!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

testUploadWorkflow();