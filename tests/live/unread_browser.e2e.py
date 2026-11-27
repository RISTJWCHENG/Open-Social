# Live test: messages read in a chat stay read after reloading the page.
# Run: python3 tests/live/unread_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts, my_principal
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
def setup(ctx):
    pg=ctx.new_page(); cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    return pg
def signup(pg):
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button[aria-label='New chat']:not([disabled])", timeout=60000)
    p=my_principal(pg); return p
def badge(pg):
    loc=pg.locator(".convo:has(.request-tag) .unread, .convo:has-text('Alice') .unread")
    return loc.first.inner_text() if loc.count() else "none"
with sync_playwright() as pw:
    b=pw.chromium.launch()
    A=setup(b.new_context(viewport={"width":1280,"height":860})); B=setup(b.new_context(viewport={"width":1280,"height":860}))
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    for t in ("one","two"):
        A.fill("#draft", t); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".convo:has(.request-tag) .unread", timeout=120000); print("B before reading: unread badge", badge(B))
    B.click(".convo:has(.request-tag)"); B.wait_for_selector(".message.in:has-text('two')", timeout=60000)
    B.wait_for_timeout(1500); B.reload(); B.wait_for_selector(".convo:has(.request-tag)", timeout=60000); B.wait_for_timeout(3000)
    print("B after reload: unread badge", badge(B))
    delete_accounts(b); b.close()
