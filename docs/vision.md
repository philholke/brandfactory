# BrandFactory — Vision

## Why this exists

Brand context lives in too many places — a brand deck in Figma, a tone-of-voice doc in Notion, audience personas in a slide somewhere, campaign notes in Slack, and a dozen half-remembered rules in the founder's head. Every time someone opens a generic AI tool to draft an ad, name a product, or plan a week of posts, they re-explain the brand from scratch — or skip it, and get generic output that doesn't sound like the brand at all.

BrandFactory fixes that by making the brand the center of gravity. Define it once. Every creative surface inherits it automatically.

## The core idea

A **Brand** is the single source of truth. Everything creative — brainstorming, ideation, iteration, finalization — happens in the orbit of that brand, with the brand's context always present.

Brands live in **Workspaces**. Creative work happens inside **Projects** attached to a workspace. A universal flow runs through every project: **Ideate → Iterate → Finalize**.

## Building blocks

### Brands and Brand Guidelines

Each brand you create gets its own workspace. The brand itself is described by a set of living guidelines:

- Target audience and personas
- Brand voice and personality
- Values and positioning
- Visual guidelines (colors, type, logo, aesthetic references)
- Messaging frameworks and taglines
- Anything else that matters — freeform fields welcome

Some brands arrive fully defined and just need to be captured. Others start as rough ideas, where most of the guidelines are blank or tentative. BrandFactory treats both the same way: the guidelines layer is the **finalized** output, and it can be filled in gradually as the brand takes shape — often by promoting ideas directly out of projects.

You can have many brands in your library, side by side, in every state of completeness.

### Projects

Projects are where work actually happens. Each project is attached to a brand and automatically inherits its context.

Projects come in two flavors:

- **Freeform projects** — an open canvas for whatever you want to explore. Brainstorm a naming idea, draft a campaign, sketch a product concept, plan a launch. No imposed structure.
- **Standardized projects** — opinionated templates with a fixed UI optimized for a specific job. The first obvious one is a minimalist social media content calendar: a calendar view, an agent chat tuned for content ideation, drag-and-drop scheduling of ideas into dates.

Standardized projects are optional. A brand workspace doesn't need to have them, and no one is forced to use them. They exist because some jobs benefit from purpose-built UI, and reinventing that in a freeform canvas every time is tedious.

## The universal flow: Ideate → Iterate → Finalize

Every project moves through the same conceptual motion — but this is a loose guide, not a rigid three-step pipeline. Ideation and iteration are a **loop** you run as many times as needed, zooming in progressively until you're ready to pick a winner.

- **Ideate** — chat back and forth with an agent that has full brand context. Generate options, explore directions, throw things at the wall.
- **Iterate** — pin the ideas you like, soft-delete the ones you don't, and keep brainstorming off of the shortlist. Each pass narrows the space: more signal, less noise, closer to the vision you had in mind. You repeat this as often as you want — sometimes a handful of rounds, sometimes dozens.
- **Finalize** — once you've zoomed in enough, lock in the canonical version: a tagline, a name, a content calendar, a menu design, a packaging direction, whatever the output is. Finalized outputs can be promoted into the brand's guidelines, where they become part of the source of truth for every future project.

Soft-deletion matters here: discarded ideas aren't gone, just hidden. You can always pull them back if a later round of iteration makes them relevant again.

The same loop applies whether you're naming a company, planning next week's posts, or iterating on a product's visual identity.

## The workspace experience

Inside a project, the default surface is a **split-screen workspace** — agent chat on one side, a canvas on the other. The reference point is something like v0: a live conversation with an agent on the left, a continuously updating artifact on the right.

The canvas is freeform and multimodal:

- **Rich text** — Notion-style lists, bullets, headings, plain paragraphs. Write, outline, restructure.
- **Dump zone** — drag-and-drop images, files, text snippets, links. Pinterest- and mymind-style visual boards belong here. Use it for moodboards, reference collections, competitive tear-downs, anything.

Every element on the canvas — a text block, a bullet, an image, a snippet — can be **pinned** (starred, bookmarked, favorited; exact name TBD). Pinning builds a shortlist of the ideas you actually want to keep.

A **shortlist view** shows only the pinned items, so you can collapse a cluttered workspace down to the good stuff and iterate from there.

The agent is **live-aware** of the canvas at all times. It sees what's pinned, what isn't, and what's been added since the last message. That means prompts like "give me five more like the pinned ones", "rewrite the third bullet in a warmer tone", or "turn this moodboard into three visual directions" just work — no re-pasting, no re-explaining.

## Design principles

### Native-minimalist, integrate for depth

BrandFactory builds **minimalist native implementations** where a lightweight version covers the 80% case. A basic content calendar, moodboard, or ideation canvas belongs natively inside the repo so the brand context flows seamlessly.

For the 20% that requires real specialist depth — full social publishing with provider APIs, production design software, analytics platforms — BrandFactory **integrates** rather than reinventing. We don't want to build yet another Buffer or Figma. We want the brand context to flow into them.

The test: is this core to the Brand-as-source-of-truth value prop, or is it a deep specialist domain? Core → native and small. Specialist → integration.

### Un-opinionated about specific workflows

There is no dedicated naming agent, copywriting agent, slogan agent, or packaging agent. One brainstorming surface with brand context produces all of those outputs. The agent adapts to what you're doing; the UI doesn't need a separate mode for every creative task.

Standardized project templates exist for jobs where a purpose-built UI genuinely helps (like a calendar), not for every category of creative work.

### Self-hosted and privacy-first

BrandFactory runs on your own infrastructure. Brand data, guidelines, ideation history, pinned content — all of it stays where you put it. No required cloud backend, no data sent anywhere you didn't authorize.

### Modular and extensible

The architecture is built around swappable modules: project types, integrations, model providers, storage backends. The community can add new standardized project templates, new third-party integrations, new agent behaviors without forking the core.

### Bring your own stack

Use commercial LLM APIs, self-hosted open-weight models, or a mix. Swap providers without losing your brand data. The brand context layer is provider-agnostic on purpose.

### No lock-in

Open-source, no recurring fees, standard data formats, exportable at any time. If you want to leave, you take everything with you.

## Who it's for

- **Solo founders** building a brand from scratch, who need a structured place to develop and refine brand identity without hiring an agency.
- **Marketers and in-house teams at small companies**, especially those juggling multiple brands or sub-brands, who need consistency without rebuilding context every time they open an AI tool.
- **Creators** who are their own brand, and want their brand voice baked into everything they generate.
- **Small agencies** managing a portfolio of client brands, who need to keep each brand's context cleanly separated and instantly available.

## What's explicitly out of scope

- Rebuilding specialist tools (full social publishing platforms, production design suites, deep analytics) from scratch.
- Locking users into a single AI provider, cloud backend, or hosting model.
- Hosted-only SaaS distribution with recurring fees.
- Prescribing a single "right" creative workflow — the canvas is freeform by default for a reason.
