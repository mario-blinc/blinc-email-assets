# Blinc Studio email signatures

Hosted signature images at **https://assets.blinc.studio/email/** and a generator that builds an HTML signature for each team member with their home city highlighted.

**Assets are append-only. Never delete or overwrite a file in `public/email/`. Every email ever sent points at those URLs. A changed image is saved as a new version (`-v2`, `-v3`) and team.json or the build script is pointed at it.** The scripts refuse to overwrite, and every Vercel deploy runs `scripts/check-append-only.mjs`, which fails the deploy if a live file has been changed or removed.

Never host signature images on Google Drive, Notion, Canva or Dropbox links.

## Layout

| Path | What |
|---|---|
| `public/email/` | Hosted images (what Vercel serves) |
| `public/manifest.json` | Hashes of everything in `public/email/`, used by the append-only check |
| `team/team.json` | One entry per person |
| `source/avatars/` | Original avatar renders, untouched |
| `scripts/` | `avatars.mjs`, `icons.mjs`, `build.mjs`, `check-append-only.mjs`, `verify-urls.mjs` |
| `signatures/` | Generated signature per person (`{slug}.html`) |
| `previews/` | PNG screenshot of each signature, plus one per city |
| `template.html` | Signature layout (source of truth) |

Setup once: `npm install`.

## Add a new team member

1. Drop their avatar render in `source/avatars/` (square, framed like the others; the script keeps the central 75%, anchored to the top. Adjust per person with `avatarCrop` in team.json).
2. Add them to `team/team.json`:
   ```json
   {
     "name": "Jane Smith",
     "title": "Designer",
     "phone": "07700 900123",
     "phoneIntl": "+447700900123",
     "city": "Lisbon",
     "avatar": "jane.png",
     "slug": "jane"
   }
   ```
   `city` must be one of LONDON, DUBAI, LIMASSOL, MILAN, LISBON (any case). The build fails on anything else.
3. `npm run avatars`: creates `public/email/avatar-jane-v1.png` and sets `avatarAsset` in team.json.
4. `npm run build`: writes `signatures/jane.html` and `previews/jane.png`. Read the warnings.
5. `npm run check`, then commit and push. Vercel deploys automatically.
6. After the deploy: `npm run verify` checks every image URL returns 200 with the right type.

To change someone's photo, replace their file in `source/avatars/` and run `npm run avatars`: it writes the next version and updates team.json. The old version stays online.

## Install the signature

Open `signatures/{slug}.html` in Chrome, click inside the page, select all (Cmd/Ctrl+A) and copy (Cmd/Ctrl+C).

- **Gmail (Google Workspace):** Settings (gear) → See all settings → General → Signature → Create new, paste into the box, set it as the default for new emails and replies, then Save Changes at the bottom.
- **Apple Mail:** Mail → Settings → Signatures, pick the account, click +, untick "Always match my default message font", paste. If images show as blue question marks, quit Mail, then reopen it once the images have loaded.
- **Outlook (new Outlook and Outlook on the web):** Settings → Accounts → Signatures → New signature, paste, Save, then choose it as the default for new messages and replies.
- **Outlook (classic Windows):** File → Options → Mail → Signatures → New, paste, OK.

Outlook desktop shows only the first frame of the animated logo, which is why frame 1 is always the settled wordmark.

## Hosting

Vercel static project, output directory `public`, no framework. `vercel.json` sets year-long immutable caching and cross-origin headers on `/email/*`. Custom domain `assets.blinc.studio` is a CNAME to Vercel.
