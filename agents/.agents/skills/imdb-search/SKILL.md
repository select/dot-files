---
name: imdb-search
description: "Look up IMDB IDs, ratings, and vote counts for movies and TV shows using IMDB's public endpoints. Use this skill when: imdb rating, imdb score, imdb votes, find imdb link, movie rating, show rating, imdb id"
---

# Purpose

Find IMDB IDs, scores, and vote counts for movies and TV shows using IMDB's public endpoints — no API key required.

## Workflow

> Execute the following steps in order, top to bottom:

1. **Find the IMDB ID** using the suggestion API:

```bash
curl -s "https://v3.sg.media-imdb.com/suggestion/x/TITLE%20YEAR.json" \
  | python3 -c "
import json, sys
d = json.load(sys.stdin)
for r in d.get('d', [])[:5]:
    print(r.get('id'), r.get('l'), r.get('y'), r.get('q'))
"
```

2. **Fetch rating and vote count** from the title page:

```bash
ID="tt0094625"
data=$(curl -s "https://www.imdb.com/title/$ID/" \
  -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
  -H "Accept-Language: en-US,en;q=0.9" \
  | grep -o '"ratingCount":[0-9]*,"bestRating":[0-9]*,"worstRating":[0-9]*,"ratingValue":[0-9.]*')
score=$(echo "$data" | grep -oP '"ratingValue":\K[0-9.]+')
votes=$(echo "$data" | grep -oP '"ratingCount":\K[0-9]+')
echo "$ID | score: $score | votes: $votes"
```

3. **For multiple titles**, loop with a short delay to avoid rate limiting:

```bash
for id in tt0094625 tt0113568 tt0816398; do
  data=$(curl -s "https://www.imdb.com/title/$id/" \
    -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36" \
    -H "Accept-Language: en-US,en;q=0.9" \
    | grep -o '"ratingCount":[0-9]*,"bestRating":[0-9]*,"worstRating":[0-9]*,"ratingValue":[0-9.]*')
  score=$(echo "$data" | grep -oP '"ratingValue":\K[0-9.]+')
  votes=$(echo "$data" | grep -oP '"ratingCount":\K[0-9]+')
  echo "$id | score: $score | votes: $votes"
  sleep 0.3
done
```

4. **Format the result** in markdown:

```markdown
**IMDB:** [tt0094625](https://www.imdb.com/title/tt0094625/) — ⭐ 8.0 / 10 (224,804 votes)
```

## Cookbook

- IF: Title has spaces
- THEN: Replace spaces with `%20` in the suggestion API URL
- EXAMPLES:
  - `Ghost in the Shell` → `Ghost%20in%20the%20Shell`
  - `Cowboy Bebop 1998` → `Cowboy%20Bebop%201998`

- IF: Search returns multiple results with the same name
- THEN: Add the year to the query to disambiguate, and check the `q` field for type (`feature`, `TV series`, `TV mini-series`)

- IF: Score and votes come back empty
- THEN: The `-A` User-Agent and `-H` Accept-Language headers are required — requests without them return empty pages

- IF: Title has very few ratings (< 100 votes)
- THEN: Rating may be unstable or missing — note this in the output
