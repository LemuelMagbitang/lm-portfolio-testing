# Local Browser Testing

This repository is a static GitHub Pages site. For reliable local testing, serve the repository over HTTP rather than opening `index.html` directly from the filesystem.

## Recommended Windows setup

### 1. Clone with GitHub Desktop

1. Install GitHub Desktop and sign in.
2. Choose **File → Clone Repository**.
3. Clone `LemuelMagbitang/lm-portfolio-testing`.
4. Choose a normal local folder such as `Documents/GitHub`.
5. Click **Clone**.

GitHub Desktop can clone repositories and switch between remote branches without using Git commands.

### 2. Switch to the hardening branch

In GitHub Desktop:

1. Click **Current Branch**.
2. Select `architecture-security-hardening`.
3. Let Desktop fetch/pull the branch if prompted.

Do not make or commit changes to `main` during this test.

### 3. Open the project in VS Code

Use GitHub Desktop's **Open in Visual Studio Code** action, or open the cloned folder in VS Code.

Install the **Live Server** extension from the VS Code Extensions panel.

### 4. Start the local site

In VS Code Explorer, right-click `index.html` and choose **Open with Live Server**.

A browser tab should open at a local HTTP address similar to:

`http://127.0.0.1:5500/`

Do not use `file://` URLs for this test because the site's module/data loading expects an HTTP server.

## Browser smoke test

Check the following at desktop and then narrow the browser window:

- Home page loads without a blank state or missing assets.
- Hero media loads and transitions normally.
- Gallery filters work and do not lose CMS filter IDs.
- Show More works after resizing from desktop to mobile and back.
- Project cards open the lightbox and previous/next/close controls work.
- Video, Lottie, image, and 3D project types behave correctly where present.
- 3D viewer opens only when activated, responds to resize, and closes without leaving the page frozen.
- About page loads its CMS content and assets.
- 404 and success pages load their local assets.

Open browser DevTools (**F12**) and check:

- Console: no red JavaScript errors.
- Network: no unexpected 404/failed local asset requests.
- No repeated requests or errors when opening/closing a project repeatedly.

## CMS test

Open:

`http://127.0.0.1:5500/admin/`

Use your own GitHub fine-grained token locally. **Never send the token in chat, commit it, or put it in screenshots.**

Recommended checks:

1. Connect with **Remember on this device** disabled.
2. Disconnect and confirm the session ends.
3. Reload and confirm the token is not silently restored from a previous session.
4. Test a harmless content edit and save it to the hardening branch, not `main`.
5. Verify the resulting GitHub commit contains only the expected files.
6. Test a second browser tab or window and confirm stale saves are rejected when the repository changes underneath them.
7. Open DevTools and verify authenticated GitHub API requests go directly to GitHub and do not send a site referrer.

After testing, remove any local test content you do not want to keep and delete or rotate the test token if you granted more access than necessary.

## Optional command-line route

GitHub Desktop is easier for beginners, but the same workflow can be done with Git:

```powershell
git clone https://github.com/LemuelMagbitang/lm-portfolio-testing.git
cd lm-portfolio-testing
git fetch origin
git switch --track origin/architecture-security-hardening
```

Then open the folder in VS Code and use Live Server.

## What to report

The most useful feedback is:

- exact page/interaction that failed;
- browser console error text;
- failing Network request URL/path;
- screenshot of the broken UI;
- browser name and version.

Do not include tokens, cookies, authorization headers, or other credentials in screenshots or copied logs.
