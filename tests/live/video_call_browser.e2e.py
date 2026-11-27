# Live test with real WebRTC and Chromium's fake camera/microphone: Alice
# video-calls Bob, Bob's browser rings and he accepts, both receive live
# video, mute/camera toggles work, Alice hangs up, both chats log the call.
# Run: python3 tests/live/video_call_browser.e2e.py
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
VIDEO = "() => { const v = document.querySelector('.call-remote'); return v && !v.hidden && v.videoWidth > 0 && v.currentTime > 0.3 ? v.videoWidth + 'x' + v.videoHeight : null; }"
with sync_playwright() as pw:
    b=pw.chromium.launch(args=ARGS); errs=[]
    A=setup(b.new_context(viewport={"width":1280,"height":800}, permissions=["camera","microphone"]))
    B=setup(b.new_context(viewport={"width":1280,"height":800}, permissions=["camera","microphone"]))
    for pg,n in ((A,"A"),(B,"B")): pg.on("console", lambda m,n=n: errs.append(n+": "+m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    A.fill("#draft","hi"); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".convo:has(.request-tag)", timeout=120000); B.click(".convo:has(.request-tag)"); B.click(".request-banner button:has-text('Accept')")
    time.sleep(2)
    A.locator("button[aria-label='Video call']:visible").first.click(); t0=time.time()
    A.wait_for_selector(".call-screen", timeout=10000); print("A:", A.inner_text(".call-top").replace("\n"," · "))
    B.wait_for_selector(".call-incoming", timeout=60000); print(f"B rings after {round(time.time()-t0,1)} s:", B.inner_text(".call-incoming").replace("\n"," · "))
    B.screenshot(path="/tmp/call-incoming.png", clip={"x":340,"y":0,"width":600,"height":130})
    B.click(".call-incoming button[aria-label='Accept']"); t1=time.time()
    A.wait_for_function(VIDEO, timeout=40000); B.wait_for_function(VIDEO, timeout=40000)
    print(f"connected in {round(time.time()-t1,1)} s | A sees Bob's video {A.evaluate(VIDEO)} | B sees Alice's video {B.evaluate(VIDEO)}")
    time.sleep(2); print("A status:", A.inner_text(".call-top span"))
    A.click("button[aria-label='Mute']"); A.click("button[aria-label='Turn camera off']")
    print("A toggles:", A.locator("button[aria-label='Unmute']").count(), A.locator("button[aria-label='Turn camera on']").count())
    A.click("button[aria-label='Turn camera on']")
    A.screenshot(path="/tmp/call-active.png")
    A.click("button[aria-label='Hang up']"); B.wait_for_selector(".call-screen", state="detached", timeout=30000)
    A.wait_for_selector(".call-log", timeout=10000); B.wait_for_selector(".call-log", timeout=30000)
    print("A log:", A.inner_text(".call-log").replace("\n"," "), "| B log:", B.inner_text(".call-log").replace("\n"," "))
    print("errors:", errs[:3]); delete_accounts(b); b.close()
