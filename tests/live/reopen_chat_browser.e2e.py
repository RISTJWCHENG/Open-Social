# Live test: after a reload the chat that was open is open again; file
# messages show their name in the chat list. Needs /tmp/photo.png.
# Run: python3 tests/live/reopen_chat_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
def active(pg): return pg.get_attribute("main.chat-main", "aria-label")
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":820}); pg=ctx.new_page()
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000)
    pg.click("button.rail-me"); pg.set_input_files("input[aria-label='Files to send']", ["/tmp/photo.png"])
    pg.wait_for_selector(".convo:has-text('Myself')", timeout=20000)
    print("list preview:", pg.inner_text(".convo:has-text('Myself') .convo-preview"))
    pg.click("button.rail-me"); pg.wait_for_selector("main[aria-label^='Conversation with']:has(.chat-header .avatar)")
    pg.reload(); pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000); pg.wait_for_timeout(1500)
    print("after reload (Myself open before):", active(pg)); delete_accounts(b); b.close()
