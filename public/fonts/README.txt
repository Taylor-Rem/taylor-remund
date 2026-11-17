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
