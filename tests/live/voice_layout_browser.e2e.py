# Live test: an outgoing voice message fits its bubble (speed button inside) with the
# profile panel open, closed, and on a phone-sized screen. Run: python3 tests/live/voice_layout_browser.e2e.py
import time
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
ARGS=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
JS="""() => { const out = document.querySelector('.message.out:has(.voice-msg)'); const q = (s) => out.querySelector(s); const w = (e) => e ? Math.round(e.getBoundingClientRect().width) : null;
 const bubble = q('.voice-msg').closest('.bubble') || q('.attachment').parentElement;
 return { bubble: w(bubble), bubbleClass: bubble.className, attachment: w(q('.attachment')), voiceMsg: w(q('.voice-msg')), voiceScroll: q('.voice-msg').scrollWidth, wave: w(q('.voice-wave')), body: w(q('.voice-body')), speedRight: Math.round(q('.voice-speed').getBoundingClientRect().right), bubbleRight: Math.round(bubble.getBoundingClientRect().right),
   bubbleCss: (() => { const c = getComputedStyle(bubble); return { maxWidth: c.maxWidth, overflow: c.overflow, padding: c.padding, display: c.display, width: c.width }; })(),
   attCss: (() => { const c = getComputedStyle(q('.attachment')); return { maxWidth: c.maxWidth, width: c.width, overflow: c.overflow }; })() }; }"""
with sync_playwright() as pw:
    b=pw.chromium.launch(args=ARGS); ctx=b.new_context(viewport={"width":1280,"height":860}, permissions=["microphone"]); pg=ctx.new_page()
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000); pg.click("button.rail-me"); pg.wait_for_selector(".composer")
    pg.click("button[aria-label='Record a voice message']"); pg.wait_for_selector("button[aria-label='Pause recording']", timeout=10000); time.sleep(2)
    pg.click("button[aria-label='Send voice message']"); pg.wait_for_selector(".message.out .voice-msg", timeout=30000); pg.wait_for_timeout(800)
    CHECK = "() => { const out = document.querySelector('.message.out:has(.voice-msg)'); const bubble = out.querySelector('.bubble'); const br = bubble.getBoundingClientRect(); const sp = out.querySelector('.voice-speed').getBoundingClientRect(); const vm = out.querySelector('.voice-msg'); return { bubble: Math.round(br.width), voice: Math.round(vm.getBoundingClientRect().width), overflow: vm.scrollWidth - vm.clientWidth, speedInside: sp.right <= br.right - 4 && sp.left >= br.left }; }"
    print("1280 px, profile panel open:", pg.evaluate(CHECK))
    pg.click("aside.profile-panel button[aria-label^='Close']") if pg.locator("aside.profile-panel").count() else None
    pg.wait_for_timeout(400)
    print("1280 px, panel closed:", pg.evaluate(CHECK))
    pg.locator(".message.out:has(.voice-msg)").screenshot(path="/tmp/voice-out.png")
    pg.set_viewport_size({"width": 390, "height": 800}); pg.wait_for_timeout(500)
    print("390 px phone:", pg.evaluate(CHECK))
    pg.locator(".message.out:has(.voice-msg)").screenshot(path="/tmp/voice-out-phone.png")
    delete_accounts(b); b.close()
