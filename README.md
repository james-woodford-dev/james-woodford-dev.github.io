# james-woodford-dev.github.io

James Woodford's personal website hosted hosted by GitHub Pages.

---

## Editing your website content

Most of the text on the website can be edited **without touching any HTML file**.
Open `data/content.json` and fill in your details:

| Field | What it controls |
|---|---|
| `name` | Your display name (navbar, footer, hero heading) |
| `title` | Your position / degree (e.g. `"Ph.D. Student"`) |
| `department` | Your department |
| `university` | Your university |
| `city` | City and state |
| `bio` | The bio paragraph on the homepage |
| `email` | Email address (all mailto: links) |
| `github_username` | Your GitHub username |
| `linkedin_profile` | Your LinkedIn profile slug |
| `scholar_id` | Your Google Scholar profile ID |
| `research_interests` | Array of cards shown on the homepage |
| `news` | News items shown on the homepage and the full News page |

After saving `data/content.json`, commit and push — GitHub Pages will redeploy automatically.

---

## Editing individual pages

For content that is more structured (CV timeline, research themes, hobby cards, blog posts),
edit the corresponding HTML file directly:

| File | Page |
|---|---|
| `index.html` | Homepage |
| `research.html` | Research overview |
| `publications.html` | Publications (auto-populated from Google Scholar) |
| `news.html` | Full news list |
| `cv.html` | Curriculum Vitae |
| `hobbies.html` | Hobbies |
| `blog/index.html` | Blog listing |
| `blog/posts/` | Individual blog posts |

---

## Publications (Google Scholar sync)

Publication data is fetched automatically once a month via GitHub Actions
(see `.github/workflows/update-scholar.yml`).

To enable it:
1. Add your Google Scholar ID to `data/content.json` under `scholar_id`.
2. Add `SCHOLAR_ID` as a repository secret in **Settings → Secrets → Actions**.
3. Trigger a manual run from the **Actions** tab, or wait for the monthly schedule.

---

## Adding a profile photo

Place a photo at `assets/img/profile.jpg` (or `.png`).
The site will use it automatically; if the file is missing it falls back to the
placeholder SVG.
