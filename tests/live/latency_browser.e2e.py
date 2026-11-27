# Live latency test: two passkey accounts online in separate browsers on the
# ICP site; measures time from pressing send to the message showing on the
# other side. Run: python3 tests/live/latency_browser.e2e.py
import time, statistics
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
    b=pw.chromium.launch()
    A=setup(b.new_context(viewport={"width":1280,"height":800})); B=setup(b.new_context(viewport={"width":1280,"height":800}))
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    A.fill("#draft","warm-up"); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".convo:has-text('warm-up')", timeout=60000); B.click(".convo:has-text('warm-up')")
    B.click(".request-banner button:has-text('Accept')")
    # Mailbox delivery first: wait until both sides are friends, then for the direct link.
    t0=time.time(); direct=False
    # The chat header (with the connection status) is hidden while the profile panel is open.
    if A.locator("[aria-label='Close profile']").count(): A.click("[aria-label='Close profile']")
    try:
        A.wait_for_selector("text=End-to-end encrypted, direct connection", timeout=90000); direct=True
    except Exception:
        pass
    print("direct link:", direct, "after", round(time.time()-t0,1), "s")
    times=[]
    for i in range(5):
        t=time.time(); A.fill("#draft", f"ping {i}"); A.click("[aria-label='Send encrypted']")
        B.wait_for_selector(f".message.in:has-text('ping {i}')", timeout=60000); times.append(time.time()-t)
    print("A->B seconds:", [round(x,2) for x in times], "median", round(statistics.median(times),2))
    delete_accounts(b); b.close()
