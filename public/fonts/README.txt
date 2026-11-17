Fonts for the text in the workshop (label tape, crate stencils, typed
cards, brass plates, the painted sign, the phone screen). Self-hosted; no
request goes to any other origin. Loaded with the FontFace API by
src/workshop/view/labels/fonts.ts before anything is drawn.

Each file is a SUBSET of an open-licence font, renamed. Under the SIL Open
Font License a subset is a Modified Version, and two of these fonts declare
Reserved Font Names ("Alfa Slab"; "Stardos", "Stardos Stencil"), which a
Modified Version may not use; so every subset carries a neutral family name
("Workshop ..."). The copyright, version and licence records of the original
are kept in each file's name table. Each licence is beside its file.

file                     family name        subset of                         version  licence  source (downloaded 2026-11-17)
workshop-tape.woff2      Workshop Tape      Barlow Semi Condensed SemiBold    1.408    OFL 1.1  https://github.com/google/fonts/blob/main/ofl/barlowsemicondensed/BarlowSemiCondensed-SemiBold.ttf  (upstream: https://github.com/jpt/barlow)
workshop-type.woff2      Workshop Type      Courier Prime Regular             3.018    OFL 1.1  https://github.com/google/fonts/blob/main/ofl/courierprime/CourierPrime-Regular.ttf  (upstream: https://github.com/quoteunquoteapps/CourierPrime)
workshop-stencil.woff2   Workshop Stencil   Stardos Stencil Bold              1.001    OFL 1.1  https://github.com/google/fonts/blob/main/ofl/stardosstencil/StardosStencil-Bold.ttf
workshop-sign.woff2      Workshop Sign      Alfa Slab One Regular             2.000    OFL 1.1  https://github.com/google/fonts/blob/main/ofl/alfaslabone/AlfaSlabOne-Regular.ttf  (upstream: https://github.com/googlefonts/alfaslabone)

Licences: workshop-*.OFL.txt (each the OFL.txt from the same google/fonts
directory, with that font's copyright line).

Characters kept (fonts.ts SUBSET mirrors these; a unit test checks every
world string against them):
  tape, type      printable ASCII (U+0020-U+007E) and ’ ‘ “ ” – — … é
  stencil, sign   space, A-Z, 0-9 and . , : ; - – — ' ’ " ! ? & / # ( ) + % *

How they were made: glyph ids kept, glyphs outside the set emptied, cmap
rebuilt (3,1 format 4), GSUB/GDEF and hinting dropped (instructions
stripped), GPOS/kern kept for kerning, post set to format 3, name table
renamed, then WOFF2 with null-transformed glyf/loca and Brotli quality 11.

To remake them: download the four original .ttf files listed above into
one directory (the file names must stay as upstream names them), then
  node scripts/subset-fonts.ts <that directory>
which writes public/fonts/workshop-*.woff2. The character sets come from
SUBSET in src/workshop/view/labels/fonts.ts. Output is deterministic:
re-running it on the originals above (sha256 prefixes: Barlow bd299f4bc5b44d30,
Courier Prime 72f793376f8e2841, Stardos 6b15f50b1b358512, Alfa Slab
28664afa698a3393) reproduced the committed files byte for byte on
2026-11-17 (Node 22's built-in Brotli).

Sizes (bytes): tape 13564, type 8360, stencil 6832, sign 7068; total 35824.
