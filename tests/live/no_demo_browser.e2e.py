# Live test: a new account sees no demo contacts, an empty chat list and a
# "No chats yet" start screen. Run: python3 tests/live/no_demo_browser.e2e.py
from playwright.sync_api import sync_playwright
from helpers import create_account, delete_accounts
URL="https://ydmpv-niaaa-aaaak-qzlua-cai.icp0.io/"
with sync_playwright() as pw:
    b=pw.chromium.launch(); ctx=b.new_context(viewport={"width":1280,"height":760}); pg=ctx.new_page(); errs=[]
    pg.on("console", lambda m: errs.append(m.text[:150]) if m.type=="error" and "pubKeyCred" not in m.text else None)
    cdp=ctx.new_cdp_session(pg); cdp.send("WebAuthn.enable")
    cdp.send("WebAuthn.addVirtualAuthenticator", {"options":{"protocol":"ctap2","transport":"internal","hasResidentKey":True,"hasUserVerification":True,"isUserVerified":True,"automaticPresenceSimulation":True}})
    pg.goto(URL, timeout=60000); pg.wait_for_selector("text=Sign in to OpenSocial", timeout=40000)
    create_account(pg); pg.wait_for_selector("text=Skip for now", timeout=120000); pg.click("text=Skip for now")
    pg.wait_for_selector("main[aria-label='No chat open']", timeout=60000)
    print("demo names on page:", sum(pg.locator(f"text={n}").count() for n in ("Emily Chen","James Carter","Sophia Lee","Demo contact")))
    print("chat items:", pg.locator(".convo").count(), "| empty screen:", pg.inner_text("main[aria-label='No chat open'] h2"))
    pg.screenshot(path="/tmp/nodemo.png"); print("errors:", errs[:3]); delete_accounts(b); b.close()
