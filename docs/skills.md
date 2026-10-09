# Skills on demand

A model works best when it is not reading a long manual before every answer. Vitruvius therefore starts with a short identity and a one-line list of its **skills**. The full instructions for a skill load only when the request needs them, and stay for the rest of that chat.

This keeps each step small, which makes answers faster and lets one graphics card serve more people.

## The skills in this preview

| Skill | What it adds | Loads when you ask for |
|---|---|---|
| `canvas-moodboard` | Scaled concept plans and diagrams on the canvas; colour and material moodboards, with optional concept images | a plan, layout, diagram, sketch, moodboard, palette, materials or lighting ideas |
| `ingetrazo-live` | Building and measuring real geometry in IngeTrazo, with a measured top view | modelling, building, measuring or showing something in IngeTrazo |
| `design-review` | A review under Venustas, Firmitas and Utilitas, with clearances marked measured or unverified | a review, critique, check or second opinion |

You can also call a skill yourself: type `/` and its name in the message box, for example `/design-review`.

## Write your own

A skill is a folder with one file, `SKILL.md`: a short header, then plain instructions.

```markdown
---
name: kitchen-check
description: Check a kitchen layout for work triangle, landing space and clearances.
whenToUse: The user asks whether a kitchen layout works.
---
Read the plan dimensions first. Report the work triangle legs in metres...
```

1. Copy one of the folders in `skills/public/` to `skills/community/<your-skill>/`.
2. Keep the `description` to one line; it is what the model sees in every chat.
3. Run `node skills/review.mjs skills/community/<your-skill>` to see what a reviewer sees: the tools it may use, any web addresses or paths it mentions, and any problems.
4. Start a new chat. Your skill appears in the list.

The header format is described in `skills/skill-frontmatter.schema.json`. To keep skills in another folder, set `ATELIER_SKILLS_DIR` (several folders separated by `;`).

## Sharing a skill

Open a pull request with your skill folder. It is read and checked before it is approved; approved skills are recorded with their hash in `skills/APPROVED.json`. If an approved skill file is changed later, it goes back to unreviewed until it is checked again.
