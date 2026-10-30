import { forOrg, type Template } from '@tricity/db';
import type { Actor, CoreDeps } from './deps';
import { invalid, notFound } from './errors';
import { isUuid } from './ids';

export type TemplateKind = 'content' | 'design';

export interface TemplateView {
  id: string;
  kind: TemplateKind;
  name: string;
  description: string;
  prompt: string;
  builtIn: boolean;
}

// Starting points; users add their own per organization. Content templates say what to write,
// design templates how the HTML should look.
const BUILT_IN: Omit<TemplateView, 'builtIn'>[] = [
  {
    id: 'builtin:standard',
    kind: 'content',
    name: 'Standard article',
    description: 'A well-rounded informative article.',
    prompt:
      'Write an informative article for readers who searched for this topic. Open by stating what the reader will get from it, cover the topic in logically ordered sections, and close with a short summary of the key points. Prefer concrete facts, examples and practical advice over generalities.',
  },
  {
    id: 'builtin:how-to',
    kind: 'content',
    name: 'How-to guide',
    description: 'Step-by-step instructions to complete a task.',
    prompt:
      'Write a practical how-to guide. Start with who it is for and what they need before starting. Present the procedure as numbered steps, each with a short explanation of why it matters and what can go wrong. Finish with troubleshooting tips for the most common problems.',
  },
  {
    id: 'builtin:listicle',
    kind: 'content',
    name: 'List article',
    description: 'A ranked or themed list of items.',
    prompt:
      'Write a list article. Introduce the selection criteria briefly, then give each item its own heading followed by why it made the list and who it suits best. Keep items parallel in structure and end with a quick recommendation for different reader needs.',
  },
  {
    id: 'builtin:comparison',
    kind: 'content',
    name: 'Comparison',
    description: 'Weighs options against each other to help a decision.',
    prompt:
      'Write a comparison that helps the reader choose. Define the options and the criteria that matter, compare them criterion by criterion (include a comparison table), be explicit about trade-offs, and end with a verdict for each type of reader rather than a single winner when that is more honest.',
  },
  {
    id: 'builtin:beginners-guide',
    kind: 'content',
    name: "Beginner's guide",
    description: 'Explains a topic from first principles.',
    prompt:
      "Write a beginner's guide. Assume no prior knowledge, define terms the first time they appear, build from fundamentals to practical first steps, and include a short glossary or FAQ when it helps. Keep the tone encouraging and avoid jargon.",
  },
  {
    id: 'builtin:problem-solution',
    kind: 'content',
    name: 'Problem and solution',
    description: 'Diagnoses a problem and walks through fixes.',
    prompt:
      'Write a problem-solving article. Describe the problem and its symptoms so readers recognize it, explain the likely causes, then present solutions from simplest to most involved with when to use each. Close with how to prevent it from coming back.',
  },
  {
    id: 'builtin:clean',
    kind: 'design',
    name: 'Clean',
    description: 'Plain headings and paragraphs with occasional callouts.',
    prompt:
      'Keep the design clean: H2 section headings, short paragraphs, bullet lists where they help scanning, at most two callout boxes, and one simple table only if the content is tabular. No colored section backgrounds.',
  },
  {
    id: 'builtin:visual',
    kind: 'design',
    name: 'Visual',
    description: 'Feature cards, alternating sections and a closing call to action.',
    prompt:
      'Make the article visually rich: open with a key takeaways box, present parallel points as a feature card grid, alternate light section backgrounds between major sections, use a styled table for any comparison, and end with a call-to-action box.',
  },
  {
    id: 'builtin:minimal',
    kind: 'design',
    name: 'Minimal',
    description: 'Typography only; no boxes or colors.',
    prompt:
      'Use a minimal, text-first design: headings, paragraphs, lists, blockquotes and plain tables only. Do not use cards, colored backgrounds, callout boxes or call-to-action blocks.',
  },
];

export function builtInTemplates(kind?: TemplateKind): TemplateView[] {
  return BUILT_IN.filter((t) => !kind || t.kind === kind).map((t) => ({ ...t, builtIn: true }));
}

function view(template: Template): TemplateView {
  return {
    id: template.id,
    kind: template.kind,
    name: template.name,
    description: template.description,
    prompt: template.prompt,
    builtIn: false,
  };
}

export async function listTemplates(deps: CoreDeps, actor: Actor, kind?: TemplateKind): Promise<TemplateView[]> {
  const custom = await forOrg(deps.db, actor.orgId).templates.list(kind);
  return [...builtInTemplates(kind), ...custom.map(view)];
}

export async function getTemplate(deps: CoreDeps, actor: Actor, id: string): Promise<TemplateView> {
  const builtIn = BUILT_IN.find((t) => t.id === id);
  if (builtIn) return { ...builtIn, builtIn: true };
  if (id.startsWith('builtin:') || !isUuid(id)) throw notFound('Template');
  const template = await forOrg(deps.db, actor.orgId).templates.get(id);
  if (!template) throw notFound('Template');
  return view(template);
}

export interface TemplateInput {
  kind: TemplateKind;
  name: string;
  description?: string;
  prompt: string;
}

export async function createTemplate(deps: CoreDeps, actor: Actor, input: TemplateInput): Promise<TemplateView> {
  validate(input);
  return view(
    await forOrg(deps.db, actor.orgId).templates.create({
      kind: input.kind,
      name: input.name.trim(),
      description: input.description?.trim() ?? '',
      prompt: input.prompt.trim(),
    }),
  );
}

export async function updateTemplate(
  deps: CoreDeps,
  actor: Actor,
  id: string,
  patch: Partial<Omit<TemplateInput, 'kind'>>,
): Promise<TemplateView> {
  if (id.startsWith('builtin:')) throw invalid('Built-in templates cannot be edited. Duplicate it instead.');
  if (!isUuid(id)) throw notFound('Template');
  const template = await forOrg(deps.db, actor.orgId).templates.update(id, {
    ...(patch.name !== undefined && { name: patch.name.trim() }),
    ...(patch.description !== undefined && { description: patch.description.trim() }),
    ...(patch.prompt !== undefined && { prompt: patch.prompt.trim() }),
  });
  if (!template) throw notFound('Template');
  validate(template);
  return view(template);
}

export async function deleteTemplate(deps: CoreDeps, actor: Actor, id: string): Promise<void> {
  if (id.startsWith('builtin:')) throw invalid('Built-in templates cannot be deleted.');
  if (!isUuid(id) || !(await forOrg(deps.db, actor.orgId).templates.remove(id))) throw notFound('Template');
}

function validate(input: { name: string; prompt: string }): void {
  if (!input.name.trim()) throw invalid('Template name is required.');
  if (input.name.length > 100) throw invalid('Template name is too long.');
  if (input.prompt.trim().length < 20) throw invalid('Template prompt should be at least 20 characters.');
  if (input.prompt.length > 8000) throw invalid('Template prompt is too long.');
}
