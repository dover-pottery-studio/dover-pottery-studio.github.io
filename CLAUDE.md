# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The source for the Dover Pottery Studio website (doverpottery.studio), a small business site for a pottery
studio in Dover, NH offering classes and memberships. Built with Hugo (static site generator). The theme was
originally based on Beautiful Hugo but has been fully ejected/customized into `layouts/` and `static/css/studio/`
— there is no theme submodule or `theme =` setting in `hugo.toml`.

## Commands

- `hugo server -D` — run the local dev server with drafts (default at http://localhost:1313)
- `hugo` — build the production site into `./public`
- `hugo --gc --minify --baseURL "<url>/"` — the exact build invocation used in CI (see `.github/workflows/hugo.yaml`)
- There is no npm build step, linter, or test suite — Node is only present in CI to `npm ci` if a lockfile exists (none currently does), and Dart Sass is installed but no `.scss` files exist in the repo; all CSS in `static/css/studio/` is plain, hand-written CSS.
- Required Hugo version: extended, >= 0.116.0 (CI pins `HUGO_VERSION: 0.124.1`).

## Deployment

Pushing to `main` triggers `.github/workflows/hugo.yaml`, which builds with Hugo and deploys to GitHub Pages
(served at https://doverpottery.studio). There is no staging environment — merging to `main` is a production
deploy.

## Content model

- `content/_index.md` — homepage; renders a `card-gallery` of pagecards linking to Classes/Memberships/Supplies.
- `content/page/*.md` — the site's static pages (classes, memberships, supplies). Front matter typically includes `title`, `description`, `image` (used for card thumbnails via the `pagecard` shortcode), and `bigimg` (hero background image, an array of `{"src": ...}` objects consumed by `header.html`).
- `content/posts/*.md` — news/blog posts, filenames follow `YYYY-MM-DD--slug.md`. Front matter is just `title` and `date`. `mainSections = ["posts"]` in `hugo.toml` controls what the homepage treats as "latest post" and what `/posts/` lists. A `<!--more-->` marker controls the post summary/excerpt shown in listings.
- Site nav (`hugo.toml` `[[menus.main]]`) is currently: Classes, Memberships, News, Supplies (Home is commented out since the logo links home).

## Custom shortcodes (`layouts/shortcodes/`)

These are the building blocks content authors use inside `.md` files:

- `basic-image` — simple `<img>` wrapper with optional `class`/`width` (e.g. `floatleft`/`floatright` for post images).
- `figure` / `gallery` / `load-photoswipe` — from the hugo-easy-gallery project, used for lightbox image galleries; `load-photoswipe` must be included once per page to pull in the PhotoSwipe JS/CSS.
- `card` / `card-gallery` / `pagecard` — card UI; `pagecard` pulls `title`/`image`/`description` from another page's front matter via `.Site.GetPage`, used on the homepage.
- `kilnfire-embed` and `kilnfire_button` — integrate with Kilnfire (doverpotterystudio.kilnfire.com), the third-party class-scheduling/registration platform. `kilnfire-embed` loads `https://kilnfire.com/classembed.js` and renders a `blocks` or `calendar` view of classes; this is the actual source of class listings/dates, not Hugo content.
- `sep` — horizontal rule divider (`small`/`medium`/`long` classes).

## Templates (`layouts/`)

- `_default/baseof.html` is the base template: `head.html` → `nav.html` → `header.html` (hero/title block) → page `main` block → `footer.html` → `footer_custom.html`.
- `header.html` derives hero title/subtitle/bigimg from either site params (home) or page front matter, and expects `bigimg` as a list so multiple hero images can rotate (`data-num-img`, `data-img-src-N` attributes).
- `head_custom.html` and `footer_custom.html` are the theme's designated injection points and currently hold real content: Google Analytics (gtag) in the head, and the studio's address/Google Maps embed/Mailchimp signup form in the footer. These are not boilerplate — edit carefully since they contain the business's actual embedded forms/tracking.
- `partials/seo/` builds Open Graph, Twitter Card, and schema.org structured data (organization, website, article/post, breadcrumb) — relevant if changing page metadata or front matter fields that feed SEO.
- CSS is organized under `static/css/studio/`: `base.css`, `layout.css`, `theme.css`, `utilities.css`, plus `components/` (buttons, cards, embeds, footer, forms, media, navigation, posts). `static/css/framework/` (Bootstrap) and `static/css/vendor/` (PhotoSwipe, staticman, highlight.js) are third-party and shouldn't be hand-edited.

## Notes

- i18n files exist for many languages, but the site is effectively English-only in practice (only `en-us` is configured in `hugo.toml`); don't assume multilingual routing is active.
- Images live under `static/img/`, organized loosely by post/date (e.g. `img/2025-11/`) or purpose (`img/classes/`, `img/opening/`, `img/cc4/` for stock photos). When adding a post, follow the existing `img/YYYY-MM/` convention.
- Use Google's Rich Result Test (https://search.google.com/test/rich-results) to validate structured data changes, per the project README.
