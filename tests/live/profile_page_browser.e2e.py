# Live test: fill and save the profile page (photo, bio, link). Needs /tmp/a.png.
# Run: python3 tests/live/profile_page_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":980}); pg=ctx.new_page(); errs=[]
    pg.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" else None)
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button[aria-label='New chat']:not([disabled])", timeout=60000)
    pg.click("[aria-label='Menu']"); pg.click(".menu-settings")
    pg.set_input_files("input[aria-label='Profile photo']", "/tmp/a.png"); pg.click(".crop-apply"); pg.wait_for_timeout(500)
    pg.fill("textarea.pf-textarea", "VFX artist in Brussels")
    pg.click("text=+ Add link"); pg.fill("[aria-label='Link 1 name']", "triggerpointglobal"); pg.fill("[aria-label='Link 1 address']", "https://www.triggerpointglobal.com")
    pg.click("button:has-text('Save profile')"); pg.wait_for_selector("text=Profile saved", timeout=60000)
    pg.locator("aside.settings-panel").screenshot(path="/tmp/pf.png"); print("saved; errors:", errs[:3]); delete_accounts(b); b.close()
