import { describe, expect, it } from 'vitest';
import { protectEntities } from '../protect';
import {
  disambiguate,
  expandContractions,
  joinSegments,
  normalizeTimes,
  protectForTranslation,
  protectTerms,
  splitSentences,
} from './rules';

const texts = (input: string) => splitSentences(input).map((s) => s.text);

describe('splitSentences', () => {
  it('splits on full stops, question and exclamation marks and keeps the separators', () => {
    const input = 'Hello there. How are you?  I am fine!';
    expect(splitSentences(input)).toEqual([
      { text: 'Hello there.', sep: ' ' },
      { text: 'How are you?', sep: '  ' },
      { text: 'I am fine!', sep: '' },
    ]);
  });

  it('round-trips any input exactly', () => {
    for (const input of [
      '',
      '   ',
      '  indented text.  ',
      '- Monitor production systems.\n- Lead the team. Improve uptime.\n\n1. First step\r\n2) Second',
      'One.\n\n\nTwo?   Three!\t',
      '你好。我很好！',
    ]) {
      expect(joinSegments(splitSentences(input))).toBe(input);
    }
  });

  it('moves line breaks, indents and bullets into the separator', () => {
    expect(splitSentences('- Monitor production systems.\n- Lead the team. Improve uptime.\n\n1. First step')).toEqual([
      { text: '', sep: '- ' },
      { text: 'Monitor production systems.', sep: '\n- ' },
      { text: 'Lead the team.', sep: ' ' },
      { text: 'Improve uptime.', sep: '\n\n1. ' },
      { text: 'First step', sep: '' },
    ]);
    expect(texts('• Python\n• SQL\n  a) first\n  b) second')).toEqual(['', 'Python', 'SQL', 'first', 'second']);
  });

  it('does not treat a number or hyphen at the start of a line as a bullet unless a space follows', () => {
    expect(texts('3.5 kg of rice\n-5 degrees outside')).toEqual(['3.5 kg of rice', '-5 degrees outside']);
  });

  it('does not split after titles and common abbreviations', () => {
    expect(texts('Mr. Smith met Dr. Jones and Prof. Lee. They talked.')).toEqual(['Mr. Smith met Dr. Jones and Prof. Lee.', 'They talked.']);
    expect(texts('Bring fruit, e.g. apples, i.e. something fresh. Thanks.')).toEqual([
      'Bring fruit, e.g. apples, i.e. something fresh.',
      'Thanks.',
    ]);
    expect(texts('Ask for approx. 3 kg vs. 5 kg. Then pay.')).toEqual(['Ask for approx. 3 kg vs. 5 kg.', 'Then pay.']);
  });

  it('keeps numbered abbreviations with their number', () => {
    expect(texts('Room No. 5 is free. Vol. 2 is out.')).toEqual(['Room No. 5 is free.', 'Vol. 2 is out.']);
    expect(texts('The answer is no. We will not go.')).toEqual(['The answer is no.', 'We will not go.']);
  });

  it('splits after abbreviations that can end a sentence only when a sentence clearly starts', () => {
    expect(texts('I work at Acme Inc. The company is big.')).toEqual(['I work at Acme Inc.', 'The company is big.']);
    expect(texts('Apple Inc. announced it.')).toEqual(['Apple Inc. announced it.']);
    expect(texts('He served in the U.S. Army for years.')).toEqual(['He served in the U.S. Army for years.']);
    expect(texts('He lives in the U.S. We live in Kuwait.')).toEqual(['He lives in the U.S.', 'We live in Kuwait.']);
    expect(texts('Meet at 5 p.m. The room is booked.')).toEqual(['Meet at 5 p.m.', 'The room is booked.']);
    expect(texts('We sell pens, paper, etc. Prices vary.')).toEqual(['We sell pens, paper, etc.', 'Prices vary.']);
    expect(texts('John F. Kennedy spoke.')).toEqual(['John F. Kennedy spoke.']);
  });

  it('never splits inside decimals, emails, web addresses or placeholders', () => {
    expect(texts('Prices rose 3.5% today. Email a.b@c.com. Visit www.x.com/a?b=1 now. Call {{0}}. Done.')).toEqual([
      'Prices rose 3.5% today.',
      'Email a.b@c.com.',
      'Visit www.x.com/a?b=1 now.',
      'Call {{0}}.',
      'Done.',
    ]);
  });

  it('keeps closing quotes and brackets with their sentence', () => {
    expect(texts('He said "Stop." Then he left. (See below.) Next one.')).toEqual([
      'He said "Stop."',
      'Then he left.',
      '(See below.)',
      'Next one.',
    ]);
  });

  it('does not split before a lowercase continuation', () => {
    expect(texts('"Are you sure?" she asked. I was... thinking. Wait... What?')).toEqual([
      '"Are you sure?" she asked.',
      'I was... thinking.',
      'Wait...',
      'What?',
    ]);
  });

  it('splits on non-Latin sentence terminators', () => {
    expect(texts('你好。我很好！谢谢？好')).toEqual(['你好。', '我很好！', '谢谢？', '好']);
    expect(texts('هل أنت بخير؟ نعم أنا بخير.')).toEqual(['هل أنت بخير؟', 'نعم أنا بخير.']);
    expect(texts('मैं ठीक हूँ। आप कैसे हैं?')).toEqual(['मैं ठीक हूँ।', 'आप कैसे हैं?']);
  });
});

describe('expandContractions', () => {
  it.each([
    ["I hadn't finished the report, so we couldn't obtain approval.", 'I had not finished the report, so we could not obtain approval.'],
    ["Don't worry, it's fine.", 'Do not worry, it is fine.'],
    ["I can't come and she won't either.", 'I cannot come and she will not either.'],
    ["Can't stop, won't stop.", 'Cannot stop, will not stop.'],
    ["CAN'T STOP, DON'T STOP", 'CANNOT STOP, DO NOT STOP'],
    ["I'm sure you're right, they've gone and we'll see.", 'I am sure you are right, they have gone and we will see.'],
    ['I’m sure you’re right and it’s late.', 'I am sure you are right and it is late.'],
    ["Let's go.", 'Let us go.'],
    ["What's that? There's a bus. Here's the key. Who's there?", 'What is that? There is a bus. Here is the key. Who is there?'],
    ["It's been a long day.", 'It has been a long day.'],
    ["She's got two kids and he's not been here.", 'She has got two kids and he has not been here.'],
    ["He's taken the train.", 'He has taken the train.'],
    ["What's happened? It's started raining.", 'What has happened? It has started raining.'],
    ["She's left the office.", 'She has left the office.'],
    ["I'd like a coffee.", 'I would like a coffee.'],
    ["I'd already left when you'd called.", 'I had already left when you had called.'],
    ["You'd better go. I'd been there. It'd be nice.", 'You had better go. I had been there. It would be nice.'],
    ["I'd've come.", 'I would have come.'],
    ["Y'all aren't ready, I ain't either.", 'You all are not ready, I am not either.'],
    ['I dont know, im tired and thats why I cant come.', 'I do not know, I am tired and that is why I cannot come.'],
  ])('%s', (input, expected) => {
    expect(expandContractions(input)).toBe(expected);
  });

  it('keeps "is" where the participle is an adjective or passive', () => {
    expect(expandContractions("He's just tired.")).toBe('He is just tired.');
    expect(expandContractions("It's called the Old Town.")).toBe('It is called the Old Town.');
    expect(expandContractions("It's left on the table.")).toBe('It is left on the table.');
    expect(expandContractions("It's closed today.")).toBe('It is closed today.');
    expect(expandContractions("She's a doctor and he's working.")).toBe('She is a doctor and he is working.');
  });

  it('leaves possessives and words with apostrophes alone', () => {
    for (const input of ["John's car", "the company's profits", "Ahmed’s phone", "It's 5 o'clock", "Sean O'Neill", "rock 'n' roll"]) {
      expect(expandContractions(input).replace("It is", "It's")).toBe(input);
    }
  });

  it('does not expand all-caps chat spellings that are acronyms or real words', () => {
    expect(expandContractions('Send me an IM. She lets me in.')).toBe('Send me an IM. She lets me in.');
    expect(expandContractions('Its colour is red. Well, I will.')).toBe('Its colour is red. Well, I will.');
  });
});

describe('normalizeTimes', () => {
  it.each([
    ['Meet me at 3:30 PM.', 'Meet me at 15:30.'],
    ['Open 8 AM to 4 PM daily', 'Open 08:00 to 16:00 daily'],
    ['12 am, 12:30 a.m. and 12 PM', '00:00, 00:30 and 12:00'],
    ['Dinner at 7.45pm', 'Dinner at 19:45'],
    ['Office hours 9am–5pm', 'Office hours 09:00–17:00'],
    ['Open 8-11 AM', 'Open 08:00-11:00'],
    ['Lunch 11–2 pm', 'Lunch 11:00–14:00'],
    ['Shift 10-1 am', 'Shift 22:00-01:00'],
    ['Available between 2 and 4 pm', 'Available between 14:00 and 16:00'],
    ['We close at 5 p.m. The shop opens at 9 a.m.', 'We close at 17:00. The shop opens at 09:00.'],
    ['We close at 5 p.m. and reopen at 6 P.M., thanks', 'We close at 17:00 and reopen at 18:00, thanks'],
    ['Flight at 11:45 PM tonight', 'Flight at 23:45 tonight'],
  ])('%s', (input, expected) => {
    expect(normalizeTimes(input)).toBe(expected);
  });

  it('leaves noon, midnight, 24-hour times and things that are not times alone', () => {
    for (const input of [
      'Lunch at noon, back by midnight.',
      'The train leaves at 15:30.',
      'Go to Room 4 AM-B on the left.',
      'Gate 12 AM is closed.',
      'Listen on AM/FM radio.',
      'The score was 3-2.',
      'It weighs 1.5 pm units.',
      'It was 13:30 PM.',
      'I am 5. Am I late?',
      'I was 25 Am I right?',
    ]) {
      expect(normalizeTimes(input)).toBe(input);
    }
  });
});

describe('disambiguate', () => {
  // Each rule: sentences where it must fire, then a counter-example where it must not.
  it.each([
    ['Take one tablet twice a day with food.', 'Take one pill twice a day with food.'],
    ['Take two tablets after meals.', 'Take two pills after meals.'],
    ['Tablets should be swallowed whole.', 'Pills should be swallowed whole.'],
    ['I am allergic to nuts.', 'I am allergic to nuts and peanuts.'],
    ['Does this dish contain nuts?', 'Does this dish contain nuts or peanuts?'],
    ['No nuts, I am allergic.', 'No nuts or peanuts, I am allergic.'],
    ['I have a nut allergy.', 'I have a nut and peanut allergy.'],
    ['I have chest pain.', 'I have pain in the chest.'],
    ['He has severe chest pains.', 'He has severe pains in the chest.'],
    ['A table for four, please.', 'A table for four people, please.'],
    ['I need a table for one tonight.', 'I need a table for one person tonight.'],
    ['Can we have the bill, please?', 'Can we have the bill for the meal, please?'],
    ['The check, please.', 'The bill for the meal, please.'],
    ['The waiter brought the check.', 'The waiter brought the bill for the meal.'],
    ['I have a cold.', 'I have a common cold.'],
    ['She caught a cold last week.', 'She caught a common cold last week.'],
    ['I have a temperature.', 'I have a fever.'],
    ['He is running a high temperature since yesterday.', 'He is running a high fever since yesterday.'],
    ['She has a temperature of 39.', 'She has a fever of 39.'],
    ['I need a flu shot.', 'I need a flu injection.'],
    ['Where is the drugstore?', 'Where is the pharmacy?'],
    ['Are you taking any prescription drugs?', 'Are you taking any prescription medicines?'],
    ['Where is the nearest chemist?', 'Where is the nearest pharmacy?'],
    ['I bought it at the chemist’s.', 'I bought it at the pharmacy.'],
    ['The nurse must change the dressing every day to prevent infection.', 'The nurse must change the wound dressing every day to prevent infection.'],
    ['My period is late.', 'My menstrual period is late.'],
    ['I am on the pill.', 'I am on the contraceptive pill.'],
    ['Where is the restroom?', 'Where is the toilet?'],
    ['Where is the bathroom?', 'Where is the toilet?'],
    ['Take the lift to the third floor.', 'Take the elevator to the third floor.'],
    ['I rent a flat with two bedrooms.', 'I rent an apartment with two bedrooms.'],
    ['A return ticket to London, please.', 'A round-trip ticket to London, please.'],
    ['A single ticket to Leeds by train.', 'A one-way ticket to Leeds by train.'],
    ['I want to book a room for two nights.', 'I want to reserve a room for two nights.'],
    ['I booked a table for six.', 'I reserved a table for six people.'],
    ['I need to book an appointment.', 'I need to schedule an appointment.'],
    ['I had to pay a fine of 50 euros.', 'I had to pay a penalty of 50 euros.'],
    ['He got a parking fine.', 'He got a parking penalty.'],
    ['Is a tip expected here?', 'Is a gratuity expected here?'],
    ['We ordered two starters and a main.', 'We ordered two appetizers and a main.'],
    ['We will visit in the fall.', 'We will visit in the autumn.'],
    ['The fall semester starts soon.', 'The autumn semester starts soon.'],
    ['Either party may terminate this agreement.', 'Either contracting party may terminate this agreement.'],
    ['The parties shall sign the contract.', 'The contracting parties shall sign the contract.'],
    ['I would like my steak well done.', 'I would like my steak fully cooked.'],
    ['I want my steak rare.', 'I want my steak lightly cooked.'],
    ['Is the curry hot?', 'Is the curry spicy?'],
    ['A bottle of still water, please.', 'A bottle of non-sparkling water, please.'],
    ['Still or sparkling?', 'Non-sparkling or sparkling?'],
  ])('%s', (input, expected) => {
    expect(disambiguate(input)).toBe(expected);
  });

  it.each([
    'I left my tablet on the plane, it needs charging.',
    'Take your tablet to school.',
    'I watch films on my tablet during meals.',
    'Tighten the nuts and bolts.',
    'Add the nuts to the salad.',
    'I am allergic to peanuts and nuts.',
    'This drives me nuts, does it contain gluten?',
    'The treasure chest painting is old.',
    'We rented the table for four weeks.',
    'A table for four people please.',
    'The bill was passed by parliament.',
    'Please pay the electricity bill.',
    'I paid the bill at the hotel.',
    'I have a cold drink.',
    'The room has a temperature of 20 degrees.',
    'The photographer got a great shot.',
    'Police found drugs in his car.',
    'She works as a chemist in a lab.',
    'I like ranch dressing on my salad.',
    'My trial period ended late.',
    'The pill bottle is empty.',
    'The hotel room has a large bathroom.',
    'Can you give me a lift to the station?',
    'I have a flat tyre.',
    'The return journey was long.',
    'I need a single ticket for the concert.',
    'The book a friend lent me is great.',
    'I got a fine view of the sea.',
    'Here is a useful tip for travellers.',
    'For starters, I want soup.',
    'She broke her hip in the fall.',
    'The party was fun.',
    'Well done, team!',
    'A rare disease.',
    'The soup is hot.',
    'A hot dog with chili.',
    'I still water the plants.',
    'The still water of the lake.',
    'The bank is closed.',
  ])('leaves alone: %s', (input) => {
    expect(disambiguate(input)).toBe(input);
  });

  it('works sentence by sentence and keeps the layout', () => {
    expect(disambiguate('I have chest pain.\n- Take one tablet daily. My tablet is charging.')).toBe(
      'I have pain in the chest.\n- Take one pill daily. My tablet is charging.',
    );
  });
});

describe('protectTerms', () => {
  const masked = (input: string) => protectTerms(input).text;

  it('protects software, libraries and products, and restores them', () => {
    const p = protectTerms('Visualised data with Seaborn, Pandas and NumPy in Python3.');
    expect(p.text).toBe('Visualised data with {{0}}, {{1}} and {{2}} in {{3}}.');
    expect(p.restore('Visualisierte Daten mit {{0}}, {{1}} und {{2}} in {{3}}.')).toBe(
      'Visualisierte Daten mit Seaborn, Pandas und NumPy in Python3.',
    );
    expect(masked('I built the game in Unity and scripted it in C#.')).toBe('I built the game in {{0}} and scripted it in {{1}}.');
    expect(masked('We use Node.js, .NET and C++ daily.')).toBe('We use {{0}}, {{1}} and {{2}} daily.');
    expect(masked('My iPhone and YouTube app work.')).toBe('My {{0}} and {{1}} app work.');
    expect(masked('Edited documents in Microsoft Word and Excel.')).toBe('Edited documents in {{0}} and {{1}}.');
  });

  it('protects names that are ordinary words only mid-sentence or in technical context', () => {
    expect(masked('Unity is our strength.')).toBe('Unity is our strength.');
    expect(masked('Unity is a cross-platform game engine.')).toBe('{{0}} is a cross-platform game engine.');
    expect(masked('I prefer Swift for iOS apps.')).toBe('I prefer {{0}} for {{1}} apps.');
    expect(masked('The swift river and the rust on the gate.')).toBe('The swift river and the rust on the gate.');
    expect(masked('I work with Go and Rust on backend services.')).toBe('I work with {{0}} and {{1}} on backend services.');
    expect(masked('Go to the station. Let us Go!')).toBe('Go to the station. Let us Go!');
    expect(masked('Join me on Teams at 10.')).toBe('Join me on {{0}} at 10.');
    expect(masked('Our sales teams met.')).toBe('Our sales teams met.');
    expect(masked('Apple announced a new iPhone.')).toBe('{{0}} announced a new {{1}}.');
    expect(masked('I ate an Apple.')).toBe('I ate an Apple.');
    expect(masked('The Amazon rainforest is vast, but Amazon delivers.')).toBe('The Amazon rainforest is vast, but {{0}} delivers.');
    expect(masked('Write it in Word.')).toBe('Write it in Word.');
  });

  it('protects acronyms but not shouting, headings or acronyms with a local equivalent', () => {
    expect(masked('Our KPI and SLA targets for AWS are met.')).toBe('Our {{0}} and {{1}} targets for {{2}} are met.');
    expect(masked('The COVID-19 rules changed; take vitamin B12.')).toBe('The {{0}} rules changed; take vitamin {{1}}.');
    expect(masked('We store PDFs.')).toBe('We store {{0}}.');
    for (const input of ['DO NOT TAKE MORE THAN 4 TABLETS.', 'PROFESSIONAL SUMMARY', 'I need an ATM in the UK.', 'Please do NOT touch.', 'I am OK. Get a PhD.']) {
      expect(masked(input)).toBe(input);
    }
  });

  it('protects well-known titles and quoted Title Case titles, but not quoted speech', () => {
    expect(masked('Have you read The Lord of the Rings?')).toBe('Have you read {{0}}?');
    expect(masked('I watched "The Midnight Library" yesterday.')).toBe('I watched "{{0}}" yesterday.');
    expect(masked('He said "Stop Right Now." and left.')).toBe('He said "Stop Right Now." and left.');
    expect(masked('She said "see you soon" to me.')).toBe('She said "see you soon" to me.');
  });

  it("protects people's names from many cultures, including surname particles", () => {
    expect(masked('Contact Ahmed Al-Sabah or Mohammed bin Salman Al Saud today.')).toBe('Contact {{0}} or {{1}} today.');
    expect(masked('Ask Jordan Peterson, Priya Sharma and Chinedu Okafor.')).toBe('Ask {{0}}, {{1}} and {{2}}.');
    expect(masked('I met Kim Min-jun and Tanaka Hiroshi.')).toBe('I met {{0}} and {{1}}.');
    expect(masked('Sean O’Brien met Anna van der Berg and Ian McDonald.')).toBe('{{0}} met {{1}} and {{2}}.');
    expect(masked('Dr. Smith and Mr. Al-Rashid will attend.')).toBe('Dr. {{0}} and Mr. {{1}} will attend.');
    expect(masked('Sara Ahmed’s report is late.')).toBe('{{0}}’s report is late.');
    expect(masked('Meeting with Sara Ahmed Tomorrow.')).toBe('Meeting with {{0}} Tomorrow.');
    expect(masked('Will Smith starred in the film.')).toBe('{{0}} starred in the film.');
  });

  it('does not protect places, single first names or ordinary capitalized words', () => {
    for (const input of [
      'Ahmed is here.',
      'Paris is beautiful and Sydney Australia too.',
      'We drove through the Jordan Valley to Victoria Station.',
      'I landed in Hong Kong.',
      'John F. Kennedy Airport is busy.',
      'King Fahd Road is closed.',
      'Mark Down The Price Now',
      'Will you come? Grace is here.',
      'I love the Spring in Paris.',
    ]) {
      expect(masked(input)).toBe(input);
    }
  });

  it('leaves email addresses, web addresses and existing placeholders alone', () => {
    expect(masked('Visit github.com/numpy/NumPy or mail Sara.Ahmed@example.com.')).toBe(
      'Visit github.com/numpy/NumPy or mail Sara.Ahmed@example.com.',
    );
    expect(masked('Ask {{0}} about NumPy.')).toBe('Ask {{0}} about {{1}}.');
  });

  it('rejects dropped, duplicated or invented placeholders and ignores earlier layers', () => {
    const p = protectTerms('Ask {{0}} about NumPy and Seaborn.');
    expect(p.restore('Pregunta a {{0}} sobre {{1}} y {{2}}.')).toBe('Pregunta a {{0}} sobre NumPy y Seaborn.');
    expect(p.restore('Pregunta a {{0}} sobre {{ 2 }} y {{1}}.')).toBe('Pregunta a {{0}} sobre Seaborn y NumPy.');
    expect(p.restore('Pregunta sobre {{1}}.')).toBeNull();
    expect(p.restore('{{1}} {{1}} {{2}}')).toBeNull();
    expect(p.restore('{{1}} {{2}} {{3}}')).toBeNull();
    expect(protectTerms('Nothing to protect here.').restore('Nada aquí.')).toBe('Nada aquí.');
  });
});

describe('protectForTranslation', () => {
  it('composes entity and term protection without index collisions', () => {
    const input = 'Email sara@example.com, ask Sara Ahmed about Unity.';
    const p = protectForTranslation(input);
    expect(p.text).toBe('Email {{0}}, ask {{1}} about {{2}}.');
    expect(p.restore('Escribe a {{0}}, pregunta a {{1}} sobre {{2}}.')).toBe(
      'Escribe a sara@example.com, pregunta a Sara Ahmed sobre Unity.',
    );
    expect(p.restore('Escribe a {{0}}, pregunta a {{1}}.')).toBeNull();
    expect(p.restore('Escribe a {{1}}, pregunta a {{2}}.')).toBeNull();
    expect(p.restore('{{0}} {{1}} {{2}} {{3}}')).toBeNull();
  });

  it('matches protectEntities when there are no terms', () => {
    const input = 'Call +965 5550 0100 or mail a@b.com';
    expect(protectForTranslation(input).text).toBe(protectEntities(input).text);
  });
});
