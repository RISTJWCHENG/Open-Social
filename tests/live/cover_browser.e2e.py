# Live test: the cover editor in Settings > Profile has the same size and
# layout as the profile panel that shows the result.
# Run: python3 tests/live/cover_browser.e2e.py   (needs /tmp/cover.jpg, /tmp/a.png)
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
def box(pg, sel):
    b=pg.locator(sel).first.bounding_box(); return (round(b['width']), round(b['height']))
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1440,"height":900}); pg=ctx.new_page(); errs=[]
    pg.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" else None)
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000)
    pg.click("[aria-label='Menu']"); pg.click(".menu-settings")
    pg.set_input_files("input[aria-label='Cover image']", "/tmp/cover.jpg")
    pg.set_input_files("input[aria-label='Profile photo']", "/tmp/a.png"); pg.click(".crop-apply"); pg.wait_for_timeout(800)
    pg.fill("#set-profile input.pf-input", "Rist Cheng")
    ed_cover=box(pg, ".pf-cover"); ed_av=box(pg, ".pf-cover .profile-avatar")
    pg.locator("aside.settings-panel").screenshot(path="/tmp/cover-editor.png")
    pg.click("button:has-text('Save profile')"); pg.wait_for_selector("text=Profile saved", timeout=60000)
    pg.click("[aria-label='Close settings']")
    pg.click("[aria-label='Menu']"); pg.click("[role=menuitem]:has-text('My Profile')")
    pg.wait_for_selector("aside.profile-panel .cover.has-image")
    pn_cover=box(pg, "aside.profile-panel .cover"); pn_av=box(pg, "aside.profile-panel .profile-avatar")
    pg.locator("aside.profile-panel").screenshot(path="/tmp/cover-panel.png")
    print("editor cover", ed_cover, "avatar", ed_av, "| panel cover", pn_cover, "avatar", pn_av, "| errors:", errs[:3]); delete_accounts(b); b.close()
