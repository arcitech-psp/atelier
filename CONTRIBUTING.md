# Contributing to Atelier

Thank you for wanting to help. Atelier is a small project with one maintainer, so this page keeps the rules short and honest.

## How changes come in

- **Changes arrive as proposals.** Open an issue first for anything larger than a typo or a one-line fix, then send a pull request. A proposal is a suggestion: nothing is merged until the maintainer (ArciTech, Parth Patel) has reviewed and approved it.
- Keep each proposal small and about one thing. Say what problem it solves and how you checked it works.
- The maintainer may ask for changes, may decline a proposal, and may rewrite part of it. A "no" is about fit with the project, not about you.
- Bugs and rough edges are welcome as issues too. Please include your operating system, Node.js and pnpm versions, and the exact message you saw. Never paste API keys, tokens, or private client material into an issue.

## Where your change goes

- Code under `harness/` comes from DeepSeek Harness (MIT). If your change is general and not specific to Atelier, consider sending it upstream to DeepSeek Harness as well.
- `ingetrazo-plugin/` is separately licensed under GPL-3.0-or-later. Contributions to that folder are accepted under GPL-3.0-or-later, not under the project licence.
- Skills proposed for `skills/public/` must pass `node skills/review.mjs` and are listed in `skills/APPROVED.json` only after the maintainer reads and approves them.

## Licence of your contribution

By sending a contribution (a pull request, a patch, or text in an issue that is added to the project) you confirm that:

1. you wrote it, or you have the right to submit it;
2. you agree that ArciTech (Parth Patel), as owner of the project, may license your contribution under the licence the project uses, as it is now and as the owner may change it later, and may include it in official builds; and
3. you keep the copyright in what you wrote.

If you cannot agree to this, please open an issue to discuss the idea instead of sending code.

## Names and logo

Contributions do not grant any right to the Atelier or ArciTech names or the AT logo; see `TRADEMARK.md`.

## Contact

arcitech.team@outlook.com
