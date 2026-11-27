import Link from 'next/link';
import { HomeRedirect } from '../components/home-redirect';

const STEPS = [
  {
    title: 'Connect your site',
    body: 'Install the small connector plugin on any self-hosted WordPress site and pair it with a one-time code. No passwords change hands.',
  },
  {
    title: 'Describe the article',
    body: 'Give a topic and keywords, pick a length, and choose templates that hold your voice and layout.',
  },
  {
    title: 'Review and publish',
    body: 'Edit the draft, check its SEO score, then publish, schedule, or send it to WordPress as a draft.',
  },
];

const FEATURES = [
  {
    title: 'SEO fields filled in',
    body: 'Titles, meta descriptions and focus keywords land in Yoast, Rank Math or All in One SEO, or in plain meta tags when you use none.',
  },
  {
    title: 'Images included',
    body: 'A featured image and in-article images, compressed to WebP and uploaded to your media library with alt text.',
  },
  {
    title: 'Your voice, saved',
    body: 'Content and design templates, plus site-wide instructions, so every article sounds and looks like you.',
  },
  {
    title: 'Scheduled writing with guardrails',
    body: 'Queue topics and let a schedule write them: always as drafts, published only above an SEO score, or fully automatic.',
  },
  {
    title: 'Works from your AI assistant',
    body: 'Connect Claude, ChatGPT or any MCP client and manage posts or start articles from a chat.',
  },
  {
    title: 'Built for teams',
    body: 'Separate workspaces for each client, with owners, admins and members, and invitations by link or email.',
  },
];

export default function Home() {
  return (
    <div className="min-h-screen bg-white">
      <HomeRedirect />
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
        <span className="flex items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-bold text-white">
            T
          </span>
          <span className="font-semibold">TriCity Writer</span>
        </span>
        <nav className="flex items-center gap-2 text-sm">
          <Link href="/sign-in" className="rounded-lg px-3 py-2 font-medium text-slate-600 hover:bg-slate-100">
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-lg bg-brand-600 px-3.5 py-2 font-medium text-white hover:bg-brand-700"
          >
            Get started
          </Link>
        </nav>
      </header>

      <main>
        <section className="mx-auto max-w-6xl px-4 pt-14 pb-20 sm:px-6 sm:pt-20">
          <div className="max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-tight text-slate-900 sm:text-5xl">
              Articles for your WordPress sites, written, reviewed and published in one place
            </h1>
            <p className="mt-6 text-lg leading-8 text-slate-600">
              TriCity Writer drafts complete, search-ready articles with Claude or GPT, adds images, and publishes them
              to your WordPress sites. You stay in charge: review every draft, or hand a topic list to a schedule with
              rules you set.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/sign-up"
                className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-semibold text-white hover:bg-brand-700"
              >
                Create your workspace
              </Link>
              <Link
                href="/sign-in"
                className="rounded-lg px-5 py-3 text-sm font-semibold text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50"
              >
                Sign in
              </Link>
            </div>
          </div>
        </section>

        <section className="border-y border-slate-100 bg-slate-50">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 className="text-sm font-semibold tracking-wide text-brand-700 uppercase">How it works</h2>
            <ol className="mt-6 grid gap-6 md:grid-cols-3">
              {STEPS.map((step, i) => (
                <li key={step.title} className="rounded-xl bg-white p-6 ring-1 ring-slate-200">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">
                    {i + 1}
                  </span>
                  <h3 className="mt-4 font-semibold">{step.title}</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-600">{step.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 className="text-2xl font-semibold tracking-tight">Everything a post needs before it goes live</h2>
          <div className="mt-8 grid gap-x-8 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((feature) => (
              <div key={feature.title}>
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-600">{feature.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 pb-20 sm:px-6">
          <div className="rounded-2xl bg-brand-600 px-6 py-10 text-white sm:px-10">
            <h2 className="text-2xl font-semibold">Bring your own AI keys, or start with ours</h2>
            <p className="mt-3 max-w-2xl text-brand-100">
              Add your Anthropic or OpenAI key to a workspace and write without limits on your own account. Every call
              is metered, so you always see what each article cost.
            </p>
            <Link
              href="/sign-up"
              className="mt-6 inline-block rounded-lg bg-white px-5 py-3 text-sm font-semibold text-brand-700 hover:bg-brand-50"
            >
              Get started
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-slate-100">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-slate-500 sm:px-6">
          <span>TriCity Writer</span>
          <span>Self-hosted WordPress 6.0+ · PHP 7.4+</span>
        </div>
      </footer>
    </div>
  );
}
