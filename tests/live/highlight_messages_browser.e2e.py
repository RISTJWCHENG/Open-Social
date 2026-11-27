# Live test: Highlight in a message's menu switches the right panel (same width) to
# the highlighted messages; jump, remove, back to the profile; the top-right star
# icon counts them. Run: python3 tests/live/highlight_messages_browser.e2e.py  (needs /tmp/p0.jpg)
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
def highlight(pg, sel):
    bubble = pg.locator(sel).first.locator(".bubble"); bubble.hover(); bubble.locator("xpath=..").locator(".msg-action[aria-label='Message options']").click()
    pg.get_by_role("menuitem", name="Highlight", exact=True).click()
with sync_playwright() as pw:
    b=pw.chromium.launch(); errs=[]
    A=setup(b.new_context(viewport={"width":1440,"height":860})); B=setup(b.new_context(viewport={"width":1280,"height":860}))
    A.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    for t in ["hello Bob", "the address is Národní 1012, Prague", "see you at nine"]:
        A.fill("#draft", t); A.press("#draft", "Enter"); A.wait_for_timeout(300)
    with A.expect_file_chooser() as fc: A.click("button[aria-label='Attach files']")
    fc.value.set_files(["/tmp/p0.jpg"]); A.fill("#draft", "the café"); A.click("[aria-label='Send encrypted']")
    A.wait_for_selector(".message.out:has-text('the café') img", timeout=60000)
    w0 = round(A.locator("aside.profile-panel").bounding_box()["width"])
    highlight(A, ".message.out:has-text('Národní')")
    A.wait_for_selector("aside[aria-label='Highlighted messages']", timeout=5000)
    print("panel after Highlight:", A.get_attribute("aside.profile-panel", "aria-label"), "| width", w0, "->", round(A.locator("aside.profile-panel").bounding_box()["width"]))
    highlight(A, ".message.out:has-text('the café')")
    print("highlighted list:", [t.replace("\n", " / ") for t in A.locator(".highlights-item").all_inner_texts()])
    print("toolbar pin icon:", A.get_attribute(".chat-toolbar button[aria-pressed]", "aria-label"), "| pin marks in chat:", A.locator(".msg-pin").count())
    A.screenshot(path="/tmp/highlights.png", clip={"x":900,"y":0,"width":540,"height":620})
    A.locator(".highlights-item:has-text('Národní') .highlights-main").click(); A.wait_for_timeout(300)
    print("jump: flashing message:", A.locator(".message.flash").inner_text().split("\n")[0])
    A.locator(".highlights-item:has-text('Národní') .highlights-remove").click(); A.wait_for_timeout(300)
    print("after remove:", A.locator(".highlights-item").count(), "item(s) | count badge:", A.inner_text(".toolbar-count"))
    A.click("button[aria-label='Back to profile']"); print("back:", A.get_attribute("aside.profile-panel", "aria-label"))
    A.click(".chat-toolbar button[aria-label^='Highlighted messages']"); print("toolbar icon opens:", A.get_attribute("aside.profile-panel", "aria-label"))
    print("errors:", errs[:3]); delete_accounts(b); b.close()
