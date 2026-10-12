/**
 * Names of software, companies, products and works that on-device models translate or
 * respell ("Unity" became "union", "Seaborn" came back corrupted). Kept to names that show
 * up in everyday CVs, business email and chat; obscure names are rarely mistranslated
 * because the model has never seen them as ordinary words.
 */

const list = (s: string): string[] => s.trim().split(/\s+/);

/** Distinct names that are never ordinary English words: protected wherever they appear. */
export const ALWAYS_TERMS: ReadonlySet<string> = new Set(
  list(`
  Python Java Kotlin Scala Haskell Perl Fortran COBOL Lua Erlang Clojure Matlab MATLAB Solidity
  Prolog Lisp Golang Seaborn Matplotlib Plotly Scikit-learn scikit-learn Keras Jupyter Django
  Vue Svelte Laravel Symfony Tailwind Xamarin Godot Docker Kubernetes Terraform Ansible Git
  Bitbucket Jira Trello Figma Canva Photoshop Lightroom AutoCAD SolidWorks Revit Looker Salesforce
  Zendesk Shopify Wix Squarespace Magento Hadoop Kafka Databricks Postgres Redis Elasticsearch
  Firebase Supabase Linux Ubuntu Debian CentOS Firefox Gmail Dropbox Skype Viber Instagram Facebook
  Twitter Snapchat Netflix Spotify Reddit Pinterest Twitch Uber Careem Talabat Deliveroo Airbnb
  Expedia Tripadvisor Google Microsoft Samsung Huawei Xiaomi Sony Nokia Intel Nvidia NVIDIA
  Qualcomm Cisco Dell Lenovo Asus Acer Toyota Honda Nissan Hyundai Volkswagen Audi Porsche Ferrari
  Lamborghini Nike Adidas Zara Starbucks McDonald's Coca-Cola Pepsi Nestlé Mastercard Siri Cortana
  Bluetooth Minecraft Fortnite Roblox Nintendo Xbox Pokémon Pokemon Zelda Tetris Excel PowerPoint
  Android Huggingface Hermes Vercel Netlify Heroku Postman Swagger Grafana Kibana Splunk
  Datadog Jenkins Ollama Anthropic
`),
);

/**
 * Names that are also ordinary words (or a person's name) when lowercase. Protected only
 * when capitalized mid-sentence, or anywhere in a sentence that is clearly about technology.
 */
export const MID_SENTENCE_TERMS: ReadonlySet<string> = new Set(
  list(`
  Unity Swift Ruby Rust Dart Elixir Groovy Bash Pandas React Angular Rails Hibernate
  Bootstrap Flutter Ionic Electron Unreal Blender Confluence Asana Slack Notion Sketch Illustrator
  Premiere Tableau Stripe Spark Airflow Snowflake Redshift Oracle Fedora Windows Chrome Safari
  Outlook Zoom Telegram Signal Discord Meta Gemini Copilot Steam Puma Tesla Amazon Flask Jest Mocha
  Cypress Playwright Pulumi Vite Webpack Babel Redux Apollo Prisma Mongoose Notepad
`),
);

/** Multiword product names, matched as a whole. */
export const PHRASE_TERMS: readonly string[] = [
  'Microsoft Word',
  'MS Word',
  'Microsoft Excel',
  'Microsoft Office',
  'MS Office',
  'Office 365',
  'Microsoft 365',
  'Microsoft Teams',
  'MS Teams',
  'Microsoft Edge',
  'Microsoft Access',
  'MS Access',
  'Power BI',
  'Power Automate',
  'Visual Studio Code',
  'Visual Studio',
  'VS Code',
  'Android Studio',
  'Google Sheets',
  'Google Docs',
  'Google Drive',
  'Google Maps',
  'Google Translate',
  'Google Pay',
  'Google Meet',
  'Google Chrome',
  'Google Play',
  'App Store',
  'Google Cloud',
  'Apple Pay',
  'Apple Watch',
  'Apple Music',
  'Amazon Web Services',
  'Unreal Engine',
  'Adobe Photoshop',
  'Adobe Illustrator',
  'Adobe Premiere',
  'Premiere Pro',
  'After Effects',
  'Final Cut Pro',
  'Logic Pro',
  'SQL Server',
  'Ruby on Rails',
  'Spring Boot',
  'Sublime Text',
  'Stack Overflow',
  'Hugging Face',
  'Uber Eats',
  'Samsung Galaxy',
  'Call of Duty',
  'Grand Theft Auto',
  'League of Legends',
  'Counter-Strike',
  'Red Dead Redemption',
  'Super Mario',
  'Google Analytics',
  'Google Ads',
  'Apache Spark',
  'Apache Kafka',
];

/**
 * Well-known titles whose words are ordinary English, so they get translated word by word.
 * Kept small: lesser-known titles are left to the quoted-title rule.
 */
export const WORK_TITLES: readonly string[] = [
  'The Lord of the Rings',
  'The Hobbit',
  'Harry Potter',
  'Star Wars',
  'Star Trek',
  'The Godfather',
  'Game of Thrones',
  'Breaking Bad',
  'The Simpsons',
  'Pride and Prejudice',
  'War and Peace',
  'Romeo and Juliet',
  'The Great Gatsby',
  'To Kill a Mockingbird',
  'The Little Prince',
  'One Hundred Years of Solitude',
  'Don Quixote',
  'The Matrix',
  'The Lion King',
  'Toy Story',
  'Finding Nemo',
  'Jurassic Park',
  'Stranger Things',
  'Squid Game',
  'Money Heist',
  'Sherlock Holmes',
  'The Beatles',
  'Moby Dick',
  'The Odyssey',
  'The Divine Comedy',
  'One Piece',
  'Dragon Ball',
  'Attack on Titan',
  'The Avengers',
  'Spider-Man',
  'Batman',
  'Superman',
  'The Hunger Games',
  'The Da Vinci Code',
  'The Alchemist',
  'The Catcher in the Rye',
  'Animal Farm',
  'Brave New World',
  'Les Misérables',
  'One Thousand and One Nights',
];

/** Words that make a sentence about technology, which lets ordinary-word names be protected. */
export const TECH_CONTEXT =
  /\b(?:software|programming|developer|developers|development|framework|frameworks|library|libraries|language|languages|code|coding|app|apps|application|engine|platform|database|databases|script|scripts|scripting|frontend|front-end|backend|back-end|API|APIs|SDK|IDE|plugin|plugins|installed|deployed|cloud|server|servers|open-source|machine learning|analytics|dashboard|dashboards|spreadsheet|spreadsheets|browser|visuali[sz]ations?|proficient)\b/i;

/**
 * All-caps words that are emphasis or everyday abbreviations with a local equivalent
 * ("DO NOT", "ATM", "UK", "CEO"); these must be translated, not frozen.
 */
export const CAPS_TO_TRANSLATE: ReadonlySet<string> = new Set(
  list(`
  OK OKAY AM PM TV ID CV ATM PIN CEO CFO CTO COO HR IT PR UN EU UK US USA UAE KSA GCC NATO WHO AIDS
  HIV DNA RNA ICU ER GP MBA PHD BSC MSC BA MA VAT GDP FAQ DIY ASAP FYI PS AD BC CD DVD UFO IQ EV
  LOL OMG BTW TBH IMO IDK BRB THX PLS PLZ XOXO RSVP NB ETA MR MRS MS DR SR JR ST VS
  `),
);

/**
 * Frequent English words: used to reject all-caps emphasis ("NOT", "NEVER", "STOP") as
 * acronyms and to stop a name match from swallowing a following capitalized word.
 */
export const COMMON_WORDS: ReadonlySet<string> = new Set(
  list(`
  a an the and or but nor of to in on at for with from by about as into like through after over
  between out against during without before under around among off up down near since until upon
  via per than then so if is are was were be been being am have has had do does did done will
  would shall should can could may might must not no yes all any some each every this that these
  those it its he she they we you i me him her them us my your his our their who whom whose what
  when where why how which there here very too also just only now new old good great best better
  more most less least many much few please thanks thank hello hi hey dear regards sorry welcome
  love happy birthday day days night morning evening today tomorrow yesterday week month year
  monday tuesday wednesday thursday friday saturday sunday january february march april may june
  july august september october november december said says say tell told ask asked god sir madam
  team manager director department company group inc ltd llc summary experience education skills
  profile contact phone email address name page chapter section part total price note notes update
  meeting project report plan service services support sales marketing finance bank office home
  university college school hospital airport hotel restaurant city state country north south east
  west central international national global general senior junior lead head chief officer
  engineer analyst consultant specialist assistant associate president vice executive member board
  committee never always stop warning danger notice caution free sale open closed exit push pull
  keep help fire poison urgent need important hot cold wet dry slow fast keep away only again
  still even ever yet already soon late early first last next one two three four five six seven
  eight nine ten hundred thousand million go get got make made take took give gave see saw know
  knew think come came want use used find work works call called try left right well back way
  out own same other such both either neither while because although though however therefore
  dont wont cant isnt arent wasnt doesnt didnt ok okay wow yeah no nope maybe sure fine
  hours minutes free entry admission tickets ticket menu food drink water room floor level
  `),
);
