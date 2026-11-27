# Live test with Chromium's fake microphone: Alice records a voice message
# (pause and resume included), sends it; Bob receives it with its length and
# waveform and plays it. Run: python3 tests/live/voice_browser.e2e.py
import time
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts, my_principal
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
ARGS=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
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
    b=pw.chromium.launch(args=ARGS); errs=[]
    A=setup(b.new_context(viewport={"width":1280,"height":860}, permissions=["microphone"]))
    B=setup(b.new_context(viewport={"width":1280,"height":860}))
    for pg,n in ((A,"A"),(B,"B")): pg.on("console", lambda m,n=n: errs.append(n+": "+m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    A.fill("#draft","hi"); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".convo:has(.request-tag)", timeout=120000); B.click(".convo:has(.request-tag)")
    B.click(".request-banner button:has-text('Accept')")
    # Record: 2 s, pause 1 s, resume 1.5 s.
    A.click("button[aria-label='Record a voice message']"); A.wait_for_selector(".voice-bar")
    A.wait_for_selector("button[aria-label='Pause recording']", timeout=10000)
    time.sleep(2); A.click("button[aria-label='Pause recording']"); time.sleep(1)
    print("A paused at:", A.inner_text(".voice-time"))
    A.locator(".composer").screenshot(path="/tmp/voice-recording.png")
    A.click("button[aria-label='Resume recording']"); time.sleep(1.5)
    A.click("button[aria-label='Send voice message']")
    A.wait_for_selector(".message.out .voice-msg", timeout=30000)
    print("A sent:", A.inner_text(".message.out .voice-meta"))
    B.wait_for_selector(".message.in .voice-msg", timeout=90000)
    print("B list preview:", B.inner_text(".convo:has-text('Voice message') .convo-preview") if B.locator(".convo:has-text('Voice message')").count() else "-")
    B.wait_for_selector(".message.in button[aria-label='Play voice message']:not([disabled])", timeout=60000)
    print("B received:", B.inner_text(".message.in .voice-meta"), "| bars:", B.locator(".message.in .voice-wave span").count())
    B.click(".message.in button[aria-label='Play voice message']")
    B.wait_for_function("() => { const a = document.querySelector('.message.in audio'); return a && a.currentTime > 1; }", timeout=15000)
    print("B playing at", round(B.evaluate("document.querySelector('.message.in audio').currentTime"),1), "s; played bars:", B.locator(".message.in .voice-wave span.played").count())
    # Click at 75 % of the waveform: playback should jump there.
    box = B.locator(".message.in .voice-wave").bounding_box()
    B.mouse.click(box["x"] + box["width"] * 0.75, box["y"] + box["height"] / 2); B.wait_for_timeout(400)
    print("after clicking at 75%:", round(B.evaluate("document.querySelector('.message.in audio').currentTime"),2), "s of 3.5 | duration known:", B.evaluate("isFinite(document.querySelector('.message.in audio').duration)"))
    B.locator(".message.in .attachment").screenshot(path="/tmp/voice-bubble.png")
    print("errors:", [e for e in errs][:3]); delete_accounts(b); b.close()
