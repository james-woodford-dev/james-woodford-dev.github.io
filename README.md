# james-woodford-dev.github.io

James Woodford's personal website hosted by GitHub Pages.

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

For content that is more structured (CV timeline, research themes, hobby cards),
edit the corresponding HTML file directly:

| File | Page |
|---|---|
| `index.html` | Homepage |
| `research.html` | Research overview |
| `publications.html` | Publications (auto-populated from Google Scholar) |
| `news.html` | Full news list |
| `cv.html` | Curriculum Vitae |
| `hobbies.html` | Hobbies |

---

## Publications (Google Scholar sync)

`scripts/update_scholar.py` pulls your profile, citation metrics and publication list from
Google Scholar into `data/scholar.json`, which `publications.html` renders.

It runs automatically on the 1st of every month via GitHub Actions
(`.github/workflows/update-scholar.yml`) and commits any changes. You can also:

- **Run it from GitHub:** Actions tab → *Update Google Scholar Data* → *Run workflow*.
- **Run it locally:**
  ```bash
  pip install -r requirements.txt
  python scripts/update_scholar.py
  ```

The Scholar ID is set in `scripts/update_scholar.py` (`DEFAULT_SCHOLAR_ID`). No secrets are needed.

> **Note:** GitHub disables scheduled workflows after 60 days without repository activity.
> If the monthly run stops, re-enable it from the Actions tab.
> Google Scholar also sometimes rate-limits GitHub's servers; if a run fails for that reason,
> the existing data is kept, and running the script locally is the fallback.

---

## Adding a profile photo

The homepage photo is `assets/img/picture.JPG`.
