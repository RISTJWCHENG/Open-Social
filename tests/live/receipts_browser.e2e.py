# Live test: one tick, grey when sent, green when delivered, magenta when read.
# Run: python3 tests/live/receipts_browser.e2e.py
import time
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
TICK = lambda pg, text: pg.evaluate(f"() => {{ const m = [...document.querySelectorAll('.message.out')].find((e) => e.textContent.includes('{text}')); const t = m && m.querySelector('.tick'); return t ? t.className.replace('tick ', '') + ' / ' + getComputedStyle(t).color : null; }}")
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    A=setup(b.new_context(viewport={"width":1280,"height":860})); Bctx=b.new_context(viewport={"width":1280,"height":860}); B=setup(Bctx)
    for pg,n in ((A,"A"),(B,"B")): pg.on("console", lambda m,n=n: errs.append(n+": "+m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    A.fill("#draft","hi Bob"); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".convo:has(.request-tag)", timeout=120000); B.click(".convo:has(.request-tag)")
    B.click(".request-banner button:has-text('Accept')")
    # Bob opens another view (Myself), so Alice's next message is delivered but not read.
    B.click("button.rail-me"); time.sleep(1)
    A.fill("#draft","second message"); A.click("[aria-label='Send encrypted']")
    A.wait_for_selector(".message.out:has-text('second message') .tick", timeout=30000)
    print("A just sent:", TICK(A, "second message"))
    A.wait_for_selector(".message.out:has-text('second message') .tick-delivered", timeout=60000)
    print("A after Bob's device got it:", TICK(A, "second message"))
    B.click(".convo:has-text('second message')")
    A.wait_for_selector(".message.out:has-text('second message') .tick-read", timeout=60000)
    print("A after Bob opened the chat:", TICK(A, "second message"), "| first message:", TICK(A, "hi Bob"))
    A.locator(".message.out:has-text('second message') .bubble").screenshot(path="/tmp/tick-read.png")
    B.fill("#draft", "hello Alice"); B.click("[aria-label='Send encrypted']"); B.wait_for_selector(".message.out:has-text('hello Alice') .tick", timeout=30000)
    B.locator(".messages").screenshot(path="/tmp/b-view.png")
    print("B: ticks on Alice's messages:", B.locator(".message.in .tick, .message.in svg[aria-label='Signature checked']").count(), "| on Bob's own:", B.locator(".message.out .tick").count())
    print("errors:", errs[:3]); delete_accounts(b); b.close()
