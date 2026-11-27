# Live test: the round x on the tray corner removes all attachments and keeps the text.
# Run: python3 tests/live/tray_clear_browser.e2e.py  (makes no files itself: needs /tmp/p0.jpg..p11.jpg)
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
M="() => { const l = document.querySelector('.tray-list'); const items = [...l.querySelectorAll('.tray-item')]; const bottom = Math.max(...items.map((e) => e.getBoundingClientRect().bottom)); return { overflowing: l.classList.contains('overflowing'), gapBelowItems: Math.round(l.getBoundingClientRect().bottom - bottom), scrollbar: l.offsetHeight - l.clientHeight }; }"
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":760}); pg=ctx.new_page()
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000); pg.click("button.rail-me"); pg.wait_for_selector(".composer")
    with pg.expect_file_chooser() as fc: pg.click("button[aria-label='Attach files']")
    fc.value.set_files([f"/tmp/p{i}.jpg" for i in range(2)]); pg.wait_for_timeout(500)
    print("2 photos:", pg.evaluate(M))
    with pg.expect_file_chooser() as fc: pg.click("button[aria-label='Add more files']")
    fc.value.set_files([f"/tmp/p{i}.jpg" for i in range(2, 12)]); pg.wait_for_timeout(600)
    print("12 photos:", pg.evaluate(M))
    pg.fill("#draft", "keep this caption")
    pg.screenshot(path="/tmp/tray-clear.png", clip={"x":400,"y":540,"width":880,"height":220})
    box = pg.locator(".tray-clear").bounding_box(); tray = pg.locator(".tray").bounding_box()
    print("button on the corner:", round(box["x"] + box["width"]/2 - (tray["x"] + tray["width"])), round(box["y"] + box["height"]/2 - tray["y"]), "px from the corner")
    pg.click("button[aria-label='Remove all attachments']"); pg.wait_for_timeout(300)
    print("after Remove all: tray", pg.locator(".tray").count(), "| text kept:", pg.input_value("#draft"), "| send still shown (text):", pg.locator(".send-btn").count())
    delete_accounts(b); b.close()
