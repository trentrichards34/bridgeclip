# CreatorClips: first release checklist

This is for the owner (Trent), on a Mac with Apple silicon. It covers what to set up once and what to do for every release, how members download and update, and what to do when something goes wrong. You don't need to be a developer. Every step says where to click.

**How it works:** the CreatorClips code stays in your **private** GitHub repository (`trentrichards34/bridgeclip`). When you release a version, GitHub builds the Mac and Windows apps for you on its own computers. It signs the Mac app with Wealthery's Apple certificate and has Apple check it ("notarization"). Then it uploads the installers to a separate **public** repository (`trentrichards34/creatorclips-releases`) as a *draft*. You check the draft and press **Publish**. Members download from that public page, and their apps update themselves from it.

> **Words used here**
> - **Repository ("repo")**: a project folder on GitHub.
> - **Secret**: a password you store in GitHub. Its value can't be read back, only used by the build.
> - **Tag**: a label like `v0.1.20` on one exact version of the code. Pushing a tag starts a release.
> - **Terminal**: the Mac app for typing commands (press ⌘ Space, type *Terminal*, press Return).
> - **Workflow / Actions**: GitHub's automatic build, on the **Actions** tab of a repository.

---

## Part 1: one-time setup

Total hands-on time is about 1.5 to 2 hours. Apple's approval can add a few days to two weeks of waiting, so start step 1 first.

### 1. Join the Apple Developer Program as an organization (30 min, then a wait of days to ~2 weeks)

This gives Wealthery the certificate that makes macOS trust CreatorClips. It costs $99 a year.

1. Get Wealthery's **D-U-N-S Number**, a free company ID Apple uses to confirm that Wealthery is a real business. Look it up or request one at <https://developer.apple.com/enroll/duns-lookup/>. A new one can take up to about a week.
2. You need: an Apple Account with two-factor authentication turned on, Wealthery's legal name exactly as registered, a website on Wealthery's domain, and the authority to sign for the company.
3. Go to <https://developer.apple.com/programs/enroll/> → **Start your enrollment** → sign in → choose **Organization**, fill in the company details, and pay.
4. Wait for Apple's approval email. Apple may phone to confirm.
5. After approval, open <https://developer.apple.com/account>, scroll to **Membership details**, and write down the **Team ID** (10 letters and numbers, like `AB12CD34EF`). You'll need it in step 6.
6. If the account page shows a banner asking you to accept a new agreement, accept it. Notarization fails until you do.

### 2. Make the "Developer ID Application" certificate (20 min)

Only the person who enrolled (the **Account Holder**) can do this.

1. **Create a request file:** open **Keychain Access** (⌘ Space → *Keychain Access*). In the menu bar choose **Keychain Access → Certificate Assistant → Request a Certificate From a Certificate Authority…**. Enter your email and the common name `Wealthery Developer ID`, leave CA Email empty, choose **Saved to disk**, click **Continue**, and save it to the Desktop.
2. Go to <https://developer.apple.com/account/resources/certificates/list> and click the **+** button.
3. Under *Software*, choose **Developer ID Application** → **Continue**. If asked for a profile type, pick **G2 Sub-CA** → upload the request file from the Desktop → **Continue** → **Download**.
4. Double-click the downloaded `.cer` file. Keychain Access adds it.
5. **Export it with its private key:** in Keychain Access, click **login** (left) and then the **My Certificates** tab (top). Find **Developer ID Application: Wealthery … (your Team ID)**; it has a small arrow, because the private key is inside. Right-click the certificate → **Export…** → File Format **Personal Information Exchange (.p12)** → name it `creatorclips-developer-id.p12` → save to the Desktop.
6. Choose a strong password for the file. **Write it down**: this is the `CSC_KEY_PASSWORD` secret. Then enter your Mac login password to allow the export.
7. Turn the file into text for GitHub. In Terminal, type:
   ```
   base64 -i ~/Desktop/creatorclips-developer-id.p12 | pbcopy
   ```
   This copies a long block of text to your clipboard. It's the `CSC_LINK` secret. Paste it in step 6 right away, or into a note in your password manager.
8. Keep the `.p12` file and its password in your password manager, then delete them from the Desktop. Anyone with both can sign apps as Wealthery.

### 3. Make an app-specific password for notarization (5 min)

1. Go to <https://account.apple.com> and sign in with the Apple Account from step 1.
2. **Sign-In and Security → App-Specific Passwords → +** (or *Generate an app-specific password*). Name it `CreatorClips notarization`.
3. Copy the password it shows (looks like `abcd-efgh-ijkl-mnop`). This is the `APPLE_APP_SPECIFIC_PASSWORD` secret. That Apple Account's email is the `APPLE_ID` secret.

### 4. Create the public releases repository (5 min)

1. Go to <https://github.com/new>.
2. Owner: **trentrichards34**. Repository name: **creatorclips-releases**. Description: *CreatorClips downloads*.
3. Choose **Public**. Tick **Add a README file**: the repository needs one file before releases can be created.
4. Click **Create repository**.
5. Optional: edit the README to say "Download CreatorClips from the Releases section on the right."

Nothing else goes in this repository. Code never goes there, only the installers the build uploads. Members can file bug reports under its **Issues** tab, which is where the app's **Report an Issue…** menu item leads.

### 5. Create a GitHub token so the build can upload (5 min)

1. Go to <https://github.com/settings/personal-access-tokens/new> (Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → *Generate new token*).
2. Token name: `CreatorClips releases upload`. Expiration: **1 year**. Put a reminder in your calendar 11 months from now to make a new one.
3. Resource owner: **trentrichards34**.
4. Repository access: **Only select repositories** → pick **creatorclips-releases** only.
5. Permissions → **Repository permissions** → **Contents** → **Read and write**. (*Metadata: Read-only* is added automatically.)
6. Click **Generate token** and copy it (starts with `github_pat_`). This is the `GH_RELEASES_TOKEN` secret. GitHub shows it only once.

### 6. Add the secrets to the private repository (10 min)

1. Open <https://github.com/trentrichards34/bridgeclip/settings/secrets/actions> (the repo → **Settings** → **Secrets and variables** → **Actions**).
2. For each row, click **New repository secret**, type the name exactly as shown, paste the value, and click **Add secret**:

| Name | Value (from) |
| --- | --- |
| `CSC_LINK` | The long text from step 2.7 |
| `CSC_KEY_PASSWORD` | The `.p12` password from step 2.6 |
| `APPLE_ID` | Your Apple Account email (step 3) |
| `APPLE_APP_SPECIFIC_PASSWORD` | The app-specific password (step 3) |
| `APPLE_TEAM_ID` | The Team ID (step 1.5) |
| `GH_RELEASES_TOKEN` | The token (step 5) |

The Team ID does two jobs: Apple uses it to notarize, and it's built into the app as the only signer the app accepts updates from.

### 7. Try a test build (5 min of clicks, about 1 hour of waiting)

1. Open <https://github.com/trentrichards34/bridgeclip/actions> → **Release** (left) → **Run workflow** → keep *all* → **Run workflow**.
2. When it finishes, scroll to **Artifacts** at the bottom of the run page and download **mac-arm64**. Unzip it, open the `.dmg`, and drag CreatorClips into Applications.
3. Test builds are **not signed**, so macOS blocks the first open. Open it once, then go to **System Settings → Privacy & Security**, scroll down, and click **Open Anyway**. If macOS says the app "is damaged", run this in Terminal and try again:
   ```
   xattr -cr /Applications/CreatorClips.app
   ```
   Members never see this: real releases are signed and notarized.

This checks that the build works before you spend a version number. If the **Windows** job fails at *Bundle Python and FFmpeg*, see [Something went wrong](#part-4-if-something-goes-wrong).

### 8. Optional: sign the Windows app (Azure Trusted Signing, 1 to 2 hours plus a verification wait)

Without this, the Windows installer is **unsigned**. Members see a blue "Windows protected your PC" warning (they click **More info → Run anyway**), and the Windows app **does not update itself**: Windows members download each new version from the releases page. The release notes say so automatically.

To sign it, Wealthery needs Microsoft's code-signing service, *Azure Trusted Signing* (Microsoft may now call it *Artifact Signing*). Check its current price and eligibility on Microsoft's site; it has been about $10 a month. A developer can help with the Azure parts:

1. Create an Azure account at <https://portal.azure.com> → create a **Trusted Signing Account** resource and note its **Account name** and **endpoint URL** (like `https://eus.codesigning.azure.net`).
2. In it, complete **Identity validation** for Wealthery (Microsoft verifies the business, which can take days), then create a **Certificate profile** of type **Public Trust**. Note the profile name and the publisher name it shows (usually Wealthery's legal name).
3. In **Microsoft Entra ID → App registrations**, create an app called `creatorclips-signing`, add a **client secret**, and note the tenant ID, client ID and secret value.
4. On the Trusted Signing Account → **Access control (IAM)**, give that app the role **Trusted Signing Certificate Profile Signer**.
5. Add these secrets to the private repository, as in step 6: `WINDOWS_PUBLISHER_NAME` (the exact publisher name), `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`, `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`.

From then on, Windows installers are signed and the Windows app updates itself. The first signed Windows version still has to be downloaded by hand, because older unsigned copies can't update.

---

## Part 2: every release (about 10 minutes of work, 1 to 1.5 hours of waiting)

### 1. Make sure the changelog says what's new

`CHANGELOG.md` must list the changes under `## [Unreleased]`. Members see this text in the app and on the download page. Usually whoever made the changes (or Claude) has already added these lines. The release command stops with a clear message if the section is empty.

### 2. Bump the version, tag it and push it (2 min)

In Terminal, in the CreatorClips project folder:

```
git checkout main
git pull
npm run release:patch
git push origin HEAD --follow-tags
```

- `release:patch` goes from 0.1.19 to 0.1.20, for fixes and small additions. Use `npm run release:minor` (0.1.19 to 0.2.0) for bigger features, and `npm run release:major` (to 1.0.0) for a milestone.
- The command updates the version number, turns *Unreleased* into today's dated section, saves that as a commit and tags it `vX.Y.Z`. The push sends it to GitHub, which starts the build.
- If it says "Commit or discard your changes first", there are unsaved edits in the folder. Ask whoever made them, or run `git status` to see them.

### 3. Watch the build (1 to 1.5 hours, nothing to do)

Open <https://github.com/trentrichards34/bridgeclip/actions>. You'll see a **Release** run named after the commit `Release vX.Y.Z`. Its jobs are **Tests**, **Mac (arm64)**, **Mac (x64)**, **Windows (x64)** and **Draft release**. A green check means done; a red ✕ means see Part 4. GitHub also emails you if it fails.

### 4. Check and publish the draft (5 min)

1. Open <https://github.com/trentrichards34/creatorclips-releases/releases>. You'll see **CreatorClips X.Y.Z** marked *Draft* (only you can see it).
2. Optional but recommended: click the `…-mac-arm64.dmg` file to download it, install it, and open it. It should open with no warnings.
3. Click the pencil (**Edit**) icon. Read the notes and fix any wording if you like. Make sure **Set as the latest release** is ticked and **Set as a pre-release** is *not* ticked.
4. Click **Publish release**.

### 5. Members get it

Members' apps check within about 4 hours (or right away from **Help → Check for Updates…**). The new version downloads in the background, then **Restart to update** appears in the sidebar. If they don't click it, it installs the next time they quit.

---

## Part 3: how members download and update

**Download link to share** (always shows the newest version):
<https://github.com/trentrichards34/creatorclips-releases/releases/latest>

Under **Assets** on that page:

- **Mac with Apple silicon (M1, M2, M3, M4…):** `CreatorClips-X.Y.Z-mac-arm64.dmg`
- **Mac with Intel:** `CreatorClips-X.Y.Z-mac-x64.dmg` (needs macOS 15 Sequoia or newer)
- **Windows:** `CreatorClips-X.Y.Z-win-x64.exe`

The Apple silicon Mac app needs macOS 14 Sonoma or newer. (Not sure which Mac? Apple menu → About This Mac: "Chip: Apple M…" means Apple silicon.)

**Install on a Mac:** open the `.dmg`, drag **CreatorClips** onto **Applications**, then open it from the Applications folder. It must run from Applications to update itself; if it's opened straight from the disk image, Settings → About offers **Move to Applications**.

**Install on Windows:** run the `.exe`. If it's unsigned, click **More info → Run anyway**.

**Updates:** automatic for signed Mac and Windows apps, as described in Part 2, step 5. Members can see the current state under **Settings → About → Updates**.

The first Wealthery-signed version has to be installed by hand once. Every version after that arrives automatically.

---

## Part 4: if something goes wrong

On the failed run's page, click the red job to see which step failed. After fixing the cause, click **Re-run failed jobs** (top right) unless the fix needs a code change.

| What you see | What it means | What to do |
| --- | --- | --- |
| **Tests** fails at *Version*: "Tag … does not match" | The tag was made by hand | Always use `npm run release:patch`. Ask a developer to delete the stray tag. |
| **Tests** fails at `test:release` | Usually the changelog: no dated section, or a heading that isn't Added/Changed/Fixed/Removed | Fix `CHANGELOG.md`, then make a new release (step 2 again). |
| **Mac** fails at *Build app* with a certificate or "identity" error | `CSC_LINK` or `CSC_KEY_PASSWORD` is wrong, or the certificate isn't a *Developer ID Application* one | Redo step 2.5 to 2.7 and update both secrets, then **Re-run failed jobs**. |
| **Mac** fails with "Missing APPLE_…" or "must be the same team" | A secret is missing or mistyped | Check the secret names in Part 1, step 6. |
| **Mac** notarization: "invalid credentials" / HTTP 401 | Wrong Apple ID or app-specific password, or the password was revoked | Make a new app-specific password (step 3) and update `APPLE_APP_SPECIFIC_PASSWORD`. |
| **Mac** notarization: "agreement" / HTTP 403 | Apple has a new agreement to accept | Accept it at <https://developer.apple.com/account>, then re-run. |
| **Mac** notarization takes very long | Apple's service is slow | Wait; if the job times out, **Re-run failed jobs**. |
| **Windows** fails at *Bundle Python and FFmpeg* (HTTP 404) | The pinned FFmpeg download has expired upstream. **This is already the case today.** | A developer needs to update the FFmpeg pin (see "Runtime reproduction" in RELEASING.md). To ship Mac-only meanwhile: repo **Settings → Secrets and variables → Actions → Variables → New repository variable**, name `RELEASE_PLATFORMS`, value `macos`, then **Re-run all jobs**. |
| **Draft release** fails: "Add the GH_RELEASES_TOKEN secret", HTTP 401/403/404 | Token missing, expired, or not allowed on `creatorclips-releases` | Make a new token (Part 1, step 5) and update the secret, then **Re-run failed jobs**. |
| **Draft release** fails: "already exists" | A release with that version is already in the releases repo | If it's an unpublished leftover draft, delete it there (open it → 🗑), then re-run. Never delete a published one: release a new version instead. |
| GitHub says you're out of Actions minutes | Mac builds use the most minutes, and private repos have a monthly allowance | Check <https://github.com/settings/billing>; add a spending limit or upgrade the plan. |
| A published version is broken | | Don't delete it in a panic. Edit it in the releases repo and save it as a draft (members stop getting it), then fix and release a new version, which reaches everyone through updates. |

If the code needs a fix after you pushed a tag but **before** you published anything, either make a new release with the fix (simplest), or ask a developer to move the tag to the fixed commit.

---

## What each secret is, in one place

| Secret | Where it came from | Expires |
| --- | --- | --- |
| `CSC_LINK`, `CSC_KEY_PASSWORD` | Developer ID certificate (Part 1, step 2) | The certificate lasts 5 years. Released apps keep working after it expires |
| `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD` | Apple Account (step 3) | When you revoke it or change your Apple password |
| `APPLE_TEAM_ID` | Apple membership (step 1) | Never |
| `GH_RELEASES_TOKEN` | GitHub token (step 5) | The date you picked (1 year) |
| Apple Developer Program | | Renew yearly ($99), or you can't notarize new versions |
