# Live test: a second OpenSocial tab of the same account shows "open in another
# tab" until it takes over; messages then flow both ways with the active tab.
# Run: python3 tests/live/tabs_browser.e2e.py
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
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    Actx=b.new_context(viewport={"width":1280,"height":860}); A=setup(Actx); B=setup(b.new_context(viewport={"width":1280,"height":860}))
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    A.fill("#draft","hello from tab 1"); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".convo:has(.request-tag)", timeout=120000); B.click(".convo:has(.request-tag)")
    B.click(".request-banner button:has-text('Accept')")
    # Alice opens a second tab.
    A2=Actx.new_page(); A2.goto(URL, timeout=60000)
    A2.wait_for_selector("text=OpenSocial is open in another tab", timeout=60000); print("A tab 2: 'open in another tab' shown")
    A2.click("button:has-text('Use here')")
    A2.wait_for_selector("button[aria-label='New chat']:not([disabled])", timeout=60000)
    A.wait_for_selector("text=OpenSocial is open in another tab", timeout=30000); print("A tab 1: paused after the takeover")
    B.fill("#draft","reply to Alice"); B.click("[aria-label='Send encrypted']")
    A2.wait_for_selector(".convo:has-text('Bob')", timeout=60000); A2.click(".convo:has-text('Bob')")
    A2.wait_for_selector(".message.in:has-text('reply to Alice')", timeout=90000); print("A tab 2: received Bob's reply")
    A2.fill("#draft","and back to Bob"); A2.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".message.in:has-text('and back to Bob')", timeout=90000); print("B: received Alice's message from tab 2")
    delete_accounts(b); b.close()
