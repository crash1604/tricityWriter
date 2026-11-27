// End-to-end check of the connector plugin through @tricity/wp-client, against a throwaway
// WordPress Playground site (in-memory; nothing persists).
//
//   pnpm --filter @tricity/core e2e:connector [--seo=yoast|rankmath|aioseo] [--php=7.4] [--port=9500]
//
// A blueprint activates the plugin (and the SEO plugin), then issues a pairing code into a mounted
// directory so no browser is needed.
import { type ChildProcess, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { ConnectorClient, ConnectorError, createSiteFetch } from '@tricity/wp-client';
import sharp from 'sharp';

const SEO_SLUGS = { yoast: 'wordpress-seo', rankmath: 'seo-by-rank-math', aioseo: 'all-in-one-seo-pack' } as const;

const { values: args } = parseArgs({
  options: {
    seo: { type: 'string' },
    php: { type: 'string', default: '7.4' },
    port: { type: 'string', default: '9500' },
  },
});
const seo = args.seo as keyof typeof SEO_SLUGS | undefined;
if (seo && !(seo in SEO_SLUGS)) throw new Error(`--seo must be one of ${Object.keys(SEO_SLUGS).join(', ')}`);

const pluginDir = resolve(import.meta.dirname, '../../../plugins/tricity-writer');
const work = mkdtempSync(join(tmpdir(), 'tcw-e2e-'));
const siteUrl = `http://127.0.0.1:${args.port}`;

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok || detail === undefined ? '' : ` → ${JSON.stringify(detail)}`}`);
  if (!ok) failures++;
}
async function rejectsWith(label: string, promise: Promise<unknown>, code: string, status?: number) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  const ok =
    error instanceof ConnectorError && error.code === code && (status === undefined || error.status === status);
  check(label, ok, error instanceof ConnectorError ? { code: error.code, status: error.status } : error);
}

function startPlayground(): ChildProcess {
  const blueprint = {
    steps: [
      { step: 'activatePlugin', pluginPath: 'tricity-writer/tricity-writer.php' },
      ...(seo
        ? [{ step: 'installPlugin', pluginData: { resource: 'wordpress.org/plugins', slug: SEO_SLUGS[seo] } }]
        : []),
      {
        step: 'runPHP',
        code: [
          '<?php',
          "require_once '/wordpress/wp-load.php';",
          "require_once '/wordpress/wp-content/plugins/tricity-writer/tricity-writer.php';",
          "$GLOBALS['wp_rewrite']->set_permalink_structure('/%postname%/');",
          '$GLOBALS["wp_rewrite"]->flush_rules();',
          "file_put_contents('/e2e/code.txt', TricityWriter\\Pairing::issue('E2E', 1));",
        ].join('\n'),
      },
      // Plugin updates: the dashboard's manifest is stubbed, then WordPress' own update filter is asked.
      {
        step: 'runPHP',
        code: [
          '<?php',
          "require_once '/wordpress/wp-load.php';",
          "require_once ABSPATH . 'wp-admin/includes/plugin.php';",
          "$author = wp_insert_user(array('user_login' => 'author1', 'user_pass' => wp_generate_password(), 'role' => 'author'));",
          "TricityWriter\\Updater::remember_source('https://evil.example', $author);",
          "TricityWriter\\Updater::remember_source('http://example.com', 1);",
          "$rejected = get_option('tcw_update_source', '');",
          "TricityWriter\\Updater::remember_source('https://example.com/', 1);",
          "add_filter('pre_http_request', function ($pre, $args, $url) {",
          "  if ($url !== 'https://example.com/downloads/tricity-writer.json') return $pre;",
          "  $body = json_encode(array('version' => '9.9.9', 'requires' => '6.0', 'requires_php' => '7.4', 'tested' => '6.8', 'changelog' => '<ul><li>New</li></ul>'));",
          "  return array('headers' => array(), 'body' => $body, 'response' => array('code' => 200, 'message' => 'OK'), 'cookies' => array(), 'filename' => null);",
          '}, 10, 3);',
          "$file = 'tricity-writer/tricity-writer.php';",
          '$data = get_plugin_data(WP_PLUGIN_DIR . "/" . $file, false, false);',
          "$host = wp_parse_url(esc_url_raw($data['UpdateURI']), PHP_URL_HOST);",
          "$update = apply_filters('update_plugins_' . $host, false, $data, $file, array());",
          "$info = apply_filters('plugins_api', false, 'plugin_information', (object) array('slug' => 'tricity-writer'));",
          "file_put_contents('/e2e/updater.json', json_encode(array('rejected' => $rejected, 'host' => $host, 'update' => $update, 'info_version' => is_object($info) ? $info->version : null)));",
        ].join('\n'),
      },
    ],
  };
  writeFileSync(join(work, 'blueprint.json'), JSON.stringify(blueprint));

  return spawn(
    'npx',
    [
      '-y',
      '@wp-playground/cli@latest',
      'server',
      `--port=${args.port}`,
      `--php=${args.php}`,
      `--mount=${pluginDir}:/wordpress/wp-content/plugins/tricity-writer`,
      `--mount=${work}:/e2e`,
      `--blueprint=${join(work, 'blueprint.json')}`,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
}

async function waitFor(fn: () => Promise<boolean> | boolean, timeoutMs: number, what: string): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (
      await Promise.resolve()
        .then(fn)
        .catch(() => false)
    )
      return;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

async function main(): Promise<void> {
  console.log(`Connector e2e: PHP ${args.php}, SEO plugin: ${seo ?? 'none'}`);
  const server = startPlayground();
  let log = '';
  server.stdout?.on('data', (d) => {
    log += d;
  });
  server.stderr?.on('data', (d) => {
    log += d;
  });

  try {
    const codeFile = join(work, 'code.txt');
    await waitFor(() => existsSync(codeFile), 240_000, 'the blueprint to issue a pairing code');
    await waitFor(
      async () => (await fetch(`${siteUrl}/wp-json/tricity-writer/v1/ping`)).status === 200,
      60_000,
      'the REST API',
    );
    const code = readFileSync(codeFile, 'utf8').trim();

    console.log('Plugin updates');
    const updater = JSON.parse(readFileSync(join(work, 'updater.json'), 'utf8')) as {
      host: string;
      update: { version?: string; package?: string; slug?: string } | false;
      info_version: string | null;
      rejected: string;
    };
    check('only admins, over HTTPS, can choose where updates come from', updater.rejected === '', updater.rejected);
    check('Update URI routes update checks to our filter', updater.host === 'tricity-writer.invalid', updater.host);
    check(
      'the paired dashboard offers the new version and package',
      updater.update !== false &&
        updater.update.version === '9.9.9' &&
        updater.update.slug === 'tricity-writer' &&
        updater.update.package === 'https://example.com/downloads/tricity-writer.zip',
      updater.update,
    );
    check('"View details" shows the offered version', updater.info_version === '9.9.9', updater.info_version);

    // Playground listens on 127.0.0.1, which the production fetch refuses.
    const localFetch = createSiteFetch({ allowPrivateNetworks: true });
    const anon = new ConnectorClient({ siteUrl, userAgent: 'TriCityWriter-e2e', fetch: localFetch });
    console.log('Pairing');
    check('ping', (await anon.ping()).plugin === 'tricity-writer');
    const paired = await anon.pair(code, 'https://example.com');
    check('pair returns a token', paired.token.startsWith('tcw_'));
    check('pair reports the SEO plugin', paired.site.seo_plugin === (seo ?? null), paired.site.seo_plugin);
    await rejectsWith('a pairing code works only once', anon.pair(code), 'tcw_invalid_code', 403);

    const wp = new ConnectorClient({ siteUrl, token: paired.token, routeStyle: anon.routeStyle, fetch: localFetch });
    const status = await wp.status();
    check('status: admin capabilities', status.capabilities.publish_posts && status.capabilities.upload_files);

    console.log('Terms and media');
    const categories = await wp.listTerms({ taxonomy: 'category' });
    check(
      'lists categories',
      categories.some((t) => t.slug === 'uncategorized'),
    );

    const webp = await sharp({ create: { width: 640, height: 360, channels: 3, background: '#3b82f6' } })
      .webp()
      .toBuffer();
    const media = await wp.uploadMedia({
      filename: 'e2e image.webp',
      mime_type: 'image/webp',
      data: webp.toString('base64'),
      alt: 'A blue rectangle',
    });
    check('uploads WebP with alt text', media.mime_type === 'image/webp' && media.alt === 'A blue rectangle', media);
    check('generates attachment metadata', media.width === 640 && media.height === 360, media);
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: '#000' } })
      .png()
      .toBuffer();
    await rejectsWith(
      'rejects bytes that do not match the declared type',
      wp.uploadMedia({ filename: 'x.webp', mime_type: 'image/webp', data: png.toString('base64') }),
      'tcw_invalid_param',
      400,
    );

    console.log('Posts');
    const html = '<div style="background:#f8f9fa;padding:16px"><h2>Hello</h2><p>Styled content.</p></div>';
    const created = await wp.createPost({
      title: 'E2E post',
      content: html,
      excerpt: 'Short summary',
      status: 'draft',
      categories: ['E2E Category'],
      tags: ['alpha', 'beta'],
      featured_media: media.id,
    });
    check('creates a draft', created.status === 'draft' && created.title === 'E2E post');
    check('keeps inline styles for unfiltered_html users', created.content === html, created.content);
    check('creates and assigns categories by name', created.categories.includes('E2E Category'), created.categories);
    check('assigns tags', created.tags.join(',') === 'alpha,beta', created.tags);
    check('sets the featured image', created.featured_media === media.id && created.has_featured_image);

    const seoFields = {
      title: 'E2E SEO title',
      description: 'An end-to-end meta description for the connector test.',
      focus_keyword: 'connector test',
    };
    const writtenSeo = await wp.setSeo(created.id, seoFields);
    check('writes SEO fields', JSON.stringify(writtenSeo) === JSON.stringify(seoFields), writtenSeo);
    check(
      'reads SEO fields back on the post',
      (await wp.getPost(created.id)).seo.description === seoFields.description,
    );

    const future = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const scheduled = await wp.updatePost(created.id, { status: 'future', date_gmt: future });
    check('schedules a post', scheduled.status === 'future', scheduled.status);
    await rejectsWith(
      'scheduling without a date fails',
      wp.createPost({ title: 'x', status: 'future' }),
      'tcw_invalid_param',
      400,
    );

    const published = await wp.updatePost(created.id, { status: 'publish', date_gmt: new Date().toISOString() });
    check('publishes', published.status === 'publish', published.status);

    const pageResponse = await fetch(published.link);
    const page = await pageResponse.text();
    // Rank Math prints no head tags at all under Playground (not even its own title), so this check
    // can't pass there. Its Helper::get_post_meta() reads the keys we write; verified manually.
    if (seo === 'rankmath')
      console.log('  - skipped: published page meta (Rank Math prints no head tags in Playground)');
    else
      check(
        `published page prints the meta description (${seo ?? 'own output'})`,
        page.includes(seoFields.description),
        {
          url: published.link,
          status: pageResponse.status,
          meta: page.match(/<meta[^>]+description[^>]*>/i)?.[0] ?? null,
          title: page.match(/<title>[^<]*<\/title>/i)?.[0] ?? null,
        },
      );

    const found = await wp.listPosts({ search: 'E2E post' });
    check(
      'finds the post by search',
      found.items.some((p) => p.id === created.id),
    );
    const pageCreated = await wp.createPost({ type: 'page', title: 'E2E page', content: '<p>Page</p>' });
    check('creates pages', pageCreated.type === 'page');
    await rejectsWith('rejects other post types', wp.createPost({ type: 'attachment' as 'post' }), 'tcw_invalid_param');

    await wp.trashPost(created.id);
    check('trashes posts', (await wp.getPost(created.id)).status === 'trash');
    await rejectsWith('unknown posts are 404', wp.getPost(999_999), 'tcw_not_found', 404);

    console.log('Disconnect');
    await wp.disconnect();
    await rejectsWith('token stops working after disconnect', wp.status(), 'tcw_invalid_token', 401);
  } catch (error) {
    failures++;
    console.error(error);
    console.error(log.slice(-3000));
  } finally {
    server.kill('SIGTERM');
    rmSync(work, { recursive: true, force: true });
  }

  console.log(failures === 0 ? 'All connector checks passed.' : `${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

await main();
