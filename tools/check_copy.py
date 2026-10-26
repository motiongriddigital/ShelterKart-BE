#!/usr/bin/env python3
"""
ShelterKart — copy integrity gate.

Run before every deploy:

    python3 tools/check_copy.py public/shelterkart-frontend.html

Exits non-zero if anything fails, so it can sit in CI as a blocking
step. Three classes of check:

  1. SPELLING   — every user-facing word is checked against the system
                  hunspell dictionary plus an explicit project lexicon.
                  A word that is neither is a hard failure. Adding a
                  legitimate new term means adding it to LEXICON below,
                  which is deliberate friction: it makes "is this really
                  a word?" a decision someone made, not an accident.

  2. MECHANICS  — doubled words, space before punctuation, unbalanced
                  brackets/quotes, double hyphens where an em dash is
                  meant, straight apostrophes that should be typographic.

  3. TRUTH      — the checks that actually matter for this product.
                  Copy must not contradict the code. If the pricing
                  table is tiered, no string may claim a flat fee. If a
                  product has been removed, no clause may still govern
                  it. These have caused real defects here before.

Why this exists: on a platform whose entire proposition is that every
claim traces to evidence, a sentence that contradicts the software is
not a typo — it is the product failing its own standard.
"""

import re
import sys
import html as html_mod
from pathlib import Path

# Terms that are correct but absent from a general dictionary.
# Keep alphabetical. Adding here is a deliberate act: it forces
# "is this really a word?" to be a decision someone made.
LEXICON = {
    'razorpay',  # payment processor, named in the Privacy Policy
    # brand / product
    "shelterkart", "sk",
    # regulators, registries, statutes
    "rera", "maharera", "mca", "ibbi", "nclt", "ncdrc", "dld", "ura", "bca",
    "acra", "hcra", "kpkt", "nhbc", "dpdp", "gdpr", "tarion", "oqood",
    "crisil", "bse", "lse", "sgx", "dfm", "cin", "apdl", "slrb", "rega",
    # document / domain terms
    "oc", "cc", "otp", "psf", "sqft", "yoy", "ytd", "micromarket",
    "encumbrance", "encumbrances", "promoter", "promoters", "khata",
    "severability", "indemnification", "arbitrability",
    # currencies / units
    "inr", "aed", "gbp", "sgd", "cad", "myr", "lakh", "lakhs", "crore", "crores",
    # markets and places used in copy
    "mumbai", "maharashtra", "pune", "bengaluru", "karnataka", "chennai",
    "hyderabad", "telangana", "ahmedabad", "gujarat", "noida", "gurugram",
    "haryana", "kolkata", "dubai", "abu", "dhabi", "singapore", "malaysia",
    "kuala", "lumpur", "toronto", "ontario", "uae", "nri", "nris",
    # tech terms appearing in user-visible copy
    "whatsapp", "pdf", "url", "api", "offline", "downloadable",
    # Commonwealth spellings — deliberate: five of six markets (India,
    # UK, Singapore, Malaysia, UAE) use British English conventions.
    "finalised", "organised", "recognised", "authorised", "licence",
}

# Copy claims that must stay consistent with implementation.
TRUTH_RULES = [
    (
        r"flat fee|same price for any project|same for every project",
        lambda src: src.count("upTo:") > 3,
        "Copy claims a flat fee, but PRICING is tiered by market/band.",
    ),
    (
        r"Watch This Property|Watch subscription|Watch notification",
        lambda src: "openWatchModal" not in src,
        "Copy references the Watch subscription, which is not implemented.",
    ),
    (
        r"report stays free, always|full report is free",
        lambda src: "reportUnlocked" in src,
        "Copy claims the full report is free, but a paywall exists.",
    ),
]


DICT_DIC = "/usr/share/hunspell/en_US.dic"
DICT_AFF = "/usr/share/hunspell/en_US.aff"


def _parse_affix_rules(aff_lines):
    """Read PFX/SFX blocks out of a hunspell .aff file.

    A hunspell .dic is a list of ROOTS plus flags (`deliver/ADGS`), not a
    list of words. Without applying the affix rules the lexicon is only
    ~79k roots and the gate rejects ordinary English — 'delivery',
    'review', 'parties' all fail. Expanding properly yields ~160k real
    forms, which is the difference between a usable gate and one people
    learn to ignore.
    """
    rules = {}
    i = 0
    while i < len(aff_lines):
        parts = aff_lines[i].split()
        if parts and parts[0] in ("PFX", "SFX") and len(parts) >= 4:
            kind, flag = parts[0], parts[1]
            try:
                count = int(parts[3])
            except ValueError:
                i += 1
                continue
            entries = []
            for j in range(1, count + 1):
                if i + j >= len(aff_lines):
                    break
                p = aff_lines[i + j].split()
                if len(p) >= 5 and p[0] == kind and p[1] == flag:
                    entries.append((p[2], p[3], p[4]))
            rules.setdefault(flag, (kind, []))[1].extend(entries)
            i += count + 1
        else:
            i += 1
    return rules


def _condition_matches(word, cond):
    if cond == ".":
        return True
    try:
        return re.search(cond + "$", word) is not None
    except re.error:
        return True


def load_dictionary():
    dic, aff = Path(DICT_DIC), Path(DICT_AFF)
    if not dic.exists() or not aff.exists():
        print("FATAL: hunspell en_US dictionary not found.")
        print("       install hunspell-en-us — without it this gate is meaningless.")
        sys.exit(2)

    rules = _parse_affix_rules(aff.read_text(encoding="utf-8", errors="ignore").splitlines())
    words = set()
    with dic.open(encoding="utf-8", errors="ignore") as fh:
        next(fh, None)
        for line in fh:
            line = line.strip()
            if not line:
                continue
            root, _, flags = line.partition("/")
            root = root.strip().lower()
            if not root:
                continue
            words.add(root)
            for flag in flags.strip():
                if flag not in rules:
                    continue
                kind, entries = rules[flag]
                for strip, add, cond in entries:
                    if not _condition_matches(root, cond):
                        continue
                    add_s = "" if add == "0" else add
                    strip_s = "" if strip == "0" else strip
                    if kind == "SFX":
                        if strip_s and not root.endswith(strip_s):
                            continue
                        form = (root[: -len(strip_s)] if strip_s else root) + add_s
                    else:
                        if strip_s and not root.startswith(strip_s):
                            continue
                        form = add_s + (root[len(strip_s):] if strip_s else root)
                    words.add(form.lower())
    return words


def user_facing_text(src: str) -> str:
    """Strip script, style, SVG and tags; return only what a reader sees."""
    body = re.sub(r"<style.*?</style>", " ", src, flags=re.S)
    body = re.sub(r"<script.*?</script>", " ", body, flags=re.S)
    body = re.sub(r"<svg.*?</svg>", " ", body, flags=re.S)
    body = re.sub(r"<!--.*?-->", " ", body, flags=re.S)
    body = re.sub(r"<[^>]+>", "\n", body)
    return html_mod.unescape(body)



def _known_stem(word, lexicon):
    """True if a regular inflection of a known root."""
    def known(x):
        return x in lexicon or x in LEXICON

    for suffix, restores in (
        ("s", ("", "e")),          # reports -> report
        ("es", ("", "e")),         # boxes -> box
        ("ed", ("", "e")),         # reviewed -> review
        ("d", ("",)),              # derived -> derive
        ("ing", ("", "e")),        # filing -> file
        ("ly", ("", "e")),         # independently -> independent
        ("ies", ("y",)),           # parties -> party
        ("ally", ("al", "")),      # algorithmically -> algorithmic
    ):
        if word.endswith(suffix) and len(word) > len(suffix) + 2:
            stem = word[: -len(suffix)]
            for r in restores:
                if known(stem + r):
                    return True
    # doubled final consonant: 'submitted' -> 'submit'
    if len(word) > 4 and word[-1] == word[-2]:
        if known(word[:-1]):
            return True
    return False


def check_spelling(text, lexicon):
    failures = []
    for raw in re.findall(r"[A-Za-z][A-Za-z'\u2019-]{2,}", text):
        w = raw.lower().strip("'\u2019-")
        # Skip hyphenated compounds whose parts are each valid.
        if "-" in w:
            if all(part in lexicon or part in LEXICON for part in w.split("-") if part):
                continue
        # Contractions written with a typographic apostrophe are correct;
        # normalise before lookup so don’t / you’ve / won’t pass.
        flat = w.replace("\u2019", "'")
        if w in lexicon or w in LEXICON or flat in lexicon or flat in LEXICON:
            continue
        if "'" in flat:
            stem = flat.split("'")[0]
            if stem in lexicon or stem in LEXICON:
                continue
        # Regular morphology fallback. Hunspell's affix flags do not
        # cover every legitimate inflection (e.g. 'reports', 'reviewed',
        # 'redistributed'), and rejecting those trains people to ignore
        # the gate. If a standard stem of the word is known, accept it.
        if _known_stem(flat, lexicon):
            continue
        # possessives
        if w.endswith("\u2019s") and w[:-2] in lexicon | LEXICON:
            continue
        failures.append(raw)
    return sorted(set(failures))


def check_mechanics(text):
    issues = []
    for line in (l.strip() for l in text.split("\n")):
        if len(line) < 20:
            continue
        if re.search(r"\s+[,.;:!?]", line):
            issues.append(("space before punctuation", line[:90]))
        if re.search(r"\b(\w+)\s+\1\b", line, re.I):
            issues.append(("doubled word", line[:90]))
        if line.count("(") != line.count(")"):
            issues.append(("unbalanced parentheses", line[:90]))
        if "--" in line:
            issues.append(("double hyphen — use an em dash", line[:90]))
        if re.search(r"\w'\w", line):
            issues.append(("straight apostrophe — use \u2019", line[:90]))
    return issues


def check_duplicate_rules(src):
    """Flag selectors defined more than once at the same specificity.

    Across this build, three .hero-foot-links rules and thirty-one stale
    .market-* rules accumulated from successive design passes. Later
    rules silently won, so a new style could be written and simply not
    apply — the failure is invisible until someone renders the page.
    Only exact single-class rules outside media queries are counted, so
    legitimate overrides (.a.b, .a .b, responsive blocks) do not trip it.
    """
    style = re.search(r"<style>(.*)</style>", src, re.S)
    if not style:
        return []
    css = style.group(1)
    # Drop media-query bodies — overrides there are intentional.
    css = re.sub(r"@media[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}", " ", css)
    counts = {}
    for m in re.finditer(r"(^|[\n;}])\s*(\.[A-Za-z][\w-]*)\s*\{", css):
        counts[m.group(2)] = counts.get(m.group(2), 0) + 1
    # Two or three definitions is normal layering (base rule plus a
    # theme override). Four or more is accumulation across passes, and
    # is where a newly written style starts silently failing to apply.
    return [(sel, n) for sel, n in sorted(counts.items(), key=lambda x: -x[1]) if n >= 4]


# ---------------------------------------------------------------
# HOUSE STYLE
#
# The problem this solves: machine-drafted prose has a recognisable
# accent. Not errors — the grammar is usually correct — but habits.
# The em-dash used as a default connector, the tricolon everywhere,
# hedges like "arguably", corporate verbs like "leverage", vague
# superlatives like "seamless". A reader cannot always name why copy
# feels generated, but they register it, and on a trust product that
# registration is expensive.
#
# Two design decisions worth stating:
#
# 1. These are RATIOS, not bans. One em-dash is good writing; eleven
#    across sixty-five sentences is a tic. A checker that forbids a
#    punctuation mark outright produces stilted copy and gets ignored.
#    Thresholds fire on over-use.
#
# 2. Legal text is exempt from some rules. Terms and Privacy
#    legitimately enumerate ("regulatory, corporate, and open-data
#    sources") and legitimately use defined terms in quotes ("the
#    Service"). Flagging those trains people to ignore the gate, which
#    is worse than not checking at all.
# ---------------------------------------------------------------

# Phrases that are near-always a tell. These are banned outright,
# because there is no sentence they improve.
BANNED_PHRASES = [
    (r"\bit(?:'s| is) worth noting\b",        "state it or cut it"),
    (r"\bit(?:'s| is) important to note\b",   "state it or cut it"),
    (r"\bneedless to say\b",                  "then do not say it"),
    (r"\bdelve into\b|\bdeep dive\b",        "use 'examine' or 'look at'"),
    (r"\bleverage(?:s|d|ing)?\b",             "use 'use'"),
    (r"\butili[sz]e(?:s|d)?\b",               "use 'use'"),
    (r"\bseamless(?:ly)?\b",                  "unfalsifiable; say what happens"),
    (r"\brobust\b",                           "unfalsifiable; say what it withstands"),
    (r"\bcutting[- ]edge\b|\bstate[- ]of[- ]the[- ]art\b", "unfalsifiable"),
    (r"\bworld[- ]class\b|\bbest[- ]in[- ]class\b",        "unfalsifiable"),
    (r"\bgame[- ]chang(?:er|ing)\b",          "unfalsifiable"),
    (r"\bin today(?:'s)? (?:fast[- ]paced |digital )?world\b", "filler opening"),
    (r"\bunlock the power of\b|\bharness the power of\b",     "marketing filler"),
    (r"\bwe(?:'re| are) excited to\b|\bwe(?:'re| are) thrilled\b", "the reader is not"),
    (r"\bnot just [^,.]{2,30}, but\b",        "'not X but Y' is a generated cadence"),
    (r"\b(?:arguably|essentially|fundamentally|ultimately),",  "hedge; delete the word"),
]

# Ratio checks: habits that are fine occasionally, wrong as a default.
# (label, regex, max share of sentences, guidance)
STYLE_RATIOS = [
    ("em-dash as connector", r"\s[\u2014\u2013]\s",              0.08,
     "an em-dash is a break, not a default joiner. Ask whether a full stop, "
     "a colon, or a comma is what the sentence wants."),
    ("tricolon",             r"\b\w+, \w+,? and \w+\b",           0.20,
     "three-item lists everywhere is a generated rhythm. Vary the count."),
    ("sentence-initial 'And'/'But'", r"^(?:And|But)\b",           0.10,
     "occasional is fine; frequent reads as affected."),
]

# Sections where enumeration and defined terms are correct drafting.
LEGAL_MARKERS = ("tncModal", "privacyModal", "Terms &amp; Conditions", "Privacy Policy")


def _split_sentences(text):
    out = []
    for line in text.split("\n"):
        line = line.strip()
        if len(line) < 20:
            continue
        out.extend(p.strip() for p in re.split(r"(?<=[.!?])\s+", line) if len(p.strip()) > 15)
    return out


def check_house_style(src, text):
    """Returns (hard_failures, advisories)."""
    failures, advisories = [], []
    sentences = _split_sentences(text)
    if not sentences:
        return failures, advisories

    for pattern, guidance in BANNED_PHRASES:
        for s in sentences:
            if re.search(pattern, s, re.I):
                failures.append((s[:90], guidance))

    for label, pattern, limit, guidance in STYLE_RATIOS:
        hits = [s for s in sentences if re.search(pattern, s)]
        share = len(hits) / len(sentences)
        if share > limit:
            advisories.append((
                f"{label}: {len(hits)}/{len(sentences)} sentences "
                f"({share*100:.0f}%, limit {limit*100:.0f}%)",
                guidance,
                [h[:80] for h in hits[:4]],
            ))
    return failures, advisories


def check_merged_selectors(src):
    """Detect selector lists that swallowed a following rule.

    Deleting a rule from a shared selector list — e.g. removing
    `.seal-line` from `.a, .b, .seal-line{...}` — can leave a dangling
    comma. CSS then reads the NEXT rule's selector as a continuation,
    silently merging two unrelated rules. This shipped twice: the
    mono-label tracking rule landed on the page headline, and the
    dropdown's paper background landed on it too, turning the hero
    statement into a white block with blown-out letter-spacing.

    Braces stay balanced and every other check passes, so nothing else
    catches it. The signature is a selector list whose final entry is
    followed by a comma and then a COMMENT — a human would not write
    that, but a careless deletion produces it.
    """
    style = re.search(r"<style>(.*)</style>", src, re.S)
    if not style:
        return []
    css = style.group(1)
    # Walk the stylesheet rule by rule. Selector territory is the text
    # between the end of one block and the start of the next — anything
    # inside a block is a declaration and its commas are values, not
    # selector separators. Scanning structurally instead of with a
    # fixed-width window avoids truncating a gradient's opening paren
    # and mistaking its commas for a selector list.
    hits = []
    pos = 0
    while True:
        open_brace = css.find("{", pos)
        if open_brace == -1:
            break
        prev_close = css.rfind("}", 0, open_brace)
        selector = css[prev_close + 1 : open_brace]
        # strip at-rule openers, which legitimately precede a block
        if re.search(r"@(media|supports|keyframes|font-face)", selector):
            pos = open_brace + 1
            continue
        stripped = re.sub(r"/\*.*?\*/", "", selector, flags=re.S).strip()
        # A selector list that still ends in a comma after its comments
        # are removed means a rule was deleted and the comma left behind.
        if stripped.endswith(","):
            hits.append(" ".join(selector.split())[-110:])
        # ...or a comment sits between a trailing comma and the next
        # selector, which is the exact signature of a careless deletion.
        elif re.search(r",\s*/\*.*?\*/\s*[.#\w]", selector, re.S):
            hits.append(" ".join(selector.split())[-110:])
        pos = open_brace + 1
    return hits


def check_truth(src, text):
    issues = []
    for pattern, predicate, message in TRUTH_RULES:
        if re.search(pattern, text, re.I) and predicate(src):
            issues.append(message)
    return issues


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    path = Path(sys.argv[1])
    src = path.read_text(encoding="utf-8")
    text = user_facing_text(src)
    lexicon = load_dictionary()

    spelling = check_spelling(text, lexicon)
    mechanics = check_mechanics(text)
    truth = check_truth(src, text)
    dupes = check_duplicate_rules(src)
    style_fail, style_advise = check_house_style(src, text)
    merged = check_merged_selectors(src)

    print(f"ShelterKart copy gate — {path.name}")
    print(f"  dictionary entries : {len(lexicon):,}")
    print(f"  project lexicon    : {len(LEXICON)}")
    print()

    ok = True
    if spelling:
        ok = False
        print(f"SPELLING — {len(spelling)} unrecognised word(s):")
        for w in spelling:
            print(f"    {w}")
        print("  Fix the spelling, or add the term to LEXICON if it is correct.\n")
    else:
        print("SPELLING   pass")

    if mechanics:
        ok = False
        print(f"MECHANICS — {len(mechanics)} issue(s):")
        for kind, line in mechanics:
            print(f"    [{kind}] {line}")
        print()
    else:
        print("MECHANICS  pass")

    if dupes:
        print(f"CSS RULES  advisory — {len(dupes)} selector(s) defined 4+ times:")
        for sel, n in dupes:
            print(f"    {sel}  x{n}")
        print("  Not a failure (layering is valid), but this is where a new")
        print("  style starts silently failing to apply. Worth consolidating.\n")
    else:
        print("CSS RULES  pass")

    if style_fail:
        ok = False
        print(f"HOUSE STYLE — {len(style_fail)} banned phrase(s):")
        for line, guidance in style_fail:
            print(f"    {line}")
            print(f"      -> {guidance}")
        print()
    elif not style_advise:
        print("HOUSE STYLE pass")

    if style_advise:
        print("HOUSE STYLE advisory — habits over their threshold:")
        for summary, guidance, examples in style_advise:
            print(f"    {summary}")
            print(f"      -> {guidance}")
            for e in examples:
                print(f"         {e}")
        print()

    if merged:
        ok = False
        print(f"MERGED CSS — {len(merged)} selector list(s) ran into the next rule:")
        for x in merged:
            print(f"    {x}")
        print("  A comma followed by a comment then another selector means a")
        print("  rule was deleted from a shared list and left the comma behind.")
        print("  The two rules are now one. Close the list with a brace.\n")
    else:
        print("MERGED CSS pass")

    if truth:
        ok = False
        print(f"TRUTH — {len(truth)} contradiction(s) between copy and code:")
        for m in truth:
            print(f"    {m}")
        print()
    else:
        print("TRUTH      pass")

    print()
    print("RESULT:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
