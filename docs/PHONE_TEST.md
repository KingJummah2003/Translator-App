# Translator: iPhone test plan (iPhone 15 Pro Max)

This is your first time running Translator on a real iPhone. Go through the sections in order and tick each box as you go. It takes about an hour, and you can split it across days.

## What needs what

- **Works on the phone alone (no Mac, no internet):** translating once your languages are downloaded, Talk with downloaded languages, reading English and other Latin-alphabet text with the camera, "Translate on this phone" for files, History, App lock, Arabic layout, dark mode, large text.
- **Needs Wi-Fi (but not the Mac):** downloading languages (about 30 MB each).
- **Needs the Mac on with the tunnel running:** signing in, your credit balance, "Better quality", "Translate · N credits", "Translate in the cloud", reading **Arabic** text from photos, dictionary look-ups (except words you've looked up before), "Download my data" and "Delete account". These steps are tagged **[Cloud]**. Tell Claude before you start them so the Mac is ready.

**Cloud budget.** The Mac uses a free test translation service that allows about **5,000 characters a day in total**. Use short sentences and a one-page file for the [Cloud] steps. A new account gets **20 free credits**. Costs: text is 1 credit per 500 characters (at least 1), "Better quality" on a photo is 2 credits, and a document is 1 credit per 500 characters (at least 5).

**When something fails:** take a screenshot (side button + volume up), then write down the section and step number, what you tapped, what you expected, what you saw instead, whether you were on Wi-Fi, mobile data or Airplane Mode, and the time.

## Known limitations (please don't report these)

1. **Sign-in:** only "Continue with email" is offered. Apple and Google sign-in are switched off in this build.
2. **Sign-in codes don't arrive by email.** The screen says "Code sent. Check your email." Ignore that and ask Claude for the code (it shows up on the Mac).
3. **Buying doesn't work yet.** Plans says "Purchases are not available on this device." and every price shows "Price unavailable".
4. **The Mac being off means no cloud.** When the Mac is asleep or offline, [Cloud] steps show "Can't connect. Check your internet connection and try again." That's expected.
5. **Daily cloud limit.** After about 5,000 characters in a day, cloud steps may fail with something like "The translation service is having trouble. Try again in a moment."
6. **On-device quality is basic**, especially for long or technical text. That's why "Better quality" exists.
7. **Arabic, Persian and Hebrew text in photos** can only be read by the cloud. English, French and similar alphabets are read on the phone.
8. **PDFs come back as Word files.** The page layout isn't kept, and only the first 50 pages are translated. Files over 10 MB are refused.
9. **"Privacy policy" and "Terms of use"** may open a placeholder web page for now.
10. **The app stops opening after 7 days** (a limit of free Apple developer accounts). Ask Claude to reinstall it from the Mac.
11. **Speech recognition** for some languages needs internet even when translation doesn't.

## 1. First launch and permissions

- [ ] If iPhone says "Untrusted Developer": go to Settings > General > VPN & Device Management, tap your Apple ID, then tap **Trust**. If it asks for Developer Mode, turn it on in Settings > Privacy & Security > Developer Mode (the phone restarts).
- [ ] Open **Translator** from the Home Screen. Good: the splash fades into the Translate page with five tabs at the bottom: **Translate, Camera, Talk, Files, Account**.
- [ ] Good: no pop-ups at launch. Permissions are asked only when you first need them: Camera (Camera tab), Microphone and Speech Recognition (the first mic tap), Face ID (turning on App lock).
- [ ] Swipe the app away from the app switcher and reopen it. Good: it opens quickly to the same page, with your settings remembered.
- If it fails: screenshot the error or the blank screen, and note whether it happened on the first open or a later one.

## 2. Translate

- [ ] The bar at the top shows **Detect language** ⇄ **Arabic**. Tap the box that says **Type or paste text** and type `Good morning, how are you?`
- [ ] If your languages aren't downloaded yet, a banner asks you to download English and Arabic to translate offline. Tap **Download**, wait for it to finish (Wi-Fi), then come back.
- [ ] Good: the Arabic appears as you type, with no button press, in a card marked **On device**, plus a short note about on-device quality. The counter shows `26 / 5,000`.
- [ ] Tap the speaker (**Listen**): it reads the Arabic aloud. Tap the copy icon: it briefly turns into a tick. Tap the share icon: the iPhone share sheet opens.
- [ ] Tap the ⇄ button: the two languages switch places. Tap a language name: a list opens (**Translate from** / **Translate to**). Search `French`, pick it, and the text is translated again.
- [ ] Tap the microphone in the text box and say a sentence. Good: "Listening…" appears, your words appear in the box, and tapping the mic again stops listening.
- [ ] Type `I have chest pain and need a doctor`. Good: a yellow box says "Double-check important translations".
- [ ] **[Cloud]** Tap **Better quality**. Good: the card now says **Cloud** and your credits (Account tab) go down by 1. If you're not signed in, the sign-in page opens instead. That's correct.
- Then tap the **X** to clear the box, and the keyboard-down button to close the keyboard.
- If it fails: screenshot the whole page, and note the two languages chosen and the exact text you typed.

## 3. Offline languages (download)

- [ ] Go to **Account** > **Offline languages**. Good: a page explaining "Downloaded languages translate on your phone: fast, free and private. About 30 MB each.", with **Downloaded** and **Available to download** lists.
- [ ] **English** shows "Required for all offline translation" and has no delete button. That's correct.
- [ ] With **Download on Wi-Fi only** switched on, tap the download arrow next to **French**. Good: a progress bar with a percentage appears, then French moves up into **Downloaded**.
- [ ] Turn Wi-Fi off (mobile data on) and start a download for another language. Good: it says "Waiting for Wi-Fi". Turn Wi-Fi back on and it continues.
- [ ] Tap the red bin next to French, then **Delete**. Good: French moves back to **Available to download**.
- [ ] Turn on **Airplane Mode** and translate English ⇄ Arabic on the Translate tab. Good: it still works and shows **On device**, and **Better quality** is hidden. Turn Airplane Mode off afterwards.
- You should **never** see "On-device translation needs a development build on a real device." If you do, report it.
- If it fails: screenshot, and note the language, Wi-Fi or mobile data, and roughly how long you waited.

## 4. Dictionary (tap a word)

- [ ] Translate any sentence, then tap a word in the translation (the coloured card). Good: a sheet titled **Dictionary** opens with the word, a speaker button and its **Meanings**. **[Cloud]**
- [ ] **Dialect test:** keep **Detect language** → **Arabic** and type `الجو وايد حلو اليوم`. Because both sides are Arabic, the card shows your sentence back unchanged. That's expected. Tap **وايد**.
- [ ] Good: you see meanings like "very / a lot / much" under a **Gulf Arabic** heading, with Gulf Arabic listed first because the phone's region is Kuwait. If it says "No dictionary entry found.", note it. It may just be a gap in the dictionary.
- [ ] Look up a word, close the sheet, turn on Airplane Mode, and tap the same word again. Good: it still shows, with "Saved for offline use" at the bottom. A new word shows "The dictionary needs an internet connection." Turn Airplane Mode off.
- If it fails: screenshot the sheet, and note the word, its language and whether you were online.

## 5. Talk (conversation)

- [ ] Open **Talk**. Good: the screen is split in two. The bottom half is yours. The top half is upside down on purpose, for the person sitting opposite you.
- [ ] Bottom bar: your language, the ⇄ button, and a speaker toggle (**Read translations aloud**, on by default). The top shows the other language in its own name (for example **العربية**).
- [ ] Tap the big round mic at the bottom. iPhone asks for **Microphone** and **Speech Recognition**: allow both. Say `Where is the nearest pharmacy?` Good: your words appear at the bottom, and the Arabic appears on top and is read aloud.
- [ ] Tap the top mic and say something in Arabic, for example `شلونك؟ وايد زين`. Good: the English appears at the bottom and is read aloud.
- [ ] Tap any message bubble: it's read aloud again. Turn the speaker toggle off: new translations stay silent.
- [ ] Tap a mic and stay silent. Good: a calm "Didn't catch that. Try again."
- If it fails: screenshot, and note which half you spoke into, what you said, and whether you heard anything.

## 6. Camera

- [ ] Open **Camera**. Good: "Point at text" with **Allow**. Tap it, then allow on the iPhone pop-up. Good: a live camera view with "Take a photo of a sign, menu or page".
- [ ] Point at English text (a box, a book or a menu) and tap the round shutter button. Good: "Reading text…", then an **Original · English** card and a **Translation · Arabic** card marked **On device**. Tap a word in the translation to open the Dictionary.
- [ ] Tap **Retake**, then **Choose photo**. It opens the Files browser, not your photo library, so first save a screenshot with text to Files (Share > Save to Files). Pick it. Good: it's read the same way. Note whether picking from Files feels right to you.
- [ ] **[Cloud]** Tap **Better quality · 2 credits**. Good: the translation updates and is marked **Cloud**.
- [ ] **[Cloud]** Set **Translate from** to **Arabic** and photograph Arabic text. Good: it's read by the cloud (2 credits). If you're signed out, it says "Sign in to use cloud translation for Arabic". That's correct.
- [ ] Optional: in iPhone Settings > Apps > Translator, turn Camera off, then reopen the tab. Good: **Open Settings** takes you straight to that setting.
- If it fails: screenshot the photo and the result, and note the lighting and distance.

## 7. Files (PDF and Word)

Before you start, AirDrop one small **PDF** and one small **Word (.docx)** file (a page or less, with headings and some bold text) to the phone, and choose **Save to Files**.

- [ ] Open **Files**. Good: "Translate a document" with **Choose file**. Tap it and pick the Word file from the Files app.
- [ ] Good: the file name and size appear, with **Translate in the cloud** (showing "About N credits") and **Translate on this phone**.
- [ ] Tap **Translate on this phone**. Good: "Translating… NN%", then "Your translated file is ready". Tap **Save or share**, then **Save to Files**, and open the file. Good: it's translated, with the headings and bold text kept.
- [ ] Tap **Choose another file** and pick the PDF. Good: "Reading the document…", then the same two choices. The result is a **Word** file. That's expected.
- [ ] **[Cloud]** With the one-page file, tap **Translate in the cloud**. Good: "Translating in the cloud…", the file is ready, and your credits drop by at least 5.
- [ ] Try a password-protected PDF if you have one. Good: "This PDF is password-protected. Remove the password and try again."
- If it fails: keep the original file (Claude may need it) and screenshot the message.

## 8. History

- [ ] On **Translate**, tap the clock button in the top corner. Good: **History** lists your recent translations, each marked **On device** or **Cloud**.
- [ ] Tap an entry. Good: it reopens on the Translate page with both texts filled in.
- [ ] Press and hold an entry, then tap **Delete**. Good: it disappears.
- [ ] In **Account**, switch off **Keep translation history on this phone**, then translate something. Good: History doesn't grow and says history is turned off. Switch it back on.
- [ ] **Account** > **Clear history** > **Delete**. Good: History shows "No translations yet".
- If it fails: screenshot History, and note which translation is missing or doubled.

## 9. Account and credits

- [ ] Signed out: **Account** shows "Sign in to Translator" with **Sign in**, then **Downloads** (Offline languages, Download on Wi-Fi only), **Privacy** (App lock, history switches, Clear history, Privacy policy, Terms of use) and the version number at the bottom.
- [ ] **[Cloud]** Signed in (after section 10): your email, the plan **Free**, a credits number (20 for a new account) and **Get more**.
- [ ] **[Cloud]** Do a cloud translation, then come back. Good: the credit number counts down.
- [ ] **[Cloud]** **Download my data**. Good: a share sheet with a file you can save.
- [ ] **Sign out**. Good: "Signed out", and Account is back to the signed-out view. On-device translation still works.
- If it fails: screenshot Account, and note what you did just before (for example, which cloud translation).

## 10. Sign in **[Cloud]**

- [ ] **Account** > **Sign in**. Good: "Sign in to Translator" with only **Continue with email** (no Apple or Google buttons; see the known limitations).
- [ ] Tap **Continue with email**, enter your email and tap **Email me a code**. Good: "Enter the 6-digit code we sent to …". Ask Claude for the code.
- [ ] Type the code under **Verification code** and tap **Verify**. Good: the page closes and Account shows your email and credits.
- [ ] Type a wrong code once. Good: "That code isn't right. Check it and try again."
- [ ] Optional, password route: **Use a password instead** > **Create an account with a password**, then fill in name, email and a password of 10+ characters > **Create account** > code > **Verify**.
- If it fails: screenshot, and note the time you asked for the code (it helps Claude find it on the Mac).

## 11. Plans (expect "not available")

- [ ] **Account** > **Get more**. Good: "Do more with cloud translation" with subscriptions, credit packs and a 3-hour pass.
- [ ] Good: a yellow banner says "Purchases are not available on this device.", prices say "Price unavailable" and nothing can be bought. That's expected for now.
- [ ] Close it with the X (or swipe down). **Account** > **Restore purchases**: any message is fine, as long as nothing crashes.
- If it fails: report only a crash, a frozen screen or a real charge prompt.

## 12. App lock (Face ID)

- [ ] **Account** > switch on **Require Face ID / fingerprint**. The first time, iPhone asks to allow Face ID: tap **OK**, then look at the phone. Good: the switch stays on.
- [ ] Go to the Home Screen for **more than 30 seconds**, then reopen the app. Good: a lock screen with **Unlock**, and Face ID unlocks it.
- [ ] Leave the app for less than 30 seconds. Good: no lock.
- [ ] Force-quit and reopen. Good: it's locked straight away.
- [ ] Switch App lock off afterwards if you like.
- If it fails: screenshot, and note how long you were away.

## 13. Arabic interface and right-to-left

- [ ] iPhone **Settings > Apps > Translator > Language** > **العربية**, then reopen the app. Good: the Home Screen name becomes **المترجم** and the whole layout flips right-to-left.
- [ ] Tabs, from right to left: **ترجمة، الكاميرا، محادثة، الملفات، الحساب**. Back arrows point right.
- [ ] Check these labels: **اكتب النص أو الصقه** (type box), **جودة أعلى** (Better quality), **لغات دون إنترنت** (Offline languages), **تسجيل الدخول** (Sign in), **المتابعة بالبريد الإلكتروني** (Continue with email), **اختيار ملف** (Choose file), **السجل** (History).
- [ ] Type English in the box. Good: English lines up on the left, while Arabic text lines up on the right.
- [ ] Open the Dictionary on an English word. Good: the meanings are shown in Arabic (they're translated on the phone).
- [ ] Look for English text, cut-off words or icons pointing the wrong way. Then set the language back to English.
- If it fails: screenshot, and circle or describe the wrong spot.

## 14. Dark mode

- [ ] Control Centre or Settings > Display & Brightness > **Dark**. Visit every tab, the language list, the Dictionary, Sign in and Plans.
- [ ] Good: everything is readable, with no white flashes, invisible text or black-on-black icons.
- If it fails: screenshot, and note the page name.

## 15. Large text

- [ ] Settings > Accessibility > Display & Text Size > **Larger Text**. Turn it up high and go through every tab again.
- [ ] Good: text gets bigger without being cut off, language names wrap onto two lines, and every button can still be reached by scrolling.
- [ ] Put the size back when you're done.
- If it fails: screenshot, and note the text-size level and the page.
