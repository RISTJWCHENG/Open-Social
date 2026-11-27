# Live test: menu > My Profile shows the user's own profile in the same right
# panel (and width) as a contact's; editing is in Settings.
# Run: python3 tests/live/my_profile_browser.e2e.py   (needs /tmp/a.png)
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1440,"height":860}); pg=ctx.new_page(); errs=[]
    pg.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" else None)
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000)
    # A contact's panel width, for comparison.
    contact_w=pg.locator("aside.profile-panel").bounding_box()["width"]
    pg.click("[aria-label='Menu']"); pg.click(".menu-settings")
    pg.set_input_files("input[aria-label='Profile photo']", "/tmp/a.png"); pg.click(".crop-apply"); pg.wait_for_timeout(400)
    pg.fill("#set-profile input.pf-input", "Ada Lovelace"); pg.fill("textarea.pf-textarea", "Illustrator in Portland")
    pg.click("text=+ Add link"); pg.fill("[aria-label='Link 1 name']", "Portfolio"); pg.fill("[aria-label='Link 1 address']", "https://example.com")
    pg.click("button:has-text('Save profile')"); pg.wait_for_selector("text=Profile saved", timeout=60000); pg.click("[aria-label='Close settings']")
    pg.click("[aria-label='Menu']"); pg.click("[role=menuitem]:has-text('My Profile')")
    panel=pg.locator("aside.profile-panel"); panel.wait_for()
    print("My Profile panel width:", round(panel.bounding_box()["width"]), "| contact panel width:", round(contact_w))
    print("shows:", " / ".join(t for t in [panel.locator("h2").inner_text(), panel.locator(".bio").inner_text(), panel.locator(".profile-socials .profile-social-label").first.inner_text()]))
    print("editable fields in panel:", panel.locator("input, textarea").count())
    pg.screenshot(path="/tmp/myprofile.png")
    print("no Edit in Settings button:", panel.locator("button:has-text('Edit in Settings')").count() == 0, "| errors:", errs[:3]); delete_accounts(b); b.close()
