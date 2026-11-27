# Live test: "Myself" is listed at the top only while it is open: it appears
# when the account avatar is clicked (even without notes) and disappears when
# another chat is opened. Run: python3 tests/live/self_listing_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
def first(pg): return pg.locator(".convo .convo-name, .convo strong, .convo h3").first.inner_text() if pg.locator(".convo").count() else None
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":820}); pg=ctx.new_page()
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000)
    print("before click, Myself listed:", pg.locator(".convo:has-text('Myself')").count())
    pg.click("button.rail-me"); pg.wait_for_selector(".convo:has-text('Myself')", timeout=10000)
    print("after avatar click (no notes): first item is Myself:", 'Myself' in pg.locator(".convo").first.inner_text())
    # Open another chat (a friend), then Myself should leave the list.
    pg.click("button[aria-label='New chat']"); pg.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", "aaaaa-aa"); pg.keyboard.press("Escape")
    pg.evaluate("() => document.querySelector('.convo:not(:has-text(\"Myself\"))')?.click()")
    print("Myself listed while open:", pg.locator(".convo:has-text('Myself')").count())
    pg.click("button.rail-me"); pg.wait_for_selector(".convo:has-text('Myself')", timeout=10000)
    print("avatar clicked again: first item is Myself:", 'Myself' in pg.locator(".convo").first.inner_text()); delete_accounts(b); b.close()
