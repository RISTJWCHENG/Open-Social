# Live two-user browser test (Playwright, Python). Two fresh passkey accounts on the
# ICP site: B signs up and goes offline, A sends, B comes back and receives, B replies.
# Run: python3 tests/live/two_users_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts, my_principal
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
def setup(ctx):
    pg=ctx.new_page()
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    return pg
def signup(pg):
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button[aria-label='New chat']:not([disabled])", timeout=60000)
    p=my_principal(pg)
    pg.wait_for_selector("button[aria-label='New chat']:not([disabled])", timeout=60000)
    return p
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    ctxA=b.new_context(viewport={"width":1440,"height":900}); ctxB=b.new_context(viewport={"width":1440,"height":900})
    A=setup(ctxA); B=setup(ctxB)
    for pg,n in ((A,'A'),(B,'B')): pg.on("console", lambda m,n=n: errs.append(n+': '+m.text[:160]) if m.type=="error" else None)
    pB=signup(B); print("B principal", pB)
    B.close()  # Bob goes offline
    pA=signup(A); print("A principal", pA)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    A.fill("#draft", "Hello Bob, you were offline when I sent this."); A.click("[aria-label='Send encrypted']")
    A.wait_for_selector("[aria-label='Sent to mailbox']", timeout=60000); print("A: message deposited in ICP mailbox")
    # Bob comes back online
    B=ctxB.new_page(); B.on("console", lambda m: errs.append('B2: '+m.text[:160]) if m.type=="error" else None)
    B.goto(URL, timeout=60000); B.wait_for_selector("button[aria-label='New chat']:not([disabled])", timeout=60000)
    B.wait_for_selector(".convo:has-text('Hello Bob')", timeout=60000); print("B: received while offline -> shown in list")
    B.click(".convo:has-text('Hello Bob')"); B.wait_for_selector(".message.in:has-text('you were offline')", timeout=20000)
    B.fill("#draft", "Got it, Alice! Replying now."); B.click("[aria-label='Send encrypted']")
    B.wait_for_selector("[aria-label='Sent to mailbox']", timeout=60000)
    A.wait_for_selector(".message.in:has-text('Got it, Alice')", timeout=60000); print("A: reply received")
    A.screenshot(path="/tmp/realA.png"); B.screenshot(path="/tmp/realB.png")
    print("console errors:", errs[:5]); delete_accounts(b); b.close()
