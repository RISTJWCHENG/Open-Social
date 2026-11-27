# Live test (fake microphone): the recording controls sit at the right; pause
# shows the recording so far to listen to and seek; the microphone continues
# recording; the sent message has the full length. Run: python3 tests/live/voice_preview_browser.e2e.py
import time
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
ARGS=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", "--autoplay-policy=no-user-gesture-required"]
with sync_playwright() as pw:
    b=pw.chromium.launch(args=ARGS); ctx=b.new_context(viewport={"width":1280,"height":860}, permissions=["microphone"]); pg=ctx.new_page(); errs=[]
    pg.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000); pg.click("button.rail-me"); pg.wait_for_selector(".composer")
    pg.click("button[aria-label='Record a voice message']"); pg.wait_for_selector("button[aria-label='Pause recording']:not([disabled])", timeout=10000)
    time.sleep(2.2)
    gap = pg.evaluate("() => { const t = document.querySelector('button[aria-label=\"Delete recording\"]').getBoundingClientRect(); const s = document.querySelector('.send-btn').getBoundingClientRect(); return Math.round(s.left - t.right); }")
    print("recording: delete button to send button:", gap, "px")
    pg.locator(".composer").screenshot(path="/tmp/rec-1.png")
    pg.click("button[aria-label='Pause recording']")
    pg.wait_for_selector("button[aria-label='Play recording']:not([disabled])", timeout=10000)
    print("paused:", pg.inner_text(".voice-bar .voice-time"), "| continue mic:", pg.locator("button[aria-label='Continue recording']").count())
    pg.click("button[aria-label='Play recording']")
    pg.wait_for_function("() => { const a = document.querySelector('.voice-bar audio'); return a && a.currentTime > 0.6; }", timeout=10000)
    print("preview playing at", round(pg.evaluate("document.querySelector('.voice-bar audio').currentTime"), 1), "s")
    pg.locator(".composer").screenshot(path="/tmp/rec-2.png")
    box = pg.locator(".voice-preview").bounding_box(); pg.mouse.click(box["x"] + box["width"] * 0.25, box["y"] + box["height"] / 2); pg.wait_for_timeout(150)
    print("seek to 25%:", round(pg.evaluate("document.querySelector('.voice-bar audio').currentTime"), 2), "s")
    pg.click("button[aria-label='Continue recording']"); pg.wait_for_selector("button[aria-label='Pause recording']", timeout=5000)
    time.sleep(1.5)
    pg.click("button[aria-label='Send voice message']")
    pg.wait_for_selector(".message.out .voice-msg", timeout=30000); pg.wait_for_timeout(500)
    print("sent length:", pg.inner_text(".message.out .voice-meta").split("\n")[0], "| errors:", errs[:3]); delete_accounts(b); b.close()
