# Translation review — October 2026

**Status: passed, reviewed by AI.** The founder decided that ShelterKart runs without human reviewers. Every enabled language is now marked `review: 'ai'` in `backend/engine/languages.js`. The site tells readers exactly that: "Translated and checked with AI. The English original governs." It never says a native speaker reviewed anything, because none did.

## Scope

- **Interface dictionaries:** Hindi, Arabic, French, Polish, Traditional Chinese, Spanish and German. 219 strings each, plus 30 plural forms (9 Polish, 21 Arabic).
- **Sample report translations:**
  - Hubtown Celeste → Hindi: 96 sentences
  - Casagrand Casamia → Hindi: 71 sentences, 23 of them shared with Hubtown
  - Creek Bay Tower B → Arabic: 60 sentences
- **Out of scope (unchanged):** the legal texts (Terms, Privacy, Principles, Methodology) stay English-only and say so. Live report translations are checked at run time by `engine/translate.js`.

## Method

**1. Mechanical checks** (`tools/i18n_review/scrutiny.js`), over every string:

| Check | What it catches |
| --- | --- |
| Numbers, dates and registration ids survive | A changed fact |
| Protected names survive | A renamed register, regulator or company |
| {placeholders} survive | A broken placeholder would print "{n}" to a buyer |
| An English negation has a negation in the translation | A lost "not" or "never", the most harmful error |
| Question marks survive | A question turned into a statement |
| No stray English in Hindi, Arabic or Chinese | A forgotten translation |
| Not identical to the English in Latin-script languages | An untranslated string |
| No implausible lengths, no duplicate translations of different strings | A mismatched or copy-pasted entry |

**2. Line-by-line review** of:
- everything flagged;
- every sentence that composes with other text (the price line, the match line, the protections header), checked in every language for grammar with each possible filling;
- every statement carrying a promise or legal weight (the score methodology, data handling, payment, the paywall);
- every negative or legal finding in the translated samples, read against its English.

**3. Plural grammar,** which a sentence-level check can't see. Each counted phrase was checked against the language's own plural rules (`Intl.PluralRules`).

## Findings

**The mechanical checks raised 26 flags. All 26 were correct idioms, not errors:**
- Arabic writes "one" as a word ("صفحة واحدة"), not "1".
- Some negations are built into words: Arabic "تعذّر" ("could not"), French "faute de" and "impossible", Polish "niedostępna", Chinese "已失效".
- Some words are the same in both languages: French "pages", Spanish "India".
- "RERA" next to punctuation is the protected name kept intact.

**The line-by-line review found 10 real errors. All are fixed:**

| # | Language | Problem | Fix |
| --- | --- | --- | --- |
| 1 | French | The score sentence mixed genders: "Calculé… ne **la** modifient… **Elle** décrit". In French "le score" is masculine | "ne **le** modifient… **Il** décrit" |
| 2 | German | "über **den** {via}" is wrong when {via} is "Registriernummer", which is feminine | Rephrased: "(Abgleich über: {via})"; "Namen" → "Name" |
| 3 | Polish | "nazwę" (name) was in the accusative, but follows a colon | "nazwa" |
| 4 | Hindi | "उसके {via}" doesn't agree with the feminine "पंजीकरण संख्या" | The possessive was dropped: "{via} के आधार पर" |
| 5 | Hindi | "सघन" (dense) is an odd word for a "Heavy" report | "विस्तृत" (detailed) |
| 6 | Spanish | "depende de {follows}" produced "de **el** precio", which must contract to "del" | "se basa en {follows}", which is correct with all three fillings |
| 7 | Arabic | "خاص بـ {label}" left a dangling prefix | "ينطبق على {label}" ("applies to") |
| 8 | German | "umfassend und umfassen" repeated the same word | "umfassend und schliessen … ein" |
| 10 | Arabic, Chinese | Lists joined with a Latin comma ",", seen in the browser check | The separator is in the dictionaries: Arabic "،", Chinese "、" |
| 9 | Polish, Arabic | **Plurals.** Every count used one form, so "5 dodatkowe ustalenia" and "12 صفحات" were ungrammatical | 30 plural forms; the page picks the form by the number's grammatical category |

**Sensitive sample findings:** all 8 negative or legal findings in the three translated samples keep their facts, their attributions ("according to a listing site", "buyers say") and their hedges ("may not be representative"). Casamia's Hindi names "the regulator" where the English says "it", removing an ambiguity. No changes were needed.

**Swiss usage:** German uses "ss" for "ß" throughout (5 places), as Swiss Standard German does.

## Result

After the fixes, the mechanical checks raise the same 26 accepted idioms and nothing new. The dictionary build check passes. The test suites check the fixed grammar in the plural and match-line cases, and that the notice says "checked with AI", never "reviewed by a native speaker".

## Limits, stated plainly

- **The reviewer isn't independent of the translator.** Both are AI, from the same family of models. This review catches errors of fact, grammar and meaning that a careful reader would; it can't promise the idiom a native speaker would choose. The site says "checked with AI" for that reason.
- **The English original governs.** Every translated page and report says so.
- **New strings start unreviewed.** When a string is added, `tools/build_i18n.js` refuses to build until every language has it. Rerun this review, both the mechanical checks and the read of what changed, before release.
- **Live reports need no re-review.** The server's code checks and its meaning check for sensitive claims run on every translation, and anything that fails is shown in English.


## Japanese (Wave 4, 15 October 2026)

**Status: passed, reviewed by AI** (`review: 'ai'`, so the page says "Translated and checked with AI. The English original governs.").
Scope: the interface dictionary, all 275 strings. Japanese has no plural forms, so no plural keys. Reports stay in English.

- **Mechanical checks** (`tools/i18n_review/scrutiny.js`, now with Japanese negation and script rules): 5 flags, all correct idioms.
  Each is English writing a number as a word ("five", "three", "a minute") where Japanese writes the numeral (5件, 3件, 1分). No fact,
  placeholder or negation was lost; every {placeholder} and every protected name (ShelterKart, RERA, PDF, Razorpay) survives.
- **Line-by-line review:** every negative statement (each keeps ない, ません, なし or 未), every composed sentence (the price line
  with each filling, the list joiner, the match line), and every statement with legal or payment weight (the paywall, the upload notice,
  data storage, the score methodology).
- **Corrections made in review:** "Budget for" is a buyer-protection label beside "Your right" and "If it goes wrong", so it reads
  見込むべき費用 (a cost to plan for), not a budget heading; "Reported by {n} sites" tightened to {n} サイトが報告.
- **Style:** polite form (です・ます) for sentences, plain nouns for labels; Indian units "crore" and "lakh" kept in Latin, as in other languages.
- **Not done:** no native speaker has reviewed it. The page says AI-checked and never claims otherwise.
