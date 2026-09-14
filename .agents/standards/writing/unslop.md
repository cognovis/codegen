# Unslop: removing AI tells from prose

> **Scope**: Prose written for people, the same prose that
> [plain-technical-english.md](plain-technical-english.md) governs. That file
> owns sentence mechanics: active voice, short sentences, plain words, filler,
> hedging. This file catalogs the patterns that mark a text as machine-written.
> An exact output contract (a template, a schema, a fixed heading) overrides a
> presentation tell; the catalog governs free prose.
>
> Adapted from the `unslop` skill in cursor/plugins
> ([pinned source](https://github.com/cursor/plugins/blob/99559f2f52047978602ef365589275831e76af07/pstack/skills/unslop/SKILL.md),
> MIT, copyright 2026 Lauren Tan, full notice in
> [third-party-notices.md](third-party-notices.md)), with the jargon table
> adjusted for this codebase's vocabulary.

The tables below are not exhaustive. Whatever would make a text obviously
AI-generated to its reader is a tell, listed here or not.

## Content tells

| Tell | Looks like | Fix |
|------|-----------|-----|
| Puffery | "pivotal moment", "testament to", "evolving landscape" | State what happened |
| Promotional adjectives | "vibrant", "groundbreaking", "renowned", "seamless" | Neutral description |
| Name-dropping | A list of outlets, tools, or authorities with no content | Pick one, say what it said |
| Superficial `-ing` trailers | ", highlighting the need for", ", ensuring quality" | Delete, or expand with a real source |
| Vague attribution | "Experts believe", "reports suggest" | Name the source or delete |
| Formulaic arc | "Despite challenges, X continues to thrive" | Specific facts |
| Generic conclusion | "The future looks bright" | Specific plans, or end earlier |

## Language tells

| Tell | Looks like | Fix |
|------|-----------|-----|
| AI vocabulary | additionally, crucial, delve, enduring, enhance, fostering, garner, interplay, intricate, pivotal, showcase, tapestry, underscore, vantage | The plain word |
| Fancy "is" | "serves as", "stands as", "boasts", "features" | "is" / "has" |
| "Not just X, but Y" | "not just fast, but reliable" | State Y directly |
| Rule of three | Ideas forced into triads | The natural number |
| Synonym cycling | "the loader", "the component", "the mechanism" for one thing | One name per thing ([unambiguous-english.md](unambiguous-english.md)) |
| False range | "from X to Y" where X and Y share no scale | List the items |

## Style tells

- Em dashes: avoid them in prose deliverables. End the sentence or use a
  comma. Parentheses or en dashes as substitutes are the same tell.
- Colons as mid-sentence connectors: a colon belongs before a list or an
  example, not between two clauses as a rhetorical hinge.
- Bold overuse: not every proper noun or acronym is bold.
- Inline-header lists: a bold label plus colon that restates the line
  ("**Performance:** performance improved") becomes prose. A bold lead-in
  followed by genuinely new detail is fine.
- Headings: sentence case, not Title Case.
- Emojis: none in headings or bullets. The global no-emoji rule already
  covers code and technical docs.
- Curly quotes: use straight quotes.

## Chat artifacts

Remove entirely: "I hope this helps!", "Let me know if", "Certainly!",
"Great question!", "You're absolutely right!", "Found the smoking gun!",
and cutoff disclaimers such as "While specific details are limited".
Respond or report directly.

## Jargon: abstract metaphor nouns

Substrate, wedge (as verb), vector (for "method"), nexus, locus, vantage,
bedrock, flywheel, north star, endgame, gold-plating, ratchet, paradigm,
modality, primitive, harness, surface, scaffolding, evacuate (for moving
code). Used as metaphors, each has a plainer concrete word: "substrate" is
"base", "wedge in" is "add", "north star" is "the goal".

**Domain-sense exception.** Rule 0 of
[plain-technical-english.md](plain-technical-english.md) outranks this table
for exact repository-defined senses only: `primitive` as a Library primitive,
`harness` as a coding harness (Claude Code, Codex), `surface` as a permission
or API surface, `scaffold` as the generator command. The same words used as
metaphors ("the attack surface of an argument", "harness the model") stay
tells.

## Voice

Voice rules apply to editorial and recommendation prose: proposals, retros,
review verdicts, reports that end in a judgment. Factual genres (reference
docs, research summaries, evidence lists) stay neutral and draw conclusions
from evidence instead of manufactured personality.

- A judgment-free pros-and-cons list dodges the author's job; react to the
  facts.
- Vary sentence rhythm; uniform length reads machine-made.
- Prefer the specific observation over the generic label.
- First person is allowed where the author genuinely judged or chose.
- A sentence that could appear unchanged in another project's docs says
  nothing about this one. Cut it.
