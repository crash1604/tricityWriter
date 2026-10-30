# Reference product research: WPWriter

Clean-room notes on WPWriter (wpwriter.com, operated by YLabs). Everything here comes from public pages read in a browser on **2026-10-26**: marketing pages, docs, blog, legal pages, and the WordPress.org listing. We have not looked at their plugin code, theme code, or JS bundles. See the clean-room rule in `/CLAUDE.md`.

All notes are paraphrased. Don't paste their prompts, templates, or copy into our product.

| File | Covers |
|---|---|
| [product-overview.md](product-overview.md) | Positioning, the two ways to use it, pricing and quotas, BYOK, infrastructure |
| [connection-and-connector.md](connection-and-connector.md) | How sites connect, the connector plugin, REST surface, network behaviour |
| [content-pipeline.md](content-pipeline.md) | Wizard phases, templates, design system and HTML output, images, SEO, auto-blogging |
| [mcp-server.md](mcp-server.md) | Remote MCP server: transport, auth, tool catalog, agent recipe pattern |
| [implications.md](implications.md) | What this means for TriCity Writer: decisions to revisit and things to adopt |

## Sources

| Page | URL |
|---|---|
| Home | https://www.wpwriter.com/ |
| Pricing | https://www.wpwriter.com/pricing |
| Requirements & connecting | https://www.wpwriter.com/docs/requirements |
| Connect WordPress walkthrough | https://www.wpwriter.com/docs/connect-wordpress |
| Test connection | https://www.wpwriter.com/docs/test-connection |
| AI providers & keys | https://www.wpwriter.com/docs/ai-providers |
| MCP install | https://www.wpwriter.com/docs/mcp |
| MCP reference | https://www.wpwriter.com/docs/mcp-reference |
| Agent recipe | https://www.wpwriter.com/docs/agent-recipe |
| Design prompts | https://www.wpwriter.com/docs/design-prompts |
| Writing templates | https://www.wpwriter.com/docs/template-writing |
| Theme setup | https://www.wpwriter.com/docs/theme-setup |
| Subprocessors | https://www.wpwriter.com/subprocessors |
| Outbound IPs | https://www.wpwriter.com/egress-ips |
| Blog: launch | https://www.wpwriter.com/blog/ai-wordpress-plugin-launch |
| Blog: BYOK | https://www.wpwriter.com/blog/bring-your-own-key |
| Blog: assistant not autopilot | https://www.wpwriter.com/blog/ai-assistant-not-autopilot |
| Blog: automation on templates | https://www.wpwriter.com/blog/content-automation-your-templates |
| Blog: pure HTML performance | https://www.wpwriter.com/blog/wordpress-performance-pure-html |
| WordPress.org connector listing | https://wordpress.org/plugins/ylabs-connector-for-wpwriter/ |

The old doc URLs `/docs/connector-plugin`, `/docs/application-password`, and `/docs/seo-meta-rest` now redirect to `/docs/requirements`. `/docs/ftp`, `/docs/database-advanced`, `/prompts` (200+ prompt ideas), and `/blog/why-websites-matter-ai-age` haven't been read yet.
