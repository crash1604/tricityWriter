# Content pipeline

## Wizard ("AI Editor"): four phases, then review

| Phase | What the user controls |
|---|---|
| 1. Content | Topic or title, a **content template** (or free-text instructions), word count, language, global content prompt, **embedded shortcodes** (forms, galleries, video) to place in the output |
| 2. Design | A **design template** (or free-text instructions) that controls layout and visual patterns. A global design baseline applies even if this step is skipped. |
| 3. Media | AI-generate images or pick from the WP media library; image placement style; gallery layout; featured image |
| 4. Generate | Model choice, then generate |
| Review | Full preview in an editor (TinyMCE). Edit, regenerate, or tweak the prompt. Publish pushes HTML, then media, then SEO meta to WP. |

Sources: /docs/design-prompts, blogs (assistant-not-autopilot, launch, pure-html), listing screenshots.

**Also offered:**
- generating several **tone variations** and keeping the best (the rest are saved as drafts)
- "improve existing post", compared side by side with the original
- content-idea suggestions for the niche
- AI-suggested category structure
- post↔page conversion

## Templates

**Kinds:** content (what to write), design (how it looks), and image.

**Matching:** templates are matched to a title by the template **name** and the **first lines of its prompt**. The description is optional and only a hint.

**Their guidance for writing templates (useful for our defaults):**
- give each template one job
- use intent-based names
- open the prompt by stating the template's role and reader
- make optional sections conditional
- A/B test two templates on the same title before adding more
- **linking rule:** only link to URLs supplied in the generation context or already verified in existing content, same-site first. If no verified URL exists, mention the resource in plain text rather than inventing a link.

**Built-in template families:**
- *article*: clean/modern, bold/colorful, corporate, friendly/casual, minimal text-only
- *page*: contact-form layouts, media embed
- *product*: hero, split, feature grid, technical specs, visual gallery
- *homepage*: hero + sections, split hero, card grid, minimal

**Example content-template set:**
- beginner's guide
- how-to
- checklist/framework
- tool comparison
- problem-solution
- strategy guide

**Global prompts:** per-site global content and design prompts (MCP: `get_global_prompt` / `set_global_prompt`).

## HTML output and design system

- **Output format:** plain semantic HTML with **inline `style` attributes**, not Gutenberg block markup and not page-builder markup. It's meant for the classic editor, or a Classic/HTML block in Gutenberg. Page builders (Elementor, Divi, WPBakery) are explicitly unsupported.
- **Patterns always available to the model:**
  - **gallery grid** in four styles: uniform 4:3 crop, masonry, full grid with a hero image, stacked
  - **feature cards** with emoji icons and coloured top borders that rotate through six colours, laid out with `grid` + `minmax(250px, 1fr)`
  - **spec table**: dark header, zebra rows
  - **dark CTA section**
  - **callout boxes** in tip, warning, and success variants
  - **"visual rhythm"**: section backgrounds alternate, ending on the dark CTA
- **Theme-safe rules baked into generation:**
  - **Never set:** font-family, h1–h6 sizes, content max-width, base text/link colours, or line-height. Never emit `<style>` blocks, because WordPress may strip them.
  - **Allowed:** backgrounds, borders, shadows, radius, spacing, grid/flex, and accent colours.
- **RTL:** CSS stays direction-agnostic, so Hebrew and Arabic work without extra instructions.
- **Lightbox:** every `<img>` is wrapped in an `<a>` that links to the full-size file, so any lightbox plugin picks it up.
- **Known failure mode:** security plugins (Wordfence, Sucuri, iThemes) or themes strip inline styles. Their docs tell users to allow them.
- **Starter theme:** they ship a free Astra child theme tuned for this output, with four palettes as CSS custom properties. They recommend a content width of 700–960px.

## Images

- **Providers:** OpenAI (gpt-image-1/2), Gemini (Nano Banana 2/Pro, Imagen 4 / Ultra). Claude has no image generation.
- **Optimization:** every image (AI-generated or reused) is resized, compressed, and format-converted **server-side** before upload to the WP media library.
- **Generate variations, user picks:** also covers upscale, enhance, and "reimagine" of existing images.
- **MCP-only (ChatGPT):** product "studio" photos and 360° spin images.
- **Media audit:** finds missing alt text and oversized files. Bulk optimize is available.

## SEO

- AI-written SEO title and meta description go into Yoast, Rank Math, or AIOSEO.
- **On-page SEO score** per post. Auto-blogging's "guarded" mode publishes only above a threshold.
- **Site content health:**
  - posts missing featured images
  - thin posts (e.g. under 300 words)
  - missing meta descriptions
  - broken links (HEAD scans)
- **Google Search Console** (paid): queries, rankings, and position history.
- **Rendered-meta check:** they read the published page's public HTML to check which SEO meta actually rendered.

## Auto-blogging ("Content Automation")

1. **Topic queue:** topics are approved AI suggestions, imported ideas, or niche discovery. The system never invents a topic the user didn't approve.
2. **Same pipeline as the editor:** each run uses the same content template, image model, design template, and SEO scoring. There's no separate engine.
3. **Three modes:**
   - **Assist:** saves a draft.
   - **Guarded:** publishes only if the on-page score is at or above a user-set threshold; otherwise leaves a draft.
   - **Autopilot:** always publishes.
4. **Notification:** an email per post, with links to review it in WP admin or reopen it in the editor.
5. **Plan caps:** 1, 3, 8, or 15 runs/day by plan. Which modes are available also depends on the plan.

MCP surface: status, configure profile, add topics, trigger run, view queue, history.
