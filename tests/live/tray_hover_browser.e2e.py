# Live test: hovering a remove button (one photo, or remove all) shows a red x on a
# pale magenta circle. Run: python3 tests/live/tray_hover_browser.e2e.py  (needs /tmp/p0.jpg..p11.jpg)
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
    C = "(sel) => { const e = document.querySelector(sel); const c = getComputedStyle(e); return c.backgroundColor + ' / x ' + c.color; }"
    print("one photo's x, normal:", pg.evaluate(C, ".tray-remove"))
    pg.hover(".tray-item >> nth=1 >> .tray-remove"); pg.wait_for_timeout(250)
    print("one photo's x, hover:", pg.evaluate("() => { const e = document.querySelectorAll('.tray-remove')[1]; const c = getComputedStyle(e); return c.backgroundColor + ' / x ' + c.color; }"))
    pg.screenshot(path="/tmp/hover1.png", clip={"x":430,"y":550,"width":330,"height":130})
    print("remove all, normal:", pg.evaluate(C, ".tray-clear"))
    pg.hover(".tray-clear"); pg.wait_for_timeout(250)
    print("remove all, hover:", pg.evaluate(C, ".tray-clear"))
    pg.screenshot(path="/tmp/hover2.png", clip={"x":780,"y":540,"width":160,"height":90}); delete_accounts(b); b.close()
