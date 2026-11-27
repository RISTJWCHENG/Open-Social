# Live test: scrolling up shows the ↓ button; new messages while reading older
# ones keep the place and are counted on it; clicking goes to the newest.
# Run: python3 tests/live/to_latest_browser.e2e.py
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
POS="() => { const el = document.querySelector('.messages'); return Math.round(el.scrollHeight - el.scrollTop - el.clientHeight); }"
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    A=setup(b.new_context(viewport={"width":1280,"height":720})); B=setup(b.new_context(viewport={"width":1280,"height":720}))
    A.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    pB=signup(B); pA=signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    for i in range(18):
        A.fill("#draft", f"older message {i}"); A.press("#draft","Enter"); A.wait_for_timeout(150)
    B.wait_for_selector(".convo:has(.request-tag)", timeout=120000); B.click(".convo:has(.request-tag)"); B.click(".request-banner button:has-text('Accept')")
    A.wait_for_timeout(1500)
    print("at the bottom: button shown:", A.locator(".to-latest").count())
    A.hover(".messages"); A.mouse.wheel(0, -900); A.wait_for_timeout(500)
    before = A.evaluate(POS); print("scrolled up: button shown:", A.locator(".to-latest").count(), "| distance from bottom:", before)
    for t in ["new 1", "new 2", "new 3"]:
        B.fill("#draft", t); B.press("#draft","Enter"); B.wait_for_timeout(300)
    A.wait_for_function("() => document.querySelectorAll('.message.in').length >= 3", timeout=90000); A.wait_for_timeout(600)
    print("after 3 new messages: count on button:", A.inner_text(".to-latest-count"), "| place kept (distance grew):", A.evaluate(POS) > before)
    A.locator("main.chat-main").screenshot(path="/tmp/to-latest.png")
    A.click(".to-latest"); A.wait_for_timeout(900)
    print("after click: distance", A.evaluate(POS), "| button shown:", A.locator(".to-latest").count(), "| newest visible:", A.locator(".message.in:has-text('new 3')").is_visible())
    print("errors:", errs[:3]); delete_accounts(b); b.close()
