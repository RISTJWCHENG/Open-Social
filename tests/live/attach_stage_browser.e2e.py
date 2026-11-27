# Live test: chosen files wait in a tray above the message box (nothing is
# sent), can be removed, and go with the typed caption only on send. Uses a
# detail-rich photo (largest previews). Run: python3 tests/live/attach_stage_browser.e2e.py
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
    for pg,n in ((A,"A"),(B,"B")): pg.on("console", lambda m,n=n: errs.append(n+": "+m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    pB=signup(B); signup(A)
    A.click("button[aria-label='New chat']"); A.fill("input[placeholder='xxxxx-xxxxx-…-xxx']", pB); A.fill("input[placeholder='e.g. Alice from work']", "Bob")
    A.click("text=Start chat"); A.wait_for_selector("main[aria-label='Conversation with Bob']", timeout=30000)
    A.fill("#draft","hi"); A.click("[aria-label='Send encrypted']")
    B.wait_for_selector(".convo:has(.request-tag)", timeout=120000); B.click(".convo:has(.request-tag)"); B.click(".request-banner button:has-text('Accept')")
    sent_before = A.locator(".message.out").count()
    with A.expect_file_chooser() as fc: A.click("button[aria-label='Attach files']")
    fc.value.set_files(["/tmp/detailed.jpg", "/tmp/report.pdf"])
    A.wait_for_selector(".tray .tray-item", timeout=10000); A.wait_for_timeout(800)
    print("tray items:", A.locator(".tray .tray-item").count(), "| sent meanwhile:", A.locator(".message.out").count() - sent_before,
          "| placeholder:", A.get_attribute("#draft", "placeholder"), "| send shown:", A.locator(".send-btn").count(), "| mic:", A.locator("button[aria-label='Record a voice message']").count())
    A.click("button[aria-label='Remove report.pdf']"); print("after removing the pdf:", A.locator(".tray .tray-item").count())
    A.fill("#draft", "Kavárna Slavia, Prague ☕")
    A.locator(".composer").screenshot(path="/tmp/tray.png")
    A.click("button[aria-label='Send encrypted']")
    A.wait_for_selector(".message.out:has-text('Kavárna Slavia')", timeout=60000)
    A.wait_for_function("() => { const m = [...document.querySelectorAll('.message.out')].find((e) => e.textContent.includes('Kavárna')); return m && !m.textContent.includes('Sending') && !m.textContent.includes('Not sent'); }", timeout=120000)
    print("A sent:", "Not sent" not in A.inner_text(".message.out:has-text('Kavárna Slavia')"), "| tray gone:", A.locator(".tray").count() == 0, "| error:", A.locator(".composer .result.bad").count())
    B.wait_for_selector(".message.in:has-text('Kavárna Slavia') img", timeout=120000)
    print("B got photo + caption:", B.locator(".message.in:has-text('Kavárna Slavia') .bubble-text").inner_text())
    print("errors:", errs[:3]); delete_accounts(b); b.close()
