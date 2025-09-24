/**
 * Test FDX File Fixtures
 *
 * Contains various FDX file samples for testing different scenarios.
 */

export const FDX_FIXTURES = {
  /**
   * Simple FDX with 3 unique scenes
   */
  SIMPLE_THREE_SCENES: `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    <Paragraph Type="Scene Heading">
      <Text>INT. OFFICE - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>JOHN sits at his desk, reviewing documents.</Text>
    </Paragraph>
    <Paragraph Type="Character">
      <Text>JOHN</Text>
    </Paragraph>
    <Paragraph Type="Dialogue">
      <Text>These numbers don't add up.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>EXT. PARKING LOT - NIGHT</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Rain pours down. John runs to his car.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>INT. CAR - CONTINUOUS</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>John starts the engine and drives away.</Text>
    </Paragraph>
  </Content>
</FinalDraft>`,

  /**
   * FDX with duplicate sluglines
   */
  DUPLICATE_SLUGLINES: `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    <Paragraph Type="Scene Heading">
      <Text>INT. APARTMENT - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Morning. Coffee brewing.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>EXT. STREET - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Busy traffic.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>INT. APARTMENT - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Afternoon. Phone rings.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>INT. APARTMENT - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Evening. Packing boxes.</Text>
    </Paragraph>
  </Content>
</FinalDraft>`,

  /**
   * FDX with transitions
   */
  WITH_TRANSITIONS: `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    <Paragraph Type="Scene Heading">
      <Text>FADE IN:</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>INT. BEDROOM - MORNING</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Alarm clock rings.</Text>
    </Paragraph>

    <Paragraph Type="Transition">
      <Text>CUT TO:</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>INT. KITCHEN - LATER</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Breakfast on the table.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>FADE OUT.</Text>
    </Paragraph>
  </Content>
</FinalDraft>`,

  /**
   * Malformed FDX for error testing
   */
  MALFORMED: `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    <Paragraph Type="Scene Heading">
      <Text>INT.</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Incomplete slugline above.</Text>
    </Paragraph>

    <Paragraph Type="Scene Heading">
      <Text>EXT</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Another incomplete slugline.</Text>
    </Paragraph>
  </Content>
</FinalDraft>`,

  /**
   * Empty FDX
   */
  EMPTY: `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
  </Content>
</FinalDraft>`,

  /**
   * FDX with special characters
   */
  SPECIAL_CHARACTERS: `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>
    <Paragraph Type="Scene Heading">
      <Text>INT. CAFÉ - DAY</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>A sign reads: "Today's Special: Crème Brûlée"</Text>
    </Paragraph>
    <Paragraph Type="Character">
      <Text>FRANÇOIS</Text>
    </Paragraph>
    <Paragraph Type="Dialogue">
      <Text>C'est magnifique!</Text>
    </Paragraph>
  </Content>
</FinalDraft>`,

  /**
   * Large FDX with many scenes
   */
  LARGE: generateLargeFDX(20)
};

/**
 * Generate a large FDX with specified number of scenes
 */
function generateLargeFDX(sceneCount: number): string {
  const scenes = [];

  for (let i = 0; i < sceneCount; i++) {
    const location = ['OFFICE', 'STREET', 'APARTMENT', 'RESTAURANT', 'PARK'][i % 5];
    const time = ['DAY', 'NIGHT', 'MORNING', 'EVENING', 'CONTINUOUS'][i % 5];
    const intExt = i % 2 === 0 ? 'INT' : 'EXT';

    scenes.push(`
    <Paragraph Type="Scene Heading">
      <Text>${intExt}. ${location} - ${time}</Text>
    </Paragraph>
    <Paragraph Type="Action">
      <Text>Scene ${i + 1} action description goes here.</Text>
    </Paragraph>
    <Paragraph Type="Character">
      <Text>CHARACTER ${i + 1}</Text>
    </Paragraph>
    <Paragraph Type="Dialogue">
      <Text>This is dialogue for scene ${i + 1}.</Text>
    </Paragraph>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<FinalDraft DocumentType="Script" Template="No" Version="1">
  <Content>${scenes.join('')}
  </Content>
</FinalDraft>`;
}

/**
 * Expected parse results for each fixture
 */
export const EXPECTED_RESULTS = {
  SIMPLE_THREE_SCENES: {
    sceneCount: 3,
    sluglines: [
      'INT. OFFICE - DAY',
      'EXT. PARKING LOT - NIGHT',
      'INT. CAR - CONTINUOUS'
    ],
    hasCharacters: true,
    hasDialogue: true
  },

  DUPLICATE_SLUGLINES: {
    sceneCount: 4,
    sluglines: [
      'INT. APARTMENT - DAY',
      'EXT. STREET - DAY',
      'INT. APARTMENT - DAY',
      'INT. APARTMENT - DAY'
    ],
    duplicateCount: {
      'INT. APARTMENT - DAY': 3
    }
  },

  WITH_TRANSITIONS: {
    sceneCount: 2, // FADE IN/OUT aren't scenes
    sluglines: [
      'INT. BEDROOM - MORNING',
      'INT. KITCHEN - LATER'
    ],
    hasTransitions: true
  },

  MALFORMED: {
    sceneCount: 0, // Incomplete sluglines should be rejected
    sluglines: []
  },

  EMPTY: {
    sceneCount: 0,
    sluglines: []
  },

  SPECIAL_CHARACTERS: {
    sceneCount: 1,
    sluglines: ['INT. CAFÉ - DAY'],
    hasSpecialChars: true
  },

  LARGE: {
    sceneCount: 20,
    hasAllScenes: true
  }
};