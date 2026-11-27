=== TriCity Writer Connector ===
Tags: ai, content, seo, connector
Requires at least: 6.0
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Connects this site to TriCity Writer so it can draft, publish and optimize content for you.

== Description ==

Pair this site with your TriCity Writer account using a one-time code. TriCity Writer then works through a
narrow, content-only REST API, acting as the WordPress user who created the code. It cannot install plugins
or themes, manage users, or read stored secrets.

Each connection has its own name and token, is listed under Settings → TriCity Writer, and can be revoked
there at any time. Only a hash of each token is stored on this site.

== External services ==

This plugin connects your site to the TriCity Writer dashboard you pair it with (for example
https://app.example.com, the address you sign in to).

* What it does: the dashboard calls this site's REST API to read and write posts, categories, tags, media
  and SEO fields, as the WordPress user who created the pairing code. That only happens after an
  administrator pairs the site, and stops when the connection is revoked or the plugin is deleted.
* What the plugin sends: when WordPress checks for plugin updates, the plugin downloads the dashboard's
  public version file (/downloads/tricity-writer.json) and, if you choose to update, the plugin zip. No site
  data is sent with these requests beyond what any HTTP request contains (IP address, user agent).
* The dashboard's own terms of service and privacy policy are those of whoever operates it.

== Installation ==

1. In the TriCity Writer dashboard, open Sites → Connect a site and download the plugin.
2. In WordPress, go to Plugins → Add New → Upload Plugin, upload the zip and activate it.
3. Go to Settings → TriCity Writer, name the connection and generate a pairing code.
4. Paste the site address and the code into the dashboard within 10 minutes.

== Frequently Asked Questions ==

= Does it work with my SEO plugin? =

Yes. Titles, meta descriptions and focus keywords are written to Yoast SEO, Rank Math or All in One SEO when
one is active. Without an SEO plugin the connector prints the meta description and title itself.

= My host blocks the REST API or strips the Authorization header. =

The connector accepts its token in a custom header and also answers at /?rest_route=, so it works on most
hosts that interfere with /wp-json/ or with Authorization.

= How do updates arrive? =

From the dashboard you paired with. New versions appear under Dashboard → Updates like any other plugin, and
are installed only when you choose to update (or turn on auto-updates for this plugin).

== Changelog ==

= 1.0.0 =
* Updates are offered from the paired dashboard, in WP admin like any other plugin.
* The Update URI header keeps WordPress.org from offering updates to a different plugin with the same slug.

= 0.1.0 =
* Pairing codes, connection tokens, status endpoint, admin screen.
