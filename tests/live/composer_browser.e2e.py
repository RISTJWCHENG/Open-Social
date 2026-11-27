# Live test: ⋮ when the message box is empty (menu with Poll, Video call, Voice call),
# send button only while typing. Run: python3 tests/live/composer_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":760}, device_scale_factor=2); pg=ctx.new_page(); errs=[]
    pg.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000); pg.click("button.rail-me"); pg.wait_for_selector(".composer")
    order = pg.evaluate("() => [...document.querySelectorAll('.composer-inner > button, .composer-inner > input#draft, .composer-inner > .composer-more > button')].map((e) => e.id === 'draft' ? 'INPUT' : e.getAttribute('aria-label').split(' (')[0])")
    print("order:", order)
    print("empty: send", pg.locator(".send-btn").count(), "| more", pg.locator("button[aria-label='More options']").count(), "| mic in bar", pg.locator(".composer-inner button[aria-label^='Voice message']").count())
    pg.locator(".composer").screenshot(path="/tmp/c1.png")
    pg.click("button[aria-label='More options']"); pg.wait_for_selector(".composer-menu")
    print("menu:", pg.locator(".composer-menu-item").all_inner_texts())
    pg.screenshot(path="/tmp/c2.png", clip={"x":560,"y":540,"width":420,"height":220})
    pg.keyboard.press("Escape"); pg.fill("#draft", "Hello")
    print("typing: send", pg.locator(".send-btn").count(), "| more", pg.locator("button[aria-label='More options']").count(), "| mic", pg.locator(".composer-inner button[aria-label^='Voice message']").count())
    pg.locator(".composer").screenshot(path="/tmp/c3.png")
    pg.click(".send-btn"); pg.wait_for_selector(".message.out:has-text('Hello')", timeout=20000)
    with pg.expect_file_chooser() as fc:
        pg.click("button[aria-label='Attach files']")
    fc.value.set_files(["/tmp/note.txt"])
    pg.wait_for_selector(".message.out:has-text('note.txt')", timeout=20000); print("+ opened the file picker and sent note.txt")
    print("after send: more", pg.locator("button[aria-label='More options']").count(), "| mic", pg.locator(".composer-inner button[aria-label^='Voice message']").count(), "| errors:", errs[:3]); delete_accounts(b); b.close()
