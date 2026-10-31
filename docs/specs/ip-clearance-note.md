# Intellectual property note: LEGO, DUPLO, and the ToyVentor parts system

> Not legal advice. A working note to take to counsel alongside
> [`parts/partspec/LICENSING.md`](../../parts/partspec/LICENSING.md) and the
> product-safety checklist in
> [`docs/parts/partspec/specs/07_compliance.md`](../parts/partspec/specs/07_compliance.md).
> Written Oct 31, 2026 from public legal sources and this repository's own
> geometry and guard rails.

## The judgment

Nothing in ToyVentor as built infringes LEGO's or DUPLO's rights, and nothing
in it is likely to attract an enforcement letter. The reason is structural
rather than lucky: the TU parts system is dimensionally distinct from both
LEGO's and DUPLO's lattices, no buyer-facing surface in this repository
mentions any third-party brand, and the project already runs a brand-name
blocklist through the part generator and its test suite.

The exposure is also not where a first reading of "we make bricks" would put
it. Cloning a building system is not infringement; the rights LEGO still
enforces are the brand, the minifigure, specific newer brick designs, the
colour scheme, and their own product technology. ToyVentor's parts sit
outside all of them, and the one right that would be closest to the bone, the
minifigure, is nowhere near the Kip rig.

Three things would create real exposure, and none of them is the geometry:
saying their names in marketing, claiming compatibility, and letting the
brand guard decay. A fourth risk runs the opposite direction and is larger
than all three: ToyVentor's own utility patents are unfiled while the
designs are being published under an open licence, and the ToyVentor name
itself has had a web search but no trademark search.

## What the LEGO Group still protects

The LEGO Group's portfolio is layered, and the layers have very different
reach.

The word mark, the logo, DUPLO, the minifigure, and "the brick & knob
configuration" are all listed by LEGO as trademarks of the Group, and its
Fair Play policy states plainly that its trademarks and copyrighted material
"may NEVER be used by unrelated third parties for their own commercial or
marketing purposes, unless formal permission or a written licence has been
granted." LEGO has been willing to enforce that at small scale: the Lepin
litigation in China produced 18 upheld copyright findings and one
unfair-competition finding with RMB 4.7 million in damages on one appeal and
a separate RMB 30 million judgment in 2021, German customs blocked a Qman
shipment in 2021, and LEGO sent cease-and-desist letters to small retailers
and YouTubers in Germany in 2020 and 2021. The realistic threat to a small
company is a cease-and-desist letter, not a trial.

The minifigure is the right they enforce hardest. The General Court
upheld LEGO's figure shape mark in 2015 (T-395/14 and T-396/14, Best-Lock v OHIM), LEGO
holds US design patents for the figure, and in the United States the court
entered summary judgment for LEGO against Zuru on infringement of that shape
mark and on fraudulent infringement, affirmed by the Federal Circuit in 2021.
A figure with a recognisable cylindrical head, clamp hands and hollow leg
backs is the specific thing being protected.

LEGO also holds live design patents on individual brick designs, including
US D701,923S, D688,328S, D641,053S and D614,707S, which it successfully
asserted against Zuru's Max Build More line. Those are specific ornamental
designs, not the system. The Group also holds more than 2,000 live patents on
its real product technology, with wheels, gearboxes and electronics among the
protected ground.

## Where the protection stopped

The basic brick is not protectable, and that is what makes an independent
building system lawful rather than merely tolerated.

The utility patents on the stud-and-tube brick expired in 1978 in the United
States, Denmark and Canada, and the last Canadian patents in 1988. LEGO then
tried to hold the shape through trademarks and design rights, and largely
failed. The Court of Justice ruled in 2010 (C-48/09 P, Lego Juris v OHIM)
that the eight-peg brick shape "merely performs a technical function" and
cannot be registered as a trade mark, because all its essential
characteristics are technical. The Supreme Court of Canada reached the same
result in Kirkbi AG v Ritvik Holdings (2005 SCC 65), holding that functional
elements cannot be protected by registered trade mark or by passing off.
The German Federal Court denied LEGO trade mark protection for the brick
shape in 2009, and the Italian Supreme Court held that marketing a
compatible brick is not unfair competition so long as no other right is
infringed. The CJEU made the point expressly: an undertaking that developed
a technical solution cannot claim a monopoly over that solution by
registering its shape as a trade mark.

The one place the shape survived is design rights. The General Court
confirmed in January 2024 that a particular LEGO brick is a valid registered
design, and the Group holds a portfolio of design rights for individual
bricks and minifigures. Design rights protect the appearance of a specific
product. They are not a claim over the system.

DUPLO is a live LEGO trademark, launched in 1969 for preschool children,
built at twice the scale of a standard brick. The construction method for the
hollow-stud large brick was patented in 1967 and that patent expired long
ago, so the geometry is free; the name and the rabbit logo are not.

## Why ToyVentor is outside all of it

The relevant question is not whether ToyVentor is "similar to LEGO". It is
whether the parts can be confused with LEGO parts, and the answer is
decided by geometry rather than by argument.

| Measure | LEGO | DUPLO | ToyVentor Snap Small | ToyVentor Snap Large |
| --- | --- | --- | --- | --- |
| Stud pitch | 8.0 mm | 16.0 mm | 12.5 mm | 25.0 mm |
| Stud diameter | 4.8 mm | 9.6 mm | 6.6 mm | 13.2 mm |
| Stud height | 1.6 mm | 3.2 mm | 2.8 mm | 5.6 mm |
| Brick height | 9.6 mm | 19.2 mm | 15.0 mm | 30.0 mm |
| Plate height | 3.2 mm | 6.4 mm | 5.0 mm | 10.0 mm |

LEGO and DUPLO figures are from the measured geometry of the systems;
ToyVentor's come from `parts/partspec/interfaces.json`. The pitch is what
decides interoperability, and 12.5 mm is neither 8 mm nor 16 mm. A TU Small
stud is 6.6 mm across against LEGO's 4.8 mm, so a TU part cannot enter a
LEGO socket. The reverse is no fit either: a smaller LEGO stud may sit
loose in a TU socket, but it cannot clutch, so there is still no
functional connection. Snap Large at 25 mm
pitch is not DUPLO either.

The proportions are worth noting because they show the analysis was done
rather than assumed. TU tracks the same functional ratios as LEGO for brick
height and plate height, 1.2 and 0.4 of pitch, which is exactly what the
functionality doctrine excludes from trade mark protection: those ratios
exist to make a brick do what a brick does. Where it matters, TU departs:
its stud diameter is 0.528 of pitch against LEGO's 0.600, and its stud
height is 0.224 against LEGO's 0.200. The fit is friction-based rather than
LEGO's clutch-power system, and the Pro line adds a pin-and-bore grid that
has no LEGO equivalent. These are different parts that cannot be confused in
the hand.

This was a decision, not an accident. The design log records that Snap's
original 8 and 16 mm pitch "matched the spacing of the market-leading brick
systems without matching their studs, which invites a fit expectation it
cannot meet", and that the 12.5 and 25 mm TU unit was chosen as "our own
unit, unrelated to any existing system's pitch". Keeping that property is
now a legal property, and it should be protected as one.

## What the project already gets right

The guard rails are real and mostly in the right places. The Kip part
generator rejects names containing LEGO, DUPLO, Technic, Bionicle, Meccano,
Playmobil, K'Nex or Mega Bloks
(`parts/kip/sdk/kip_partspec_sdk.py`), the partspec agent prompt instructs
that no third-party construction system or trademark be named in part names,
specs, UI text or comments (`parts/partspec/make_agents.py`), and a Vitest
case enforces the rule over the Kip manifests, the viewer and the prompt
file (`tests/kip.test.ts`). The Kip rig was built clean-room on the 12.5 mm
TU lattice with Mixamo clips retargeted onto it, and its heads are Soft
Youth, Vinyl Squircle, Jumbo Vinyl and Heroic Jaw designs with sculpted
noses and orbital sockets. A LEGO minifigure is a plain cylinder with a
printed face. There is no resemblance for the shape mark to attach to.

A scan of every buyer-facing surface in this repository on Oct 31, 2026
(`src/`, `sets/`, `drafts/`, `seed/`, `public/`, `index.html`, `README.md`)
returned no occurrence of LEGO, DUPLO, Technic, Bionicle, Playmobil, Meccano,
K'Nex, Mega Bloks or minifigure. The word "brick" and the word "stud" are
used throughout the catalogue, which is unremarkable: they are the generic
terms of the trade, and the right to use them descriptively is not
LEGO's to withhold.

## The three exposures that are real

**Naming.** The narrow but genuine risk is a marketing sentence, not a
product. LEGO's stated policy is that its marks may not be used by third
parties for their own commercial purposes without a licence, and the cases
show enforcement reaches small sellers and influencers. A comparison line in
a landing page, a product title, a marketplace listing or a press release
would be exactly the kind of use that attracts a letter. Today the
enforcement is a regex and a test over seven files under `parts/kip/`, which
does not cover the app copy, the catalogue sets, the landing page or these
docs. The cheapest fix is to extend that existing test to the surfaces a
buyer reads.

**Compatibility claims.** These are legally defensible in some places and
risky in others, and the New Zealand Court of Appeal allowed Zuru to keep
"LEGO® BRICK COMPATIBLE" on its packaging in 2026, holding that consumers
would not take the mark as indicating origin. The European Union is
stricter: the Advocate General's opinion in C-334/22 framed referential use
narrowly and placed a duty of diligence on sellers of non-original spare
parts, including a duty to state clearly on the product, packaging or
sales documents that the parts are not produced by the original
manufacturer, and the Unfair Commercial Practices Directive treats the
existence or non-existence of sponsorship or approval as material
information a trader must not mislead about. For ToyVentor the claim would
also be false: the parts do not fit, so "compatible" would be a misleading
statement about a characteristic of the product rather than a competitive
reference. The rule that protects ToyVentor best is to describe the TU
lattice and never to claim compatibility with anyone's system.

**Colour and trade dress.** LEGO successfully asserted trade dress in its
red, yellow, black and white colour scheme against Zuru, alongside common
law rights in the stud shape as a source identifier. The ToyVentor palette
is its own, the geometry differs, and there is no compatibility claim to
bridge the two, so there is no exposure today. It becomes a question only if
a parts line ships primary red, yellow and blue blocks. Cheap to remember,
not worth designing around now.

## The risk that is larger, and points the other way

The exposure that deserves attention is inbound. ToyVentor's own protectable
material, the lattice, the fit gate, the stud-hole and socket geometry and
the part families, is currently protected only by the copyright notice and
the date stamps on the published designs.

Publishing under CC BY 4.0 creates prior art, which is a good defence
against someone else patenting the same shapes, and it is a poor substitute
for a patent. The United States allows one year from your own public
disclosure before the disclosure becomes prior art against you; most other
countries allow none. `parts/partspec/LICENSING.md` already flags this as an
open decision, and it should be closed before the designs are published
rather than after: either file on the lattice and the fit gate, or accept
deliberately that the shapes will be free to copy in exchange for the reach
that open publication buys.

Two placeholders also remain open and are independent of LEGO. The copyright
line and the licence still say "[legal owner]", and the ToyVentor name itself
has had a web search but no USPTO or EUIPO search, which the design log
correctly says is not a trademark search. On the evidence available, running
that search is the highest-value legal action in the project.

Separately, the product-safety track in
[`docs/parts/partspec/specs/07_compliance.md`](../parts/partspec/specs/07_compliance.md)
is the larger obligation of the two and is barely started. Whether the
company prints and ships parts or families print at home changes who the
manufacturer is, and that choice should be made before launch rather than
in parallel with it.

## What to do

1. Extend the forbidden-brand test in `tests/kip.test.ts` to the app copy,
   `sets/`, `seed/`, `drafts/` and this docs tree, so the zero-hit result
   stays a rule rather than a snapshot.
2. Write the no-compatibility rule into `parts/partspec/LICENSING.md`, with
   the reason stated: the parts do not fit, so the claim would be false, and
   the EU's spare-parts guidance makes a misleading characteristic the
   trader's problem.
3. Close the patent decision before publishing the designs: file, or accept
   prior art deliberately and record it.
4. Fill in the legal owner, and run the trademark search for ToyVentor with
   counsel rather than a web search.
5. Keep IP and product safety on separate tracks with separate owners. They
   meet at the launch decision, not before it.

## Sources

- Court of Justice, Lego Juris v OHIM (C-48/09 P), 14 September 2010:
  https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=celex:62009CJ0048
- General Court, Best-Lock v OHIM (T-395/14 and T-396/14), 16 June 2015
  (figure shape mark upheld), and BB Services v EUIPO (T-297/22):
  https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:62014TJ0395
  https://eur-lex.europa.eu/legal-content/EN/TXT/PDF/?uri=CELEX:62022TJ0297
- Opinion of the Advocate General in C-334/22 (referential use, non-original
  spare parts, duty of diligence and origin-disclosure):
  https://eur-lex.europa.eu/legal-content/EN/TXT/HTML/?uri=CELEX:62022CC0334
- Directive 2005/29/EC (Unfair Commercial Practices Directive), Articles 5 to
  7 and Annex I:
  https://eur-lex.europa.eu/legal-content/en/ALL/?uri=CELEX:32005L0029
- Kirkbi AG v Ritvik Holdings, 2005 SCC 65 (Canada):
  https://www.dww.com/articles/shape-of-lego%C2%AE-blocks-not-protected-by-trademark-law-canada
- LEGO Group v Zuru, N.D. Cal. (minifigure shape mark, colour trade dress,
  stud trademarks, brick design patents):
  https://business.cch.com/ipld/LegoZuruComp20181213.pdf
  and Federal Circuit, 2021:
  https://www.govinfo.gov/content/pkg/USCOURTS-ca13-19-02122/pdf/USCOURTS-ca13-19-02122-0.pdf
- Zuru New Zealand Ltd v Lego Juris AS, [2023] NZHC 1808, and the Court of
  Appeal decision of 2026 on "LEGO BRICK COMPATIBLE":
  https://thelawassociation.nz/wp-content/uploads/2023/07/Zuru-New-Zealand-Ltd-v-Lego-Juris-AS-2023-NZHC-1808.pdf
- LEGO Group, Lepin litigation outcomes (China):
  https://www.lego.com/en-us/aboutus/news/2020/january/lepin-case
- LEGO Group, "Fair Play" trademark and copyright policy:
  https://www.lego.com/cdn/cs/legal/assets/blt1a4c9a959ce8e1cb/LEGO_Fairplay_Nov2018.pdf
- LEGO Group trademark and product history (DUPLO 1969, 2:1 scale):
  https://www.lego.com/en-us/history/articles/e-lego-duplo
- UK IPO, "LEGOcy in the making: an IP story":
  https://ipo.blog.gov.uk/2025/03/20/legocy-in-the-making-an-ip-story/
- LEGO brick and DUPLO dimensions:
  https://brickfact.com/blog/guidebooks/lego-brick-dimensions
  and https://www.brightontoymuseum.co.uk/index/Lego_dimensions
- TTAB Answer to Zuru's cancellation petition ("'282 Patent expired on October
  24, 1978"):
  https://ttabvue.uspto.gov/ttabvue/ttabvue-92075254-CAN-5.pdf
