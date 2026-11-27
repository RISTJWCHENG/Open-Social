# Live test: highlighted messages appear in chat order (newest last), each with the
# sender's photo and the same bubble as in the chat (voice plays, photo shows).
# Run: python3 tests/live/highlights_view_browser.e2e.py  (needs /tmp/p0.jpg)
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
def highlight(pg, msg):
    bubble = msg.locator(".bubble").first; bubble.hover(); msg.locator(".msg-action[aria-label='Message options']").click()
    pg.get_by_role("menuitem", name="Highlight", exact=True).click(); pg.wait_for_timeout(300)
with sync_playwright() as pw:
    b=pw.chromium.launch(args=ARGS); errs=[]
    A=setup(b.new_context(viewport={"width":1440,"height":900}, permissions=["microphone"])); B=setup(b.new_context(viewport={"width":1280,"height":860}, permissions=["microphone"]))
    A.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Unbreakable")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Unbreakable']", timeout=30000)
    A.fill("#draft","first, from me"); A.press("#draft","Enter")
    B.wait_for_selector(".convo:has(.request-tag)", timeout=120000); B.click(".convo:has(.request-tag)"); B.click(".request-banner button:has-text('Accept')")
    # Bob sends a voice message and a text.
    B.click("button[aria-label='Record a voice message']"); B.wait_for_selector("button[aria-label='Pause recording']", timeout=10000); time.sleep(2.2)
    B.click("button[aria-label='Send voice message']"); B.wait_for_selector(".message.out .voice-msg", timeout=30000)
    B.fill("#draft","法豆腐干大师傅"); B.press("#draft","Enter")
    with A.expect_file_chooser() as fc: A.click("button[aria-label='Attach files']")
    A.wait_for_selector(".message.in .voice-msg", timeout=90000); A.wait_for_selector(".message.in:has-text('法豆腐干')", timeout=60000)
    fc.value.set_files(["/tmp/p0.jpg"]); A.click("[aria-label='Send encrypted']"); A.wait_for_selector(".message.out img.att-media", timeout=60000)
    A.fill("#draft","最后一条"); A.press("#draft","Enter"); A.wait_for_timeout(800)
    msgs = A.locator(".messages .message")
    # Highlight out of order: last, then voice, then first, then photo.
    highlight(A, A.locator(".messages .message:has-text('最后一条')"))
    highlight(A, A.locator(".messages .message:has(.voice-msg)"))
    highlight(A, A.locator(".messages .message:has-text('first, from me')"))
    highlight(A, A.locator(".messages .message:has(img.att-media)"))
    items = A.locator(".highlights-item")
    print("order:", [i.locator(".bubble").inner_text().replace("\n", " ")[:24] or "[photo]" for i in items.all()])
    print("avatars:", items.locator(".msg-avatar").count(), "| voice player in panel:", A.locator(".highlights-list .voice-msg").count(), "| photo in panel:", A.locator(".highlights-list img.att-media").count())
    A.locator(".highlights-list button[aria-label='Play voice message']").click()
    A.wait_for_function("() => { const a = document.querySelector('.highlights-list audio'); return a && a.currentTime > 0.4; }", timeout=15000)
    print("voice plays in the panel")
    print("width:", round(A.locator("aside.highlights-panel").bounding_box()["width"]))
    A.locator("aside.highlights-panel").screenshot(path="/tmp/highlights2.png")
    print("errors:", errs[:3]); delete_accounts(b); b.close()
