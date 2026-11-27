# Live test: the account avatar in the rail opens the "Myself" chat (notes to
# yourself); notes and files stay on the device and survive a reload.
# Run: python3 tests/live/self_chat_browser.e2e.py   (needs /tmp/a.png, /tmp/photo.png)
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":820}); pg=ctx.new_page(); errs=[]
    pg.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" else None)
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000)
    pg.click("[aria-label='Menu']"); pg.click(".menu-settings")
    pg.set_input_files("input[aria-label='Profile photo']", "/tmp/a.png"); pg.click(".crop-apply"); pg.wait_for_timeout(400)
    pg.fill("input.pf-input[placeholder]", "Ada Lovelace"); pg.click("button:has-text('Save profile')"); pg.wait_for_selector("text=Profile saved", timeout=60000)
    pg.click("[aria-label='Close settings']")
    pg.click("button.rail-me"); pg.wait_for_selector("main[aria-label^='Conversation with']:has(.chat-header .avatar)", timeout=20000); print("rail avatar opens the notes-to-self chat")
    pg.fill("#draft", "Remember: call the plumber"); pg.click("[aria-label='Send encrypted']")
    pg.set_input_files("input[aria-label='Files to send']", ["/tmp/photo.png"])
    pg.wait_for_selector(".message.out img.att-media", timeout=30000)
    pg.wait_for_selector(".convo:has-text('(Myself)')", timeout=10000)
    print("chat list:", pg.locator(".convo").first.locator(".convo-name, strong").first.inner_text() if pg.locator(".convo .convo-name").count() else pg.locator(".convo").first.inner_text().split("\n")[1])
    print("chat header:", pg.inner_text(".chat-header .name"), "| panel:", pg.inner_text("aside.profile-panel h2") if pg.locator("aside.profile-panel").count() else "-")
    pg.screenshot(path="/tmp/self.png")
    pg.reload(); pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000); pg.click("button.rail-me")
    pg.wait_for_selector(".message.out:has-text('call the plumber')", timeout=20000); pg.wait_for_selector(".message.out img.att-media", timeout=20000)
    print("after reload: note and photo still there; errors:", errs[:3]); delete_accounts(b); b.close()
