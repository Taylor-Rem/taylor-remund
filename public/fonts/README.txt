Fonts for the text in the workshop (label tape, crate stencils, printed
cue cards and slips, brass plates, the painted sign, the phone screen).
Self-hosted; no request goes to any other origin. Loaded with the FontFace
API by src/workshop/view/labels/fonts.ts before anything is drawn.

Each file is a SUBSET of an open-licence font, renamed. Under the SIL Open
Font License a subset is a Modified Version, and two of these fonts declare
Reserved Font Names ("Alfa Slab"; "Stardos", "Stardos Stencil"), which a
Modified Version may not use; so every subset carries a neutral family name
("Workshop ..."). The copyright, version and licence records of the original
are kept in each file's name table. Each licence is beside its file.

file                     family name        subset of                         version  licence  source (downloaded 2026-11-17)
workshop-tape.woff2      Workshop Tape      Barlow Semi Condensed SemiBold    1.408    OFL 1.1  https://github.com/google/fonts/blob/main/ofl/barlowsemicondensed/BarlowSemiCondensed-SemiBold.ttf  (upstream: https://github.com/jpt/barlow)
workshop-print.woff2     Workshop Print     Iosevka Fixed Slab Medium         34.9.1   OFL 1.1  https://github.com/be5invis/Iosevka/releases/download/v34.9.1/PkgTTF-Unhinted-IosevkaFixedSlab-34.9.1.zip  (IosevkaFixedSlab-Medium.ttf inside)
workshop-stencil.woff2   Workshop Stencil   Stardos Stencil Bold              1.001    OFL 1.1  https://github.com/google/fonts/blob/main/ofl/stardosstencil/StardosStencil-Bold.ttf
workshop-sign.woff2      Workshop Sign      Alfa Slab One Regular             2.000    OFL 1.1  https://github.com/google/fonts/blob/main/ofl/alfaslabone/AlfaSlabOne-Regular.ttf  (upstream: https://github.com/googlefonts/alfaslabone)

Licences: workshop-*.OFL.txt (the google/fonts OFL.txt of each family; for
Iosevka the release tag's LICENSE.md), each with that font's copyright line.

Why Iosevka Fixed Slab for the cards: a slab monospace advancing 0.5 em
(about 0.68 cap-heights a character, against Courier's 1.03), so a 12-letter
line of 12 px capitals fits a cue card about 2.2 units wide; it reads as a
teletype or receipt printer. The Fixed variant has no ligatures.

Characters kept (fonts.ts SUBSET mirrors these; a unit test checks every
world string against them):
  tape, print     printable ASCII (U+0020-U+007E) and ’ ‘ “ ” – — … é
  stencil, sign   space, A-Z, 0-9 and . , : ; - – — ' ’ " ! ? & / # ( ) + % *

How they were made (scripts/subset-fonts.ts): glyphs outside the set
emptied (Barlow, Stardos, Alfa Slab: glyph ids kept, GPOS/kern kept for
kerning) or dropped and renumbered (Iosevka, 39,837 glyphs: "compact"
mode, GPOS dropped, which a monospace does not need); cmap rebuilt (3,1
format 4); GSUB/GDEF and hinting dropped, instructions stripped; post set
to format 3; name table renamed; then WOFF2 with null-transformed glyf/loca
and Brotli quality 11.

To remake them: put the four original .ttf files listed above (names as
upstream ships them; unzip IosevkaFixedSlab-Medium.ttf from the release
zip) in one directory, then
  node scripts/subset-fonts.ts <that directory>
which writes public/fonts/workshop-*.woff2. Output is deterministic:
re-running it on these originals (sha256 prefixes: Barlow bd299f4bc5b44d30,
Iosevka Fixed Slab Medium 4850f23f09886f26, Stardos 6b15f50b1b358512, Alfa
Slab 28664afa698a3393) reproduced the committed files byte for byte on
2026-11-17 (Node 22's built-in Brotli).

Sizes (bytes): tape 13564, print 7116, stencil 6832, sign 7068; total 34580.


THE PAPERWORK PAGES (/resume/, the compliance pages, the 404; REWRITE.md § A
"Type on the HTML pages"): IBM Plex Sans for reading, IBM Plex Mono for
labels, dates, tags and figures, and Workshop Stencil (above) for his name
only. Declared in src/styles/paper.css with font-display: swap.

The IBM Plex files are IBM's own per-script woff2 splits, UNMODIFIED and under
IBM's own file names (the OFL reserves the name "Plex" for unmodified files).
Downloaded 2026-11-21 from the IBM/plex release assets:

  IBM Plex Sans 1.3.6  https://github.com/IBM/plex/releases/download/%40ibm/plex-sans%401.3.6/ibm-plex-sans.zip
                       (zip sha256 a52bd405930040a6bfdb5c8aff67f1b7205538999986e2186d8f8895ca6a5de1)
  IBM Plex Mono 2.5.0  https://github.com/IBM/plex/releases/download/%40ibm/plex-mono%402.5.0/ibm-plex-mono.zip
                       (zip sha256 6d23f01257663d8cc49a0d64c22ced630b79e0e2a0ac08a0da86e9a38bbc481c)

each taken from fonts/split/woff2/ inside the zip:

file                                 bytes  sha256
IBMPlexSans-Regular-Latin1.woff2     21300  bdb53f2af84b15e0a742428f5e199dacc3e6fd60776f0aebd9f700e2c97c960f
IBMPlexSans-Regular-Pi.woff2          9324  3b52c2fd8715cb8526823a8d425ebc369b716c8232f5092cf38dce305b73676a
IBMPlexSans-SemiBold-Latin1.woff2    22736  8251b7fc61b580c2f52550fa69b3c49fb94fc333815ad301ca6b1f6d15420f85
IBMPlexSans-Italic-Latin1.woff2      23096  8b14bb07ba4f906c70417543b96449abc849c67c9520a9e0c72c4fd6816aec6a
IBMPlexMono-Regular-Latin1.woff2     17544  e8993d946649b9d01abb1ed06d574b19d8ea3e66b5c3948602db335c44c18e56

Licence: IBMPlex.OFL.txt (the zip's LICENSE.txt; Sans and Mono ship the same
text, "Copyright © 2017 IBM Corp. with Reserved Font Name "Plex"").

Why these and no more. Latin1 covers ASCII, Latin-1 and the punctuation the
pages use (– — ‘ ’ “ ” … · é); each @font-face carries IBM's own
unicode-range for its split, so a browser fetches a file only when a
character on the page needs it. The Pi split is declared for Sans Regular
only: the résumé's body text has one ≤ and two → (Pi), nothing else outside
Latin1. Weights: Regular (reading), SemiBold (headings, names, bold),
Italic (one <em> on the résumé; a browser fetches it only for that line),
Mono Regular (labels, dates, tags, figures). Preloaded: Sans Regular,
Mono Regular and the stencil, which the first screen uses.
