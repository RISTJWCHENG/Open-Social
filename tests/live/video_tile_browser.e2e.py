# Live test with real WebRTC: a 50 MB video arrives as a preview frame with a
# play button and plays inside the chat. Needs /tmp/film.webm (> 10 MB).
# Run: python3 tests/live/video_tile_browser.e2e.py
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
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    A=setup(b.new_context(viewport={"width":1280,"height":860})); B=setup(b.new_context(viewport={"width":1280,"height":860}))
    for pg,n in ((A,"A"),(B,"B")): pg.on("console", lambda m,n=n: errs.append(n+": "+m.text[:140]) if m.type=="error" else None)
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    A.fill("#draft","hi"); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".convo:has(.request-tag)", timeout=120000); B.click(".convo:has(.request-tag)")
    B.click(".request-banner button:has-text('Accept')")
    A.set_input_files("input[aria-label='Files to send']", ["/tmp/film.webm"])
    A.wait_for_selector(".message.out .att-video-tile img", timeout=60000); print("A: sent with a preview frame")
    t=time.time()
    B.wait_for_selector(".message.in button.att-video-tile[aria-label^='Play']", timeout=240000)
    print(f"B: received in {round(time.time()-t)} s; preview frame shown:", B.locator(".message.in .att-video-tile img").count()==1)
    B.locator(".message.in .att-video-tile").screenshot(path="/tmp/tile.png")
    B.click(".message.in button.att-video-tile")
    B.wait_for_selector(".message.in video", timeout=60000)
    B.wait_for_function("() => { const v = document.querySelector('.message.in video'); return v && v.currentTime > 0.5; }", timeout=30000)
    print("B: playing in the chat, at", round(B.evaluate("document.querySelector('.message.in video').currentTime"),1), "s")
    B.locator(".message.in .attachment").screenshot(path="/tmp/playing.png")
    print("errors:", [e for e in errs if 'pubKeyCred' not in e][:3]); delete_accounts(b); b.close()
