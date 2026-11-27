# Live test: Settings opens as a right-hand panel beside the chat (688 px),
# and slides over the chat on narrower screens. Run: python3 tests/live/settings_panel_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
with sync_playwright() as pw:
    b=pw.chromium.launch()
    for w,h in ((1920,980),(1366,768)):
        ctx=b.new_context(viewport={"width":w,"height":h}); pg=ctx.new_page()
        cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
        cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
        pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
        create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
        pg.wait_for_selector("button.rail-me:not([disabled])", timeout=60000)
        pg.click("[aria-label='Menu']"); pg.click(".menu-settings"); pg.wait_for_selector("aside.settings-panel")
        for tab in ("Profile", "Account", "Community"):
            pg.click(f"[role=tab]:has-text('{tab}')"); pg.wait_for_timeout(400)
            panel=pg.locator("aside.settings-panel").bounding_box(); chat=pg.locator("main.chat-main").bounding_box()
            print(f"{w}px {tab}: panel w={round(panel['width'])} x={round(panel['x'])}; chat w={round(chat['width'])}")
            if tab != "Community": pg.screenshot(path=f"/tmp/settings-{w}-{tab}.png")
        contact=None
        pg.click("[aria-label='Close settings']"); print(f"{w}px: closed, panel present:", pg.locator("aside.settings-panel").count())
        delete_account(pg); ctx.close()
    delete_accounts(b); b.close()
